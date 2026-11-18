/**
 * Knowledge Atlas View — Level 1 progressive overview.
 * Renders 5-18 semantic topic clusters with bundled cross-cluster bridge
 * ribbons and FSRS health / extract-density indicators.
 */

import { useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle,
  Compass,
  Flame,
  GitBranch,
  Highlighter,
  Stack,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  ClusterBridge,
  ClusterHealth,
  ClusterSummary,
  KnowledgeAtlasModel,
  KnowledgeLens,
} from "./graphAtlasModel";
import { cn } from "../../utils/cn";

export interface KnowledgeAtlasViewProps {
  atlas: KnowledgeAtlasModel;
  lens: KnowledgeLens;
  selectedClusterId: string | null;
  onSelectCluster: (cluster: ClusterSummary) => void;
  onInspectNode: (nodeId: string) => void;
}

function HealthBadge({ health, avgRetrievability, leechCount }: {
  health: ClusterHealth;
  avgRetrievability: number | null;
  leechCount: number;
}) {
  if (health === "critical") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive tabular-nums">
        <Flame className="h-3 w-3 shrink-0" weight="fill" aria-hidden="true" />
        <span>
          {leechCount > 0 ? `${leechCount} leech${leechCount === 1 ? "" : "es"}` : "Low retention"}
        </span>
      </span>
    );
  }
  if (health === "attention") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 tabular-nums">
        <WarningCircle className="h-3 w-3 shrink-0" weight="fill" aria-hidden="true" />
        <span>
          {avgRetrievability !== null ? `${Math.round(avgRetrievability * 100)}% R` : "Needs review"}
        </span>
      </span>
    );
  }
  if (health === "healthy") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 tabular-nums">
        <CheckCircle className="h-3 w-3 shrink-0" weight="fill" aria-hidden="true" />
        <span>
          {avgRetrievability !== null ? `${Math.round(avgRetrievability * 100)}% R` : "Healthy"}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
      <Stack className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>Indexed</span>
    </span>
  );
}

