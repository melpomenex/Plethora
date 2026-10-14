/**
 * Small palette-scoped UI context and platform helpers.
 *
 * The hub tracks one transient surface at a time (document overflow menu,
 * expanded examples, advanced filters) so Escape can always dismiss the
 * innermost surface before falling through to URL clearing / composer return /
 * palette close. Children publish their open state through this context
 * instead of owning Escape handling individually.
 */

import { createContext, useContext } from "react";

export type PaletteTransientSurface = "overflow" | "examples" | "filters";

export interface PaletteUiContextValue {
  transient: PaletteTransientSurface | null;
  openTransient: (surface: PaletteTransientSurface) => void;
  closeTransient: () => void;
}

export const PaletteUiContext = createContext<PaletteUiContextValue>({
  transient: null,
  openTransient: () => {},
  closeTransient: () => {},
});

export function usePaletteUi(): PaletteUiContextValue {
  return useContext(PaletteUiContext);
}

/** Whether the current platform's modifier key is Command. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  return /mac/i.test(platform) || /Macintosh|Mac OS X/.test(userAgent);
}

/** Platform-correct palette hints ("⌘", "Ctrl"). */
export function paletteModifierLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

/** "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function paletteOpenShortcutLabel(): string {
  return isMacPlatform() ? "⌘K" : "Ctrl+K";
}

/** "⌘/" on macOS, "Ctrl+/" elsewhere — the palette-local View all shortcut. */
export function paletteViewAllShortcutLabel(): string {
  return `${paletteModifierLabel()}+/`;
}

/**
 * Whether a keyboard event belongs to text composition or to editing inside a
 * text input/textarea. Handlers must ignore those events so IME confirmation
 * and multiline editing never execute palette actions.
 */
export function isEditableKeyEvent(
  event: React.KeyboardEvent | KeyboardEvent
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  if (native.isComposing || native.keyCode === 229) return true;
  const target = native.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function isCompositionEvent(
  event: React.KeyboardEvent | KeyboardEvent
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
