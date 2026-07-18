/**
 * Knowledge Universe — WebGL galaxy view of the collection.
 *
 * Documents are stars, extracts orbit as planets, flashcards as moons;
 * categories form constellations wrapped in nebulae. Semantic zoom:
 * universe → star system → node, with full click-through, search warp, and
 * keyboard travel. Rendering is on-demand (zero frames when idle); when WebGL
 * is unavailable the Canvas 2D ObsidianSphere renders instead.
 *
 * Prop-compatible with ObsidianSphere so tab/page wiring is a drop-in swap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useI18n } from "../../lib/i18n";
import { useIsActiveTab } from "../common/Tabs/TabContent";
import { GraphNodeType, type GraphNode } from "./KnowledgeGraph";
import { useMobileShell } from "../../hooks/useMobileShell";
import { ObsidianSphere } from "./ObsidianSphere";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { UniverseEngine, WebGLUnavailableError } from "./universe/engine";
import { computeUniverseLayout } from "./universe/layout";
import type { FocusState, KnowledgeUniverseProps, Vec3 } from "./universe/types";
import {
  ArrowCounterClockwise,
  CaretRight,
  Info,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Planet,
  Sparkle,
  X,
} from "@phosphor-icons/react";

/** Touch-only: how long an empty-space tap waits for a possible double-tap. */
const EMPTY_TAP_DEFER_MS = 275;
/** Zoom-step factors for double-tap (in) — two-finger tap zoom-out lives in the engine. */
const DOUBLE_TAP_ZOOM_FACTOR = 0.55;

interface OverlayAnchor {
  key: string;
  kind: "cluster" | "star" | "hover";
  text: string;
  sub?: string;
  nodeId?: string;
  world?: Vec3;
}

