import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, MagnifyingGlassMinus, MagnifyingGlassPlus, X } from "@phosphor-icons/react";
import type { ImageAsset } from "../../api/image-registry";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import {
  clampRegion,
  type OcclusionImgBounds,
  type OcclusionViewport,
  percentToViewport,
  viewportToPercent,
  zoomViewportAt,
} from "../../utils/occlusion";
import { pinchZoomFactor } from "../graph/universe/gestureMath";
import { useI18n } from "../../lib/i18n";
import type { OcclusionSession } from "./useOcclusionSession";

/**
 * Interactive occlusion canvas.
 *
 * Renders the image at fit-to-view size and applies zoom/pan as a CSS
 * transform (`translate(panX, panY) scale(scale)`, origin 0 0) on the
 * image+overlay wrapper. All region coordinates stay percent-based — the
 * viewport math in `src/utils/occlusion.ts` converts between screen and
 * percent space, so drawing at 400% stores the same percent coordinates as
 * drawing at fit-to-view, and panning never touches stored coordinates.
 *
 * Every mutation is routed through the session hook and commits exactly one
 * history entry on pointer-up (never per pointer-move). Pending suggestions
 * render distinctly with inline accept/reject controls; editing a suggestion
 * (drag or resize) accepts it in the same gesture.
 */

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface MoveGesture {
  kind: "move";
  ids: string[];
  startX: number;
  startY: number;
  /** The region objects at gesture start — never mutated during the gesture. */
  originals: ImageOcclusionRegion[];
  /** Live result of applying the drag delta to `originals`. */
  current: ImageOcclusionRegion[];
  /** When set, the gesture accepts this pending suggestion on commit. */
  acceptId?: string;
}

interface ResizeGesture {
  kind: "resize";
  id: string;
  handle: Handle;
  startX: number;
  startY: number;
  original: ImageOcclusionRegion;
  current: ImageOcclusionRegion;
}

interface DrawGesture {
  kind: "draw";
  originX: number;
  originY: number;
  draft: ImageOcclusionRegion;
}

interface RubberGesture {
  kind: "rubber";
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
}

interface PanGesture {
  kind: "pan";
  startClientX: number;
  startClientY: number;
  startViewport: OcclusionViewport;
}

interface PinchGesture {
  kind: "pinch";
  prevDist: number;
  prevMidX: number;
  prevMidY: number;
}

type Gesture = MoveGesture | ResizeGesture | DrawGesture | RubberGesture | PanGesture | PinchGesture | null;

const HANDLE_SIZE_PX = 10;
const HANDLE_HIT_PX_DESKTOP = 12;
const HANDLE_HIT_PX_TOUCH = 22; // 44 CSS px hit diameter

export interface OcclusionCanvasProps {
  asset: ImageAsset | null;
  session: OcclusionSession;
  /** Touch shells get larger handle hit areas and fewer rendered handles. */
  isTouch?: boolean;
  /**
   * When set, the canvas pans so this region becomes visible — used for
   * list→canvas selection sync. The id is intentionally sticky: bump
   * `requestFocusNonce` to request a re-focus of the same region.
   */
  requestFocusRegionId?: string | null;
  /** Bump to re-request focusing the same region id (list re-clicks). */
  requestFocusNonce?: number;
}

