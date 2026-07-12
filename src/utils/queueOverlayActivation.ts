export const STATIONARY_TAP_TOLERANCE_PX = 12;

export type TouchPoint = {
  x: number;
  y: number;
};

export function isStationaryTap(
  start: TouchPoint,
  end: TouchPoint,
  cancelled = false,
  tolerance = STATIONARY_TAP_TOLERANCE_PX,
): boolean {
  if (cancelled) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) <= tolerance;
}

export function isEligibleOverlayTapTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest(
    'button, input, textarea, select, a, [contenteditable="true"], [role="button"], .interactive, .assistant-panel',
  );
}

export function hasActiveTextSelection(selection: Selection | null): boolean {
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}
