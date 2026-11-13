import type {
  KnowledgeGapView,
  RemediationRecommendation,
} from '../../../types/learningEvidence';
import type { AssessmentConfigV1 } from '../../../types/assessmentQuestions';
import type { StudySourceScopeV1 } from '../../../types/studySource';

export interface RemediationContext {
  planId: string | null;
  planVersionId: string | null;
  nodeId: string | null;
  gapId: string;
  conceptId: string;
  sourceScope: StudySourceScopeV1 | null;
  excludedFingerprints: string[];
  objectives: string[];
}

export interface RemediationClients {
  createBlueprintDraft: (input: {
    planId: string | null;
    title: string;
    planVersionId: string | null;
    config: AssessmentConfigV1;
    sourceScope: StudySourceScopeV1;
    sourceSnapshotHash: string;
  }) => Promise<{ revisionId: string }>;
  savePlanDraft: (input: {
    planId: string;
    expectedRevision: number;
    note: string;
  }) => Promise<void>;
  recordDisposition: (
    recommendationId: string,
    status: 'accepted' | 'dismissed' | 'completed',
  ) => Promise<RemediationRecommendation>;
  openSource: (sourceRefId: string) => Promise<void>;
}

export type PracticeEmphasis = 'recall' | 'application' | 'transfer';

export interface TargetedPracticeOptions {
  /** Difficulty band 1–5 (default 4). */
  difficulty?: 1 | 2 | 3 | 4 | 5;
  /** Emphasis: recall, application or transfer (default recall). */
  emphasis?: PracticeEmphasis;
  /**
   * Paper selection: fresh (default) starts from any previously excluded
   * fingerprints so a new paper differs; same-paper retake passes an empty
   * exclusion list so the sampler may reuse committed items.
   */
  paper?: 'fresh' | 'same';
}

export function buildTargetedPracticeConfig(
  ctx: RemediationContext,
  options: TargetedPracticeOptions = {},
): AssessmentConfigV1 {
  const difficulty = options.difficulty ?? 4;
  const emphasis = options.emphasis ?? 'recall';
  const typeWeights =
    emphasis === 'transfer'
      ? { essay: 1 }
      : emphasis === 'application'
        ? { 'multi-select': 1, 'short-answer': 1 }
        : { 'single-select': 1 };
  const excludedQuestionFingerprints =
    options.paper === 'same' ? [] : ctx.excludedFingerprints;
  return {
    schemaVersion: 1,
    mode: 'practice',
    requestedCount: 1,
    typeWeights,
    difficultyWeights: { [String(difficulty)]: 1 } as never,
    topicTargets: ctx.nodeId
      ? [{ nodeId: ctx.nodeId, conceptId: ctx.conceptId, weight: 1 }]
      : [{ nodeId: null, conceptId: ctx.conceptId, weight: 1 }],
    timeLimitSeconds: null,
    knowledgePolicy: 'source-only',
    excludedQuestionFingerprints,
    pointsByKind: {
      'single-select': 1,
      'multi-select': 2,
      cloze: 2,
      'short-answer': 2,
      essay: 5,
    } as never,
  };
}

export function buildFollowUpExamConfig(ctx: RemediationContext): AssessmentConfigV1 {
  return {
    schemaVersion: 1,
    mode: 'exam',
    requestedCount: 2,
    typeWeights: { 'single-select': 1, 'multi-select': 1 },
    difficultyWeights: { '4': 1, '5': 1 } as never,
    topicTargets: ctx.nodeId
      ? [{ nodeId: ctx.nodeId, conceptId: ctx.conceptId, weight: 2 }]
      : [{ nodeId: null, conceptId: ctx.conceptId, weight: 2 }],
    timeLimitSeconds: null,
    knowledgePolicy: 'source-only',
    excludedQuestionFingerprints: ctx.excludedFingerprints,
    pointsByKind: {
      'single-select': 1,
      'multi-select': 2,
      cloze: 2,
      'short-answer': 2,
      essay: 5,
    } as never,
  };
}

/**
 * Creates a targeted-practice C3 Draft without starting an attempt.
 * Never writes scheduler/queue/cards and never invokes providers.
 */
export async function createTargetedPracticeDraft(
  ctx: RemediationContext,
  clients: Pick<RemediationClients, 'createBlueprintDraft'>,
): Promise<{ revisionId: string }> {
  if (!ctx.sourceScope) throw new Error('missing_source_scope');
  return clients.createBlueprintDraft({
    planId: ctx.planId,
    title: `Targeted practice — ${ctx.conceptId}`,
    planVersionId: ctx.planVersionId,
    config: buildTargetedPracticeConfig(ctx),
    sourceScope: ctx.sourceScope,
    sourceSnapshotHash: 'local',
  });
}

export async function createFollowUpExamDraft(
  ctx: RemediationContext,
  clients: Pick<RemediationClients, 'createBlueprintDraft'>,
): Promise<{ revisionId: string }> {
  if (!ctx.sourceScope) throw new Error('missing_source_scope');
  return clients.createBlueprintDraft({
    planId: ctx.planId,
    title: `Follow-up exam — ${ctx.conceptId}`,
    planVersionId: ctx.planVersionId,
    config: buildFollowUpExamConfig(ctx),
    sourceScope: ctx.sourceScope,
    sourceSnapshotHash: 'local',
  });
}

export async function createPlanAdjustmentDraft(
  ctx: RemediationContext,
  clients: Pick<RemediationClients, 'savePlanDraft'>,
  planRevision: number,
): Promise<void> {
  if (!ctx.planId) throw new Error('missing_plan');
  await clients.savePlanDraft({
    planId: ctx.planId,
    expectedRevision: planRevision,
    note: `Plan adjustment requested from gap ${ctx.gapId}`,
  });
}

export function contextFromGap(
  gap: KnowledgeGapView,
  opts: {
    planVersionId?: string | null;
    sourceScope?: StudySourceScopeV1 | null;
    excludedFingerprints?: string[];
    objectives?: string[];
  } = {},
): RemediationContext {
  return {
    planId: gap.planId,
    planVersionId: opts.planVersionId ?? null,
    nodeId: gap.nodeId,
    gapId: gap.id,
    conceptId: gap.conceptId,
    sourceScope: opts.sourceScope ?? null,
    excludedFingerprints: opts.excludedFingerprints ?? [],
    objectives: opts.objectives ?? [],
  };
}
