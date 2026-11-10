/**
 * Canonical Assessment Blueprint and Question Domain Contracts.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§4–6, §10, §11
 * - openspec/changes/generate-study-plan-examinations/
 */

import type { FieldIssue, KnowledgePolicy } from './learningPaths';
import type { StudySourceScopeV1 } from './studySource';

// ============================================================================
// 1. Blueprint Configuration and Policy (§4)
// ============================================================================

export type AssessmentMode = 'exam' | 'practice' | 'diagnostic';

export type QuestionKind =
  | 'single-select'
  | 'multi-select'
  | 'cloze'
  | 'short-answer'
  | 'essay';

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export type ApplicationLevel =
  | 'recall'
  | 'comprehension'
  | 'application'
  | 'multi-step-reasoning';

export interface AssessmentScoringPolicyV1 {
  schemaVersion: 1;
  singleSelect: 'exact-option';
  multiSelect: 'exact-set-all-or-nothing';
  cloze: 'equal-per-blank';
  shortAnswer: 'accepted-exact-then-rubric';
  essay: 'analytic-rubric';
  unanswered: 'zero';
  skipped: 'zero';
  negativeMarking: false;
}

export const DEFAULT_SCORING_POLICY: AssessmentScoringPolicyV1 = {
  schemaVersion: 1,
  singleSelect: 'exact-option',
  multiSelect: 'exact-set-all-or-nothing',
  cloze: 'equal-per-blank',
  shortAnswer: 'accepted-exact-then-rubric',
  essay: 'analytic-rubric',
  unanswered: 'zero',
  skipped: 'zero',
  negativeMarking: false,
};

export const DEFAULT_POINTS_BY_KIND: Record<QuestionKind, number> = {
  'single-select': 1,
  'multi-select': 1,
  cloze: 1,
  'short-answer': 2,
  essay: 8,
};

export interface AssessmentTopicTarget {
  nodeId: string | null;
  conceptId: string | null;
  weight: number;
}

export interface AssessmentConfigV1 {
  schemaVersion: 1;
  mode: AssessmentMode;
  requestedCount: number; // 1..40; diagnostic restricted to 4..12 in C7
  typeWeights: Partial<Record<QuestionKind, number>>; // nonnegative integers, total > 0
  difficultyWeights: Partial<Record<Difficulty, number>>; // total > 0
  topicTargets: AssessmentTopicTarget[];
  timeLimitSeconds: number | null; // null or 300..14400; practice/diagnostic null
  knowledgePolicy: KnowledgePolicy;
  excludedQuestionFingerprints: string[]; // app-owned; avoid repeats for a new paper
  pointsByKind: Record<QuestionKind, number>; // integer 1..20; defaults single/multi/cloze=1, short=2, essay=8
}

export interface QuotaSlot {
  slotKey: string; // sha256 blueprintRevisionId + zero-padded slot index
  slotIndex: number;
  topicIndex: number;
  kind: QuestionKind;
  difficulty: Difficulty;
}

export interface QuotaDeficit {
  kind: QuestionKind;
  topicIndex: number;
  difficulty: Difficulty;
  count: number;
}

export interface QuotaReport {
  requested: number;
  accepted: number;
  slots: QuotaSlot[];
  deficits: QuotaDeficit[];
  shortfallAccepted: boolean;
  duplicateQuestionFingerprints: string[];
  validationIssues: FieldIssue[];
}

export type BlueprintLifecycle = 'active' | 'archived';

