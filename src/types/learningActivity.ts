/**
 * Canonical TypeScript domain types for the unified learning activity runtime
 * and extensible activity registry.
 *
 * Aligns with:
 * - `openspec/changes/unify-learning-activity-runtime/design.md`
 * - `openspec/changes/extend-learning-activity-types/design.md`
 */

import type { LearningEntityKind, LearningEventType, LearningSurface } from "./learningEvent";

export const LEARNING_ACTIVITY_TYPES = [
  "source_reading",
  "media_consumption",
  "flashcard_review",
  "extract_review",
  "guided_reading",
  "comprehension_check",
  "socratic_tutoring",
  "free_response_practice",
  "objective_question_practice",
  "structured_problem_solving",
  "rubric_assessment",
  "reflection_formulation",
  "targeted_remediation",
] as const;

export type LearningActivityType = (typeof LEARNING_ACTIVITY_TYPES)[number];

export const ACTIVITY_CAPABILITIES = [
  "ai",
  "network",
  "audio",
  "speech",
  "renderer",
  "external",
  "verification",
] as const;

export type ActivityCapability = (typeof ACTIVITY_CAPABILITIES)[number];

export const LEARNING_ACTIVITY_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "skipped",
  "postponed",
  "degraded",
] as const;

export type LearningActivityStatus = (typeof LEARNING_ACTIVITY_STATUSES)[number];

export const COMPETENCY_DIMENSIONS = [
  "exposure",
  "comprehension",
  "retention",
  "application",
  "transfer",
] as const;

export type CompetencyDimension = (typeof COMPETENCY_DIMENSIONS)[number];

export const LEARNING_SESSION_STATUSES = [
  "active",
  "paused",
  "completed",
  "abandoned",
] as const;

export type LearningSessionStatus = (typeof LEARNING_SESSION_STATUSES)[number];

export const LEARNING_SESSION_MODES = ["learning", "exam_isolated"] as const;

export type LearningSessionMode = (typeof LEARNING_SESSION_MODES)[number];

export interface LearningSourceReference {
  entityKind: LearningEntityKind;
  entityId: string;
  documentId?: string | null;
  label?: string;
}

export interface LearningActivityPriorityMetadata {
  score: number;
  urgency?: "low" | "normal" | "high" | "critical";
  dueAt?: string | null;
  providerId?: string;
  factors?: Array<{
    key: string;
    label: string;
    contribution: number;
  }>;
}

export interface LearningActivityPrerequisite {
  id: string;
  kind: "concept" | "activity" | "document";
  label?: string;
  satisfied: boolean;
}

export interface LearningActivityCapabilityRequirements {
  required: ActivityCapability[];
  optional: ActivityCapability[];
}

export interface LearningActivityCompletionPolicy {
  mode: "explicit" | "event_driven" | "threshold";
  minActiveSeconds?: number;
  requireVerification?: boolean;
  canonicalEventType?: LearningEventType;
}

export interface LearningActivity {
  id: string;
  activityType: LearningActivityType;
  title: string;
  status: LearningActivityStatus;
  dedupeKey: string;
  sourceReferences: LearningSourceReference[];
  conceptReferences: string[];
  goalReferences: string[];
  estimatedMinutes: number;
  priorityMetadata: LearningActivityPriorityMetadata;
  prerequisiteRequirements: LearningActivityPrerequisite[];
  recommendationReason: string;
  capabilityRequirements: LearningActivityCapabilityRequirements;
  resumeState: Record<string, unknown> | null;
  completionPolicy: LearningActivityCompletionPolicy;
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  examIsolated: boolean;
  startedAt?: string | null;
  completedAt?: string | null;
  activeSeconds?: number;
  completionEventId?: string | null;
  completedViaSurface?: LearningSurface | null;
  degradedReason?: string | null;
  skipOrPostponeReason?: string | null;
}

export interface CrossSurfaceCompletionNotice {
  activityId: string;
  dedupeKey: string;
  eventId: string;
  surface: LearningSurface;
  recordedAt: string;
  message: string;
}

export interface LearningSession {
  id: string;
  title: string;
  mode: LearningSessionMode;
  status: LearningSessionStatus;
  profileId: string;
  goalReferences: string[];
  timeBudgetMinutes: number | null;
  elapsedActiveSeconds: number;
  currentActivityIndex: number;
  activities: LearningActivity[];
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  createdAt: string;
  updatedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  crossSurfaceNotices: CrossSurfaceCompletionNotice[];
}

export interface LearningSessionSummary {
  sessionId: string;
  title: string;
  status: LearningSessionStatus;
  mode: LearningSessionMode;
  totalActivities: number;
  completedCount: number;
  skippedCount: number;
  postponedCount: number;
  pendingCount: number;
  inProgressCount: number;
  degradedCount: number;
  completedViaExternalSurfaceCount: number;
  totalEstimatedMinutes: number;
  remainingEstimatedMinutes: number;
  elapsedActiveSeconds: number;
  timeBudgetMinutes: number | null;
  completionRate: number;
  goalReferences: string[];
  conceptReferences: string[];
  completedByType: Partial<Record<LearningActivityType, number>>;
}

export interface RuntimeCapabilities {
  ai: boolean;
  network: boolean;
  audio: boolean;
  speech: boolean;
  renderer: boolean;
  external: boolean;
  verification: boolean;
  platform?: "desktop" | "mobile" | "pwa";
  strictLocalOnly?: boolean;
}

export const SUBJECT_TEMPLATE_IDS = [
  "mathematics",
  "computer_science",
  "philosophy",
  "language_learning",
  "history_literature",
] as const;

export type SubjectTemplateId = (typeof SUBJECT_TEMPLATE_IDS)[number];

export interface SubjectTemplate {
  id: SubjectTemplateId;
  name: string;
  description: string;
  recommendedMix: ReadonlyArray<{
    activityType: LearningActivityType;
    weight: number;
  }>;
  competencyWeights: Readonly<Record<CompetencyDimension, number>>;
  defaultSessionBlueprint: ReadonlyArray<{
    activityType: LearningActivityType;
    minutes: number;
    label: string;
  }>;
  promptScaffolds: Readonly<Partial<Record<LearningActivityType, string>>>;
}

export interface SandboxExtensionBoundary {
  readonly allowTauriIpc: false;
  readonly allowFilesystem: false;
  readonly allowNetwork: false;
  readonly allowShellExecution: false;
  readonly allowSameOriginIframe: false;
  readonly maxExecutionMs: number;
  readonly maxMemoryMb: number;
  readonly maxPayloadBytes: number;
  readonly maxMessagesPerSecond: number;
  readonly redactLocalOnly: true;
  readonly redactAiExcluded: true;
  readonly allowedEventTypes: readonly LearningEventType[];
  readonly forbiddenEventTypes: readonly LearningEventType[];
}
