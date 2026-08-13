import { useCallback, useEffect, useRef } from "react";

/**
 * Active-time tracking.
 *
 * Time attributed to an item is *active* time: the portion of elapsed time
 * during which the user was plausibly engaged with it. Seconds accrue only
 * while all four hold — the document is visible, the window is focused, the
 * user is not idle, and this item is the foreground one — so a document left
 * open overnight does not report nine hours of study.
 *
 * Accrued seconds are flushed to the backend on a cadence rather than only at
 * the end, so a crash loses at most one interval and can never inflate: only
 * seconds that were actually observed are ever sent.
 */

/** No engagement signal for this long and the item stops accruing. */
export const IDLE_THRESHOLD_MS = 60_000;

/** How often accrued seconds are handed to the backend. */
export const FLUSH_INTERVAL_MS = 30_000;

/** Granularity of the accrual loop. One second is the unit we persist in. */
const TICK_INTERVAL_MS = 1_000;

/**
 * Engagement signals that reset the idle timer.
 *
 * Media playback is handled separately via {@link ActiveTimeTracker.notifyEngagement}
 * so a 40-minute audiobook chapter keeps counting with no input at all.
 */
const ENGAGEMENT_EVENTS = [
  "pointermove",
  "pointerdown",
  "keydown",
  "wheel",
  "scroll",
  "touchstart",
] as const;

export interface UseActiveTimeTrackerOptions {
  /**
   * Whether this item is the foreground one. Two mounted trackers must not
   * both accrue — only the item the user is actually looking at does.
   */
  isActive: boolean;
  /**
   * Receives whole seconds observed since the last flush. Never called with
   * zero. Errors are swallowed by the caller's own handling; a rejected
   * promise must not break the accrual loop.
   */
  onFlush: (activeSeconds: number) => void | Promise<void>;
  /**
   * Changing this ends the current accrual: the pending seconds are flushed
   * against the *previous* value before the new one starts counting.
   */
  itemKey?: string;
  /** Escape hatch for tests and for surfaces that opt out. */
  enabled?: boolean;
}

export interface ActiveTimeTracker {
  /** Seconds accrued but not yet flushed. */
  getPendingSeconds: () => number;
  /** Flush now — after a rating, before navigating away. */
  flush: () => void;
  /**
   * Report engagement that produces no DOM event: media `timeupdate`, a
   * rating action, a programmatic page turn.
   */
  notifyEngagement: () => void;
}

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

function isWindowFocused(): boolean {
  if (typeof document === "undefined") return true;
  // `hasFocus` is the honest signal: a window can be visible but behind
  // another application, and that time is not study time.
  return typeof document.hasFocus === "function" ? document.hasFocus() : true;
}

/**
 * Accrue active seconds for one item and flush them on a cadence.
 *
 * @example
 * const tracker = useActiveTimeTracker({
 *   isActive: isCurrentItem,
 *   itemKey: document.id,
 *   onFlush: (seconds) => recordActiveTime("document", document.id, "reader", seconds, sessionId),
 * });
 */
export function useActiveTimeTracker({
  isActive,
  onFlush,
  itemKey,
  enabled = true,
}: UseActiveTimeTrackerOptions): ActiveTimeTracker {
  const pendingRef = useRef(0);
  const lastEngagementRef = useRef(Date.now());
  const onFlushRef = useRef(onFlush);
  const itemKeyRef = useRef(itemKey);

  onFlushRef.current = onFlush;

  const flush = useCallback(() => {
    const seconds = pendingRef.current;
    if (seconds <= 0) return;
    pendingRef.current = 0;
    try {
      void onFlushRef.current(seconds);
    } catch {
      // A failed flush must not stop the loop. The seconds are already
      // cleared: re-sending them on the next flush would double-count, and
      // over-reporting is worse than losing one interval.
    }
  }, []);

  const notifyEngagement = useCallback(() => {
    lastEngagementRef.current = Date.now();
  }, []);

  // Flush the previous item's pending seconds before the new one starts.
  // Without this, time read on document A lands on document B.
  useEffect(() => {
    if (itemKeyRef.current !== itemKey) {
      flush();
      itemKeyRef.current = itemKey;
      lastEngagementRef.current = Date.now();
    }
  }, [itemKey, flush]);

  // Any engagement signal resets the idle clock.
  useEffect(() => {
    if (!enabled) return;
    const handler = () => notifyEngagement();

    for (const event of ENGAGEMENT_EVENTS) {
      window.addEventListener(event, handler, { passive: true });
    }
    return () => {
      for (const event of ENGAGEMENT_EVENTS) {
        window.removeEventListener(event, handler);
      }
    };
  }, [enabled, notifyEngagement]);

  // Becoming visible or regaining focus counts as engagement — otherwise a
  // user who tabs back after two minutes would be idle from the first second.
  useEffect(() => {
    if (!enabled) return;

    const handleFocus = () => notifyEngagement();
    const handleBlur = () => flush();
    const handleVisibility = () => {
      if (isDocumentVisible()) {
        notifyEngagement();
      } else {
        flush();
      }
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, flush, notifyEngagement]);

  // The accrual loop. One second per tick, and only when every condition
  // holds — this is the whole definition of "active time".
  useEffect(() => {
    if (!enabled || !isActive) return;

    // Entering the foreground is itself engagement.
    lastEngagementRef.current = Date.now();

    const interval = window.setInterval(() => {
      const idleFor = Date.now() - lastEngagementRef.current;
      if (idleFor >= IDLE_THRESHOLD_MS) return;
      if (!isDocumentVisible() || !isWindowFocused()) return;
      pendingRef.current += 1;
    }, TICK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [enabled, isActive]);

  // Leaving the foreground banks what was accrued rather than holding it.
  useEffect(() => {
    if (!enabled || isActive) return;
    flush();
  }, [enabled, isActive, flush]);

  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(flush, FLUSH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, flush]);

  // Unmount is the last chance to bank the tail of a session.
  useEffect(() => () => flush(), [flush]);

  return {
    getPendingSeconds: () => pendingRef.current,
    flush,
    notifyEngagement,
  };
}
