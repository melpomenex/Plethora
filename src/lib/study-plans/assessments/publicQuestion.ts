/**
 * Public Question Projection and Private-Field Whitelisting.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §5.1
 * - openspec/changes/generate-study-plan-examinations/
 */

import type {
  AssessmentQuestion,
  QuestionKind,
  Difficulty,
  ApplicationLevel,
  QuestionOption,
  ClozeSegment,
  AnalyticRubric,
} from '../../../types/assessmentQuestions';

export interface PublicQuestionRevealPolicy {
  mode: 'exam' | 'practice' | 'diagnostic';
  isSubmitted: boolean;
  practiceCheckRevealed?: boolean;
  allowTransparentCriteria?: boolean;
}

export interface PublicRubricCriterion {
  id: string;
  title: string;
}

export interface PublicQuestionBase {
  schemaVersion: 1;
  kind: QuestionKind;
  prompt: string;
  difficulty: Difficulty;
  learningObjectives: string[];
  maxPoints: number;
  applicationLevel: ApplicationLevel;
  hints?: string[];
  explanation?: string;
}

export type PublicQuestion =
  | (PublicQuestionBase & {
      kind: 'single-select';
      options: QuestionOption[];
      correctOptionId?: string;
    })
  | (PublicQuestionBase & {
      kind: 'multi-select';
      options: QuestionOption[];
      correctOptionIds?: string[];
    })
  | (PublicQuestionBase & {
      kind: 'cloze';
      segments: ClozeSegment[];
      blanks: Array<{ id: string; caseSensitive: boolean; acceptedAnswers?: string[] }>;
    })
  | (PublicQuestionBase & {
      kind: 'short-answer';
      criteria?: PublicRubricCriterion[];
      referenceAnswer?: string;
      acceptedAnswers?: string[];
      rubric?: AnalyticRubric;
    })
  | (PublicQuestionBase & {
      kind: 'essay';
      criteria?: PublicRubricCriterion[];
      expectedReasoning?: string;
      rubric?: AnalyticRubric;
    });

/**
 * Constructs a fresh, whitelisted PublicQuestion object from an AssessmentQuestion.
 * Ensures strict privacy boundaries before submission in Exam/Diagnostic modes.
 */
export function toPublicQuestion(
  question: AssessmentQuestion,
  policy: PublicQuestionRevealPolicy
): PublicQuestion {
  const isPostSubmission = policy.isSubmitted;
  const isPracticeRevealed = policy.mode === 'practice' && Boolean(policy.practiceCheckRevealed);
  const shouldRevealAnswers = isPostSubmission || isPracticeRevealed;

  // C7-T02: Exam/Diagnostic public output always excludes hints, even post-submission.
  // Only Practice may reveal committed hints (one-at-a-time in UI).
  const shouldRevealHints = policy.mode === 'practice';

  const base: PublicQuestionBase = {
    schemaVersion: 1,
    kind: question.kind,
    prompt: question.prompt,
    difficulty: question.difficulty,
    learningObjectives: [...question.learningObjectives],
    maxPoints: question.maxPoints,
    applicationLevel: question.applicationLevel,
  };

  if (shouldRevealHints && Array.isArray(question.hints) && question.hints.length > 0) {
    base.hints = [...question.hints];
  }

  if (shouldRevealAnswers && question.explanation) {
    base.explanation = question.explanation;
  }

  switch (question.kind) {
    case 'single-select': {
      const options: QuestionOption[] = question.options.map((o) => ({
        id: o.id,
        text: o.text,
      }));

      const res: PublicQuestion = {
        ...base,
        kind: 'single-select',
        options,
      };

      if (shouldRevealAnswers) {
        res.correctOptionId = question.correctOptionId;
      }

      return res;
    }

    case 'multi-select': {
      const options: QuestionOption[] = question.options.map((o) => ({
        id: o.id,
        text: o.text,
      }));

      const res: PublicQuestion = {
        ...base,
        kind: 'multi-select',
        options,
      };

      if (shouldRevealAnswers) {
        res.correctOptionIds = [...question.correctOptionIds];
      }

      return res;
    }

    case 'cloze': {
      const segments: ClozeSegment[] = question.segments.map((s) => ({ ...s }));

      const blanks = question.blanks.map((b) => {
        const item: { id: string; caseSensitive: boolean; acceptedAnswers?: string[] } = {
          id: b.id,
          caseSensitive: b.caseSensitive,
        };
        if (shouldRevealAnswers) {
          item.acceptedAnswers = [...b.acceptedAnswers];
        }
        return item;
      });

      return {
        ...base,
        kind: 'cloze',
        segments,
        blanks,
      };
    }

    case 'short-answer': {
      const res: PublicQuestion = {
        ...base,
        kind: 'short-answer',
      };

      if (policy.allowTransparentCriteria && question.rubric?.criteria) {
        res.criteria = question.rubric.criteria.map((c) => ({
          id: c.id,
          title: c.title,
        }));
      }

      if (shouldRevealAnswers) {
        res.referenceAnswer = question.referenceAnswer;
        res.acceptedAnswers = [...question.acceptedAnswers];
        res.rubric = JSON.parse(JSON.stringify(question.rubric));
      }

      return res;
    }

    case 'essay': {
      const res: PublicQuestion = {
        ...base,
        kind: 'essay',
      };

      if (policy.allowTransparentCriteria && question.rubric?.criteria) {
        res.criteria = question.rubric.criteria.map((c) => ({
          id: c.id,
          title: c.title,
        }));
      }

      if (shouldRevealAnswers) {
        res.expectedReasoning = question.expectedReasoning;
        res.rubric = JSON.parse(JSON.stringify(question.rubric));
      }

      return res;
    }
  }
}

/**
 * Diagnostic utility: recursively asserts that an unrevealed public question
 * has zero private fields (such as correctOptionId, acceptedAnswers, referenceAnswer,
 * expectedReasoning, keyFacts, or rubric level weights/descriptors).
 */
export function assertNoPrivateFields(
  obj: unknown,
  forbiddenKeys: string[] = [
    'correctOptionId',
    'correctOptionIds',
    'acceptedAnswers',
    'referenceAnswer',
    'expectedReasoning',
    'keyFacts',
    'levels',
    'gradingConstraints',
    'expectedConcepts',
    'hints',
    'explanation',
  ]
): void {
  if (!obj || typeof obj !== 'object') return;

  for (const [key, value] of Object.entries(obj)) {
    if (forbiddenKeys.includes(key)) {
      throw new Error(`Private field leakage detected: '${key}' in public object`);
    }
    if (value && typeof value === 'object') {
      assertNoPrivateFields(value, forbiddenKeys);
    }
  }
}
