/**
 * Canonical TypeScript contracts for the 5-dimension Persistent Learner Model (Phase 1B).
 *
 * Matches `openspec/changes/establish-persistent-learner-model/design.md` and
 * mirrors migration `169_persistent_learner_model`.
 */

export const COMPETENCY_POLICY_VERSION = "competency-v1" as const;

export const ALL_COMPETENCY_DIMENSIONS = [
  "exposure",
  "comprehension",
  "retention",
  "application",
  "transfer",
] as const;

export type CompetencyDimension = (typeof ALL_COMPETENCY_DIMENSIONS)[number];

export const ALL_COMPETENCY_STATUSES = [
  "unknown",
  "insufficient_evidence",
  "needs_attention",
  "developing",
  "demonstrated",
] as const;

export type CompetencyStatus = (typeof ALL_COMPETENCY_STATUSES)[number];

export const ALL_COMPETENCY_EVIDENCE_SOURCE_KINDS = [
  "reading_progress",
  "extract_created",
  "guided_check",
  "fsrs_review",
  "socratic_practice",
  "practice_attempt",
  "exam_grade",
  "diagnostic_grade",
  "language_practice",
] as const;

export type CompetencyEvidenceSourceKind =
  (typeof ALL_COMPETENCY_EVIDENCE_SOURCE_KINDS)[number];

export type DeclaredCompetencyLevel =
  | "unfamiliar"
  | "familiar"
  | "confident"
  | "needs_refresh";

export interface CompetencyEvidenceRecord {
  id: string;
  conceptId: string;
  dimension: CompetencyDimension;
  sourceKind: CompetencyEvidenceSourceKind;
  sourceEventId: string | null;
  sourceRecordId: string;
  evidenceGroupId: string;
  cardFamilyId: string | null;
  sessionId: string | null;
  /** Normalized performance score in [0.0, 1.0]. */
  observedScore: number | null;
  /** Positive base weight in (0.0, 2.0]. */
  baseWeight: number;
  /** Elapsed days since prior review (used for retention cramming discount). */
  elapsedDays: number | null;
  /** Non-negative hint count used by the learner. */
  hintLevel: number;
  /** Unverified / model-only records are strictly excluded from demonstrated estimates. */
  isVerified: boolean;
  /** Invalidated records (e.g., undone review or invalidated exam grade) are excluded. */
  isInvalidated: boolean;
  invalidatedByEventId: string | null;
  documentId: string | null;
  isLocalOnly: boolean;
  isAiExcluded: boolean;
  occurredAt: string;
  policyVersion: string;
  createdAt: string;
}

export interface RecordCompetencyEvidenceInput {
  id?: string;
  conceptId: string;
  dimension: CompetencyDimension;
  sourceKind: CompetencyEvidenceSourceKind;
  sourceEventId?: string | null;
  sourceRecordId: string;
  evidenceGroupId: string;
  cardFamilyId?: string | null;
  sessionId?: string | null;
  observedScore: number | null;
  baseWeight: number;
  elapsedDays?: number | null;
  hintLevel?: number;
  isVerified?: boolean;
  documentId?: string | null;
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
  occurredAt?: string;
  policyVersion?: string;
}

export interface DimensionProjection {
  dimension: CompetencyDimension;
  status: CompetencyStatus;
  estimate: number | null;
  confidence: number;
  effectiveWeight: number;
  rawEvidenceCount: number;
  independentGroups: number;
  distinctDays: number;
  uncertaintyReasons: string[];
  evidenceIds: string[];
  lastEvidenceAt: string | null;
  policyVersion: string;
}

export interface LearnerCompetencyDeclaration {
  id?: string;
  conceptId: string;
  declaredLevel: DeclaredCompetencyLevel;
  note: string | null;
  createdAt?: string;
  updatedAt: string;
}

export interface ConceptCompetencyProfile {
  conceptId: string;
  conceptName: string;
  dimensions: Record<CompetencyDimension, DimensionProjection>;
  selfDeclaration: LearnerCompetencyDeclaration | null;
  containsLocalOnlyEvidence: boolean;
  containsAiExcludedEvidence: boolean;
}

export interface EstimateCompetencyOptions {
  /** Target dimension (used when records array is empty or mixed). */
  dimension?: CompetencyDimension;
  /** When true (e.g. cloud AI callers), excludes any evidence with isAiExcluded === true. */
  excludeAiExcluded?: boolean;
  /** Optional policy version tag override (defaults to COMPETENCY_POLICY_VERSION). */
  policyVersion?: string;
}
