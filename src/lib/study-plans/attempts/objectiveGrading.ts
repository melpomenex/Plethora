/**
 * Pure Deterministic Objective Grading.
 *
 * Implements objective scoring for single-select, multi-select, cloze,
 * and deterministic short-answer/essay edge cases.
 * Specifications: 02-SHARED-CONTRACTS.md §7.1.
 */

import type {
  AssessmentQuestion,
  AssessmentResponse,
  ClozeQuestion,
  MultiSelectQuestion,
  QuestionKind,
  ResponseMark,
  ShortAnswerQuestion,
  SingleSelectQuestion,
} from '../../../types/assessmentQuestions';
import type {
  ObjectiveGradeOutput,
  ObjectiveOutcome,
} from '../../../types/assessmentSessions';

/**
 * Cloze text normalization:
 * NFC -> NFKC, trim, collapse whitespace to single ASCII space,
 * and conditional lowercase when caseSensitive=false.
 * Strictly preserves punctuation, accents, and diacritics. No fuzzy matching.
 */
export function normalizeClozeText(text: string, caseSensitive: boolean): string {
  const normalized = text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
  return caseSensitive ? normalized : normalized.toLowerCase();
}

/**
 * Short-answer accepted text normalization:
 * NFKC, trim, collapse whitespace, lowercase.
 */
export function normalizeShortAnswerText(text: string): string {
  return text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Grades a single-select question deterministically.
 */
export function gradeSingleSelect(
  question: SingleSelectQuestion,
  response: AssessmentResponse,
  mark: ResponseMark,
  questionRevisionId: string
): ObjectiveGradeOutput {
  if (mark === 'unanswered' || mark === 'skipped') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: mark,
    };
  }

  if (response.kind !== 'single-select') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'incorrect',
    };
  }

  const isCorrect = response.optionId === question.correctOptionId;
  return {
    questionRevisionId,
    origin: 'deterministic',
    state: 'final',
    points: isCorrect ? question.maxPoints : 0,
    maxPoints: question.maxPoints,
    outcome: isCorrect ? 'correct' : 'incorrect',
    details: {
      selectedOptionIds: response.optionId ? [response.optionId] : [],
      correctOptionIds: [question.correctOptionId],
    },
  };
}

/**
 * Grades a multi-select question deterministically with all-or-nothing exact set matching.
 */
export function gradeMultiSelect(
  question: MultiSelectQuestion,
  response: AssessmentResponse,
  mark: ResponseMark,
  questionRevisionId: string
): ObjectiveGradeOutput {
  if (mark === 'unanswered' || mark === 'skipped') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: mark,
    };
  }

  if (response.kind !== 'multi-select') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'incorrect',
    };
  }

  const selectedSet = new Set(response.optionIds);
  const correctSet = new Set(question.correctOptionIds);

  const isExactMatch =
    selectedSet.size === correctSet.size &&
    [...selectedSet].every((id) => correctSet.has(id));

  return {
    questionRevisionId,
    origin: 'deterministic',
    state: 'final',
    points: isExactMatch ? question.maxPoints : 0,
    maxPoints: question.maxPoints,
    outcome: isExactMatch ? 'correct' : 'incorrect',
    details: {
      selectedOptionIds: response.optionIds,
      correctOptionIds: question.correctOptionIds,
    },
  };
}

/**
 * Grades a cloze question deterministically with equal per-blank points.
 */
