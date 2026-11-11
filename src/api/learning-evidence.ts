/**
 * Typed Tauri IPC wrappers for Learning Evidence, Gaps and Remediation (C6-T05).
 *
 * Implements shared commands: summary/plan evidence/list gaps/dismiss/refresh/
 * reconcile/remediation disposition + diagnostic prior-evidence read adapter.
 * Fail-closed: non-Tauri rejects with unsupported_platform, never empty defaults.
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import { StudyApiError, normalizeStudyError } from './study-plans';
import type {
  ConceptMasterySummary,
  KnowledgeGapView,
  LearningEvidenceReconcileResult,
  PlanEvidenceSummary,
  RemediationRecommendation,
} from '../types/learningEvidence';

export interface CurriculumPriorEvidenceConcept {
  conceptId: string;
  level: string;
  observedMean: number | null;
  uncertainty: string[];
  evidenceGroupIds: string[];
}

export interface CurriculumPriorEvidence {
  diagnosticAttemptId: string;
  concepts: CurriculumPriorEvidenceConcept[];
}

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study.evidence.error.unsupported_platform',
      retryable: false,
    });
  }
}

export async function getConceptMasterySummary(conceptId: string): Promise<ConceptMasterySummary> {
  ensureNativeSupport();
  try {
    return await invokeCommand<ConceptMasterySummary>('get_concept_mastery_summary', {
      conceptId,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function getDiagnosticPriorEvidence(attemptId: string): Promise<CurriculumPriorEvidence> {
  ensureNativeSupport();
  try {
    return await invokeCommand<CurriculumPriorEvidence>('get_diagnostic_prior_evidence', {
      attemptId,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function getStudyPlanEvidence(planId: string): Promise<PlanEvidenceSummary> {
  ensureNativeSupport();
  try {
    return await invokeCommand<PlanEvidenceSummary>('get_study_plan_evidence', { planId });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function listLearningGaps(
  planId?: string | null,
  includeDismissed = false,
): Promise<KnowledgeGapView[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<KnowledgeGapView[]>('list_learning_gaps', {
      planId: planId ?? null,
      includeDismissed,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function dismissLearningGap(gapId: string, evidenceCutoff: string): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('dismiss_learning_gap', { gapId, evidenceCutoff });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function refreshLocalLearningGaps(planId: string): Promise<KnowledgeGapView[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<KnowledgeGapView[]>('refresh_local_learning_gaps', { planId });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function reconcileLearningEvidence(
  afterGradeId?: string | null,
  batchLimit = 50,
): Promise<LearningEvidenceReconcileResult> {
  ensureNativeSupport();
  try {
    return await invokeCommand<LearningEvidenceReconcileResult>('reconcile_learning_evidence', {
      afterGradeId: afterGradeId ?? null,
      batchLimit,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function recordRemediationDisposition(
  recommendationId: string,
  status: 'suggested' | 'accepted' | 'dismissed' | 'completed',
): Promise<RemediationRecommendation> {
  ensureNativeSupport();
  try {
    return await invokeCommand<RemediationRecommendation>('record_remediation_disposition', {
      recommendationId,
      status,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}