export function KnowledgeAtlasView({
  atlas,
  lens,
  selectedClusterId,
  onSelectCluster,
  onInspectNode,
}: KnowledgeAtlasViewProps) {
  const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null);
  const [hoveredBridgeId, setHoveredBridgeId] = useState<string | null>(null);

  const clusterMap = useMemo(
    () => new Map(atlas.clusters.map((c) => [c.id, c])),
    [atlas.clusters],
  );

  const activeClusterId = hoveredClusterId ?? selectedClusterId;

  const connectedClusterIds = useMemo(() => {
    if (!activeClusterId) return null;
    const set = new Set<string>([activeClusterId]);
    for (const b of atlas.bridges) {
      if (b.sourceClusterId === activeClusterId) set.add(b.targetClusterId);
      if (b.targetClusterId === activeClusterId) set.add(b.sourceClusterId);
    }
    return set;
  }, [activeClusterId, atlas.bridges]);

  const activeBridge: ClusterBridge | null = useMemo(
    () => atlas.bridges.find((b) => b.id === hoveredBridgeId) ?? null,
    [atlas.bridges, hoveredBridgeId],
  );

  if (atlas.clusters.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="knowledge-atlas-view"
      className="relative h-full w-full overflow-auto bg-background"
    >
      {/* Spatial Canvas (Desktop / Tablet) */}
      <div className="relative hidden min-h-[560px] h-full w-full md:block">
        {/* Bundled Bridge Ribbons SVG Layer */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 1000 700"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {atlas.bridges.map((bridge) => {
            const src = clusterMap.get(bridge.sourceClusterId);
            const tgt = clusterMap.get(bridge.targetClusterId);
            if (!src || !tgt) return null;

            const x1 = src.nx * 1000;
            const y1 = src.ny * 700;
            const x2 = tgt.nx * 1000;
            const y2 = tgt.ny * 700;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const cx = mx - dy * 0.14;
            const cy = my + dx * 0.14;

            const isHighlighted =
              hoveredBridgeId === bridge.id ||
              (activeClusterId !== null &&
                (bridge.sourceClusterId === activeClusterId ||
                  bridge.targetClusterId === activeClusterId));
            const isDimmed = activeClusterId !== null && !isHighlighted;
            const strokeWidth = Math.min(6, 1.5 + Math.log2(bridge.weight + 1) * 1.2);

            return (
              <path
                key={bridge.id}
                d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={isHighlighted ? strokeWidth + 1.5 : strokeWidth}
                strokeLinecap="round"
                className={cn(
                  "pointer-events-auto cursor-pointer transition-opacity",
                  isHighlighted
                    ? "text-primary opacity-80"
                    : isDimmed
                      ? "text-border opacity-15"
                      : "text-primary/35 opacity-60 hover:opacity-90",
                )}
                onMouseEnter={() => setHoveredBridgeId(bridge.id)}
                onMouseLeave={() => setHoveredBridgeId(null)}
              />
            );
          })}
        </svg>

        {/* Bridge Hover Callout */}
        {activeBridge && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground shadow-md">
            <span className="font-medium">
              {clusterMap.get(activeBridge.sourceClusterId)?.label} ↔{" "}
              {clusterMap.get(activeBridge.targetClusterId)?.label}
            </span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground tabular-nums">
              {activeBridge.weight} shared link{activeBridge.weight === 1 ? "" : "s"}
            </span>
            {activeBridge.conceptLabels.length > 0 && (
              <span className="ml-1.5 text-primary">
                ({activeBridge.conceptLabels.slice(0, 2).join(", ")})
              </span>
            )}
          </div>
        )}

        {/* Cluster Nodes */}
        {atlas.clusters.map((cluster) => {
          const isSelected = selectedClusterId === cluster.id;
          const isDimmed =
            connectedClusterIds !== null && !connectedClusterIds.has(cluster.id);
          const densityRatio =
            cluster.documentCount > 0
              ? Math.min(1, cluster.extractCount / (cluster.documentCount * 8))
              : 0;

          return (
            <div
              key={cluster.id}
              style={{
                left: `${cluster.nx * 100}%`,
                top: `${cluster.ny * 100}%`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
            >
              <button
                type="button"
                onClick={() => onSelectCluster(cluster)}
                onMouseEnter={() => setHoveredClusterId(cluster.id)}
                onMouseLeave={() => setHoveredClusterId(null)}
                className={cn(
                  "group w-56 rounded-2xl border p-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isSelected
                    ? "border-primary bg-card shadow-lg"
                    : "border-border bg-card/95 shadow-sm hover:border-primary/60 hover:bg-card",
                  isDimmed && "opacity-35",
                  lens === "orphans_bridges" &&
                    cluster.bridgeCount === 0 &&
                    "border-dashed border-amber-500/60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Compass
                        className="h-4 w-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {cluster.label}
                      </h3>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3 w-3" aria-hidden="true" />
                        {cluster.documentCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Highlighter className="h-3 w-3" aria-hidden="true" />
                        {cluster.extractCount}
                      </span>
                      {cluster.bridgeCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <GitBranch className="h-3 w-3" aria-hidden="true" />
                          {cluster.bridgeCount}
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Lens-aware footer */}
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  {lens === "extract_density" ? (
                    <div className="flex w-full items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(8, Math.round(densityRatio * 100))}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                        {cluster.documentCount > 0
                          ? `${(cluster.extractCount / cluster.documentCount).toFixed(1)}/doc`
                          : `${cluster.extractCount} ext`}
                      </span>
                    </div>
                  ) : lens === "orphans_bridges" ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                        cluster.bridgeCount > 0
                          ? "bg-primary/10 text-primary"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      <GitBranch className="h-3 w-3" aria-hidden="true" />
                      {cluster.bridgeCount > 0
                        ? `${cluster.bridgeCount} cross-links`
                        : "Isolated topic"}
                    </span>
                  ) : (
                    <HealthBadge
                      health={cluster.health}
                      avgRetrievability={cluster.avgRetrievability}
                      leechCount={cluster.leechCount}
                    />
                  )}

                  <span className="text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Focus →
                  </span>
                </div>

                {/* Top representative items preview */}
                {cluster.topNodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 border-t border-border/60 pt-2">
                    {cluster.topNodes.slice(0, 2).map((item) => (
                      <span
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onInspectNode(item.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onInspectNode(item.id);
                          }
                        }}
                        className="max-w-full truncate rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] text-foreground/80 hover:bg-primary/15 hover:text-primary"
                      >
                        {item.label}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Compact Responsive Grid (Phone / Small Screens) */}
      <div className="grid grid-cols-1 gap-3 p-4 pt-16 sm:grid-cols-2 md:hidden">
        {atlas.clusters.map((cluster) => (
          <button
            key={cluster.id}
            type="button"
            onClick={() => onSelectCluster(cluster)}
            className={cn(
              "rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/60",
              selectedClusterId === cluster.id && "border-primary",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {cluster.label}
              </h3>
              <HealthBadge
                health={cluster.health}
                avgRetrievability={cluster.avgRetrievability}
                leechCount={cluster.leechCount}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
              {cluster.documentCount} docs · {cluster.extractCount} extracts ·{" "}
              {cluster.bridgeCount} bridges
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
