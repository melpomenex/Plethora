/**
 * Selection geometry + anchored-bar placement (change:
 * overhaul-reader-selection-ux, design decisions 3/5).
 *
 * Pure, testable pieces split by cost:
 *  - `fingerprintRange` — O(1) range identity with NO layout reads; safe on
 *    every raw `selectionchange` (design D10).
 *  - `captureSelectionGeometry` — layout reads; called at settle and inside
 *    rAF-throttled revalidation only.
 *  - `placeAnchoredBar` — pure viewport math: above → below → nearest safe
 *    region, clamped to the viewport minus safe-area/keyboard insets, never
 *    centered over the passage.
 */

/** Node identity for fingerprints. Cheap counter keyed by reference. */
const nodeIds = new WeakMap<Node, number>();
let nextNodeId = 0;

function nodeId(node: Node): number {
  let id = nodeIds.get(node);
  if (id === undefined) {
    id = ++nextNodeId;
    nodeIds.set(node, id);
  }
  return id;
}

/**
 * Range identity from start/end container + offset only — no layout reads, no
 * text materialization. DOM churn that shifts offsets (reflow lazy sections
 * appending around a live selection) changes the fingerprint; that is
 * intentional: fingerprint equality is the "range unchanged" signal used for
 * settle detection and revalidation.
 */
export function fingerprintRange(range: Range | null | undefined): string | null {
  if (!range) return null;
  try {
    const { startContainer, startOffset, endContainer, endOffset } = range;
    if (startContainer === endContainer && startOffset === endOffset) return null; // collapsed
    return `${nodeId(startContainer)}:${startOffset}>${nodeId(endContainer)}:${endOffset}`;
  } catch {
    return null;
  }
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectionGeometry {
  /** Viewport-space bounding rect of the range (iframe offset applied). */
  rect: Rect;
  /** Per-line client rects, viewport-space (iframe offset applied). */
  clientRects: Rect[];
  /** Fingerprint of the range at capture time. */
  fingerprint: string;
}

export interface Offset {
  x: number;
  y: number;
}

const bottomOf = (r: Rect): number => r.top + r.height;

/**
 * Viewport-space geometry for a range. `iframeOffset` (EPUB/HTML content:
 * `frameElement.getBoundingClientRect()` top-left) translates iframe-local
 * coordinates into app-viewport coordinates — the transform from
 * `EPUBViewer.tsx`'s context-menu bridging. Zero-rect results (defensive:
 * detached ranges, engines without range layout) still carry the fingerprint.
 */
export function captureSelectionGeometry(range: Range, iframeOffset?: Offset | null): SelectionGeometry {
  const offset = iframeOffset ?? { x: 0, y: 0 };
  const toRect = (r: { left: number; top: number; width: number; height: number }): Rect => ({
    left: r.left + offset.x,
    top: r.top + offset.y,
    width: r.width,
    height: r.height,
  });
  const domRect: Rect =
    typeof range.getBoundingClientRect === "function"
      ? toRect(range.getBoundingClientRect())
      : toRect({ left: 0, top: 0, width: 0, height: 0 });
  const domRects: Rect[] =
    typeof range.getClientRects === "function"
      ? Array.from(range.getClientRects()).map(toRect)
      : [];
  return {
    rect: domRect,
    clientRects: domRects,
    fingerprint: fingerprintRange(range) ?? "",
  };
}

/** Viewport + insets the placement math clamps against. */
export interface ViewportLike {
  width: number;
  height: number;
}

export interface SafeInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  /** Virtual-keyboard height (visual-viewport), reserved from the bottom. */
  keyboard?: number;
}

export interface BarPlacement {
  top: number;
  left: number;
  /** Effective width the bar may occupy (viewport-capped; it scrolls inside). */
  maxWidth: number;
  placement: "above" | "below" | "docked-top" | "docked-bottom";
}

const BAR_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

/**
 * Anchor rect for placement: the FIRST client rect that intersects the
 * viewport, so a multi-line or taller-than-viewport selection never anchors
 * its bar offscreen. Falls back to the bounding rect (single-line selections
 * and zero-client-rects ranges) and finally to the last rect.
 */
export function anchorRectFromGeometry(geometry: SelectionGeometry, viewport: ViewportLike): Rect {
  const rects = geometry.clientRects.length ? geometry.clientRects : [geometry.rect];
  const visible = rects.filter(
    (r) => bottomOf(r) > 0 && r.top < viewport.height && r.width > 0 && r.height > 0,
  );
  if (visible.length > 0) return visible[0];
  // Nothing intersects (scrolled away): anchor to the edge nearest the rect.
  const first = rects[0];
  const last = rects[rects.length - 1];
  return first.top <= viewport.height - bottomOf(last) ? first : last;
}

