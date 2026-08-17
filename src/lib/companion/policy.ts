/**
 * Companion speech policy — the anti-spam layer.
 *
 * Hard rules (spec: companion-runtime / Anti-spam speech policy):
 *  - minimum cooldown between unsolicited bubbles
 *  - per-session speech budget scaled by the user's frequency setting
 *  - suppression while typing, during review decisions, in modals/focus modes
 *  - no repeating any of the last N lines
 *
 * The engine is pure: every decision is a function of (event, ctx).
 */

import type { CompanionEvent, CompanionContext, PolicyDecision, SpeechFrequency } from "./types";

/** Minimum cooldown between unsolicited bubbles (ms), by frequency. */
const COOLDOWN_MS: Record<SpeechFrequency, number> = {
  quiet: 5 * 60_000,
  normal: 90_000,
  chatty: 45_000,
};

/** Session budget (max bubbles), by frequency. */
const SESSION_BUDGET: Record<SpeechFrequency, number> = {
  quiet: 3,
  normal: 8,
  chatty: 16,
};

/** Lines that never repeat within this window. */
const NO_REPEAT_WINDOW = 5;

export function cooldownMs(frequency: SpeechFrequency): number {
  return COOLDOWN_MS[frequency] ?? COOLDOWN_MS.normal;
}

export function sessionBudget(frequency: SpeechFrequency): number {
  return SESSION_BUDGET[frequency] ?? SESSION_BUDGET.normal;
}

/** Events that are suppressed outright in busy contexts. */
export function isSuppressedContext(ctx: CompanionContext): boolean {
  return ctx.typingActive || ctx.reviewDecisionActive || ctx.modalOrFocusActive;
}

export function decideSpeech(ctx: CompanionContext, speechKey?: string): PolicyDecision {
  if (!speechKey) return { allow: false, reason: "no-line" };

  if (isSuppressedContext(ctx)) {
    return { allow: false, reason: "suppressed-context" };
  }
  if (ctx.sessionSpeechCount >= sessionBudget(ctx.settings.speechFrequency)) {
    return { allow: false, reason: "budget", budgetExhausted: true };
  }
  if (ctx.msSinceLastSpeech < cooldownMs(ctx.settings.speechFrequency)) {
    return { allow: false, reason: "cooldown" };
  }
  const window = ctx.recentSpeechKeys.slice(-NO_REPEAT_WINDOW);
  if (window.includes(speechKey)) {
    return { allow: false, reason: "no-repeat" };
  }
  return { allow: true };
}

/** Category gating by user preference. */
export function eventAllowedBySettings(
  event: CompanionEvent,
  settings: { contextualComments: boolean; encouragement: boolean }
): boolean {
  switch (event.type) {
    case "document_opened":
    case "reading_milestone":
    case "highlight_created":
    case "extract_created":
      return settings.contextualComments;
    case "card_created":
    case "review_correct":
    case "review_difficult":
    case "review_session_completed":
      return settings.encouragement;
    default:
      return true;
  }
}