export type BlueprintState =
  | 'draft'
  | 'needs-review'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface AssessmentBlueprint {
  id: string;
  planId: string | null;
  title: string;
  currentRevisionId: string | null;
  lifecycle: BlueprintLifecycle;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintRevision {
  id: string;
  blueprintId: string;
  revision: number;
  state: BlueprintState;
  planVersionId: string | null;
  config: AssessmentConfigV1;
  scoring: AssessmentScoringPolicyV1;
  sourceScope: StudySourceScopeV1;
  quota: QuotaReport;
  generationJobId: string | null;
  sourceSnapshotHash: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface BlueprintDetail {
  blueprint: AssessmentBlueprint;
  revision: BlueprintRevision;
  questions: AssessmentQuestionRevision[];
}

export interface BlueprintSummary {
  id: string;
  planId: string | null;
  title: string;
  lifecycle: BlueprintLifecycle;
  currentRevisionId: string | null;
  currentRevision: number;
  state: BlueprintState;
  mode: AssessmentMode;
  questionCount: number;
  updatedAt: string;
}

// ============================================================================
// 2. Canonical Question Interfaces (§5)
// ============================================================================

export interface QuestionOption {
  id: string;
  text: string;
}

interface QuestionCommon<K extends QuestionKind> {
  schemaVersion: 1;
  kind: K;
  prompt: string; // 1..2000 chars
  difficulty: Difficulty;
  learningObjectives: string[]; // 0..6 items, each 1..240
  sourceRefIds: string[]; // 0..4 items, max 4
  explanation: string; // 0..4000 chars
  maxPoints: number; // integer 1..20
  applicationLevel: ApplicationLevel;
  hints: string[]; // 0..3 precommitted <=500-char hints; only Practice may reveal
}

export interface SingleSelectQuestion extends QuestionCommon<'single-select'> {
  options: QuestionOption[]; // 2..8 options
  correctOptionId: string;
}

export interface MultiSelectQuestion extends QuestionCommon<'multi-select'> {
  options: QuestionOption[]; // 2..8 options
  correctOptionIds: string[]; // unique, sorted, size >= 2
}

export type ClozeSegment =
  | { kind: 'text'; text: string }
  | { kind: 'blank'; blankId: string };

export interface ClozeBlank {
  id: string;
  acceptedAnswers: string[]; // 1..12, each nonempty <=500; unique after normalization
  caseSensitive: boolean;
}

export interface ClozeQuestion extends QuestionCommon<'cloze'> {
  segments: ClozeSegment[]; // >= 1 blank, exactly one segment per blank id
  blanks: ClozeBlank[];
}

export interface KeyFact {
  id: string;
  text: string;
  required: boolean;
}

export interface ShortAnswerQuestion extends QuestionCommon<'short-answer'> {
  referenceAnswer: string; // 1..8000
  keyFacts: KeyFact[]; // 1..10
  acceptedAnswers: string[]; // deterministic full-credit alternatives
  rubric: AnalyticRubric;
}

export interface EssayQuestion extends QuestionCommon<'essay'> {
  expectedReasoning: string; // committed solution outline, 1..12000
  rubric: AnalyticRubric;
}

export type AssessmentQuestion =
  | SingleSelectQuestion
  | MultiSelectQuestion
  | ClozeQuestion
  | ShortAnswerQuestion
  | EssayQuestion;

export type QuestionValidationStatus = 'draft' | 'valid' | 'invalid';

export interface AssessmentQuestionRevision {
  id: string;
  questionId: string;
  blueprintRevisionId: string;
  revision: number;
  slotKey: string;
  fingerprint: string;
  question: AssessmentQuestion;
  validation: QuestionValidationStatus;
  validationIssues?: FieldIssue[];
  committedAt: string | null;
  provider: GenerationProvenance | null;
  createdAt: string;
}

// ============================================================================
// 3. Rubric Contracts (§6)
// ============================================================================

export type RubricLevel = 0 | 1 | 2 | 3 | 4;

export interface RubricCriterion {
  id: string; // app-assigned per question
  title: string;
  assessmentInstruction: string;
  weight: number; // integer 1..100
  grounding: 'source' | 'reasoning' | 'presentation';
  sourceRefIds: string[]; // required when grounding=source
  keyFactIds: string[]; // short-answer links, empty for essay if not applicable
  levels: Record<'0' | '1' | '2' | '3' | '4', string>; // all nonempty <=1000 each
}

export interface AnalyticRubric {
  schemaVersion: 1;
  criteria: RubricCriterion[]; // short 1..8, essay 2..8; unique ids/titles, total weight > 0
  expectedConcepts: string[];
  gradingConstraints: string[]; // bounded; no model-authored executable instruction
}

export interface GenerationProvenance {
  taskId: string;
  providerId: string;
  endpointLocality: 'device' | 'loopback' | 'lan' | 'remote' | 'unknown';
  requestedModelClass: 'fast' | 'full' | 'reasoning';
  servedModelClass: 'fast' | 'full' | 'reasoning';
  fallbackPath: 'none' | 'cloud-fallback' | 'reasoning-fallback';
  validationOutcome: string;
  baseModelName?: string;
  promptContractVersion: 'study-ai-v1';
  usage?: { inputTokens?: number; outputTokens?: number; tokenLimit?: number };
}

// ============================================================================
// 4. Learner Responses and Public Projections (§5.1)
// ============================================================================

export type LearnerConfidence = 0 | 0.3 | 0.5 | 0.7 | 0.9 | 1;

export type AssessmentResponse =
  | { kind: 'single-select'; optionId: string | null; confidence?: LearnerConfidence }
  | { kind: 'multi-select'; optionIds: string[]; confidence?: LearnerConfidence }
  | { kind: 'cloze'; answers: Record<string, string>; confidence?: LearnerConfidence }
  | { kind: 'short-answer'; text: string; confidence?: LearnerConfidence }
  | { kind: 'essay'; text: string; confidence?: LearnerConfidence };

export type ResponseMark = 'unanswered' | 'answered' | 'skipped';

// ============================================================================
// 5. Model Output Batch Contracts (§5.2)
// ============================================================================

export interface ModelOption {
  handle: string;
  text: string;
}

export interface ModelCriterion extends Omit<RubricCriterion, 'id' | 'sourceRefIds'> {
  handle: string;
  sourceHandles: string[];
}

export interface ModelQuestionBase {
  prompt: string;
  learningObjectives: string[];
  explanation: string;
  sourceHandles: string[];
  applicationLevel: ApplicationLevel;
  hints: string[]; // 0..3 hints
}

export type ModelQuestion =
  | (ModelQuestionBase & {
      kind: 'single-select';
      options: ModelOption[];
      correctOptionHandle: string;
    })
  | (ModelQuestionBase & {
      kind: 'multi-select';
      options: ModelOption[];
      correctOptionHandles: string[];
    })
  | (ModelQuestionBase & {
      kind: 'cloze';
      segments: ClozeSegment[];
      blanks: Array<{
        handle: string;
        acceptedAnswers: string[];
        caseSensitive: boolean;
      }>;
    })
  | (ModelQuestionBase & {
      kind: 'short-answer';
      referenceAnswer: string;
      keyFacts: Array<{ handle: string; text: string; required: boolean }>;
      acceptedAnswers: string[];
      rubric: {
        expectedConcepts: string[];
        gradingConstraints: string[];
        criteria: ModelCriterion[];
      };
    })
  | (ModelQuestionBase & {
      kind: 'essay';
      expectedReasoning: string;
      rubric: {
        expectedConcepts: string[];
        gradingConstraints: string[];
        criteria: ModelCriterion[];
      };
    });

export interface ModelQuestionBatch {
  schemaVersion: 1;
  questions: Array<{
    slotKey: string;
    question: ModelQuestion;
  }>;
}
