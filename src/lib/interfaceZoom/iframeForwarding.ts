/**
 * Same-origin iframe forwarding for interface zoom (change:
 * desktop-global-interface-zoom).
 *
 * The application dispatcher lives on the parent window. Key events inside a
 * same-origin reader iframe do not bubble there, so the shared capture handler
 * is attached directly to the iframe window. EPUB `rendered` can fire
 * repeatedly for the same window; a private marker keeps exactly one listener.
 */

import { handleInterfaceZoomKeyDown } from "./shortcuts";

type MarkedWindow = Window & {
  __plethoraInterfaceZoomHandler?: boolean;
};

const HANDLER_FLAG = "__plethoraInterfaceZoomHandler";

/**
 * Attach the shared zoom handler to `win` at most once. Returns an idempotent
 * detach function; calling it clears the marker so a later reattach works.
 */
export function attachInterfaceZoomToWindow(win: Window | null | undefined): () => void {
  if (!win) return () => {};
  const marked = win as MarkedWindow;
  if (marked[HANDLER_FLAG]) return () => {};

  marked[HANDLER_FLAG] = true;
  try {
    win.addEventListener("keydown", handleInterfaceZoomKeyDown, true);
  } catch {
    delete marked[HANDLER_FLAG];
    return () => {};
  }

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    try {
      win.removeEventListener("keydown", handleInterfaceZoomKeyDown, true);
    } catch {
      /* frame detached */
    }
    delete marked[HANDLER_FLAG];
  };
}

/**
 * Attach to a same-origin iframe's window. Cross-origin frames are outside the
 * HTML reader contract and are treated as a no-op.
 */
export function attachInterfaceZoomToIframe(
  frame: HTMLIFrameElement | null | undefined,
): () => void {
  if (!frame) return () => {};
  let win: Window | null = null;
  try {
    win = frame.contentWindow;
  } catch {
    return () => {};
  }
  return attachInterfaceZoomToWindow(win);
}