export function OcclusionCanvas({
  asset,
  session,
  isTouch = false,
  requestFocusRegionId = null,
  requestFocusNonce = 0,
}: OcclusionCanvasProps) {
  const { t } = useI18n();
  const { regions, suggestions, selection, viewport, apply } = session;

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgBounds, setImgBounds] = useState<OcclusionImgBounds | null>(null);
  const [gesture, setGesture] = useState<Gesture>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const spaceHeldRef = useRef(false);
  /** Id of the most recently committed draw, so Escape can remove it. */
  const lastDrawnRegionIdRef = useRef<string | null>(null);

  const handleHitPx = isTouch ? HANDLE_HIT_PX_TOUCH : HANDLE_HIT_PX_DESKTOP;

  // Ref mirror of the viewport so the focus effect can run without churning
  // every time the viewport changes.
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const capturePointer = useCallback((pointerId: number) => {
    // jsdom lacks real pointer capture; guard for tests.
    containerRef.current?.setPointerCapture?.(pointerId);
  }, []);

  const computeImgBounds = useCallback(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img || !img.naturalWidth || !img.naturalHeight) return;
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    setImgBounds({
      offsetX: imgRect.left - containerRect.left,
      offsetY: imgRect.top - containerRect.top,
      width: imgRect.width,
      height: imgRect.height,
    });
  }, []);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) computeImgBounds();
    img.addEventListener("load", computeImgBounds);
    const ro = new ResizeObserver(computeImgBounds);
    ro.observe(img);
    return () => {
      img.removeEventListener("load", computeImgBounds);
      ro.disconnect();
    };
  }, [asset, computeImgBounds]);

  /** Map a client coordinate to a percent point under the current viewport. */
  const toPercent = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      const bounds = imgBounds;
      if (!rect || !bounds) return null;
      return viewportToPercent(
        { x: clientX - rect.left, y: clientY - rect.top },
        viewport,
        bounds,
      );
    },
    [imgBounds, viewport],
  );

  const regionToPx = useCallback(
    (region: ImageOcclusionRegion) => {
      const bounds = imgBounds;
      if (!bounds) return null;
      const topLeft = percentToViewport({ x: region.x, y: region.y }, viewport, bounds);
      return {
        left: topLeft.x,
        top: topLeft.y,
        width: (region.width / 100) * bounds.width * viewport.scale,
        height: (region.height / 100) * bounds.height * viewport.scale,
      };
    },
    [imgBounds, viewport],
  );

  const setViewport = useCallback(
    (next: OcclusionViewport) => apply({ type: "setViewport", viewport: next }),
    [apply],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const bounds = imgBounds;
      if (!bounds || !rect) return;
      setViewport(
        zoomViewportAt(viewport, { x: rect.width / 2, y: rect.height / 2 }, factor),
      );
    },
    [imgBounds, setViewport, viewport],
  );

  const fitToView = useCallback(() => {
    setViewport({ scale: 1, panX: 0, panY: 0 });
  }, [setViewport]);

  // List→canvas selection sync: pan so the requested region becomes visible.
  useEffect(() => {
    if (!requestFocusRegionId) return;
    const region = regions.find((r) => r.id === requestFocusRegionId);
    const bounds = imgBounds;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!region || !bounds || !rect) return;
    const vp = viewportRef.current;
    const topLeft = percentToViewport({ x: region.x, y: region.y }, vp, bounds);
    const w = (region.width / 100) * bounds.width * vp.scale;
    const h = (region.height / 100) * bounds.height * vp.scale;
    const margin = 32;
    if (
      topLeft.x >= margin &&
      topLeft.y >= margin &&
      topLeft.x + w <= rect.width - margin &&
      topLeft.y + h <= rect.height - margin
    ) {
      return;
    }
    setViewport({
      ...vp,
      panX: vp.panX + (rect.width / 2 - (topLeft.x + w / 2)),
      panY: vp.panY + (rect.height / 2 - (topLeft.y + h / 2)),
    });
  }, [requestFocusRegionId, requestFocusNonce, regions, imgBounds, setViewport]);

  // Wheel zoom (also trackpad pinch, which arrives as ctrl+wheel). Native and
  // non-passive so preventDefault reliably stops page scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.002);
      const bounds = imgBounds;
      if (!bounds) return;
      setViewport(
        zoomViewportAt(
          viewport,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          factor,
        ),
      );
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [imgBounds, viewport, setViewport]);

  // Space key for pan (window-level so it works regardless of focus).
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spaceHeldRef.current = true;
        if (
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLTextAreaElement)
        ) {
          event.preventDefault();
        }
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceHeldRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const hitHandle = useCallback(
    (clientX: number, clientY: number): { id: string; handle: Handle } | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      const bounds = imgBounds;
      if (!rect || !bounds) return null;
      // Only handles that are actually rendered are hit-testable: the active
      // (last-selected) region. Pending suggestions have no rendered handles —
      // editing one accepts it via a body drag instead.
      const targetId = selection.length > 0 ? selection[selection.length - 1] : null;
      const region = targetId ? regions.find((r) => r.id === targetId) : undefined;
      if (!region) return null;
      const px = percentToViewport({ x: region.x, y: region.y }, viewport, bounds);
      const pw = (region.width / 100) * bounds.width * viewport.scale;
      const ph = (region.height / 100) * bounds.height * viewport.scale;
      const handles: Array<{ handle: Handle; hx: number; hy: number }> = [
        { handle: "nw", hx: px.x, hy: px.y },
        { handle: "n", hx: px.x + pw / 2, hy: px.y },
        { handle: "ne", hx: px.x + pw, hy: px.y },
        { handle: "e", hx: px.x + pw, hy: px.y + ph / 2 },
        { handle: "se", hx: px.x + pw, hy: px.y + ph },
        { handle: "s", hx: px.x + pw / 2, hy: px.y + ph },
        { handle: "sw", hx: px.x, hy: px.y + ph },
        { handle: "w", hx: px.x, hy: px.y + ph / 2 },
      ];
      for (const h of handles) {
        if (
          Math.abs(clientX - rect.left - h.hx) <= handleHitPx &&
          Math.abs(clientY - rect.top - h.hy) <= handleHitPx
        ) {
          return { id: region.id ?? "", handle: h.handle };
        }
      }
      return null;
    },
    [imgBounds, viewport, regions, selection, handleHitPx],
  );

  const hitRegion = useCallback(
    (clientX: number, clientY: number): { id: string; suggestion: boolean } | null => {
      const point = toPercent(clientX, clientY);
      if (!point) return null;
      const contains = (region: ImageOcclusionRegion) =>
        point.x >= region.x &&
        point.x <= region.x + region.width &&
        point.y >= region.y &&
        point.y <= region.y + region.height;
      // Suggestions render above regions; check them first (topmost last).
      for (let i = suggestions.length - 1; i >= 0; i--) {
        if (contains(suggestions[i])) return { id: suggestions[i].id ?? "", suggestion: true };
      }
      for (let i = regions.length - 1; i >= 0; i--) {
        if (contains(regions[i])) return { id: regions[i].id ?? "", suggestion: false };
      }
      return null;
    },
    [toPercent, regions, suggestions],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesture) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
      containerRef.current?.focus({ preventScroll: true });
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Pan: middle button, or space held with the primary button.
    if (event.button === 1 || (spaceHeldRef.current && event.button === 0)) {
      event.preventDefault();
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      capturePointer(event.pointerId);
      setGesture({
        kind: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewport,
      });
      return;
    }
    if (event.button !== 0) return;

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      // Pinch zoom / two-finger pan on touch.
      const [p1, p2] = [...pointersRef.current.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      capturePointer(event.pointerId);
      setGesture({
        kind: "pinch",
        prevDist: dist,
        prevMidX: (p1.x + p2.x) / 2 - rect.left,
        prevMidY: (p1.y + p2.y) / 2 - rect.top,
      });
      return;
    }

    const handle = hitHandle(event.clientX, event.clientY);
    if (handle) {
      const start = toPercent(event.clientX, event.clientY);
      if (!start) return;
      const region = regions.find((r) => r.id === handle.id);
      if (!region) return;
      if (!selection.includes(handle.id)) apply({ type: "select", ids: [handle.id] });
      setGesture({
        kind: "resize",
        id: handle.id,
        handle: handle.handle,
        startX: start.x,
        startY: start.y,
        original: region,
        current: region,
      });
      capturePointer(event.pointerId);
      return;
    }

    const hit = hitRegion(event.clientX, event.clientY);
    if (hit) {
      const start = toPercent(event.clientX, event.clientY);
      if (!start) return;
      if (hit.suggestion) {
        const suggestion = suggestions.find((s) => s.id === hit.id);
        if (!suggestion) return;
        // Editing a suggestion accepts it in the same gesture.
        setGesture({
          kind: "move",
          ids: [suggestion.id ?? ""],
          startX: start.x,
          startY: start.y,
          originals: [...regions, { ...suggestion }],
          current: [...regions, { ...suggestion }],
          acceptId: suggestion.id ?? "",
        });
        capturePointer(event.pointerId);
        return;
      }
      const region = regions.find((r) => r.id === hit.id);
      if (!region) return;
      const isModifier = event.shiftKey || event.metaKey || event.ctrlKey;
      if (isModifier) {
        // Modifier click toggles the region in the selection — no drag.
        const next = selection.includes(hit.id)
          ? selection.filter((id) => id !== hit.id)
          : [...selection, hit.id];
        apply({ type: "select", ids: next });
        return;
      }
      // Plain click: select only this region, or keep an existing group.
      const ids = selection.length > 1 && selection.includes(hit.id) ? selection : [hit.id];
      if (ids.length === 1) apply({ type: "select", ids });
      const originals = regions.filter((r) => ids.includes(r.id ?? ""));
      if (originals.length === 0) return;
      setGesture({
        kind: "move",
        ids,
        startX: start.x,
        startY: start.y,
        originals,
        current: originals.map((r) => ({ ...r })),
      });
      capturePointer(event.pointerId);
      return;
    }

    // Empty space: rubber-band multi-select with a modifier, otherwise draw.
    const point = toPercent(event.clientX, event.clientY);
    if (!point) return;
    apply({ type: "select", ids: [] });
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      setGesture({
        kind: "rubber",
        originX: point.x,
        originY: point.y,
        currentX: point.x,
        currentY: point.y,
      });
    } else {
      setGesture({
        kind: "draw",
        originX: point.x,
        originY: point.y,
        draft: { id: `draft-${Date.now()}`, x: point.x, y: point.y, width: 0, height: 0 },
      });
    }
    capturePointer(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (gesture.kind === "pinch") {
      const prev = pointersRef.current.get(event.pointerId);
      if (prev) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [p1, p2] = [...pointersRef.current.values()];
      if (!p1 || !p2) return;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) / 2 - rect.left;
      const midY = (p1.y + p2.y) / 2 - rect.top;
      const bounds = imgBounds;
      if (!bounds) return;
      let next = zoomViewportAt(
        viewport,
        { x: midX, y: midY },
        pinchZoomFactor(gesture.prevDist, dist),
      );
      next = {
        ...next,
        panX: next.panX + (midX - gesture.prevMidX),
        panY: next.panY + (midY - gesture.prevMidY),
      };
      setViewport(next);
      setGesture({ kind: "pinch", prevDist: dist, prevMidX: midX, prevMidY: midY });
      return;
    }
    if (gesture.kind === "pan") {
      setViewport({
        ...gesture.startViewport,
        panX: gesture.startViewport.panX + (event.clientX - gesture.startClientX),
        panY: gesture.startViewport.panY + (event.clientY - gesture.startClientY),
      });
      return;
    }

    const point = toPercent(event.clientX, event.clientY);
    if (!point) return;

    if (gesture.kind === "draw") {
      const { originX, originY } = gesture;
      setGesture({
        ...gesture,
        draft: clampRegion({
          id: gesture.draft.id,
          x: Math.min(originX, point.x),
          y: Math.min(originY, point.y),
          width: Math.abs(point.x - originX),
          height: Math.abs(point.y - originY),
        }),
      });
      return;
    }
    if (gesture.kind === "rubber") {
      setGesture({ ...gesture, currentX: point.x, currentY: point.y });
      return;
    }
    if (gesture.kind === "move") {
      const dx = point.x - gesture.startX;
      const dy = point.y - gesture.startY;
      setGesture({
        ...gesture,
        current: gesture.originals.map((region) =>
          clampRegion({ ...region, x: region.x + dx, y: region.y + dy }),
        ),
      });
      return;
    }
    if (gesture.kind === "resize") {
      const dx = point.x - gesture.startX;
      const dy = point.y - gesture.startY;
      setGesture({
        ...gesture,
        current: resizeRegion(gesture.original, gesture.handle, dx, dy),
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (!gesture) return;
    const container = containerRef.current;
    if (container?.hasPointerCapture?.(event.pointerId)) {
      container.releasePointerCapture?.(event.pointerId);
    }

    if (gesture.kind === "pinch" || gesture.kind === "pan") {
      setGesture(null);
      return;
    }
    if (gesture.kind === "draw") {
      const draft = clampRegion(gesture.draft);
      if (draft.width > 0 && draft.height > 0) {
        apply({ type: "replaceRegions", regions: [...regions, draft] });
        apply({ type: "select", ids: [draft.id ?? ""] });
        lastDrawnRegionIdRef.current = draft.id ?? null;
      }
      setGesture(null);
      return;
    }
    if (gesture.kind === "rubber") {
      const rect = {
        x: Math.min(gesture.originX, gesture.currentX),
        y: Math.min(gesture.originY, gesture.currentY),
        width: Math.abs(gesture.currentX - gesture.originX),
        height: Math.abs(gesture.currentY - gesture.originY),
      };
      const selected = regions
        .filter((region) => rectsIntersect(region, rect))
        .map((region) => region.id ?? "");
      apply({ type: "select", ids: selected });
      setGesture(null);
      return;
    }
    if (gesture.kind === "move") {
      const usable = gesture.current.filter((r) => r.width > 0 && r.height > 0);
      if (gesture.acceptId) {
        const moved = usable.find((r) => r.id === gesture.acceptId);
        apply({
          type: "commit",
          snapshot: {
            regions: moved
              ? [...regions.filter((r) => r.id !== gesture.acceptId), moved]
              : regions,
            suggestions: suggestions.filter((s) => s.id !== gesture.acceptId),
          },
        });
      } else {
        // Merge the moved selection back into the full region list — never
        // replace the whole list with just the dragged subset. A moved region
        // that collapsed to zero area is dropped (as before), but unselected
        // regions are untouched.
        const movedIds = new Set(gesture.ids);
        const usableById = new Map(usable.map((r) => [r.id ?? "", r]));
        const merged = regions
          .filter((r) => !(movedIds.has(r.id ?? "") && !usableById.has(r.id ?? "")))
          .map((r) => usableById.get(r.id ?? "") ?? r);
        apply({ type: "replaceRegions", regions: merged });
      }
      setGesture(null);
      return;
    }
    if (gesture.kind === "resize") {
      const updated = clampRegion(gesture.current);
      if (updated.width > 0 && updated.height > 0) {
        apply({
          type: "replaceRegions",
          regions: regions.map((r) => (r.id === gesture.id ? updated : r)),
        });
      } else {
        apply({ type: "deleteRegions", ids: [gesture.id] });
      }
      setGesture(null);
    }
  };

  // ---- Keyboard control (only while the canvas itself has focus) ----
  const nudgeStep = useCallback(() => {
    const img = imgRef.current;
    const x = img && img.naturalWidth > 0 ? 100 / img.naturalWidth : 1;
    const y = img && img.naturalHeight > 0 ? 100 / img.naturalHeight : 1;
    return { x, y };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) session.redo();
      else session.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      session.redo();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setGesture(null);
      // Escape right after drawing removes the box that was just drawn (undoing
      // the accidental occlusion). Only when it is still the sole selection —
      // otherwise Escape behaves as before: deselect.
      const lastDrawn = lastDrawnRegionIdRef.current;
      if (lastDrawn && selection.length === 1 && selection[0] === lastDrawn) {
        lastDrawnRegionIdRef.current = null;
        apply({ type: "deleteRegions", ids: [lastDrawn] });
      } else {
        apply({ type: "select", ids: [] });
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (selection.length > 0) apply({ type: "deleteRegions", ids: selection });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (regions.length === 0) return;
      const last = selection.length > 0 ? selection[selection.length - 1] : null;
      const index = last ? regions.findIndex((r) => r.id === last) : -1;
      const next = regions[(index + 1) % regions.length];
      apply({ type: "select", ids: [next.id ?? ""] });
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (selection.length === 0) return;
    event.preventDefault();
    const step = nudgeStep();
    const amount = event.shiftKey ? { x: step.x * 10, y: step.y * 10 } : step;
    const dx = event.key === "ArrowLeft" ? -amount.x : event.key === "ArrowRight" ? amount.x : 0;
    const dy = event.key === "ArrowUp" ? -amount.y : event.key === "ArrowDown" ? amount.y : 0;

    if (event.altKey) {
      // Resize the right/bottom edges (se-anchored) by the same increments.
      const resized = regions.map((r) =>
        selection.includes(r.id ?? "")
          ? clampRegion({
              ...r,
              width: Math.max(step.x, r.width + dx),
              height: Math.max(step.y, r.height + dy),
            })
          : r,
      );
      apply({ type: "replaceRegions", regions: resized });
    } else {
      const moved = regions.map((r) =>
        selection.includes(r.id ?? "") ? clampRegion({ ...r, x: r.x + dx, y: r.y + dy }) : r,
      );
      apply({ type: "replaceRegions", regions: moved });
    }
  };

  // ---- Derived render state ----
  const displayRegions = useMemo(() => {
    if (!gesture) return regions;
    if (gesture.kind === "move") {
      if (gesture.acceptId) {
        return [
          ...regions.filter((r) => r.id !== gesture.acceptId),
          ...gesture.current.filter((r) => r.id === gesture.acceptId),
        ];
      }
      return regions.map((r) => gesture.current.find((m) => m.id === r.id) ?? r);
    }
    if (gesture.kind === "resize") {
      return regions.map((r) => (r.id === gesture.id ? gesture.current : r));
    }
    return regions;
  }, [gesture, regions]);

  const draftRegion = gesture?.kind === "draw" ? clampRegion(gesture.draft) : null;
  const rubberRect =
    gesture?.kind === "rubber"
      ? {
          x: Math.min(gesture.originX, gesture.currentX),
          y: Math.min(gesture.originY, gesture.currentY),
          width: Math.abs(gesture.currentX - gesture.originX),
          height: Math.abs(gesture.currentY - gesture.originY),
        }
      : null;

  const activeRegionId = selection.length > 0 ? selection[selection.length - 1] : null;
  const zoomPercent = Math.round(viewport.scale * 100);

  if (!asset) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        {t("flashcardStudio.importImageForOcclusion")}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-muted/20 outline-none select-none touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      {/* Zoom controls */}
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-full border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          aria-label={t("occlusionComposer.zoomOut")}
          onClick={(event) => {
            event.stopPropagation();
            zoomBy(1 / 1.25);
          }}
          className="rounded-full p-1.5 text-foreground hover:bg-muted"
        >
          <MagnifyingGlassMinus className="h-4 w-4" />
        </button>
        <span className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-foreground">
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label={t("occlusionComposer.zoomIn")}
          onClick={(event) => {
            event.stopPropagation();
            zoomBy(1.25);
          }}
          className="rounded-full p-1.5 text-foreground hover:bg-muted"
        >
          <MagnifyingGlassPlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            fitToView();
          }}
          className="rounded-full px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {t("occlusionComposer.fitToView")}
        </button>
      </div>

      {/* Image + overlay wrapper: the CSS transform that implements zoom/pan */}
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.scale})`,
          transformOrigin: "0 0",
        }}
      >
        <img
          ref={imgRef}
          src={asset.data_url}
          alt={asset.file_name || t("flashcardStudio.occlusionEditor")}
          className="block w-full object-contain select-none"
          draggable={false}
        />
        {imgBounds &&
          displayRegions.map((region, index) => {
            const px = regionToPx(region);
            if (!px) return null;
            const isSelected = selection.includes(region.id ?? "");
            const key = region.id || `${region.x}-${region.y}-${index}`;
            return (
              <div
                key={key}
                data-region-id={region.id}
                data-testid={`occlusion-region-${index + 1}`}
                className={`absolute rounded border ${
                  isSelected ? "border-sky-400/90 bg-sky-500/20" : "border-white/50 bg-slate-950/60"
                }`}
                style={{
                  left: px.left,
                  top: px.top,
                  width: px.width,
                  height: px.height,
                  cursor: "move",
                }}
              >
                <span className="pointer-events-none absolute -top-5 left-0 rounded bg-slate-900/90 px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
                  {index + 1}
                  {region.label ? ` · ${region.label}` : ""}
                </span>
              </div>
            );
          })}

        {draftRegion &&
          (() => {
            const px = regionToPx(draftRegion);
            if (!px) return null;
            return (
              <div
                data-testid="occlusion-draft"
                className="absolute rounded border border-white/80 bg-slate-950/50"
                style={{ left: px.left, top: px.top, width: px.width, height: px.height }}
              />
            );
          })()}

        {/* Pending suggestions: visually distinct, with inline accept/reject */}
        {imgBounds &&
          suggestions.map((suggestion, index) => {
            const px = regionToPx(suggestion);
            if (!px) return null;
            return (
              <div
                key={suggestion.id || `suggestion-${index}`}
                data-testid={`occlusion-suggestion-${index + 1}`}
                className="absolute rounded border-2 border-dashed border-emerald-400/80 bg-emerald-500/10"
                style={{ left: px.left, top: px.top, width: px.width, height: px.height }}
              >
                <span className="pointer-events-none absolute -top-5 left-0 rounded bg-emerald-900/90 px-1 py-0.5 text-[10px] font-semibold leading-none text-emerald-100">
                  {suggestion.label || t("occlusionComposer.suggestion")}
                </span>
                <div className="absolute -top-5 right-0 flex gap-1">
                  <button
                    type="button"
                    aria-label={t("occlusionComposer.acceptSuggestion")}
                    className="rounded bg-emerald-600 p-1 text-white shadow hover:bg-emerald-500"
                    onClick={(event) => {
                      event.stopPropagation();
                      apply({ type: "acceptSuggestion", id: suggestion.id ?? "" });
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("occlusionComposer.rejectSuggestion")}
                    className="rounded bg-rose-600 p-1 text-white shadow hover:bg-rose-500"
                    onClick={(event) => {
                      event.stopPropagation();
                      apply({ type: "rejectSuggestion", id: suggestion.id ?? "" });
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

        {/* Resize handles for the active (last-selected) region. On touch the
            handles render only for that one region so dense regions stay
            reachable; on desktop multi-selection the active region still gets
            the full handle set. */}
        {imgBounds &&
          activeRegionId &&
          (() => {
            const region = displayRegions.find((r) => r.id === activeRegionId);
            if (!region) return null;
            const px = regionToPx(region);
            if (!px) return null;
            const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
            const cursorFor = (handle: Handle) =>
              handle === "nw" || handle === "se"
                ? "nwse-resize"
                : handle === "ne" || handle === "sw"
                  ? "nesw-resize"
                  : handle === "n" || handle === "s"
                    ? "ns-resize"
                    : "ew-resize";
            return (
              <>
                {handles.map((handle) => {
                  const hx =
                    handle.includes("w")
                      ? px.left
                      : handle.includes("e")
                        ? px.left + px.width
                        : px.left + px.width / 2;
                  const hy =
                    handle.includes("n")
                      ? px.top
                      : handle.includes("s")
                        ? px.top + px.height
                        : px.top + px.height / 2;
                  return (
                    <div
                      key={handle}
                      data-testid={`occlusion-handle-${handle}`}
                      className="absolute rounded-sm border border-black/60 bg-white"
                      style={{
                        width: HANDLE_SIZE_PX,
                        height: HANDLE_SIZE_PX,
                        left: hx - HANDLE_SIZE_PX / 2,
                        top: hy - HANDLE_SIZE_PX / 2,
                        cursor: cursorFor(handle),
                        zIndex: 5,
                      }}
                    />
                  );
                })}
              </>
            );
          })()}

        {/* Rubber-band selection */}
        {rubberRect &&
          (() => {
            const bounds = imgBounds;
            if (!bounds) return null;
            const topLeft = percentToViewport(
              { x: rubberRect.x, y: rubberRect.y },
              viewport,
              bounds,
            );
            return (
              <div
                data-testid="occlusion-rubber-band"
                className="absolute rounded border border-sky-400/80 bg-sky-400/10"
                style={{
                  left: topLeft.x,
                  top: topLeft.y,
                  width: (rubberRect.width / 100) * bounds.width * viewport.scale,
                  height: (rubberRect.height / 100) * bounds.height * viewport.scale,
                }}
              />
            );
          })()}
      </div>
    </div>
  );
}

function resizeRegion(
  region: ImageOcclusionRegion,
  handle: Handle,
  dx: number,
  dy: number,
): ImageOcclusionRegion {
  let { x, y, width, height } = region;
  if (handle.includes("w")) {
    width -= dx;
    x += dx;
  } else if (handle.includes("e")) {
    width += dx;
  }
  if (handle.includes("n")) {
    height -= dy;
    y += dy;
  } else if (handle.includes("s")) {
    height += dy;
  }
  return clampRegion({ ...region, x, y, width, height });
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
