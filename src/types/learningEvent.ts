/**
 * Canonical TypeScript contracts for the unified learning event spine (Phase 1A).
 *
 * Matches `openspec/changes/unify-learning-state-and-events/design.md` and
 * mirrors `src-tauri/src/models/learning_event.rs` + migration `168_unify_learning_state_events`.
 */

export const LEARNING_EVENT_SCHEMA_VERSION = 1 as const;

export const LEARNING_EVENT_COMMITTED_CHANNEL = "learning-event:committed" as const;

export const VALID_LEARNING_EVENT_TYPES = [
  "review_committed",
  "review_undone",
  "reading_progressed",
  "reading_completed",
  "extract_created",
  "card_created",
  "guided_check_completed",
  "practice_attempted",
  "assessment_submitted",
  "assessment_graded",
  "assessment_grade_invalidated",
  "concept_mastery_declared",
  "goal_created",
  "goal_updated",
  "goal_completed",
  "session_started",
  "session_paused",
  "session_resumed",
  "session_completed",
  "remediation_completed",
] as const;

export type LearningEventType = (typeof VALID_LEARNING_EVENT_TYPES)[number];

export const VALID_LEARNING_EVENT_ACTORS = ["user", "system", "sync"] as const;

export type LearningEventActor = (typeof VALID_LEARNING_EVENT_ACTORS)[number];

export const VALID_LEARNING_SURFACES = [
  "review",
  "scroll_mode",
  "quick_review",
  "zen_review",
  "queue",
  "reader",
  "study_mode",
  "guided_trail",
  "exam",
  "unified_session",
  "knowledge_atlas",
  "today_dashboard",
  "background",
  "sync",
  "unknown",
] as const;

export type LearningSurface = (typeof VALID_LEARNING_SURFACES)[number];

export const VALID_LEARNING_ENTITY_KINDS = [
  "learning_item",
  "extract",
  "document",
  "concept",
  "study_plan",
  "study_plan_node",
  "assessment_attempt",
  "exam_grade",
  "guided_trail",
  "learning_goal",
  "learning_session",
  "remediation",
] as const;

export type LearningEntityKind = (typeof VALID_LEARNING_ENTITY_KINDS)[number];

export interface LearningEvent<TPayload = Record<string, unknown>> {
  seq: number;
  id: string;
  idempotencyKey: string;
  schemaVersion: number;
  eventType: LearningEventType;
  actor: LearningEventActor;
  surface: LearningSurface;
  sessionId: string | null;
  goalId: string | null;
  entityKind: LearningEntityKind;
  entityId: string;
  documentId: string | null;
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  payload: TPayload;
  occurredAt: string;
  createdAt: string;
  retractedByEventId: string | null;
}

export interface AppendLearningEventInput<TPayload = Record<string, unknown>> {
  idempotencyKey: string;
  eventType: LearningEventType;
  actor?: LearningEventActor;
  surface: LearningSurface;
  sessionId?: string | null;
  goalId?: string | null;
  entityKind: LearningEntityKind;
  entityId: string;
  documentId?: string | null;
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
  payload?: TPayload;
  occurredAt?: string | null;
  retractsEventId?: string | null;
}

export interface AppendLearningEventResult<TPayload = Record<string, unknown>> {
  event: LearningEvent<TPayload>;
  /** False when idempotencyKey matched an already-committed event. */
  inserted: boolean;
}

export interface LearningEventCheckpoint {
  consumerId: string;
  lastSeq: number;
  policyVersion: string;
  updatedAt: string;
}

export interface LearningEventFilter {
  eventTypes?: LearningEventType[];
  surfaces?: LearningSurface[];
  entityKind?: LearningEntityKind;
  entityId?: string;
  documentId?: string;
  sessionId?: string;
  goalId?: string;
  sinceSeq?: number;
  includeRetracted?: boolean;
  excludeAiExcluded?: boolean;
  limit?: number;
}

export interface ReviewCommittedPayload {
  reviewResultId?: string;
  rating?: number;
  elapsedDays?: number;
  scheduledDays?: number;
  stability?: number;
  difficulty?: number;
  retrievability?: number;
  newDueDate?: string | null;
  isSuspended?: boolean;
  buryExtractId?: string | null;
  cardFamilyId?: string | null;
  conceptIds?: string[];
  [key: string]: unknown;
}

export interface ReviewUndonePayload {
  undoneReviewResultId?: string;
  restoredDueDate?: string | null;
  restoredState?: string;
  isSuspended?: boolean;
  conceptIds?: string[];
  [key: string]: unknown;
}
