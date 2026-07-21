import { useEffect, useRef, useState } from "react";
import {
  candidatesFromAnchor,
  isVisuallyPresent,
  resolveAnchor,
  type TourAnchorId,
} from "./anchors";

/**
 * A viewport-relative rect for the spotlight cutout. `null` when no anchor
 * resolves, meaning the active step should render as a centred card.
 */
export type AnchorRect = {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

function rectFromElement(el: HTMLElement): AnchorRect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    right: r.right,
    bottom: r.bottom,
  };
}

function nullRect(): AnchorRect | null {
  return null;
}

/**
 * Resolve the active step's anchor candidates and track the element's box
 * over time. Returns the current rect, or `null` when nothing resolves.
 *
 * Tracking (spec: "Anchor geometry follows layout changes"):
 * - `ResizeObserver` on the resolved element catches the element resizing.
 * - `ResizeObserver` on `document.body` catches the layout reflowing even
 *   when the anchor's own box is unchanged (e.g. a pane split shifts it).
 * - passive `resize` and `scroll` listeners on `window`, rAF-throttled so
 *   a live queue / sync indicator churn never starves the main thread.
 *
 * Not `MutationObserver`: too noisy in a shell with live indicators.
 */
export function useAnchorRect(candidates: TourAnchorId[]): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(() => {
    if (typeof window === "undefined") return nullRect();
    const el = resolveAnchor(candidates);
    return el ? rectFromElement(el) : null;
  });

  // The element we are currently tracking, plus a rAF handle so we can
  // coalesce bursts of events into one measurement.
  const trackedRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Resolve fresh on every candidates change.
    const el = resolveAnchor(candidates);
    trackedRef.current = el;
    setRect(el ? rectFromElement(el) : null);
    if (!el) return;

    const scheduleMeasure = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const tracked = trackedRef.current;
        if (!tracked || !isVisuallyPresent(tracked)) {
          // The element hid since the last event. Try to re-resolve the
          // candidate list before giving up — a view swap may have remounted
          // it elsewhere.
          const next = resolveAnchor(candidates);
          trackedRef.current = next;
          setRect(next ? rectFromElement(next) : null);
          return;
        }
        setRect(rectFromElement(tracked));
      });
    };

    // ResizeObserver covers the anchor's own box changing.
    const ro = new ResizeObserver(() => scheduleMeasure());
    ro.observe(el);
    if (document.body) ro.observe(document.body);

    // Window events cover movement without a resize (scroll, pane drag).
    window.addEventListener("resize", scheduleMeasure, { passive: true });
    window.addEventListener("scroll", scheduleMeasure, { passive: true, capture: true });

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, { capture: true } as EventListenerOptions);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      trackedRef.current = null;
    };
    // `candidates` is a new array per render by design; compare by value so
    // the effect re-runs only when the candidate set actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.join("|")]);

  return rect;
}

/** Convenience: padding in pixels applied around the anchor's box. */
export const SPOTLIGHT_PADDING = 8;

/**
 * Expand an anchor rect by the spotlight padding and return the dim-panel
 * geometry: the four rectangles that, painted black-ish, leave only the
 * anchor (plus padding) visible.
 */
export function computeDimPanels(
  rect: AnchorRect,
  pad: number,
  viewportWidth: number,
  viewportHeight: number,
): {
  top: AnchorRect;
  right: AnchorRect;
  bottom: AnchorRect;
  left: AnchorRect;
  ring: AnchorRect;
} {
  const ringLeft = Math.max(0, rect.left - pad);
  const ringTop = Math.max(0, rect.top - pad);
  const ringRight = Math.min(viewportWidth, rect.right + pad);
  const ringBottom = Math.min(viewportHeight, rect.bottom + pad);
  const ringWidth = Math.max(0, ringRight - ringLeft);
  const ringHeight = Math.max(0, ringBottom - ringTop);

  return {
    // Above the anchor.
    top: { left: 0, top: 0, width: viewportWidth, height: Math.max(0, ringTop), right: viewportWidth, bottom: ringTop },
    // Right of the anchor.
    right: {
      left: ringRight,
      top: ringTop,
      width: Math.max(0, viewportWidth - ringRight),
      height: ringHeight,
      right: viewportWidth,
      bottom: ringBottom,
    },
    // Below the anchor.
    bottom: {
      left: 0,
      top: ringBottom,
      width: viewportWidth,
      height: Math.max(0, viewportHeight - ringBottom),
      right: viewportWidth,
      bottom: viewportHeight,
    },
    // Left of the anchor.
    left: { left: 0, top: ringTop, width: Math.max(0, ringLeft), height: ringHeight, right: ringLeft, bottom: ringBottom },
    // The non-dimmed ring drawn around the anchor for visual emphasis.
    ring: { left: ringLeft, top: ringTop, width: ringWidth, height: ringHeight, right: ringRight, bottom: ringBottom },
  };
}

/** Re-exported so callers don't need to know about candidatesFromAnchor. */
export { candidatesFromAnchor };
