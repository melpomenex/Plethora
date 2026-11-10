/**
 * Assessment Evidence Planner and Batch Constructor.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §4.1, §5.2, §10
 * - openspec/changes/generate-study-plan-examinations/ (C3-T07)
 */

import type {
  AssessmentTopicTarget,
  QuotaSlot,
} from '../../../types/assessmentQuestions';
import type { StudySourceRefV1 } from '../../../types/studySource';
import type { SourceEvidenceItem } from '../../ai/tasks/definitions/curriculumTasks';
import type { TopicEvidenceSummary } from '../../ai/tasks/definitions/studyQuestionTasks';

export const DESKTOP_BATCH_SIZE = 4;
export const MOBILE_BATCH_SIZE = 2;

export interface TopicInfo {
  index: number;
  nodeId?: string | null;
  conceptId?: string | null;
  conceptLabel: string;
  title: string;
  objectives: string[];
}

export interface QuestionBatchPlan {
  batchIndex: number;
  stepKey: string;
  slots: QuotaSlot[];
  sources: SourceEvidenceItem[];
  sourceMap: Record<string, string>; // local handle (s_0) -> persistent sourceRefId
  topicEvidence: TopicEvidenceSummary[];
}

export interface PlanQuestionBatchesOptions {
  slots: QuotaSlot[];
  sourceRefs: StudySourceRefV1[];
  topicTargets: AssessmentTopicTarget[];
  topics?: TopicInfo[];
  isMobile?: boolean;
  maxBatchSize?: number;
}

/**
 * Resolves optimal batch size based on platform environment.
 */
export function resolveBatchSize(isMobile?: boolean): number {
  if (isMobile !== undefined) {
    return isMobile ? MOBILE_BATCH_SIZE : DESKTOP_BATCH_SIZE;
  }
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    return MOBILE_BATCH_SIZE;
  }
  return DESKTOP_BATCH_SIZE;
}

/**
 * Calculates the maximum allowed model calls for a generation request:
 * callCap = 2 * ceil(N / batchSize)
 */
export function calculateModelCallBudget(totalQuestions: number, batchSize: number): number {
  if (totalQuestions <= 0) return 0;
  return 2 * Math.ceil(totalQuestions / Math.max(1, batchSize));
}

/**
 * Plans question generation batches, assigning verified source excerpts and topic evidence to each batch.
 */
export function planQuestionBatches(options: PlanQuestionBatchesOptions): QuestionBatchPlan[] {
  const { slots, sourceRefs, topicTargets, topics = [] } = options;
  if (slots.length === 0) return [];

  const batchSize = options.maxBatchSize ?? resolveBatchSize(options.isMobile);

  // Build topic lookup
  const topicMap = new Map<number, TopicInfo>();
  for (const t of topics) {
    topicMap.set(t.index, t);
  }

  // Ensure default fallback topics if none provided
  for (let i = 0; i < topicTargets.length; i++) {
    if (!topicMap.has(i)) {
      const target = topicTargets[i];
      topicMap.set(i, {
        index: i,
        nodeId: target.nodeId,
        conceptId: target.conceptId,
        conceptLabel: target.conceptId ?? `Topic ${i + 1}`,
        title: target.conceptId ?? `Topic ${i + 1}`,
        objectives: ['Master the core concepts of this topic'],
      });
    }
  }

  // Split slots into batches
  const batches: QuestionBatchPlan[] = [];
  const totalBatches = Math.ceil(slots.length / batchSize);

  for (let b = 0; b < totalBatches; b++) {
    const batchSlots = slots.slice(b * batchSize, (b + 1) * batchSize);
    const stepKey = `question_batch:${String(b).padStart(4, '0')}`;

    // Collect topics involved in this batch
    const involvedTopicIndices = Array.from(new Set(batchSlots.map((s) => s.topicIndex))).sort(
      (a, b) => a - b
    );

    const batchTopics: TopicEvidenceSummary[] = [];
    for (const tIdx of involvedTopicIndices) {
      const topic = topicMap.get(tIdx);
      if (topic) {
        batchTopics.push({
          index: topic.index,
          title: topic.title,
          conceptName: topic.conceptLabel,
          objectives: topic.objectives,
        });
      } else {
        batchTopics.push({
          index: tIdx,
          title: `Topic ${tIdx + 1}`,
          conceptName: `Topic ${tIdx + 1}`,
          objectives: ['Understand topic content'],
        });
      }
    }

    // Select grounding sources (up to 4 sources per batch to keep containment tight)
    // In practice, select sources relevant to the plan or all verified sources up to limit
    const selectedSourceRefs = sourceRefs.slice(0, 4);
    const sources: SourceEvidenceItem[] = [];
    const sourceMap: Record<string, string> = {};

    for (let sIdx = 0; sIdx < selectedSourceRefs.length; sIdx++) {
      const ref = selectedSourceRefs[sIdx];
      const handle = `s_${sIdx}`;
      sources.push({
        handle,
        title: ref.documentTitle,
        excerpt: ref.excerpt,
      });
      sourceMap[handle] = ref.id;
    }

    batches.push({
      batchIndex: b,
      stepKey,
      slots: batchSlots,
      sources,
      sourceMap,
      topicEvidence: batchTopics,
    });
  }

  return batches;
}