export interface AnchoredBarOptions {
  /**
   * Prefer below the selection. Android's native selection toolbar (Copy /
   * Select All / Share) floats directly ABOVE the selection, so the app's
   * anchored bar must take the below slot to stay visible on touch.
   */
  preferBelow?: boolean;
  /**
   * Space to reserve above the selection for the system selection toolbar
   * when the bar does end up above it (the app's bar sits above that zone).
   */
  systemToolbarClearance?: number;
}

/**
 * Pure anchored placement for the touch action bar.
 *
 * Preference order: above the selection → below it → docked to the nearest
 * safe edge (reversed when `preferBelow`, for Android's system toolbar).
 * Always fully inside the viewport minus insets, horizontally centered on
 * the anchor but clamped, and vertically separated from the passage — never
 * centered over it.
 */
export function placeAnchoredBar(
  selectionRect: Rect,
  barSize: { width: number; height: number },
  viewport: ViewportLike,
  insets: SafeInsets = {},
  options: AnchoredBarOptions = {},
): BarPlacement {
  const safeLeft = (insets.left ?? 0) + VIEWPORT_MARGIN_PX;
  const safeRight = (insets.right ?? 0) + VIEWPORT_MARGIN_PX;
  const safeTop = (insets.top ?? 0) + VIEWPORT_MARGIN_PX;
  const safeBottom = (insets.bottom ?? 0) + (insets.keyboard ?? 0) + VIEWPORT_MARGIN_PX;

  const availableWidth = Math.max(0, viewport.width - safeLeft - safeRight);
  const maxWidth = Math.min(barSize.width, availableWidth);
  // Horizontal: centered on the anchor's midpoint, clamped into the safe area.
  const center = selectionRect.left + selectionRect.width / 2;
  const left = Math.min(Math.max(center - maxWidth / 2, safeLeft), viewport.width - safeRight - maxWidth);

  // "Above" must clear the system selection toolbar's zone when reserved.
  const aboveClearance = options.systemToolbarClearance ?? 0;
  const fitsAbove =
    selectionRect.top - BAR_GAP_PX - aboveClearance - barSize.height >= safeTop;
  const placeAbove = (): BarPlacement => ({
    top: Math.max(selectionRect.top - BAR_GAP_PX - aboveClearance - barSize.height, safeTop),
    left,
    maxWidth,
    placement: "above",
  });

  const belowTop = bottomOf(selectionRect) + BAR_GAP_PX;
  const fitsBelow = belowTop + barSize.height <= viewport.height - safeBottom;
  const placeBelow = (): BarPlacement => ({ top: belowTop, left, maxWidth, placement: "below" });

  if (options.preferBelow) {
    if (fitsBelow) return placeBelow();
    if (fitsAbove) return placeAbove();
  } else {
    if (fitsAbove) return placeAbove();
    if (fitsBelow) return placeBelow();
  }

  // No room on either side (selection fills the viewport): dock to the edge
  // with more room — a stable single-step position, never over the middle.
  const roomTop = selectionRect.top - safeTop;
  const roomBottom = viewport.height - safeBottom - bottomOf(selectionRect);
  if (roomTop >= roomBottom) {
    return { top: safeTop, left, maxWidth, placement: "docked-top" };
  }
  return {
    top: Math.max(safeTop, viewport.height - safeBottom - barSize.height),
    left,
    maxWidth,
    placement: "docked-bottom",
  };
}

/**
 * Read the safe insets the app already publishes: `--shell-safe-*` CSS vars
 * (safe areas) and the visual-viewport keyboard height. Returns zeros when
 * the vars are absent (tests, SSR) so placement still clamps to the layout
 * viewport.
 */
export function readSafeInsets(doc: Document = document): SafeInsets {
  const computed = getComputedStyle(doc.documentElement);
  const read = (name: string): number => {
    const raw = computed.getPropertyValue(name).trim();
    if (!raw) return 0;
    const value = Number.parseFloat(raw.replace(/^calc\(/, "").replace(/px\)?$/, ""));
    return Number.isFinite(value) ? value : 0;
  };
  const keyboard = read("--app-keyboard-height");
  return {
    top: read("--shell-safe-top"),
    bottom: read("--shell-safe-bottom"),
    left: read("--shell-safe-left"),
    right: read("--shell-safe-right"),
    keyboard: keyboard > 0 ? keyboard : 0,
  };
}

/** Layout viewport used for clamping (defensive under exotic zoom levels). */
export function readLayoutViewport(win: Window = window): ViewportLike {
  return { width: win.innerWidth, height: win.innerHeight };
}
