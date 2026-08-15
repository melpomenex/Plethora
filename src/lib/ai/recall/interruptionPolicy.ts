/**
 * Active-recall interruption policy (design D19 / ai-active-recall spec,
 * task 5.4).
 *
 * Pure, deterministic decision module — the ONLY authority on when a recall
 * prompt may interrupt reading. The viewer controller feeds it signals and
 * renders an overlay only when `decidePromptsEligible` says so. Every spec
 * scenario maps to a branch here, mirrored 1:1 in the unit tests:
 *
 *   - mode off            → never eligible (kill switch);
 *   - "don't ask again today" → suppressed until the next calendar day;
 *   - selection / reflow / playback → suppressed;
 *   - per-session cap     → max 3 prompts per reading session;
 *   - minimum interval    → low 10 min, adaptive 4–10 by signals,
 *                           intensive 2 min.
 *
 * Adaptive interval resolution (4–10 min): a signal score widens the
 * interval when the reader struggles or the material is already covered,
 * narrows it when they are cruising through fresh material.
 */

export type ActiveRecallMode = "off" | "low" | "adaptive" | "intensive";

/** Minimum prompt interval per fixed mode, in minutes (design D19). */
export const MIN_INTERVAL_MINUTES: Readonly<Record<Exclude<ActiveRecallMode, "adaptive" | "off">, number>> = {
  low: 10,
  intensive: 2,
};

/** Inclusive bounds of the adaptive interval window, in minutes. */
export const ADAPTIVE_INTERVAL_RANGE = { min: 4, max: 10 } as const;

/** Maximum prompts per reading session (spec: interruption budget). */
export const MAX_PROMPTS_PER_SESSION = 3;

export type RecallSuppressionReason =
  | "mode-off"
  | "dismissed-today"
  | "selection-active"
  | "reflow-active"
  | "playback-active"
  | "session-budget-exhausted"
  | "min-interval"
  | "eligible";

export interface RecallSignals {
  mode: ActiveRecallMode;
  /** Minutes since the last prompt; null when none was shown yet. */
  minutesSinceLastPrompt: number | null;
  /** Prompts already shown in this reading session (answered or dismissed). */
  promptsThisSession: number;
  /** User is actively selecting text right now. */
  isSelecting: boolean;
  /** A PDF reflow interaction is in progress. */
  isReflowActive: boolean;
  /** Audio/video playback is active. */
  isPlaybackActive: boolean;
  /**
   * Local calendar day (YYYY-MM-DD) the user dismissed prompts for with
   * "don't ask again today"; prompts stay suppressed until the next day.
   */
  dismissedUntilTomorrow?: string | null;
  /** Current local calendar day (YYYY-MM-DD); injectable for tests. */
  today?: string;
  /** Reading-progress delta since the last prompt, 0–1. */
  readingProgressDelta: number;
  /** Concept density of recently read material, chunks read per minute. */
  conceptDensity: number;
  /** Recent review-grade trend, -1 (failing) .. 1 (acing). */
  recentGradeTrend: number;
  /** Share of read material already covered by existing cards, 0–1. */
  coverageRatio: number;
  /** Minutes read in this session (observability; not a gate). */
  minutesReadThisSession: number;
}

export interface PromptEligibility {
  eligible: boolean;
  reason: RecallSuppressionReason;
  /** Resolved minimum interval in minutes (adaptive resolves per signals). */
  minIntervalMinutes: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Adaptive minimum interval (4–10 min) from the signal profile:
 *
 *  +1 when recent grades trend down (< -0.2)  — struggling: widen;
 *  +1 when existing card coverage is high (> 0.6) — already tested: widen;
 *  +1 when concept density is low (< 0.5/min) — little new material: widen;
 *  -1 when progress is strong (≥ 0.05) through fresh (< 0.3 coverage)
 *      material — cruising: narrow;
 *  -1 when grades trend up (> 0.2) with steady progress (≥ 0.03): narrow.
 *
 * Score -2..+3 maps deterministically onto {4, 6, 8, 10} (clamped).
 */
export function adaptiveMinIntervalMinutes(signals: RecallSignals): number {
  let score = 0;
  if (signals.recentGradeTrend < -0.2) score += 1;
  if (signals.coverageRatio > 0.6) score += 1;
  if (signals.conceptDensity < 0.5) score += 1;
  if (signals.readingProgressDelta >= 0.05 && signals.coverageRatio < 0.3) score -= 1;
  if (signals.recentGradeTrend > 0.2 && signals.readingProgressDelta >= 0.03) score -= 1;
  return clamp(6 + score * 2, ADAPTIVE_INTERVAL_RANGE.min, ADAPTIVE_INTERVAL_RANGE.max);
}

/** Resolve the minimum interval for the active mode. */
export function minIntervalMinutes(signals: RecallSignals): number {
  if (signals.mode === "adaptive") return adaptiveMinIntervalMinutes(signals);
  if (signals.mode === "off") return 0;
  return MIN_INTERVAL_MINUTES[signals.mode];
}

/**
 * Decide whether a recall prompt may be shown right now. Deterministic: the
 * same signals always yield the same verdict, and the FIRST failing rule
 * wins (the order is part of the contract, mirrored by the tests).
 */
export function decidePromptsEligible(signals: RecallSignals): PromptEligibility {
  const minInterval = minIntervalMinutes(signals);

  if (signals.mode === "off") {
    return { eligible: false, reason: "mode-off", minIntervalMinutes: 0 };
  }

  // "Don't ask again today": suppressed for the remainder of the dismissal
  // calendar day; a different (later) day re-enables prompts.
  if (
    signals.dismissedUntilTomorrow &&
    signals.dismissedUntilTomorrow === (signals.today ?? localDayString(new Date()))
  ) {
    return { eligible: false, reason: "dismissed-today", minIntervalMinutes: minInterval };
  }

  if (signals.isSelecting) {
    return { eligible: false, reason: "selection-active", minIntervalMinutes: minInterval };
  }
  if (signals.isReflowActive) {
    return { eligible: false, reason: "reflow-active", minIntervalMinutes: minInterval };
  }
  if (signals.isPlaybackActive) {
    return { eligible: false, reason: "playback-active", minIntervalMinutes: minInterval };
  }

  if (signals.promptsThisSession >= MAX_PROMPTS_PER_SESSION) {
    return {
      eligible: false,
      reason: "session-budget-exhausted",
      minIntervalMinutes: minInterval,
    };
  }

  if (
    signals.minutesSinceLastPrompt !== null &&
    signals.minutesSinceLastPrompt < minInterval
  ) {
    return { eligible: false, reason: "min-interval", minIntervalMinutes: minInterval };
  }

  return { eligible: true, reason: "eligible", minIntervalMinutes: minInterval };
}

/** Local calendar day as YYYY-MM-DD (recall dismissal is day-scoped). */
export function localDayString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
