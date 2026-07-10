/**
 * Reactive form-factor hook.
 *
 * Wraps the synchronous {@link getFormFactor} / {@link isNativeMobile} helpers
 * from `lib/tauri` so components re-render when the orientation changes (e.g.
 * a tablet rotated from portrait phone-like to landscape desktop-like).
 *
 * On native mobile builds the platform never changes at runtime, but the
 * phone-vs-tablet classification can flip on rotate, so we listen for both
 * `resize` and `orientationchange` (debounced via requestAnimationFrame).
 */

import { usePresentation } from "../contexts/PresentationContext";
import { isNativeMobile, type FormFactor } from "../lib/tauri";

export function useFormFactor(): FormFactor {
  const { mode } = usePresentation();
  return mode === "compact-desktop" ? "desktop" : mode;
}

/**
 * Reactive version of {@link isNativeMobile}. Re-renders if the cached
 * form factor is reset (it never flips from false→true at runtime, but this
 * keeps consumers consistent with {@link useFormFactor}).
 */
export function useIsNativeMobile(): boolean {
  // Subscribe to the same orientation lifecycle so consumers stay in sync.
  useFormFactor();
  return isNativeMobile();
}
