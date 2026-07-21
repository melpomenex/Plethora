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
    const pos = boxFor(side, rect, cw, ch);
    if (fits(pos, vw, vh)) {
      return { side, ...pos };
    }
  }

  // Last resort: preferred side, clamped into the viewport. Overlap with the
  // anchor is acceptable; clipping is not.
  const fallback = boxFor(preferred, rect, cw, ch);
  return {
    side: preferred,
    top: clamp(fallback.top, COACH_MIN_MARGIN, Math.max(COACH_MIN_MARGIN, vh - ch - COACH_MIN_MARGIN)),
    left: clamp(fallback.left, COACH_MIN_MARGIN, Math.max(COACH_MIN_MARGIN, vw - cw - COACH_MIN_MARGIN)),
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

function fits(pos: { top: number; left: number }, vw: number, vh: number): boolean {
  return pos.top >= COACH_MIN_MARGIN && pos.left >= COACH_MIN_MARGIN && pos.top <= vh && pos.left <= vw;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
