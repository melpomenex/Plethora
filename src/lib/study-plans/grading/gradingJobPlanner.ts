/**
 * Grading Job Planner for Subjective Question Submissions.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§6, 10, 11
 * - openspec/changes/implement-rubric-based-exam-grading/tasks.md (C5-T04)
 */

import { sha256 } from '../generation/requestHash';
import type {
  AttemptDetail,
  GradeRecord,
  ResponseSubmission,
  AssessmentResponse,
} from '../../../types/assessmentSessions';
import type {
  AssessmentQuestionRevision,
  ShortAnswerQuestion,
  EssayQuestion,
} from '../../../types/assessmentQuestions';
import type {
  CreateStudyStepInput,
  StartStudyJobInput,
  StudyAiPreflight,
} from '../generation/types';

export interface PendingGradingItem {
  submission: ResponseSubmission;
  question: AssessmentQuestionRevision;
  currentGrade?: GradeRecord;
}

export interface PlanGradingJobOptions {
  attemptDetail: AttemptDetail;
  questions: Map<string, AssessmentQuestionRevision> | AssessmentQuestionRevision[];
  preflight?: StudyAiPreflight | Record<string, unknown>;
  creationKey?: string;
  sourceHashes?: Record<string, string>;
  regrade?: boolean; // if true, includes items even if current grade is final (for intentional regrade)
}

/**
 * Checks if a response submission is blank / empty text.
 */
export function isBlankResponse(response: AssessmentResponse | null | undefined): boolean {
  if (!response) return true;
  if ('text' in response && typeof response.text === 'string') {
    return response.text.trim().length === 0;
  }
  return false;
}

/**
 * Identifies exactly nonblank, non-exact short-answer and essay submissions lacking Final grade.
 */
export function findPendingGradingSubmissions(
  attemptDetail: AttemptDetail,
  questionsInput: Map<string, AssessmentQuestionRevision> | AssessmentQuestionRevision[],
  options?: { regrade?: boolean }
): PendingGradingItem[] {
  const questionsMap =
    questionsInput instanceof Map
      ? questionsInput
      : new Map(questionsInput.map((q) => [q.id, q]));

  const currentGradeBySubmissionId = new Map<string, GradeRecord>();
  for (const grade of attemptDetail.currentGrades || []) {
    if (grade.isCurrent) {
      currentGradeBySubmissionId.set(grade.responseSubmissionId, grade);
    }
  }

  const pending: PendingGradingItem[] = [];

  for (const submission of attemptDetail.submissions || []) {
    const questionRevision = questionsMap.get(submission.questionRevisionId);
    if (!questionRevision || !questionRevision.question) continue;

    const q = questionRevision.question;

    // Only subjective questions (short-answer, essay) undergo AI rubric grading
    if (q.kind !== 'short-answer' && q.kind !== 'essay') {
      continue;
    }

    // Omit blank responses (deterministic unanswered 0 points handled by C4)
    if (isBlankResponse(submission.response)) {
      continue;
    }

    // For short-answer, check if exact full-credit match was already deterministically accepted
    if (q.kind === 'short-answer') {
      const saQuestion = q as ShortAnswerQuestion;
      const responseText =
        'text' in submission.response && typeof submission.response.text === 'string'
          ? submission.response.text.trim()
          : '';
      const accepted = (saQuestion.acceptedAnswers || []).some(
        (ans) => ans.trim().toLowerCase() === responseText.toLowerCase()
      );
      if (accepted) {
        continue; // Deterministic C4 match, no AI rubric job step needed
      }
    }

    const currentGrade = currentGradeBySubmissionId.get(submission.id);

    // If already has a final grade and this is not an explicit regrade, skip
    if (currentGrade && currentGrade.state === 'final' && !options?.regrade) {
      continue;
    }

    pending.push({
      submission,
      question: questionRevision,
      currentGrade,
    });
  }

  return pending;
}

/**
 * Plans a durable `exam-grading` narrow job for pending subjective submissions.
 * Returns null if no eligible subjective submissions require grading.
 */
export function planGradingJob(
  options: PlanGradingJobOptions
): { jobInput: StartStudyJobInput; pendingItems: PendingGradingItem[] } | null {
  const pendingItems = findPendingGradingSubmissions(
    options.attemptDetail,
    options.questions,
    { regrade: options.regrade }
  );

  if (pendingItems.length === 0) {
    return null;
  }

  const { attempt } = options.attemptDetail;
  const sourceHashes = options.sourceHashes || {};

  const steps: CreateStudyStepInput[] = pendingItems.map((item, index) => {
    const stepKey = `grade:${item.submission.id}`;
    const questionData = item.question.question as ShortAnswerQuestion | EssayQuestion;

    const stepPayload = {
      attemptId: attempt.id,
      submissionId: item.submission.id,
      questionRevisionId: item.question.id,
      response: item.submission.response,
      rubric: questionData.rubric,
      sourceHashes: (questionData.sourceRefIds || []).map(
        (refId) => sourceHashes[refId] || 'nohash'
      ),
    };

    const inputHash = sha256(JSON.stringify(stepPayload));

    return {
      stepKey,
      ordinal: index,
      inputHash,
    };
  });

  const requestPayload = {
    attemptId: attempt.id,
    attemptRevision: attempt.revision,
    stepHashes: steps.map((s) => s.inputHash),
  };
  const requestHash = sha256(JSON.stringify(requestPayload));

  const creationKey =
    options.creationKey ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `grading_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

  const preflight: StudyAiPreflight = (options.preflight as StudyAiPreflight) || {
    providerId: 'local',
    generationDestination: 'local_device',
    embeddingDestination: null,
    featureAllowed: true,
    documentIds: [],
    sourceExcerptCount: 0,
    sendsSourceOffDevice: false,
    sendsAnswersOffDevice: false,
    billable: false,
    cloudDisclosureAccepted: true,
    costConsentAccepted: true,
    maximumModelCalls: steps.length,
  };

  const jobInput: StartStudyJobInput = {
    kind: 'exam-grading',
    targetId: attempt.id,
    targetRevision: attempt.revision,
    creationKey,
    requestHash,
    preflight,
    steps,
  };

  return { jobInput, pendingItems };
}
