/**
 * Typed Tauri IPC wrappers for Resumable Examination Sessions & Attempts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
 * - openspec/changes/implement-resumable-examination-sessions/ (C4-T04)
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import { StudyApiError, normalizeStudyError } from './study-plans';
import type {
  AttemptDetail,
  AttemptSummary,
  ExamResponse,
  PracticeCheckResult,
  StartAttemptInput,
  SaveResponseInput,
  SubmitAttemptInput,
  CheckPracticeInput,
  AttemptHistoryFilter,
} from '../types/assessmentSessions';

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study.assessment.error.unsupported_platform',
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

export function normalizeExamResponse(raw: any): ExamResponse {
  return {
    id: raw.id,
    attemptId: raw.attemptId,
    questionRevisionId: raw.questionRevisionId,
    draft: raw.draft ?? parseJson(raw.draftJson, { kind: 'short-answer', text: '' }),
    mark: raw.mark ?? 'unanswered',
    revision: raw.revision,
    lastClientMutationId: raw.lastClientMutationId,
    updatedAt: raw.updatedAt,
  };
}

export function normalizeAttemptDetail(raw: any): AttemptDetail {
  return {
    attempt: raw.attempt,
    responses: (raw.responses || []).map(normalizeExamResponse),
    submissions: (raw.submissions || []).map((s: any) => ({
      ...s,
      response: s.response ?? parseJson(s.responseJson, { kind: 'short-answer', text: '' }),
    })),
    currentGrades: (raw.currentGrades || []).map((g: any) => ({
      ...g,
      assessment: g.assessment ?? parseJson(g.assessmentJson, null),
      criteria: g.criteria ?? parseJson(g.criteriaJson, []),
      provenance: g.provenance ?? parseJson(g.provenanceJson, null),
    })),
    questions: raw.questions,
  };
}

/**
 * Starts a new exam attempt or returns an existing one idempotently by clientStartKey.
 */
export async function startExamAttempt(
  input: StartAttemptInput
): Promise<AttemptDetail> {
  ensureNativeSupport();
  try {
    const raw = await invokeCommand<any>('start_exam_attempt', { input });
    return normalizeAttemptDetail(raw);
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Loads a full attempt detail including attempt row, responses, submissions, and current grades.
 */
export async function getExamAttempt(
  attemptId: string
): Promise<AttemptDetail> {
  ensureNativeSupport();
  try {
    const raw = await invokeCommand<any>('get_exam_attempt', {
      attemptId,
      attempt_id: attemptId,
    });
    return normalizeAttemptDetail(raw);
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Lists past attempt summaries with optional filtering.
 */
export async function listExamAttempts(
  input: AttemptHistoryFilter = {}
): Promise<AttemptSummary[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<AttemptSummary[]>('list_exam_attempts', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Saves a learner draft response with CAS revision check and mutation ID deduplication.
 */
export async function saveExamResponse(
  input: SaveResponseInput
): Promise<ExamResponse> {
  ensureNativeSupport();
  try {
    const raw = await invokeCommand<any>('save_exam_response', {
      input: {
        attemptId: input.attemptId,
        responseId: input.responseId,
        expectedResponseRevision: input.expectedResponseRevision,
        lastClientMutationId: input.lastClientMutationId,
        draftJson: JSON.stringify(input.draft),
        mark: input.mark,
      },
    });
    return normalizeExamResponse(raw);
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Submits an attempt with objective grade evaluations.
 */
export async function submitExamAttempt(
  input: SubmitAttemptInput
): Promise<AttemptDetail> {
  ensureNativeSupport();
  try {
    const raw = await invokeCommand<any>('submit_exam_attempt', { input });
    return normalizeAttemptDetail(raw);
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Evaluates an immediate practice check response (practice mode only).
 */
export async function checkPracticeResponse(
  input: CheckPracticeInput
): Promise<PracticeCheckResult> {
  ensureNativeSupport();
  try {
    const raw = await invokeCommand<any>('check_practice_response', {
      input: {
        attemptId: input.attemptId,
        responseId: input.responseId,
        expectedAttemptRevision: input.expectedAttemptRevision,
        clientMutationId: input.clientMutationId,
        hintLevel: input.hintLevel,
        draftJson: JSON.stringify(input.draft),
        mark: input.mark,
        objectiveGrade: input.objectiveGrade,
      },
    });
    return {
      submission: {
        ...raw.submission,
        response: raw.submission?.response ?? parseJson(raw.submission?.responseJson, input.draft),
      },
      grade: raw.grade
        ? {
            ...raw.grade,
            assessment: raw.grade.assessment ?? parseJson(raw.grade.assessmentJson, null),
            criteria: raw.grade.criteria ?? parseJson(raw.grade.criteriaJson, []),
            provenance: raw.grade.provenance ?? parseJson(raw.grade.provenanceJson, null),
          }
        : null,
      attemptRevision: raw.attemptRevision,
    };
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Cancels an in-progress attempt.
 */
export async function cancelExamAttempt(
  attemptId: string,
  expectedRevision: number
): Promise<AttemptDetail> {
  ensureNativeSupport();
  try {
    const raw = await invokeCommand<any>('cancel_exam_attempt', {
      attemptId,
      attempt_id: attemptId,
      expectedRevision,
      expected_revision: expectedRevision,
    });
    return normalizeAttemptDetail(raw);
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Deletes an attempt and all related responses/submissions/grades from history.
 */
export async function deleteExamHistory(
  attemptId: string
): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('delete_exam_history', {
      attemptId,
      attempt_id: attemptId,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}
