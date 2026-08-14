/**
 * Bridge pointer activity out of same-origin content iframes.
 *
 * Scroll Mode's overlay controls (rating orbs, bottom actions, progress bar)
 * are shown by a `mousemove` listener on the top-level window and hidden by a
 * 3-second idle timer. The reading content — epub.js and the HTML viewer —
 * renders inside an iframe, and pointer events inside an iframe never reach
 * the parent window. So once the timer fired while the cursor was over the
 * book, the controls could only be summoned back from the non-iframe chrome
 * (top bar, side rails, screen edges); moving the pointer to the bottom of
 * the content did nothing. Clicks, keys, and swipes are already forwarded
 * from these iframes; this forwards pointer movement the same way.
 *
 * The forwarded event is a dedicated CustomEvent rather than a synthetic
 * `mousemove`, so global mousemove consumers that read coordinates (assistant
 * panel dragging, resize handles) never see a bogus (0, 0) event.
 */
export const IFRAME_POINTER_ACTIVITY_EVENT = "incrementum:iframe-pointer-activity";

export type IframePointerActivityKind = "pointer" | "touch";

export interface IframePointerActivityDetail {
  kind: IframePointerActivityKind;
}

/** Pointer moves fire at display frequency; forwarding each one just re-arms
 *  the consumer's idle timer, so throttle to this interval. */
const POINTER_FORWARD_THROTTLE_MS = 100;

/**
 * Forward `mousemove` (as `pointer`) and `touchstart` (as `touch`) activity
 * from an iframe's document to the parent window via
 * {@link IFRAME_POINTER_ACTIVITY_EVENT}. Touch stays unthrottled and keeps
 * its own kind so consumers can preserve touch semantics (e.g. Scroll Mode
 * resets its idle timer on touch but does not reveal controls).
 *
 * Returns a detach function. When the iframe navigates or is recreated its
 * document is replaced, taking the listeners with it — detach only matters
 * for long-lived documents.
 */
export function attachIframePointerActivityForwarder(
  doc: Document,
  parentWindow: Window,
): () => void {
  let lastPointerForwardedAt = 0;

  const forward = (kind: IframePointerActivityKind) => {
    parentWindow.dispatchEvent(
      new CustomEvent<IframePointerActivityDetail>(IFRAME_POINTER_ACTIVITY_EVENT, {
        detail: { kind },
      }),
    );
  };

  const handleMouseMove = () => {
    const now = Date.now();
    if (now - lastPointerForwardedAt < POINTER_FORWARD_THROTTLE_MS) return;
    lastPointerForwardedAt = now;
    forward("pointer");
  };
  const handleTouchStart = () => forward("touch");

  doc.addEventListener("mousemove", handleMouseMove);
  doc.addEventListener("touchstart", handleTouchStart, { passive: true });
  return () => {
    doc.removeEventListener("mousemove", handleMouseMove);
    doc.removeEventListener("touchstart", handleTouchStart);
  };
}
