/**
 * Feedback policy registry — pure data mapping each feedback event to its
 * allowed channels, sound role, priority, and suppression rules.
 *
 * Scaffolding for the `unify-notifications-and-sound` OpenSpec change. The
 * orchestrator that interprets this data is TODO(implementation) (tasks.md 2.1,
 * `./orchestrator.ts`). This module must stay side-effect-free: it is data plus
 * types, safe to import from tests and from the future decision layer.
 *
 * Source of truth for the values: design.md §2 (event inventory) and §3 (sound
 * language). Change the docs first, then this table — the contract tests in
 * __tests__/policy.test.ts pin the invariants.
 */

import type { FeedbackType } from "../../utils/soundService";
import type { FeedbackEventId } from "./events";

/**
 * Semantic sound roles (design.md §3). Roles map onto the existing bundled
 * assets via SOUND_ROLE_TO_FEEDBACK_TYPE — v1 ships no new audio files.
 */
export type SoundRole =
  | "acknowledge" // dry tick for opt-in micro-interactions
  | "confirm" // action succeeded
  | "complete" // session/timer completion
  | "celebrate" // streak milestone, may layer after `complete`
  | "attention" // reminder; uses the user-selected notification sound
  | "warning" // recoverable issue
  | "error"; // failed action

/**
 * Which existing soundService FeedbackType each role plays.
 * `attention` is special-cased: it resolves through the user's
 * `notifications.notificationSound` selection (NOTIFICATION_SOUND_FILES),
 * not through this map.
 */
export const SOUND_ROLE_TO_FEEDBACK_TYPE: Record<Exclude<SoundRole, "attention">, FeedbackType> = {
  acknowledge: "click",
  confirm: "success",
  complete: "review-complete",
  celebrate: "milestone",
  warning: "warning",
  error: "error",
};

/**
 * Which user setting gates a role's audibility (settingsStore `notifications`):
 * - "feedback": `feedbackSoundsEnabled` + `feedbackVolume` (default OFF, 0.3)
 * - "notification": `soundEnabled` + `soundVolume` (default ON, 0.5)
 */
export const SOUND_ROLE_GATE: Record<SoundRole, "feedback" | "notification"> = {
  acknowledge: "feedback",
  confirm: "feedback",
  warning: "feedback",
  error: "feedback",
  complete: "notification",
  celebrate: "notification",
  attention: "notification",
};

/** Channel modes. `never` is an explicit product decision, not an omission. */
export type ChannelMode = "default-on" | "opt-in" | "never";

/** When an OS notification is allowed to fire relative to app visibility. */
export type OsVisibilityRule = "hidden-only" | "always" | "never";

export interface FeedbackPolicy {
  /** Passive | informative | actionable | warning | critical (design.md §2). */
  importance: "passive" | "informative" | "actionable" | "warning" | "critical";
  /** In-app toast via useToastStore. */
  toast: ChannelMode;
  /** Sound role, or null for silent events. Sound must never be the sole channel. */
  sound: SoundRole | null;
  /** Haptic (existing vibrate()) — only meaningful where supportsHaptics(). */
  haptic: boolean;
  /** OS-level notification pathway. */
  osNotification: ChannelMode;
  /** Visibility gate applied when osNotification is not "never". */
  osVisibility: OsVisibilityRule;
  /** Respect quiet hours (attention/OS channels only per design; errors never gated). */
  quietHours: boolean;
  /**
   * Minimum ms between deliveries of the same dedupe key.
   * 0 = no cooldown. Reminder additionally has a persisted daily cap
   * (orchestrator concern, not expressible here).
   */
  cooldownMs: number;
  /** Suppress entirely while a review session is active. */
  suppressDuringReview: boolean;
  /** Web Notification `tag` / Tauri dedupe hint, when OS delivery is possible. */
  osTag?: string;
}

/**
 * The registry. Every FeedbackEventId must appear here (contract-tested).
 * TODO(implementation): consumed by ./orchestrator.ts `emitFeedback` (task 2.1).
 */
