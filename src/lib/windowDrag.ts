import type { MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { isTauri } from "./tauri";

/**
 * True only where Plethora actually suppresses native window decorations and
 * renders its own chrome: Linux desktop Tauri. macOS/Windows use native title
 * bars and mobile builds have no window to move, so dragging must no-op there.
 */
export function isCustomChromeDragActive(): boolean {
  if (!isTauri()) return false;

  try {
    return platform() === "linux";
  } catch {
    return false;
  }
}

/**
 * Interactive elements that must never become drag surfaces, even if a
 * container is mis-marked. Defense-in-depth behind the exact-target filter.
 */
const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [contenteditable]';

function isInsideInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

/**
 * Initiate a window drag from an empty area of the custom top chrome
 * (Linux desktop Tauri only; no-ops everywhere else).
 *
 * Drag-surface convention: attach this handler via `onMouseDown` to a chrome
 * *container* whose own background is the empty, non-interactive space —
 * the tab-strip row, the top toolbar row, the trailing tab drop-zone. The
 * exact-target rule means a drag starts only when the mousedown lands on the
 * marked element itself (`event.target === event.currentTarget`); every
 * descendant — tabs, toolbar buttons, menus, inputs, window controls — is
 * automatically excluded, so new chrome controls need no opt-out. Interactive
 * descendants additionally never trigger a drag even if mis-targeted, thanks
 * to the {@link INTERACTIVE_SELECTOR} guard.
 *
 * Behavior mirrors a native title bar: primary button only; double-click on
 * empty chrome toggles maximize/restore; otherwise movement is delegated
 * entirely to the OS via `startDragging()` (no coordinate math). Failures are
 * logged with the `[WindowDrag]` prefix and never surface UI errors.
 */
export function handleWindowDragRequest(
  event: ReactMouseEvent<HTMLElement>,
): void {
  if (!isCustomChromeDragActive() || event.button !== 0) return;
  if (event.target !== event.currentTarget) return;
  if (isInsideInteractiveElement(event.target)) return;

  const appWindow = getCurrentWindow();

  if (event.detail === 2) {
    void appWindow.toggleMaximize().catch((error) => {
      console.error("[WindowDrag] toggle maximize failed", error);
    });
    return;
  }

  void appWindow.startDragging().catch((error) => {
    console.error("[WindowDrag] start drag failed", error);
  });
}
