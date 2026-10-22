/**
 * Pure interface-zoom contracts (change: desktop-global-interface-zoom).
 *
 * The product exposes fixed 10% steps between 70% and 150%. Everything here is
 * pure so the store, native layer, startup bootstrap, Settings control, and
 * Command Palette share one normalization rule. `125` is intentionally
 * representable after rounding (it normalizes to 130) but is never offered as a
 * user-selectable step; only the internal native layer may apply 125 directly
 * during manual inspection.
 */

export const INTERFACE_ZOOM_DEFAULT = 100;
export const INTERFACE_ZOOM_MIN = 70;
export const INTERFACE_ZOOM_MAX = 150;
export const INTERFACE_ZOOM_STEP = 10;

function clampInterfaceZoom(value: number): number {
  return Math.min(INTERFACE_ZOOM_MAX, Math.max(INTERFACE_ZOOM_MIN, value));
}

/**
 * Coerce any persisted/typed value into a supported interface-zoom percentage:
 * non-finite/non-numeric values become the default, then the value is rounded
 * to the nearest 10-point step and clamped to the supported range.
 */
export function normalizeInterfaceZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return INTERFACE_ZOOM_DEFAULT;
  }
  const rounded = Math.round(value / INTERFACE_ZOOM_STEP) * INTERFACE_ZOOM_STEP;
  return clampInterfaceZoom(rounded);
}

/** Move exactly one 10-point step in the requested direction, clamped. */
export function stepInterfaceZoom(current: number, direction: "in" | "out"): number {
  const normalized = normalizeInterfaceZoom(current);
  const delta = direction === "in" ? INTERFACE_ZOOM_STEP : -INTERFACE_ZOOM_STEP;
  return clampInterfaceZoom(normalized + delta);
}

/** Convert a percentage preference into the native WebView scale factor. */
export function interfaceZoomToScale(percent: number): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return INTERFACE_ZOOM_DEFAULT / 100;
  }
  return percent / 100;
}
