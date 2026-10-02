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

/** The DAQE idle timeout. Configurable per user via `settings.daqe.knobs.afkIdleTimeoutMs`. */
export const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/** Inclusive bounds on the idle timeout, matching the settings schema. */
export const AFK_IDLE_TIMEOUT_MIN_MS = 15_000;
export const AFK_IDLE_TIMEOUT_MAX_MS = 120_000;

/**
 * The pre-DAQE idle threshold.
 *
 * @deprecated Kept as a re-export so existing call sites keep compiling. DAQE
 * made the timeout a user setting; pass `idleTimeoutMs` instead of reading this.
 */
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

/**
 * How a dwell session ended.
 *
 * A closed union because an unrecognised value must not be stored: a typo in a
 * caller's exit action would otherwise enter the friction signal as a fact.
 */
export const DWELL_EXIT_ACTIONS = [
  "extract-created",
  "next-item",
  "postpone",
  "dismiss",
  "re-prioritize",
  "session-end",
] as const;
export type DwellExitAction = (typeof DWELL_EXIT_ACTIONS)[number];

export function isDwellExitAction(value: unknown): value is DwellExitAction {
  return (
    typeof value === "string" &&
    (DWELL_EXIT_ACTIONS as readonly string[]).includes(value)
  );
}

/** What a flush carries alongside the active seconds. */
export interface DwellFlush {
  /** Discarded time: never attributed as dwell. */
  idleMs: number;
  /**
   * How far through the document the user got, in `[0,1]`.
   *
   * Supplied by the viewer via `reportTraversal`, never inferred from the
   * engagement events: a pointer move at the bottom of a page is not evidence of
   * having read the top of it.
   */
  scrollDepthRatio?: number;
  /** Highlights or extracts per minute of active dwell. */
  interactionDensity?: number;
  /** Only the last flush of a session carries it. */
  exitAction?: DwellExitAction;
}

