import { useEffect } from "react";
import { requestApplicationBack, requestApplicationForward } from "../lib/applicationBack";

const MOUSE_BACK_BUTTON = 3;
const MOUSE_FORWARD_BUTTON = 4;
const HANDLER_FLAG = "__plethoraMouseNavigationHandler";

type MarkedWindow = Window & {
  [HANDLER_FLAG]?: boolean;
};

function isMouseNavigationButton(button: number): boolean {
  return button === MOUSE_BACK_BUTTON || button === MOUSE_FORWARD_BUTTON;
}

function handlePreventNativeNavigation(event: MouseEvent): void {
  if (isMouseNavigationButton(event.button)) {
    event.preventDefault();
  }
}

function handleMouseNavigationUp(event: MouseEvent): void {
  if (!isMouseNavigationButton(event.button)) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.button === MOUSE_BACK_BUTTON) {
    requestApplicationBack();
  } else if (event.button === MOUSE_FORWARD_BUTTON) {
    requestApplicationForward();
  }
}

/**
 * Attach mouse Back/Forward button listeners to a Window (main window or
 * same-origin reader iframe) at most once. Returns an idempotent detach
 * function.
 */
export function attachMouseNavigationToWindow(win: Window | null | undefined): () => void {
  if (!win) return () => {};
  const marked = win as MarkedWindow;
  if (marked[HANDLER_FLAG]) return () => {};

  marked[HANDLER_FLAG] = true;
  try {
    win.addEventListener("mousedown", handlePreventNativeNavigation, true);
    win.addEventListener("auxclick", handlePreventNativeNavigation, true);
    win.addEventListener("mouseup", handleMouseNavigationUp, true);
  } catch {
    delete marked[HANDLER_FLAG];
    return () => {};
  }

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    try {
      win.removeEventListener("mousedown", handlePreventNativeNavigation, true);
      win.removeEventListener("auxclick", handlePreventNativeNavigation, true);
      win.removeEventListener("mouseup", handleMouseNavigationUp, true);
    } catch {
      /* frame detached */
    }
    delete marked[HANDLER_FLAG];
  };
}

/**
 * Global hook enabling mouse Back (button 3) and Forward (button 4) buttons
 * across the application shell.
 */
export function useMouseNavigation(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    return attachMouseNavigationToWindow(window);
  }, []);
}
