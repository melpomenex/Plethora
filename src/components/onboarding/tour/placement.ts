import type { AnchorRect } from "./useAnchorRect";

/** Preferred side of the anchor the coach mark wants to attach to. */
export type TourPlacement = "auto" | "top" | "right" | "bottom" | "left" | "center";

const COACH_MIN_MARGIN = 12;

/**
 * Resolve a coach mark's placement against the viewport and the anchor rect.
 *
 * Strategy (spec: "Coach mark stays on screen"):
 * - If the step has no anchor (centred card), or placement is `center`,
 *   return `center` with a centred position.
 * - Otherwise try the preferred side, then flip through the opposite side
 *   and the two perpendicular sides in order. The first placement whose
 *   computed box fits fully inside the viewport wins.
 * - If none fits (very small viewport), fall back to the preferred side
 *   clamped into the viewport — overlap with the anchor is preferred to
 *   off-screen clipping.
 */
export function resolveCoachPlacement(
  placement: TourPlacement,
  rect: AnchorRect | null,
  coachSize: { width: number; height: number },
  viewport: { width: number; height: number },
): {
  side: Exclude<TourPlacement, "auto">;
  top: number;
  left: number;
} {
  const vw = viewport.width;
  const vh = viewport.height;
  const cw = coachSize.width;
  const ch = coachSize.height;

  if (!rect || placement === "center") {
    return {
      side: "center",
      top: Math.max(COACH_MIN_MARGIN, (vh - ch) / 2),
      left: Math.max(COACH_MIN_MARGIN, (vw - cw) / 2),
    };
  }

  const preferred = placement === "auto" ? "bottom" : placement;
  // Flip order: preferred, opposite, then the two perpendiculars. A 4-slot
  // tour (mobile) usually wants bottom-sheet placement below the anchor.
  const order = flipOrder(preferred);

  for (const side of order) {
    const base = boxFor(side, rect, cw, ch);
    // For each side there is a "primary axis" (perpendicular to the side —
    // the direction the coach mark extends away from the anchor) and a
    // "cross axis" (parallel to the anchor edge). The spec lets the coach
    // mark "flip OR shift": we reject a side only when it can't fit on its
    // primary axis, and otherwise shift it along the cross axis until it
    // fits. This is what lets a wide coach mark still attach "top"/"bottom"
    // to a small bottom-nav button on a narrow phone viewport — the unshifted
    // horizontal centre would push it off the left/right edge, but shifting
    // it into view keeps the preferred vertical side.
    const primaryFits = fitsOnPrimaryAxis(side, base, cw, ch, vw, vh);
    if (primaryFits) {
      const shifted = shiftIntoViewport(side, base, cw, ch, vw, vh);
      return { side, ...shifted };
    }
  }

  // No side fit on its primary axis — viewport too small in both dimensions
  // relative to the coach mark and anchor. Clamp the preferred side into the
  // viewport on both axes; overlap with the anchor is acceptable here, but
  // clipping is not.
  const fallback = boxFor(preferred, rect, cw, ch);
  return {
    side: preferred,
    top: clamp(fallback.top, COACH_MIN_MARGIN, Math.max(COACH_MIN_MARGIN, vh - ch - COACH_MIN_MARGIN)),
    left: clamp(fallback.left, COACH_MIN_MARGIN, Math.max(COACH_MIN_MARGIN, vw - cw - COACH_MIN_MARGIN)),
  };
}

/**
 * Does the coach mark fit on the primary axis for this side? The primary
 * axis is the one perpendicular to the side — i.e. the direction the coach
 * mark extends away from the anchor:
 *   top/bottom sides → vertical primary (must fit above/below the anchor)
 *   left/right sides → horizontal primary (must fit left/right of anchor)
 *
 * The cross axis can always be shifted into view (see {@link shiftIntoViewport}),
 * so we don't check it here.
 */
function fitsOnPrimaryAxis(
  side: "top" | "right" | "bottom" | "left",
  pos: { top: number; left: number },
  cw: number,
  ch: number,
  vw: number,
  vh: number,
): boolean {
  switch (side) {
    case "top":
      // Coach is above the anchor; needs room from 0 to its bottom edge.
      return pos.top >= COACH_MIN_MARGIN && pos.top + ch <= vh - COACH_MIN_MARGIN;
    case "bottom":
      // Coach is below the anchor; its top must clear the top edge and its
      // bottom must clear the screen bottom.
      return pos.top >= COACH_MIN_MARGIN && pos.top + ch <= vh - COACH_MIN_MARGIN;
    case "left":
      return pos.left >= COACH_MIN_MARGIN && pos.left + cw <= vw - COACH_MIN_MARGIN;
    case "right":
      return pos.left >= COACH_MIN_MARGIN && pos.left + cw <= vw - COACH_MIN_MARGIN;
  }
}

/**
 * Shift the box along the cross axis so it fits inside the viewport. The
 * primary-axis position is preserved (the side relative to the anchor); only
 * the cross-axis offset is clamped.
 */
function shiftIntoViewport(
  side: "top" | "right" | "bottom" | "left",
  pos: { top: number; left: number },
  cw: number,
  ch: number,
  vw: number,
  vh: number,
): { top: number; left: number } {
  if (side === "top" || side === "bottom") {
    // Cross axis is horizontal: clamp `left`, keep `top`.
    return {
      top: pos.top,
      left: clamp(pos.left, COACH_MIN_MARGIN, Math.max(COACH_MIN_MARGIN, vw - cw - COACH_MIN_MARGIN)),
    };
  }
  // Cross axis is vertical: clamp `top`, keep `left`.
  return {
    top: clamp(pos.top, COACH_MIN_MARGIN, Math.max(COACH_MIN_MARGIN, vh - ch - COACH_MIN_MARGIN)),
    left: pos.left,
  };
}

function flipOrder(preferred: Exclude<TourPlacement, "auto" | "center">): ("top" | "right" | "bottom" | "left")[] {
  const opposite: Record<typeof preferred, "top" | "right" | "bottom" | "left"> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  const perpendiculars: ("top" | "right" | "bottom" | "left")[] =
    preferred === "top" || preferred === "bottom" ? ["right", "left"] : ["top", "bottom"];
  return [preferred, opposite[preferred], ...perpendiculars];
}

function boxFor(
  side: "top" | "right" | "bottom" | "left",
  rect: AnchorRect,
  cw: number,
  ch: number,
): { top: number; left: number } {
  switch (side) {
    case "top":
      return { top: rect.top - ch - COACH_MIN_MARGIN, left: rect.left + rect.width / 2 - cw / 2 };
    case "bottom":
      return { top: rect.bottom + COACH_MIN_MARGIN, left: rect.left + rect.width / 2 - cw / 2 };
    case "left":
      return { top: rect.top + rect.height / 2 - ch / 2, left: rect.left - cw - COACH_MIN_MARGIN };
    case "right":
      return { top: rect.top + rect.height / 2 - ch / 2, left: rect.right + COACH_MIN_MARGIN };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