/** The one-time signal that the user returned after being away. */
export interface AwayReturn {
  /** How long they were away. */
  idleMs: number;
  /** The notice id, so the UI can dismiss it. */
  noticeId: string;
}

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
  onFlush: (activeSeconds: number, details: DwellFlush) => void | Promise<void>;
  /**
   * Changing this ends the current accrual: the pending seconds are flushed
   * against the *previous* value before the new one starts counting.
   */
  itemKey?: string;
  /** Escape hatch for tests and for surfaces that opt out. */
  enabled?: boolean;
  /**
   * The idle cutoff. `settings.daqe.knobs.afkIdleTimeoutMs`; clamped by the
   * settings validator to 15 000–120 000.
   */
  idleTimeoutMs?: number;
  /**
   * Called once per idle episode when the user returns. The notice is
   * informational and must never block the current item.
   */
  onAwayReturn?: (return_: AwayReturn) => void;
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
  /** Pending discarded milliseconds, not yet flushed. */
  getPendingIdleMs: () => number;
  /**
   * Report how far through the document the user has got, in `[0,1]`.
   *
   * Separate from {@link notifyEngagement} because traversal is evidence and
   * engagement is only a hint — the two must not be conflated.
   */
  reportTraversal: (ratio: number) => void;
  /** Record the action that ends this session. Sent with the next flush. */
  setExitAction: (action: DwellExitAction) => void;
  /** Record one highlight or extract, for the interaction-density signal. */
  recordInteraction: () => void;
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
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  onAwayReturn,
}: UseActiveTimeTrackerOptions): ActiveTimeTracker {
  const pendingRef = useRef(0);
  const pendingIdleMsRef = useRef(0);
  const lastEngagementRef = useRef(Date.now());
  const onFlushRef = useRef(onFlush);
  const onAwayReturnRef = useRef(onAwayReturn);
  const itemKeyRef = useRef(itemKey);
  /** True once the user has gone idle and not yet returned. */
  const idleRef = useRef(false);
  /** When this idle episode began, for the return notice. */
  const idleBeganAtRef = useRef(0);
  /** Latest traversal report, monotonic. */
  const traversalRef = useRef(0);
  const interactionsRef = useRef(0);
  const exitActionRef = useRef<DwellExitAction | undefined>(undefined);
  /** Monotonic counter for notice ids, so a re-render cannot replay a notice. */
  const noticeSeqRef = useRef(0);

  onFlushRef.current = onFlush;
  onAwayReturnRef.current = onAwayReturn;

  const flush = useCallback(() => {
    const seconds = pendingRef.current;
    const idleMs = pendingIdleMsRef.current;
    const hasIdle = idleMs > 0;
    const exitAction = exitActionRef.current;
    if (seconds <= 0 && !hasIdle) return;
    pendingRef.current = 0;
    pendingIdleMsRef.current = 0;
    // The exit action belongs to the session that is ending, so it is consumed
    // by the flush that carries it rather than being sent again later.
    exitActionRef.current = undefined;
    const details: DwellFlush = { idleMs };
    if (traversalRef.current > 0) details.scrollDepthRatio = traversalRef.current;
    // Per *minute* of observed time, floor 1 so a very short session yields a
    // usable rate instead of dividing by zero.
    const observedMs = seconds * 1000 + idleMs;
    if (interactionsRef.current > 0) {
      details.interactionDensity = interactionsRef.current / Math.max(observedMs / 60_000, 1);
    }
    if (exitAction) details.exitAction = exitAction;
    try {
      void onFlushRef.current(seconds, details);
    } catch {
      // A failed flush must not stop the loop. The seconds are already
      // cleared: re-sending them on the next flush would double-count, and
      // over-reporting is worse than losing one interval.
    }
  }, []);

  const notifyEngagement = useCallback(() => {
    const wasIdle = idleRef.current;
    idleRef.current = false;
    lastEngagementRef.current = Date.now();
    if (wasIdle) {
      // Returning from an idle episode. The time away is discarded, not dwell —
      // `pendingIdleMsRef` already holds it — so all this does is tell the user
      // that tracking paused. Informational only.
      noticeSeqRef.current += 1;
      onAwayReturnRef.current?.({
        idleMs: Math.max(0, Date.now() - idleBeganAtRef.current),
        noticeId: `away-${noticeSeqRef.current}`,
      });
    }
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

    idleRef.current = false;
    pendingIdleMsRef.current = 0;

    const interval = window.setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastEngagementRef.current;

      // Observation gate first. A hidden document or an unfocused window is not
      // "the user was away" — it is a period we did not observe at all, and the
      // repository's rule is that nothing is written for an unobserved period.
      // Checking idleness first would misfile every unfocused second as idle
      // time, which is precisely the inflation this tracker exists to prevent.
      if (!isDocumentVisible() || !isWindowFocused()) return;

      if (idleFor >= idleTimeoutMs) {
        if (!idleRef.current) {
          idleRef.current = true;
          idleBeganAtRef.current = lastEngagementRef.current;
          // Retroactive clamp. Everything still pending has been accruing inside
          // the block that is now idle, so it moves to idle rather than being
          // reported as dwell.
          //
          // The seconds already flushed were genuinely observed, and only the
          // tail of the idle block is still pending when the transition is
          // detected, because the flush cadence is shorter than the timeout.
          pendingIdleMsRef.current += pendingRef.current * 1000;
          pendingRef.current = 0;
        }
        // The away span keeps accruing as idle. Without this, only the idle
        // timeout itself would be attributed and the rest of the absence would
        // be neither active nor idle — so `active + idle == elapsed` would not
        // hold, and "the user was away for an hour" would be indistinguishable
        // from "the tracker stopped".
        pendingIdleMsRef.current += TICK_INTERVAL_MS;
        return;
      }

      pendingRef.current += 1;
    }, TICK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [enabled, isActive, idleTimeoutMs]);

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

  const reportTraversal = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio)) return;
    // Monotonic: the figure is "how far through the document the user got", so a
    // later report can only advance it. Taking a max also makes a stale or
    // out-of-order viewer report harmless.
    traversalRef.current = Math.min(1, Math.max(traversalRef.current, Math.max(0, ratio)));
  }, []);

  const setExitAction = useCallback((action: DwellExitAction) => {
    if (!isDwellExitAction(action)) return;
    exitActionRef.current = action;
  }, []);

  const recordInteraction = useCallback(() => {
    interactionsRef.current += 1;
  }, []);

  return {
    getPendingSeconds: () => pendingRef.current,
    getPendingIdleMs: () => pendingIdleMsRef.current,
    flush,
    notifyEngagement,
    reportTraversal,
    setExitAction,
    recordInteraction,
  };
}
