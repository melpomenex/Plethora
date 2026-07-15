/**
 * Unified feedback system (notifications + sound) — public surface.
 *
 * Status: SCAFFOLDING for the `unify-notifications-and-sound` OpenSpec change.
 * See openspec/changes/unify-notifications-and-sound/{design.md,tasks.md}.
 *
 * What exists now (safe to import):
 * - Typed event vocabulary (./events)
 * - Channel/sound policy registry, pure data (./policy)
 * - Surface detection + capability interfaces (./capabilities)
 *
 * TODO(implementation) — not yet present, do not fake:
 * - ./orchestrator.ts  → emitFeedback(), gates, cooldowns (tasks.md 2.1)
 * - ./reminderScheduler.ts → daily review reminder (tasks.md 4.1)
 *
 * Delivery continues to live in src/utils/soundService.ts,
 * src/utils/notificationService.ts, and src/components/common/Toast.tsx.
 */

export { FEEDBACK_EVENT_IDS } from "./events";
export type { FeedbackEventId, FeedbackEventPayloads } from "./events";

export {
  FEEDBACK_POLICY_REGISTRY,
  SOUND_ROLE_TO_FEEDBACK_TYPE,
  SOUND_ROLE_GATE,
} from "./policy";
export type {
  FeedbackPolicy,
  SoundRole,
  ChannelMode,
  OsVisibilityRule,
} from "./policy";

export {
  detectFeedbackSurface,
  queryAsyncCapabilities,
} from "./capabilities";
export type {
  FeedbackSurface,
  AsyncFeedbackCapabilities,
  QueryAsyncCapabilities,
} from "./capabilities";

export {
  emitFeedback,
  resetFeedbackCooldowns,
  setActiveReviewSession,
  setReviewSessionActive,
} from "./orchestrator";
export type {
  FeedbackChannel,
  FeedbackEmitOptions,
  FeedbackNotificationOptions,
  FeedbackResolution,
  FeedbackSuppressionReason,
  FeedbackToastOptions,
} from "./orchestrator";