export function gradeCloze(
  question: ClozeQuestion,
  response: AssessmentResponse,
  mark: ResponseMark,
  questionRevisionId: string
): ObjectiveGradeOutput {
  if (mark === 'unanswered' || mark === 'skipped') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: mark,
    };
  }

  if (response.kind !== 'cloze') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'incorrect',
    };
  }

  const blankCount = question.blanks.length;
  if (blankCount === 0) {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'incorrect',
    };
  }

  const pointsPerBlank = question.maxPoints / blankCount;
  let correctBlankCount = 0;
  const blankDetails: Record<string, { correct: boolean; points: number }> = {};

  for (const blank of question.blanks) {
    const rawAnswer = response.answers[blank.id] ?? '';
    const normAnswer = normalizeClozeText(rawAnswer, blank.caseSensitive);

    let isMatch = false;
    if (rawAnswer.trim().length > 0) {
      isMatch = blank.acceptedAnswers.some(
        (accepted) =>
          normalizeClozeText(accepted, blank.caseSensitive) === normAnswer
      );
    }

    if (isMatch) {
      correctBlankCount++;
      blankDetails[blank.id] = { correct: true, points: pointsPerBlank };
    } else {
      blankDetails[blank.id] = { correct: false, points: 0 };
    }
  }

  const totalPoints = correctBlankCount * pointsPerBlank;
  let outcome: ObjectiveOutcome;
  if (correctBlankCount === blankCount) {
    outcome = 'correct';
  } else if (correctBlankCount > 0) {
    outcome = 'partial';
  } else {
    outcome = 'incorrect';
  }

  return {
    questionRevisionId,
    origin: 'deterministic',
    state: 'final',
    points: totalPoints,
    maxPoints: question.maxPoints,
    outcome,
    details: {
      blanks: blankDetails,
    },
  };
}

/**
 * Grades a short-answer question.
 * If unanswered/skipped: deterministic 0.
 * If empty/whitespace: deterministic 0.
 * If matching accepted deterministic answers: full points.
 * Otherwise: pending AI rubric grading (state='needs-review', points=null).
 */
export function gradeShortAnswer(
  question: ShortAnswerQuestion,
  response: AssessmentResponse,
  mark: ResponseMark,
  questionRevisionId: string
): ObjectiveGradeOutput {
  if (mark === 'unanswered' || mark === 'skipped') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: mark,
    };
  }

  if (response.kind !== 'short-answer') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'incorrect',
    };
  }

  if (response.text.trim().length === 0) {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'unanswered',
    };
  }

  // Check deterministic accepted exact answers
  const normLearner = normalizeShortAnswerText(response.text);
  if (question.acceptedAnswers && question.acceptedAnswers.length > 0) {
    const isExactMatch = question.acceptedAnswers.some(
      (accepted) => normalizeShortAnswerText(accepted) === normLearner
    );
    if (isExactMatch) {
      return {
        questionRevisionId,
        origin: 'deterministic',
        state: 'final',
        points: question.maxPoints,
        maxPoints: question.maxPoints,
        outcome: 'correct',
      };
    }
  }

  // Non-exact requires AI/manual rubric evaluation in C5
  return {
    questionRevisionId,
    origin: 'ai',
    state: 'needs-review',
    points: null,
    maxPoints: question.maxPoints,
    outcome: 'pending',
  };
}

/**
 * Grades an essay question.
 * If unanswered/skipped: deterministic 0.
 * If empty/whitespace: deterministic 0.
 * Non-empty essay requires AI/manual rubric evaluation in C5.
 */
export function gradeEssay(
  question: AssessmentQuestion,
  response: AssessmentResponse,
  mark: ResponseMark,
  questionRevisionId: string
): ObjectiveGradeOutput {
  if (mark === 'unanswered' || mark === 'skipped') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: mark,
    };
  }

  if (response.kind !== 'essay') {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'incorrect',
    };
  }

  if (response.text.trim().length === 0) {
    return {
      questionRevisionId,
      origin: 'deterministic',
      state: 'final',
      points: 0,
      maxPoints: question.maxPoints,
      outcome: 'unanswered',
    };
  }

  return {
    questionRevisionId,
    origin: 'ai',
    state: 'needs-review',
    points: null,
    maxPoints: question.maxPoints,
    outcome: 'pending',
  };
}

/**
 * Dispatches objective grading for any question kind.
 */
export function gradeQuestionObjective(
  question: AssessmentQuestion,
  response: AssessmentResponse,
  mark: ResponseMark,
  questionRevisionId: string
): ObjectiveGradeOutput {
  switch (question.kind) {
    case 'single-select':
      return gradeSingleSelect(question, response, mark, questionRevisionId);
    case 'multi-select':
      return gradeMultiSelect(question, response, mark, questionRevisionId);
    case 'cloze':
      return gradeCloze(question, response, mark, questionRevisionId);
    case 'short-answer':
      return gradeShortAnswer(question, response, mark, questionRevisionId);
    case 'essay':
      return gradeEssay(question, response, mark, questionRevisionId);
  }
}
