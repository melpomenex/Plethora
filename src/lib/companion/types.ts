/**
 * Plethora Companion — shared types.
 *
 * The companion is a deterministic state machine driven by structured app
 * events. It never polls and never owns timers beyond speech expiry; all
 * timing decisions flow through the policy with an injectable clock so tests
 * are reproducible.
 */

export type CompanionStateId =
  | "perch"
  | "idle"
  | "blink"
  | "look"
  | "hop"
  | "celebrate"
  | "think"
  | "curious"
  | "talk"
  | "sleep";

/** Structured application events the companion can react to. */
export type CompanionEvent =
  | { type: "app_launched" }
  | { type: "document_opened"; title?: string }
  | { type: "reading_milestone"; percent: number }
  | { type: "highlight_created" }
  | { type: "extract_created" }
  | { type: "card_created" }
  | { type: "review_correct"; streak?: number }
  | { type: "review_difficult" }
  | { type: "review_session_completed"; count: number }
  | { type: "rss_liked"; title?: string }
  | { type: "rss_disliked" }
  | { type: "queue_due_changed"; count: number };

export interface CompanionReaction {
  state: CompanionStateId;
  /** i18n key for an optional speech line; absent = no bubble. */
  speechKey?: string;
  /** Interpolation values for the speech line. */
  speechVars?: Record<string, string | number>;
  /** How long a transient state plays before returning to perch (ms). */
  durationMs?: number;
}

export type SpeechFrequency = "quiet" | "normal" | "chatty";

export interface CompanionSettings {
  enabled: boolean;
  speechFrequency: SpeechFrequency;
  /** Contextual reading comments (milestones, highlights). */
  contextualComments: boolean;
  /** Study encouragement (review outcomes, streaks). */
  encouragement: boolean;
}

export const DEFAULT_COMPANION_SETTINGS: CompanionSettings = {
  enabled: false,
  speechFrequency: "normal",
  contextualComments: true,
  encouragement: true,
};

/** Context the policy needs to decide eligibility. */
export interface CompanionContext {
  now: number;
  settings: CompanionSettings;
  /** Milliseconds since the last unsolicited bubble (Infinity initially). */
  msSinceLastSpeech: number;
  /** Speech lines shown this session. */
  sessionSpeechCount: number;
  /** Recent speech keys (most recent last) for no-repeat. */
  recentSpeechKeys: string[];
  /** A text input currently has focus. */
  typingActive: boolean;
  /** A review decision is in progress (grade buttons armed). */
  reviewDecisionActive: boolean;
  /** A modal or focus/immersive mode is open. */
  modalOrFocusActive: boolean;
}

/** Result of running an event through the policy. */
export interface PolicyDecision {
  allow: boolean;
  reason?: string;
  budgetExhausted?: boolean;
}
