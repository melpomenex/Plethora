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
  "review.answer-revealed",
  "review.grade-boundary-crossed",
  "review.option-selected",
  "review.session-completed",
  "review.streak-milestone",
  "review.progress-milestone",

  // Reader and navigation interactions
  "reader.context-activated",
  "reader.annotation-saved",
  "reader.bookmark-saved",
  "reader.tool-selected",
  "navigation.primary-tab-selected",
  "navigation.back-completed",
  "navigation.destination-opened",
  "interaction.sheet-committed",

  // Reminders / queue
  "queue.selection-mode-entered",
  "queue.selection-changed",
  "queue.refresh-armed",
  "queue.due-count-changed",
  "reminder.reviews-due",

  // Committed actions and library outcomes
  "action.committed",
  "action.failed",
  "library.action-committed",
  "library.training-committed",
  "feedback.confirmed",
  "feedback.warning",
  "feedback.error",

  // Documents / long tasks
  "import.completed",
  "import.failed",
  "transcription.completed",
  "transcription.failed",

  // Lifecycle / system
  "backup.auto-backup-found",
  "db.recovered-after-quarantine",
  "migration.legacy-data-migrated",
  "focus.phase-completed",
  "sync.corruption",
  "update.available",
] as const;

export type FeedbackEventId = (typeof FEEDBACK_EVENT_IDS)[number];

/** Stable, content-free identity carried from accepted intent through commit. */
export interface FeedbackInteractionContext {
  interactionId: string;
  operationId?: string;
  gestureId?: string;
  step?: string;
  sessionId?: string;
  origin: "user" | "system";
}

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
  "review.answer-revealed": Record<string, never>;
  "review.grade-boundary-crossed": Record<string, never>;
  "review.option-selected": Record<string, never>;
  "review.session-completed": {
    reviewsCompleted: number;
    correctCount: number;
    durationMs: number;
  };
  "review.streak-milestone": { currentStreak: number };
  "review.progress-milestone": { completedCount: number };

  "reader.context-activated": Record<string, never>;
  "reader.annotation-saved": Record<string, never>;
  "reader.bookmark-saved": Record<string, never>;
  "reader.tool-selected": Record<string, never>;
  "navigation.primary-tab-selected": Record<string, never>;
  "navigation.back-completed": Record<string, never>;
  "navigation.destination-opened": Record<string, never>;
  "interaction.sheet-committed": Record<string, never>;

  "queue.selection-mode-entered": Record<string, never>;
  "queue.selection-changed": Record<string, never>;
  "queue.refresh-armed": Record<string, never>;
  "queue.due-count-changed": { dueCount: number };
  "reminder.reviews-due": { dueCount: number };

  "action.committed": Record<string, never>;
  "action.failed": Record<string, never>;
  "library.action-committed": Record<string, never>;
  "library.training-committed": Record<string, never>;
  "feedback.confirmed": Record<string, never>;
  "feedback.warning": Record<string, never>;
  "feedback.error": Record<string, never>;

  "import.completed": { documentCount: number; extractCount: number; title: string; message?: string };
  "import.failed": { title: string; message?: string };
  "transcription.completed": { title: string; message?: string };
  "transcription.failed": { title: string; message?: string };

  "backup.auto-backup-found": { backupPath: string };
  "db.recovered-after-quarantine": Record<string, never>;
  "migration.legacy-data-migrated": { legacyPath: string };
  "focus.phase-completed": { phase: "work" | "short_break" | "long_break"; phaseLabel: string };
  "sync.corruption": { message: string };
  "update.available": { latestVersion: string };
}

/** Compile-time guarantee that every event id has a payload type. */
type _PayloadsCoverAllEvents = FeedbackEventPayloads[FeedbackEventId];
