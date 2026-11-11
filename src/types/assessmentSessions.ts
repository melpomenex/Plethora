/**
 * Canonical Assessment Session, Response, and Grade Domain Contracts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§5–7, §11, §12
 * - openspec/changes/implement-resumable-examination-sessions/
 */

import type {
  AssessmentMode,
  AssessmentQuestionRevision,
  AssessmentResponse,
  LearnerConfidence,
  QuestionKind,
  ResponseMark,
  RubricCriterion,
  RubricLevel,
} from './assessmentQuestions';

export type {
  LearnerConfidence,
  ResponseMark,
  AssessmentResponse,
  AssessmentQuestionRevision,
};

// ============================================================================
// 1. Session and Attempt Types (§7)
// ============================================================================

export type AttemptStatus =
  | 'in-progress'
  | 'submitted'
  | 'grading'
  | 'partially-graded'
  | 'complete'
  | 'grading-failed'
  | 'cancelled';

export type SubmissionReason = 'user' | 'timer' | 'timer-recovered';

export interface ExamAttempt {
  id: string;
  blueprintRevisionId: string;
  blueprintTitle?: string;
  clientStartKey: string;
  mode: AssessmentMode;
  status: AttemptStatus;
  questionRevisionIds: string[]; // fixed order at Start
  revision: number;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  submissionReason: SubmissionReason | null;
  submissionKey: string | null;
  awardedPoints: number | null; // null while any official item score is unresolved
  maximumPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamResponse {
  id: string;
  attemptId: string;
  questionRevisionId: string;
  draft: AssessmentResponse;
  mark: ResponseMark;
  revision: number;
  lastClientMutationId: string;
  updatedAt: string;
}

export interface ResponseSubmission {
  id: string;
  responseId: string;
  attemptId: string;
  questionRevisionId: string;
  ordinal: number; // 1 for exam/diagnostic; incrementing practice Check rounds
  kind: 'exam-final' | 'practice-check';
  response: AssessmentResponse;
  mark: ResponseMark;
  hintLevel: number; // 0..3; exams always 0
  createdAt: string;
}

// ============================================================================
// 2. Grade Records and Rubrics (§6)
// ============================================================================

export type GradeOrigin = 'deterministic' | 'ai' | 'manual';
export type GradeState = 'final' | 'needs-review' | 'failed';

export type CriterionJudgment =
  | {
      criterionId: string;
      status: 'assessed';
      level: RubricLevel;
      answerEvidence: string; // exact nonempty substring of learner response
      rationale: string;
      missingConcepts: string[];
      misconception: string | null;
      sourceRefIds: string[];
    }
  | { criterionId: string; status: 'not-assessable'; reason: string };

export type CriterionResult =
  | CriterionJudgment
  | {
      criterionId: string;
      status: 'manual';
      level: RubricLevel;
      rationale: string | null;
    };

export type RubricLimitation =
  | 'ambiguous-answer'
  | 'insufficient-source'
  | 'model-capability'
  | 'non-reasoning-fallback';

export interface RubricGradeProposal {
  schemaVersion: 1;
  criteria: CriterionJudgment[];
  assessment: import('../lib/ai/schemas/answerAssessment').AnswerAssessment;
  limitations: RubricLimitation[];
}

export interface GradeRecord {
  id: string;
  responseSubmissionId: string;
  questionRevisionId: string;
  origin: GradeOrigin;
  state: GradeState;
  points: number | null;
  maxPoints: number;
  outcome?: ObjectiveOutcome;
  assessment: import('../lib/ai/schemas/answerAssessment').AnswerAssessment | null;
  criteria: CriterionResult[];
  provenance: import('./assessmentQuestions').GenerationProvenance | null;
  manualReason: string | null;
  supersedesGradeId: string | null;
  isCurrent: boolean;
  createdAt: string;
}

// ============================================================================
// 3. Grader and Scoring Output Contracts (§7.1)
// ============================================================================

export type ObjectiveOutcome =
  | 'correct'
  | 'partial'
  | 'incorrect'
  | 'unanswered'
  | 'skipped'
  | 'pending';

export interface ObjectiveGradeOutput {
  questionRevisionId: string;
  responseSubmissionId?: string;
  origin: GradeOrigin;
  state: GradeState;
  points: number | null;
  maxPoints: number;
  outcome: ObjectiveOutcome;
  details?: {
    blanks?: Record<string, { correct: boolean; points: number }>;
    selectedOptionIds?: string[];
    correctOptionIds?: string[];
  };
}

export interface AttemptScoreSummary {
  attemptId: string;
  maximumPoints: number;
  awardedPoints: number | null; // null if any question is not final
  provisionalObjectivePoints: number; // subtotal of all final objective grades
  totalQuestions: number;
  finalQuestions: number;
  pendingQuestions: number;
  needsReviewQuestions: number;
  failedQuestions: number;
  isFullyFinal: boolean;
  derivedStatus: AttemptStatus;
}

// ============================================================================
// 4. Detail, Summary and IPC Payloads (§11)
// ============================================================================

export interface AttemptDetail {
  attempt: ExamAttempt;
  responses: ExamResponse[];
  submissions: ResponseSubmission[];
  currentGrades: GradeRecord[];
  questions?: AssessmentQuestionRevision[]; // optional loaded questions
}

export interface AttemptSummary {
  id: string;
  blueprintRevisionId: string;
  blueprintId: string;
  blueprintTitle: string;
  mode: AssessmentMode;
  status: AttemptStatus;
  startedAt: string;
  deadlineAt: string | null;
  completedAt: string | null;
  awardedPoints: number | null;
  maximumPoints: number;
  questionCount: number;
}

export interface StartAttemptInput {
  blueprintRevisionId: string;
  clientStartKey: string;
}

export interface SaveResponseInput {
  attemptId: string;
  responseId: string;
  expectedResponseRevision: number;
  lastClientMutationId: string;
  draft: AssessmentResponse;
  mark: ResponseMark;
}

export interface SubmitAttemptInput {
  attemptId: string;
  expectedAttemptRevision: number;
  submissionKey: string;
  submissionReason: SubmissionReason;
  objectiveGrades: ObjectiveGradeOutput[];
}

export interface CheckPracticeInput {
  attemptId: string;
  responseId: string;
  expectedAttemptRevision: number;
  clientMutationId: string;
  hintLevel: number;
  draft: AssessmentResponse;
  mark: ResponseMark;
  objectiveGrade: ObjectiveGradeOutput | null;
}

export interface PracticeCheckResult {
  submission: ResponseSubmission;
  grade: GradeRecord | null;
  attemptRevision: number;
  responseRevision?: number;
  explanation?: string | null;
}

export interface AttemptHistoryFilter {
  blueprintRevisionId?: string;
  blueprintId?: string;
  mode?: AssessmentMode;
  status?: AttemptStatus;
}

export interface CriterionJudgmentInput {
  criterionId: string;
  status: 'assessed' | 'not-assessable';
  level?: number | null;
  answerEvidence?: string | null;
  rationale?: string | null;
  missingConceptsJson?: string | null;
  misconception?: string | null;
  sourceRefIdsJson?: string | null;
  notAssessableReason?: string | null;
}

export interface RecordRubricGradeInput {
  attemptId: string;
  responseSubmissionId: string;
  questionRevisionId: string;
  expectedAttemptRevision: number;
  state: 'final' | 'needs-review' | 'failed';
  points: number | null;
  maxPoints: number;
  normalizedScore: number | null;
  assessmentJson?: string | null;
  criteria: CriterionJudgmentInput[];
  provenanceJson?: string | null;
  limitationsJson?: string | null;
  jobId?: string | null;
  stepKey?: string | null;
}

export interface ManualCriterionGradeItem {
  criterionId: string;
  level: number;
  rationale?: string | null;
}

export interface RecordManualGradeInput {
  attemptId: string;
  responseSubmissionId: string;
  questionRevisionId: string;
  expectedAttemptRevision: number;
  manualReason: string;
  criteria: ManualCriterionGradeItem[];
  feedback?: string | null;
}

export interface GradeSettlementOutcome {
  gradeId: string;
  isCurrent: boolean;
  supersedesGradeId: string | null;
  attemptStatus: AttemptStatus;
  attemptAwardedPoints: number | null;
  attemptRevision: number;
}