export const FEEDBACK_POLICY_REGISTRY: Record<FeedbackEventId, FeedbackPolicy> = {
  "review.card-graded": {
    importance: "passive",
    toast: "never",
    sound: "acknowledge",
    haptic: true,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 150,
    suppressDuringReview: false,
  },
  "review.card-action": {
    importance: "actionable",
    toast: "default-on",
    sound: "confirm",
    haptic: false,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 2000,
    suppressDuringReview: false,
  },
  "review.session-completed": {
    importance: "informative",
    toast: "never", // the completion screen is the visual channel
    sound: "complete",
    haptic: true,
    osNotification: "opt-in",
    osVisibility: "hidden-only",
    quietHours: true,
    cooldownMs: 0,
    suppressDuringReview: false,
    osTag: "session-complete",
  },
  "review.streak-milestone": {
    importance: "informative",
    toast: "never",
    sound: "celebrate",
    haptic: true,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 0,
    suppressDuringReview: false,
  },
  "queue.due-count-changed": {
    importance: "passive",
    toast: "never",
    sound: null, // badge-only event
    haptic: false,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 0,
    suppressDuringReview: false,
  },
  "reminder.reviews-due": {
    importance: "actionable",
    toast: "default-on", // foreground fallback when OS path is suppressed
    sound: "attention",
    haptic: false,
    osNotification: "opt-in", // `enabled && studyReminders`
    osVisibility: "hidden-only",
    quietHours: true,
    cooldownMs: 60 * 60 * 1000, // plus persisted once-per-day cap in orchestrator
    suppressDuringReview: true,
    osTag: "due-cards",
  },
  "import.completed": {
    importance: "informative",
    toast: "default-on",
    sound: "confirm",
    haptic: false,
    osNotification: "never", // v2 may allow hidden-window long imports
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 1000,
    suppressDuringReview: false,
  },
  "import.failed": {
    importance: "warning",
    toast: "default-on",
    sound: "error",
    haptic: true,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 1000,
    suppressDuringReview: false,
  },
  "transcription.completed": {
    importance: "informative",
    toast: "default-on",
    sound: "confirm",
    haptic: false,
    osNotification: "never", // v2: hidden-window only
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 1000,
    suppressDuringReview: false,
  },
  "transcription.failed": {
    importance: "warning",
    toast: "default-on",
    sound: "error",
    haptic: false,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 1000,
    suppressDuringReview: false,
  },
  "backup.auto-backup-found": {
    importance: "actionable",
    toast: "default-on", // persistent (duration 0) with Restore action
    sound: null,
    haptic: false,
    osNotification: "never", // startup notice: app is foreground by definition
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 0,
    suppressDuringReview: false,
  },
  "db.recovered-after-quarantine": {
    importance: "critical",
    toast: "default-on", // persistent until dismissed
    sound: "warning",
    haptic: false,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false, // critical events are never time-gated
    cooldownMs: 0,
    suppressDuringReview: false,
  },
  "focus.phase-completed": {
    importance: "actionable",
    toast: "never", // timer UI is the visible channel
    sound: "complete", // delivered by existing playTimerComplete tones
    haptic: true,
    osNotification: "default-on", // also gated by focus-timer's own config
    osVisibility: "hidden-only",
    quietHours: true,
    cooldownMs: 1000,
    suppressDuringReview: false,
    osTag: "focus-timer",
  },
  "sync.corruption": {
    importance: "critical",
    toast: "default-on", // persistent, with recovery action
    sound: "warning",
    haptic: false,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 60 * 1000, // repeated dispatches collapse
    suppressDuringReview: false,
  },
  "update.available": {
    importance: "informative",
    toast: "default-on", // 15 s with View action (existing behavior)
    sound: null, // deliberately silent
    haptic: false,
    osNotification: "never",
    osVisibility: "never",
    quietHours: false,
    cooldownMs: 0, // single startup check already bounds frequency
    suppressDuringReview: false,
  },
};
