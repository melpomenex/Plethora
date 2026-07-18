/**
 * Knowledge Universe — pure multi-touch gesture math.
 *
 * Kept free of DOM/three.js so the pinch/twist/tap classification the engine
 * relies on is unit-testable without a WebGL context.
 */

/** Multiplicative orbit-distance factor for a pinch frame (spread in → >1 → zoom out). */
export function pinchZoomFactor(prevDist: number, currDist: number): number {
  if (prevDist <= 0 || currDist <= 0) return 1;
  return prevDist / currDist;
}

/** Signed shortest angular delta (radians) between two pointer-pair angles. */
export function twistDelta(prevAngle: number, currAngle: number): number {
  const tau = Math.PI * 2;
  let d = (currAngle - prevAngle) % tau;
  if (d > Math.PI) d -= tau;
  if (d < -Math.PI) d += tau;
  return d;
}

/** Cumulative twist (radians) required before rotation engages, to keep pure pinches jitter-free. */
export const TWIST_ENGAGE_RAD = 0.08;

export const TWO_FINGER_TAP_MAX_MS = 250;
export const TWO_FINGER_TAP_MAX_MOVE_PX = 12;

/** True when a completed two-pointer session was a "two-finger tap" (stepped zoom out). */
export function isTwoFingerTap(durationMs: number, movementPx: number): boolean {
  return durationMs <= TWO_FINGER_TAP_MAX_MS && movementPx < TWO_FINGER_TAP_MAX_MOVE_PX;
}
