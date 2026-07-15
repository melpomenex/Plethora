/**
 * Feedback event vocabulary — the single typed list of application events that
 * may produce user-facing feedback (toast, sound, haptic, badge, OS notification).
 *
 * This is scaffolding for the `unify-notifications-and-sound` OpenSpec change
 * (see openspec/changes/unify-notifications-and-sound/design.md §2 for the full
 * inventory, channel policy, and suppression rules). The decision layer that
 * consumes these events is TODO(implementation) — see ./policy.ts and tasks.md
 * task 2.1. Until then, nothing imports this module at runtime; call sites keep
 * their existing behavior.
 *
 * Rules for adding events:
 * - An event names something that happened in the domain ("import.completed"),
 *   never a delivery ("show-toast"). Delivery is decided by the policy registry.
 * - Every event must be added to FEEDBACK_EVENT_IDS *and* given a policy entry in
 *   FEEDBACK_POLICY_REGISTRY (./policy.ts) — the contract test enforces this.
 * - Events that should stay silent everywhere do not belong here at all
 *   (navigation, card flips, scrolling, per-item sync events, autosaves…).
 */

/** All feedback-eligible application events. Keep alphabetized within groups. */
export const FEEDBACK_EVENT_IDS = [
  // Review session
  "review.card-action",
  "review.card-graded",
  "review.session-completed",
  "review.streak-milestone",

  // Reminders / queue
  "queue.due-count-changed",
  "reminder.reviews-due",

  // Documents / long tasks
  "import.completed",
  "import.failed",
  "transcription.completed",
  "transcription.failed",

  // Lifecycle / system
  "backup.auto-backup-found",
  "db.recovered-after-quarantine",
  "focus.phase-completed",
  "sync.corruption",
  "update.available",
] as const;

export type FeedbackEventId = (typeof FEEDBACK_EVENT_IDS)[number];

/**
 * Per-event payloads. Payloads carry facts for message formatting and dedup keys;
 * they never carry channel choices.
 */
export interface FeedbackEventPayloads {
  "review.card-action": {
    /** Which queue/card mutation happened. */
    action: "delete" | "suspend" | "postpone" | "dismiss" | "restore";
    succeeded: boolean;
    /** Present when the action supports undo (existing queueActions flow). */
    onUndo?: () => void;
    /** Pre-localized title/message from the call site (existing i18n keys). */
    title: string;
    message?: string;
  };
  "review.card-graded": { rating: number };
  "review.session-completed": {
    reviewsCompleted: number;
    correctCount: number;
    durationMs: number;
  };
  "review.streak-milestone": { currentStreak: number };

  "queue.due-count-changed": { dueCount: number };
  "reminder.reviews-due": { dueCount: number };

  "import.completed": { documentCount: number; extractCount: number; title: string; message?: string };
  "import.failed": { title: string; message?: string };
  "transcription.completed": { title: string; message?: string };
  "transcription.failed": { title: string; message?: string };

  "backup.auto-backup-found": { backupPath: string };
  "db.recovered-after-quarantine": Record<string, never>;
  "focus.phase-completed": { phase: "work" | "short_break" | "long_break"; phaseLabel: string };
  "sync.corruption": { message: string };
  "update.available": { latestVersion: string };
}

/** Compile-time guarantee that every event id has a payload type. */
type _PayloadsCoverAllEvents = FeedbackEventPayloads[FeedbackEventId];
