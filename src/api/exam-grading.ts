/**
 * Typed Tauri IPC wrappers for Rubric-Based Exam Grading.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§6, 11, 12
 * - openspec/changes/implement-rubric-based-exam-grading/ (C5-T03, C5-T04)
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import { StudyApiError, normalizeStudyError } from './study-plans';
import type {
  GradeRecord,
  GradeSettlementOutcome,
  RecordRubricGradeInput,
  RecordManualGradeInput,
} from '../types/assessmentSessions';

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study.grading.error.unsupported_platform',
      retryable: false,
    });
  }
}

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function normalizeGradeRecord(raw: any): GradeRecord {
  return {
    id: raw.id,
    responseSubmissionId: raw.responseSubmissionId ?? raw.response_submission_id,
    questionRevisionId: raw.questionRevisionId ?? raw.question_revision_id,
    origin: raw.origin,
    state: raw.state,
    points: raw.points ?? null,
    maxPoints: raw.maxPoints ?? raw.max_points ?? 0,
    assessment: raw.assessment ?? parseJson(raw.assessmentJson ?? raw.assessment_json, null),
    criteria: raw.criteria ?? parseJson(raw.criteriaJson ?? raw.criteria_json, []),
    provenance: raw.provenance ?? parseJson(raw.provenanceJson ?? raw.provenance_json, null),
    manualReason: raw.manualReason ?? raw.manual_reason ?? null,
    supersedesGradeId: raw.supersedesGradeId ?? raw.supersedes_grade_id ?? null,
    isCurrent: Boolean(raw.isCurrent ?? raw.is_current ?? false),
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  };
}

/**
 * Persists an AI or automated rubric evaluation atomically.
 */
export async function recordRubricGrade(
  input: RecordRubricGradeInput
): Promise<GradeSettlementOutcome> {
  ensureNativeSupport();
  try {
    return await invokeCommand<GradeSettlementOutcome>('record_rubric_grade', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Persists a human manual grade override atomically with strict reason and full criteria.
 */
export async function recordManualGrade(
  input: RecordManualGradeInput
): Promise<GradeSettlementOutcome> {
  ensureNativeSupport();
  try {
    return await invokeCommand<GradeSettlementOutcome>('record_manual_grade', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Retrieves the full chronological grade history for a given response submission.
 */
export async function getResponseGradeHistory(
  responseSubmissionId: string
): Promise<GradeRecord[]> {
  ensureNativeSupport();
  try {
    const rawList = await invokeCommand<any[]>('get_response_grade_history', {
      responseSubmissionId,
      response_submission_id: responseSubmissionId,
    });
    return (rawList || []).map(normalizeGradeRecord);
  } catch (err) {
    throw normalizeStudyError(err);
  }
}