export function KnowledgeUniverse(props: KnowledgeUniverseProps) {
  const {
    nodes,
    edges = [],
    onNodeClick,
    onNodeDoubleClick,
    onNodeContextMenu,
    onNodeDelete,
    onNodeSave,
    showHeader = true,
    selectedNodeId: propsSelectedNodeId,
  } = props;

  const { t } = useI18n();
  const { theme } = useTheme();
  const isDark = theme.variant === "dark";
  const isActiveTab = useIsActiveTab();
  const isMobile = useMobileShell();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<UniverseEngine | null>(null);

  const [webglFailed, setWebglFailed] = useState(false);
  const [focus, setFocus] = useState<FocusState>({ level: "universe" });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(props.selectedNodeId ?? null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [ambientOn, setAmbientOn] = useState(true);

  const layout = useMemo(() => computeUniverseLayout(nodes, edges), [nodes, edges]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Refs so the engine (created once) always sees fresh values.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const selectedRef = useRef(selectedNodeId);
  selectedRef.current = selectedNodeId;
  const propsRef = useRef(props);
  propsRef.current = props;

  // Touch tap disambiguation: empty-space taps defer briefly so a double-tap
  // can turn into a zoom instead of a back-navigation.
  const lastPointerTypeRef = useRef<string>("mouse");
  const pendingEmptyTapRef = useRef<number | null>(null);

  const clearPendingEmptyTap = useCallback(() => {
    if (pendingEmptyTapRef.current !== null) {
      window.clearTimeout(pendingEmptyTapRef.current);
      pendingEmptyTapRef.current = null;
    }
  }, []);

  useEffect(() => clearPendingEmptyTap, [clearPendingEmptyTap]);

  // ---------------------------------------------------------- overlay labels

  const labelEls = useRef(new Map<string, HTMLDivElement | null>());
  const anchorsRef = useRef<OverlayAnchor[]>([]);

  const syncLabels = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const anchor of anchorsRef.current) {
      const el = labelEls.current.get(anchor.key);
      if (!el) continue;
      const p = anchor.nodeId
        ? engine.projectToScreen(anchor.nodeId)
        : anchor.world
          ? engine.projectPoint(anchor.world.x, anchor.world.y, anchor.world.z)
          : null;
      if (!p || !p.visible) {
        el.style.opacity = "0";
        continue;
      }
      el.style.opacity = "1";
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  }, []);
  const syncLabelsRef = useRef(syncLabels);
  syncLabelsRef.current = syncLabels;

  // ------------------------------------------------------------- engine init

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let engine: UniverseEngine;
    try {
      engine = new UniverseEngine(canvas, {
        reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
        callbacks: {
          onHoverChange: (id) => {
            setHoveredNodeId(id);
            const node = id ? propsRef.current.nodes.find((n) => n.id === id) ?? null : null;
            propsRef.current.onNodeHover?.(node);
          },
          onFrame: () => syncLabelsRef.current(),
          onContextLost: () => setWebglFailed(true),
        },
      });
    } catch (err) {
      if (err instanceof WebGLUnavailableError) {
        setWebglFailed(true);
        return;
      }
      throw err;
    }
    engineRef.current = engine;
    if (import.meta.env.DEV) {
      (window as any).__universeDebug = engine;
    }

    const ro = new ResizeObserver(() => {
      engine.resize(container.clientWidth, container.clientHeight);
    });
    ro.observe(container);
    engine.resize(container.clientWidth, container.clientHeight);

    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMedia = () => engine.setReducedMotion(media?.matches ?? false);
    media?.addEventListener?.("change", onMedia);

    return () => {
      media?.removeEventListener?.("change", onMedia);
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
      if (import.meta.env.DEV && (window as any).__universeDebug === engine) {
        delete (window as any).__universeDebug;
      }
    };
  }, []);

  // Data → engine; drop stale focus/selection when the collection changes.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setData(layout, nodes, edges);
    const f = focusRef.current;
    if (f.level !== "universe" && !layout.systems.has(f.docId)) {
      setFocus({ level: "universe" });
      engine.setFocus({ level: "universe" }, { instant: true });
    } else if (f.level !== "universe") {
      engine.setFocus(f, { instant: true });
    }
    if (selectedRef.current && !layout.placements.has(selectedRef.current)) {
      setSelectedNodeId(null);
      engine.setSelected(null);
    }
  }, [layout, nodes, edges]);

  // Theme → engine
  useEffect(() => {
    engineRef.current?.setTheme({
      isDark,
      background: theme.colors.background,
      accent: theme.colors.primary,
    });
  }, [theme, isDark]);

  // Tab activity → hard-stop rendering in background tabs
  useEffect(() => {
    engineRef.current?.setActive(isActiveTab);
  }, [isActiveTab]);

  useEffect(() => {
    engineRef.current?.setAmbientEnabled(ambientOn);
  }, [ambientOn]);

  useEffect(() => {
    if (propsSelectedNodeId !== undefined) {
      setSelectedNodeId(propsSelectedNodeId);
      engineRef.current?.setSelected(propsSelectedNodeId);
    }
  }, [propsSelectedNodeId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (selectedNodeId && !isMobile) {
      engine.setViewportOffset(180);
    } else {
      engine.setViewportOffset(0);
    }
  }, [selectedNodeId, isMobile]);

  // ------------------------------------------------------------- navigation

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
    engineRef.current?.setSelected(id);
  }, []);

  const applyFocus = useCallback((f: FocusState, opts?: { warp?: boolean }) => {
    setFocus(f);
    if (opts?.warp) engineRef.current?.warpTo(f);
    else engineRef.current?.setFocus(f);
  }, []);

  const popFocus = useCallback(() => {
    const f = focusRef.current;
    if (f.level === "node") {
      selectNode(null);
      applyFocus({ level: "system", docId: f.docId });
    } else if (f.level === "system") {
      selectNode(null);
      applyFocus({ level: "universe" });
    }
  }, [applyFocus, selectNode]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      const engine = engineRef.current;
      const lay = layoutRef.current;
      if (!engine || !lay) return;
      if (engine.consumeClickSuppression()) return; // drag, not a click
      containerRef.current?.focus({ preventScroll: true });

      const id = engine.pickAt(e.clientX, e.clientY);
      if (!id) {
        // Click on empty space: clear selection first, then pop one level.
        const popOrClear = () => {
          if (selectedRef.current) selectNode(null);
          else popFocus();
        };
        if (lastPointerTypeRef.current === "touch") {
          if (pendingEmptyTapRef.current !== null) {
            // Second tap within the window — double-tap zoom, not back-nav.
            clearPendingEmptyTap();
            engine.zoomToward(e.clientX, e.clientY, DOUBLE_TAP_ZOOM_FACTOR, { animated: true });
          } else {
            pendingEmptyTapRef.current = window.setTimeout(() => {
              pendingEmptyTapRef.current = null;
              popOrClear();
            }, EMPTY_TAP_DEFER_MS);
          }
          return;
        }
        popOrClear();
        return;
      }
      // A node tap cancels any pending empty-space back-navigation.
      clearPendingEmptyTap();
      const node = nodeMap.get(id);
      if (!node) return;
      onNodeClick?.(node);

      const placement = lay.placements.get(id);
      const isStar = node.type === GraphNodeType.Document || node.type === GraphNodeType.Rss;
      if (isStar && lay.systems.has(id)) {
        selectNode(id);
        const f = focusRef.current;
        if (f.level === "universe" || f.docId !== id) {
          applyFocus({ level: "system", docId: id }); // fly into the system
        }
      } else if (placement && placement.systemIndex >= 0) {
        const docId = lay.systemList[placement.systemIndex].docId;
        selectNode(id);
        applyFocus({ level: "node", docId, nodeId: id });
      } else {
        selectNode(id); // tag / category / belt orphan: select in place
      }
    },
    [nodeMap, onNodeClick, applyFocus, popFocus, selectNode, clearPendingEmptyTap]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      const id = engine.pickAt(e.clientX, e.clientY);
      const node = id ? nodeMap.get(id) : null;
      if (node) onNodeDoubleClick?.(node);
    },
    [nodeMap, onNodeDoubleClick]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const engine = engineRef.current;
      if (!engine) return;
      const id = engine.pickAt(e.clientX, e.clientY);
      const node = id ? nodeMap.get(id) : null;
      if (node) onNodeContextMenu?.(node, { x: e.clientX, y: e.clientY });
    },
    [nodeMap, onNodeContextMenu]
  );

  const cycleSelection = useCallback(
    (dir: 1 | -1) => {
      const lay = layoutRef.current;
      if (!lay) return;
      const f = focusRef.current;
      let list: string[] = [];
      if (f.level === "universe") {
        list = lay.systemList.map((s) => s.docId);
      } else {
        const sys = lay.systems.get(f.docId);
        if (!sys) return;
        list = [
          sys.docId,
          ...sys.extractIds,
          ...sys.extractIds.flatMap((eid) => sys.moonsByExtract.get(eid) ?? []),
        ];
      }
      if (list.length === 0) return;
      const cur = selectedRef.current ? list.indexOf(selectedRef.current) : -1;
      const next = list[(cur + dir + list.length) % list.length];
      selectNode(next);
    },
    [selectNode]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
          return;
        }
        if (selectedRef.current) {
          selectNode(null);
          if (focusRef.current.level === "node") {
            applyFocus({ level: "system", docId: focusRef.current.docId });
          }
        } else {
          popFocus();
        }
      } else if (e.key === "Tab" || e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        cycleSelection(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        cycleSelection(-1);
      } else if (e.key === "Enter") {
        const node = selectedRef.current ? nodeMap.get(selectedRef.current) : null;
        if (node) onNodeDoubleClick?.(node);
      }
    },
    [searchOpen, selectNode, applyFocus, popFocus, cycleSelection, nodeMap, onNodeDoubleClick]
  );

  // ---------------------------------------------------------------- search

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => n.label?.toLowerCase().includes(q)).slice(0, 12);
  }, [searchQuery, nodes]);

  useEffect(() => {
    engineRef.current?.setSearchMatches(new Set(searchMatches.map((m) => m.id)));
  }, [searchMatches]);

  const warpToNode = useCallback(
    (node: GraphNode) => {
      const lay = layoutRef.current;
      const engine = engineRef.current;
      if (!lay || !engine) return;
      const placement = lay.placements.get(node.id);
      if (!placement) return;
      selectNode(node.id);
      if (placement.systemIndex >= 0) {
        const docId = lay.systemList[placement.systemIndex].docId;
        const f: FocusState =
          docId === node.id
            ? { level: "system", docId }
            : { level: "node", docId, nodeId: node.id };
        setFocus(f);
        engine.warpTo(f);
      } else {
        engine.flyToPoint(placement.position.x, placement.position.y, placement.position.z, 70, true);
      }
      setSearchOpen(false);
      setSearchQuery("");
    },
    [selectNode]
  );

  // ------------------------------------------------------------ overlay data

  const focusedSystem = focus.level !== "universe" ? layout.systems.get(focus.docId) : undefined;
  const focusedCluster =
    focusedSystem && focusedSystem.clusterKey
      ? layout.clusters.find((c) => c.key === focusedSystem.clusterKey)
      : undefined;

  const anchors = useMemo<OverlayAnchor[]>(() => {
    const list: OverlayAnchor[] = [];
    if (focus.level === "universe") {
      [...layout.clusters]
        .filter((c) => c.label)
        .sort((a, b) => b.docCount - a.docCount)
        .slice(0, 12)
        .forEach((c) => {
          list.push({
            key: `cluster:${c.key}`,
            kind: "cluster",
            text: c.label,
            sub: String(c.docCount),
            world: { x: c.center.x, y: c.center.y + c.radius * 0.55 + 12, z: c.center.z },
          });
        });
    } else if (focusedSystem) {
      const doc = nodeMap.get(focusedSystem.docId);
      list.push({
        key: `star:${focusedSystem.docId}`,
        kind: "star",
        text: doc?.label ?? "",
        sub:
          focusedSystem.pagedExtracts > 0
            ? t("universe.moreOrbits", { count: focusedSystem.pagedExtracts })
            : undefined,
        nodeId: focusedSystem.docId,
      });
    }
    if (hoveredNodeId && hoveredNodeId !== selectedNodeId) {
      const node = nodeMap.get(hoveredNodeId);
      if (node) {
        list.push({ key: `hover:${hoveredNodeId}`, kind: "hover", text: node.label, nodeId: hoveredNodeId });
      }
    }
    return list;
  }, [layout, focus, focusedSystem, hoveredNodeId, selectedNodeId, nodeMap, t]);

  useEffect(() => {
    anchorsRef.current = anchors;
    syncLabels();
    engineRef.current?.invalidate();
  }, [anchors, syncLabels]);

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

  // ---------------------------------------------------------------- fallback

  if (webglFailed) {
    return <ObsidianSphere {...props} />;
  }

  // ------------------------------------------------------------------ render

  const breadcrumb: Array<{ key: string; label: string; onClick?: () => void }> = [
    {
      key: "universe",
      label: t("universe.breadcrumbUniverse"),
      onClick:
        focus.level !== "universe"
          ? () => {
              selectNode(null);
              applyFocus({ level: "universe" });
            }
          : undefined,
    },
  ];
  if (focusedCluster?.label) {
    breadcrumb.push({
      key: `cluster`,
      label: focusedCluster.label,
      onClick: () => {
        selectNode(null);
        applyFocus({ level: "universe" });
      },
    });
  }
  if (focusedSystem) {
    const doc = nodeMap.get(focusedSystem.docId);
    breadcrumb.push({
      key: "doc",
      label: doc?.label ?? "",
      onClick:
        focus.level === "node"
          ? () => {
              selectNode(null);
              applyFocus({ level: "system", docId: focusedSystem.docId });
            }
          : undefined,
    });
  }
  if (focus.level === "node") {
    const node = nodeMap.get(focus.nodeId);
    if (node) breadcrumb.push({ key: "node", label: node.label });
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          lastPointerTypeRef.current = e.pointerType;
        }}
        onClick={handleCanvasClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Overlay labels (positions synced imperatively on rendered frames) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {anchors.map((a) => (
          <div
            key={a.key}
            ref={(el) => {
              labelEls.current.set(a.key, el);
            }}
            className="absolute left-0 top-0 will-change-transform"
            style={{ opacity: 0 }}
          >
            {a.kind === "cluster" && (
              <div className="-translate-x-1/2 -translate-y-full flex flex-col items-center gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground/70 drop-shadow">
                  {a.text}
                </span>
                <span className="text-[10px] text-muted-foreground/80">{a.sub}</span>
              </div>
            )}
            {a.kind === "star" && (
              <div className="-translate-x-1/2 translate-y-4 flex flex-col items-center gap-1 max-w-56">
                <span className="text-xs font-semibold text-foreground/90 drop-shadow truncate max-w-full">
                  {a.text}
                </span>
                {a.sub && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-card/80 border border-border text-muted-foreground">
                    {a.sub}
                  </span>
                )}
              </div>
            )}
            {a.kind === "hover" && (
              <div className="-translate-x-1/2 translate-y-3 px-2 py-0.5 rounded-lg bg-card/90 backdrop-blur border border-border shadow-lg max-w-64">
                <span className="text-xs text-foreground truncate block">{a.text}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Top bar: header + search (compact icon row on the mobile shell) */}
      <div
        className={
          isMobile
            ? "absolute top-3 left-3 right-3 flex items-start justify-end gap-2 pointer-events-none z-10"
            : "absolute top-4 left-6 right-6 flex items-start justify-between gap-4 pointer-events-none"
        }
      >
        {showHeader && !isMobile ? (
          <div className="pointer-events-auto">
            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Planet className="w-5 h-5 text-primary" />
              {t("universe.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("universe.subtitle", { count: nodes.length })}
            </p>
          </div>
        ) : (
          <div />
        )}

        <div className={`flex items-center gap-2 pointer-events-auto ${isMobile ? "flex-1 justify-end" : ""}`}>
          {/* Search — collapses to an icon on the mobile shell */}
          {isMobile && !mobileSearchOpen ? (
            <button
              onClick={() => setMobileSearchOpen(true)}
              className="w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all"
              title={t("universe.searchPlaceholder")}
            >
              <MagnifyingGlass className="w-5 h-5" />
            </button>
          ) : (
          <div className={isMobile ? "relative flex-1 min-w-0" : "relative"}>
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              autoFocus={isMobile}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => searchQuery && setSearchOpen(true)}
              placeholder={t("universe.searchPlaceholder")}
              className={`${isMobile ? "w-full" : "w-56"} pl-9 pr-8 py-2 bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary`}
            />
            {(searchQuery || isMobile) && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSearchOpen(false);
                  setMobileSearchOpen(false);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {searchOpen && searchQuery.trim() && (
              <div className={`absolute top-full mt-2 ${isMobile ? "left-0 right-0" : "right-0 w-72"} bg-card/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl overflow-hidden z-20`}>
                {searchMatches.length === 0 ? (
                  <div className="px-3 py-2.5 text-sm text-muted-foreground">{t("universe.noResults")}</div>
                ) : (
                  searchMatches.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => warpToNode(m)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: m.color || "#3b82f6" }}
                      />
                      <span className="truncate">{m.label}</span>
                      <span className="ml-auto text-[10px] uppercase text-muted-foreground flex-shrink-0">
                        {m.type}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          )}

          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all ${showInfo ? "text-primary" : ""}`}
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Breadcrumb trail — own scrollable row under the top bar on mobile */}
      <div
        className={
          isMobile
            ? "absolute top-16 left-3 right-3 pointer-events-auto overflow-x-auto"
            : "absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto"
        }
      >
        <div
          className={`flex items-center gap-1 px-3 py-1.5 bg-card/80 backdrop-blur border border-border rounded-xl shadow-lg ${
            isMobile ? "w-max" : "max-w-[42rem]"
          }`}
        >
          {breadcrumb.map((crumb, i) => (
            <div key={crumb.key} className="flex items-center gap-1 min-w-0">
              {i > 0 && <CaretRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
              {crumb.onClick ? (
                <button
                  onClick={crumb.onClick}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors truncate max-w-40"
                >
                  {crumb.label}
                </button>
              ) : (
                <span className="text-xs font-semibold text-foreground truncate max-w-40">{crumb.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div
          className={`absolute bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-5 pointer-events-auto z-10 ${
            isMobile ? "top-28 left-3 right-3" : "top-20 left-6 w-72"
          }`}
        >
          <h3 className="font-semibold mb-3">{t("universe.about")}</h3>
          <p className="text-sm text-muted-foreground mb-4">{t("universe.aboutDescription")}</p>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
              <span className="text-sm">{t("graph.documents")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
              <span className="text-sm">{t("graph.extracts")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
              <span className="text-sm">{t("graph.flashcards")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
              <span className="text-sm">{t("graph.categories")}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
              <span className="text-sm">{t("graph.tags")}</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">{t("universe.navHints")}</p>
          </div>
        </div>
      )}

      {/* Selected node detail panel */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          edges={edges}
          onClose={() => selectNode(null)}
          onFocus={() => {
            const placement = layout.placements.get(selectedNode.id);
            if (!placement) return;
            if (placement.systemIndex >= 0) {
              const docId = layout.systemList[placement.systemIndex].docId;
              applyFocus(
                docId === selectedNode.id
                  ? { level: "system", docId }
                  : { level: "node", docId, nodeId: selectedNode.id }
              );
            } else {
              engineRef.current?.flyToPoint(
                placement.position.x,
                placement.position.y,
                placement.position.z,
                70
              );
            }
          }}
          onOpen={onNodeDoubleClick}
          onSave={onNodeSave}
          onDelete={onNodeDelete}
        />
      )}

      {/* Floating controls — inset above gesture bars on mobile */}
      <div
        className={`absolute flex flex-col gap-2 pointer-events-auto ${isMobile ? "right-4" : "bottom-6 right-6"}`}
        style={isMobile ? { bottom: "calc(1.5rem + env(safe-area-inset-bottom))" } : undefined}
      >
        <button
          onClick={() => setAmbientOn(!ambientOn)}
          className={`w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all ${ambientOn ? "text-primary" : ""}`}
          title={t("universe.toggleAmbient")}
        >
          <Sparkle className="w-5 h-5" />
        </button>
        <div className="w-10 h-px bg-border my-1" />
        <button
          onClick={() => engineRef.current?.zoomBy(0.8)}
          className="w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all"
          title={t("graph.zoomIn")}
        >
          <MagnifyingGlassPlus className="w-5 h-5" />
        </button>
        <button
          onClick={() => engineRef.current?.zoomBy(1.25)}
          className="w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all"
          title={t("graph.zoomOut")}
        >
          <MagnifyingGlassMinus className="w-5 h-5" />
        </button>
        <button
          onClick={() => {
            selectNode(null);
            setFocus({ level: "universe" });
            engineRef.current?.resetView();
          }}
          className="w-10 h-10 flex items-center justify-center bg-card/90 backdrop-blur border border-border rounded-xl shadow-lg hover:bg-muted transition-all"
          title={t("graph.resetView")}
        >
          <ArrowCounterClockwise className="w-5 h-5" />
        </button>
      </div>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Planet className="w-12 h-12 mx-auto mb-3 text-muted-foreground/60" />
            <p className="text-muted-foreground">{t("universe.empty")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgeUniverse;
