/**
 * Touch selection-dismissal primitives (spec: touch-selection-dismissal).
 *
 * On touch shells the native selection deliberately survives dismissal —
 * clearing it programmatically while Android's selection action mode is up
 * wedges the WebView. Consequence: reflow DOM churn (lazy page sections
 * appending around the live selection) keeps firing selectionchange, so the
 * dismissal guard must be keyed by TEXT (offsets shift with every mutation)
 * and scroll must actively dismiss the UI. These are the pure pieces of that
 * logic so the semantics are unit-testable without rendering DocumentViewer.
 */

/** Minimum scroll travel before a scroll gesture counts as deliberate. */
export const SCROLL_DISMISS_THRESHOLD_PX = 8;

/**
 * Gate over one scroll gesture: tracks the origin (per scroller, so an
 * overlay scroller interleaving with the content scroller re-arms instead of
 * accumulating phantom travel) and reports true exactly once per gesture once
 * travel crosses the threshold.
 */
export function createScrollDismissGate(thresholdPx: number = SCROLL_DISMISS_THRESHOLD_PX) {
  let origin: { target: EventTarget; top: number; left: number } | null = null;
  return {
    /** Feed a scroll event (its target + current offsets); true = dismiss. */
    track(target: EventTarget, top: number, left: number): boolean {
      if (!origin || origin.target !== target) {
        origin = { target, top, left };
        return false;
      }
      const traveled = Math.abs(top - origin.top) + Math.abs(left - origin.left);
      if (traveled < thresholdPx) return false;
      origin = null; // gesture consumed; the next scroll re-arms fresh
      return true;
    },
    reset(): void {
      origin = null;
    },
  };
}

/**
 * Whether a stability-gated candidate selection stays suppressed after a
 * dismissal. Keyed by text with no expiry: DOM churn shifts offsets but (for
 * the churn case) never the selected text, while a genuinely new selection
 * almost always differs in text. Suppression is cleared by a fresh content
 * gesture (pass null) or a collapsed native selection (pass null).
 */
export function isSuppressedSelection(dismissedText: string | null, candidateText: string): boolean {
  if (dismissedText === null || dismissedText === "") return false;
  return dismissedText === candidateText;
}
