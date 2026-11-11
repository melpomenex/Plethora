/**
 * Curriculum Generation Proposal Contracts & Types.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3, §10
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T01)
 */

import type {
  KnowledgePolicy,
  StudyDepth,
  StudySourceScopeV1,
} from '../../../types/studySource';

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

export interface CurriculumPriorEvidenceConcept {
  conceptId: string;
  level: MasteryEvidenceLevel;
  observedMean: number | null;
  uncertainty: UncertaintyReason[];
  evidenceGroupIds: string[];
}

export interface CurriculumPriorEvidence {
  diagnosticAttemptId: string;
  concepts: CurriculumPriorEvidenceConcept[];
}

import type { DestinationClassification } from '../../ai/features/destinations';

export interface CurriculumGenerationRequest {
  planId: string;
  baseVersionId: string;
  sourceScope: StudySourceScopeV1;
  depth: StudyDepth;
  knowledgePolicy: KnowledgePolicy;
  rulesOnly: boolean;
  priorEvidence: CurriculumPriorEvidence | null; // C2 supports null; C7 supplies validated diagnostics
  goal?: string;
}

export interface CurriculumTopicProposal {
  handle: string; // batch-local identifier, e.g. "h_0", "n1", never durable UUID
  title: string; // 1..160
  summary: string; // 0..1000
  learningObjectives: string[]; // 1..6, each 1..240
  conceptName: string; // 1..160
  materialSupport: 'grounded' | 'unsupported';
  sourceHandles: string[]; // grounded requires >=1 allowed hydrated source handle, max 8
  whyHere: string | null; // 0..500
}

export interface CurriculumEdgeProposal {
  prerequisiteHandle: string;
  dependentHandle: string;
  rationale: string; // 1..500
  sourceHandles: string[]; // max 8
  support: 'inferred' | 'unsupported' | 'confirmed-concept-link';
}

export interface CurriculumDecomposeBatchOutput {
  schemaVersion: 1;
  topics: CurriculumTopicProposal[];
}

export interface CurriculumPrerequisiteOutput {
  schemaVersion: 1;
  edges: CurriculumEdgeProposal[];
}

// ============================================================================
// Study Generation Durable Narrow Job Contracts (§10, §11)
// ============================================================================

export type StudyJobKind = 'curriculum' | 'assessment-generation' | 'exam-grading';

export type StudyJobStatus =
  | 'queued'
  | 'running'
  | 'awaiting-review'
  | 'interrupted'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StudyStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StudyAiPreflight {
  providerId: string;
  modelSelection?: string;
  model?: {
    configId: string;
    provider: string;
    name: string;
    id: string;
    endpointOrigin: string;
    endpointHash: string;
    reasoningMetadata?: boolean;
  };
  modelClass?: string;
  reasoningFallback?: boolean;
  estimate?: {
    modelSteps: number;
    inputTokens: number;
    outputTokens: number;
    inputPrice?: number;
    outputPrice?: number;
    costUsd?: number;
  };
  embedding?: {
    provider: string;
    model: string;
    endpointHash?: string;
    maximumQueries: number;
  };
  generationDestination: DestinationClassification | string;
  embeddingDestination: DestinationClassification | string | null;
  featureAllowed: boolean;
  documentIds: string[];
  sourceExcerptCount: number;
  sendsSourceOffDevice: boolean;
  sendsAnswersOffDevice: boolean;
  billable: boolean;
  cloudDisclosureAccepted: boolean;
  costConsentAccepted: boolean;
  maximumModelCalls: number;
}

export interface CurriculumExecutionStats {
  modelCalls: number;
  corrections: number;
  reportedInputTokens: number;
  reportedOutputTokens: number;
  responsesWithUsage: number;
  durationMs: number;
}

export interface StudyJobProgress {
  completed: number;
  total: number;
  labelKey: string;
  execution?: CurriculumExecutionStats;
}

export interface StudyGenerationJob {
  id: string;
  kind: StudyJobKind;
  targetId: string;
  targetRevision: number;
  requestHash: string;
  creationKey: string;
  status: StudyJobStatus;
  nextStepIndex: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  cancellationEpoch: number;
  attemptCount: number;
  preflight: StudyAiPreflight | Record<string, unknown>;
  progress: StudyJobProgress;
  lastError: import('../../../types/learningPaths').StudyCommandError | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyGenerationStep {
  jobId: string;
  stepKey: string;
  ordinal: number;
  inputHash: string;
  status: StudyStepStatus;
  outputRefId: string | null;
  safeError: import('../../../types/learningPaths').StudyCommandError | null;
  completedAt: string | null;
}

export interface CreateStudyStepInput {
  stepKey: string;
  ordinal: number;
  inputHash: string;
}

export interface StartStudyJobInput {
  kind: StudyJobKind;
  targetId: string;
  targetRevision: number;
  creationKey: string;
  requestHash: string;
  preflight: StudyAiPreflight | Record<string, unknown>;
  steps: CreateStudyStepInput[];
}

export interface CompleteStudyStepInput {
  jobId: string;
  stepKey: string;
  leaseOwner: string;
  cancellationEpoch: number;
  inputHash: string;
  outputRefId: string | null;
  nextStepIndex: number;
  progress: StudyJobProgress;
  status?: StudyJobStatus;
}

export interface FailStudyStepInput {
  jobId: string;
  stepKey: string;
  leaseOwner: string;
  cancellationEpoch: number;
  error: import('../../../types/learningPaths').StudyCommandError;
}

