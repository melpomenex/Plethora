/**
 * Shared Type Contracts for Learning Evidence, Knowledge Gaps, and Remediation.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§8, 9
 * - openspec/changes/derive-study-gaps-from-exam-evidence/ (C6-T01)
 */

import type { EvidenceCoverage, CoverageActivity } from '../lib/ai/concepts/coverage';
import type { NodeActivity } from './learningPaths';
import type { StudySourceResolution } from './studySources';

export type EvidenceSourceKind =
  | 'exam-final'
  | 'practice-check'
  | 'diagnostic-final'
  | 'review-result';

export type EvidencePolicyVersion = 'evidence-v1';

export type EvidenceOutcome =
  | 'correct'
  | 'partial'
  | 'incorrect'
  | 'misconception'
  | 'unanswered'
  | 'skipped'
  | 'review-lapse';

export type GraderOrigin = 'deterministic' | 'ai' | 'manual' | 'user-review';

export interface LearningEvidence {
  id: string;
  conceptId: string;
  conceptLabel: string;
  planId: string | null;
  nodeId: string | null;
  sourceKind: EvidenceSourceKind;
  sourceId: string;
  gradeId: string | null;
  evidenceGroupId: string; // e.g. attemptId + ':' + conceptId
  questionFingerprint: string | null;
  observedScore: number | null; // normalized 0..1; null for review lapse / activity-only
  outcome: EvidenceOutcome;
  misconception: string | null;
  learnerConfidence: number | null; // 0..1 learner-stated confidence
  hintLevel: number; // 0 no hints
  graderOrigin: GraderOrigin;
  difficulty?: number | null; // optional question difficulty 1..5
  occurredAt: string; // ISO 8601 UTC
  policyVersion: EvidencePolicyVersion;
}

export type MasteryEvidenceLevel =
  | 'insufficient-evidence'
  | 'needs-attention'
  | 'developing'
  | 'demonstrated-consistently';

export type UncertaintyReason =
  | 'no-assessment'
  | 'one-independent-session'
  | 'few-independent-sessions'
  | 'same-question-repetition'
  | 'hints-used'
  | 'ai-graded'
  | 'conflicting-outcomes'
  | 'stale-evidence'
  | 'narrow-difficulty'
  | 'source-missing'
  | 'not-enough-recent-success'
  | 'low-learner-confidence'
  | 'high-confidence-error';

export interface ConceptMasterySummary {
  conceptId: string;
  level: MasteryEvidenceLevel;
  observedMean: number | null; // weighted observed performance; NOT a mastery probability
  evidenceWeight: number;
  independentSessions: number;
  distinctDays: number;
  minimumObserved: number | null;
  maximumObserved: number | null;
  latestEvidenceAt: string | null;
  uncertainty: UncertaintyReason[];
  evidenceIds: string[];
  policyVersion: EvidencePolicyVersion;
}

export type KnowledgeGapKind =
  | 'weak_prerequisite'
  | 'missing_concept'
  | 'repeatedly_failed'
  | 'read_never_reviewed'
  | 'disconnected_cluster'
  | 'weak_transfer';

export interface GapEvidenceRecord {
  recordId: string;
  kind: 'review_lapse' | 'unreviewed_reading' | 'graph_edge' | 'assessment';
  description: string;
  learningEvidenceId: string | null;
  sourceRefId: string | null;
  payload: Record<string, unknown>;
}

export interface KnowledgeGapView {
  id: string;
  kind: KnowledgeGapKind;
  conceptId: string;
  conceptName: string;
  planId: string | null;
  nodeId: string | null;
  ruleId: string;
  status: 'active' | 'dismissed' | 'resolved';
  evidence: GapEvidenceRecord[];
  demonstrated: ConceptMasterySummary | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  evidenceCutoff: string;
}

export interface NodeLearningProgress {
  nodeId: string;
  activity: NodeActivity;
  contentCoverage: EvidenceCoverage | 'not-computed';
  coverageActivity: CoverageActivity | 'not-computed';
  demonstrated: ConceptMasterySummary | null;
  sourceStatuses: StudySourceResolution['status'][];
}

export interface LearningEvidenceReconcileResult {
  processed: number;
  remaining: number;
  nextAfterGradeId: string | null;
  completed: boolean;
}

export interface PlanEvidenceSummary {
  planId: string;
  versionId: string;
  nodes: NodeLearningProgress[];
  activeGapIds: string[];
  computedAt: string;
}

export type RemediationKind =
  | 'open-source'
  | 'review-extract'
  | 'tutor'
  | 'targeted-practice'
  | 'card-proposals'
  | 'follow-up-exam'
  | 'plan-adjustment';

export interface RemediationRecommendation {
  id: string;
  gapId: string;
  kind: RemediationKind;
  status: 'suggested' | 'accepted' | 'dismissed' | 'completed';
  sourceRefIds: string[];
  payload: {
    conceptId: string;
    nodeId?: string;
    planId?: string;
    objectives: string[];
    misconception?: string;
    evidenceSummary: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface StudyTutorContext {
  planId: string;
  planVersionId: string;
  nodeId: string;
  conceptId: string | null;
  gapId: string | null;
  sourceDocumentIds: string[];
  sourceRefIds: string[];
  objectives: string[];
  misconception: string | null;
  evidenceSummary: string;
}
