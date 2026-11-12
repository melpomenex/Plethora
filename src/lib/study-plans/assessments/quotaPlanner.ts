/**
 * Deterministic Assessment Quota Planning and Largest-Remainder Slot Allocation.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §4, §4.1
 * - openspec/changes/generate-study-plan-examinations/
 */

import { sha256Hex } from '../sourceValidation';
import type {
  AssessmentConfigV1,
  QuestionKind,
  Difficulty,
  QuotaSlot,
  QuotaDeficit,
  QuotaReport,
  AssessmentQuestionRevision,
} from '../../../types/assessmentQuestions';
import type { FieldIssue } from '../../../types/learningPaths';

export const QUOTA_BOUNDS = {
  MIN_REQUESTED_COUNT: 1,
  MAX_REQUESTED_COUNT: 40,
  DIAGNOSTIC_MIN_COUNT: 4,
  DIAGNOSTIC_MAX_COUNT: 12,
  DESKTOP_BATCH_SIZE: 2,
  MOBILE_BATCH_SIZE: 2,
} as const;

export const KIND_STABLE_ORDER: QuestionKind[] = [
  'single-select',
  'multi-select',
  'cloze',
  'short-answer',
  'essay',
];

export const DIFFICULTY_STABLE_ORDER: Difficulty[] = [1, 2, 3, 4, 5];

export interface AllocationDimension<K> {
  key: K;
  weight: number;
}

/**
 * Largest-remainder allocation: distributes `total` items across weighted keys.
 * Ties are broken using the supplied stableKeys order.
 */
export function allocateLargestRemainder<K extends string | number>(
  total: number,
  entries: Array<AllocationDimension<K>>,
  stableKeys: K[]
): Map<K, number> {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error('study.assessment.error.invalid_total_allocation');
  }

  // Validate weights
  let sumWeights = 0;
  for (const entry of entries) {
    if (typeof entry.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0) {
      throw new Error('study.assessment.error.invalid_weight');
    }
    sumWeights += entry.weight;
  }

  if (sumWeights <= 0) {
    throw new Error('study.assessment.error.all_zero_weights');
  }

  // Keep only positive-weight entries in stable key order
  const stableKeyOrderMap = new Map<K, number>(stableKeys.map((k, idx) => [k, idx]));
  const positiveEntries = entries
    .filter((e) => e.weight > 0)
    .sort((a, b) => {
      const orderA = stableKeyOrderMap.get(a.key) ?? 999;
      const orderB = stableKeyOrderMap.get(b.key) ?? 999;
      return orderA - orderB;
    });

  if (positiveEntries.length === 0) {
    throw new Error('study.assessment.error.all_zero_weights');
  }

  const counts = new Map<K, number>();
  const remainders: Array<{ key: K; remainder: number; originalOrder: number }> = [];
  let allocatedSum = 0;

  for (let i = 0; i < positiveEntries.length; i++) {
    const entry = positiveEntries[i];
    const raw = (total * entry.weight) / sumWeights;
    const floorCount = Math.floor(raw);
    counts.set(entry.key, floorCount);
    allocatedSum += floorCount;
    remainders.push({
      key: entry.key,
      remainder: raw - floorCount,
      originalOrder: i,
    });
  }

  // Distribute remaining units one each by descending remainder; tie-breaker: ascending stable order
  const unitsToDistribute = total - allocatedSum;
  remainders.sort((a, b) => {
    const diff = b.remainder - a.remainder;
    if (Math.abs(diff) > 1e-9) {
      return diff;
    }
    return a.originalOrder - b.originalOrder;
  });

  for (let i = 0; i < unitsToDistribute; i++) {
    const entry = remainders[i];
    counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);
  }

  return counts;
}

/**
 * Generates deterministic slotKey: SHA-256 over blueprintRevisionId + zero-padded 4-digit slot index.
 */
export function computeSlotKey(blueprintRevisionId: string, slotIndex: number): string {
  const paddedIndex = slotIndex.toString().padStart(4, '0');
  return sha256Hex(`${blueprintRevisionId}:${paddedIndex}`);
}

/**
 * Builds deterministic QuotaSlot array from an AssessmentConfig.
 * Uses rotating relative-remainder selection across topic, kind, and difficulty dimensions.
 */
export function planQuotaSlots(
  config: AssessmentConfigV1,
  blueprintRevisionId: string
): QuotaSlot[] {
  const total = config.requestedCount;
  if (
    !Number.isInteger(total) ||
    total < QUOTA_BOUNDS.MIN_REQUESTED_COUNT ||
    total > QUOTA_BOUNDS.MAX_REQUESTED_COUNT
  ) {
    throw new Error('study.assessment.error.invalid_requested_count');
  }

  if (!config.topicTargets || config.topicTargets.length === 0) {
    throw new Error('study.assessment.error.missing_topic_targets');
  }

  // 1. Allocate counts for each dimension
  // Types
  const typeEntries: Array<AllocationDimension<QuestionKind>> = [];
  for (const kind of KIND_STABLE_ORDER) {
    const weight = config.typeWeights[kind] ?? 0;
    if (weight > 0) {
      typeEntries.push({ key: kind, weight });
    }
  }
  const typeAllocations = allocateLargestRemainder(total, typeEntries, KIND_STABLE_ORDER);

  // Difficulties
  const difficultyEntries: Array<AllocationDimension<Difficulty>> = [];
  for (const diff of DIFFICULTY_STABLE_ORDER) {
    const weight = config.difficultyWeights[diff] ?? 0;
    if (weight > 0) {
      difficultyEntries.push({ key: diff, weight });
    }
  }
  const difficultyAllocations = allocateLargestRemainder(
    total,
    difficultyEntries,
    DIFFICULTY_STABLE_ORDER
  );

  // Topics
  const topicEntries: Array<AllocationDimension<number>> = [];
  const topicStableKeys: number[] = [];
  for (let idx = 0; idx < config.topicTargets.length; idx++) {
    const weight = config.topicTargets[idx].weight;
    if (weight > 0) {
      topicEntries.push({ key: idx, weight });
      topicStableKeys.push(idx);
    }
  }
  const topicAllocations = allocateLargestRemainder(total, topicEntries, topicStableKeys);

  // 2. Rotating relative-remainder selection across slots
  // Maintain original counts and remaining counts for each dimension
  const remainingTypes = new Map<QuestionKind, number>(typeAllocations);
  const originalTypes = new Map<QuestionKind, number>(typeAllocations);

  const remainingDifficulties = new Map<Difficulty, number>(difficultyAllocations);
  const originalDifficulties = new Map<Difficulty, number>(difficultyAllocations);

  const remainingTopics = new Map<number, number>(topicAllocations);
  const originalTopics = new Map<number, number>(topicAllocations);

  const slots: QuotaSlot[] = [];

  for (let slotIndex = 0; slotIndex < total; slotIndex++) {
    // Select Kind
    let bestKind: QuestionKind = KIND_STABLE_ORDER[0];
    let bestKindRatio = -1;
    for (const kind of KIND_STABLE_ORDER) {
      const remaining = remainingTypes.get(kind) ?? 0;
      if (remaining > 0) {
        const ratio = remaining / (originalTypes.get(kind) ?? 1);
        if (ratio > bestKindRatio + 1e-9) {
          bestKindRatio = ratio;
          bestKind = kind;
        }
      }
    }
    remainingTypes.set(bestKind, (remainingTypes.get(bestKind) ?? 0) - 1);

    // Select Difficulty
    let bestDifficulty: Difficulty = DIFFICULTY_STABLE_ORDER[0];
    let bestDiffRatio = -1;
    for (const diff of DIFFICULTY_STABLE_ORDER) {
      const remaining = remainingDifficulties.get(diff) ?? 0;
      if (remaining > 0) {
        const ratio = remaining / (originalDifficulties.get(diff) ?? 1);
        if (ratio > bestDiffRatio + 1e-9) {
          bestDiffRatio = ratio;
          bestDifficulty = diff;
        }
      }
    }
    remainingDifficulties.set(bestDifficulty, (remainingDifficulties.get(bestDifficulty) ?? 0) - 1);

    // Select Topic
    let bestTopic: number = topicStableKeys[0];
    let bestTopicRatio = -1;
    for (const tIdx of topicStableKeys) {
      const remaining = remainingTopics.get(tIdx) ?? 0;
      if (remaining > 0) {
        const ratio = remaining / (originalTopics.get(tIdx) ?? 1);
        if (ratio > bestTopicRatio + 1e-9) {
          bestTopicRatio = ratio;
          bestTopic = tIdx;
        }
      }
    }
    remainingTopics.set(bestTopic, (remainingTopics.get(bestTopic) ?? 0) - 1);

    const slotKey = computeSlotKey(blueprintRevisionId, slotIndex);
    slots.push({
      slotKey,
      slotIndex,
      topicIndex: bestTopic,
      kind: bestKind,
      difficulty: bestDifficulty,
    });
  }

  return slots;
}

/**
 * Calculates deficits and aggregates a QuotaReport from planned slots and accepted question revisions.
 */
export function evaluateQuotaReport(
  slots: QuotaSlot[],
  acceptedQuestions: AssessmentQuestionRevision[],
  shortfallAccepted: boolean = false,
  duplicateFingerprints: string[] = [],
  validationIssues: FieldIssue[] = []
): QuotaReport {
  const requested = slots.length;

  // Map valid questions by slotKey
  const validBySlotKey = new Map<string, AssessmentQuestionRevision>();
  for (const q of acceptedQuestions) {
    if (q.validation === 'valid') {
      validBySlotKey.set(q.slotKey, q);
    }
  }

  const accepted = slots.filter((slot) => validBySlotKey.has(slot.slotKey)).length;

  // Aggregate deficits by (kind, topicIndex, difficulty)
  const deficitMap = new Map<string, { kind: QuestionKind; topicIndex: number; difficulty: Difficulty; count: number }>();

  for (const slot of slots) {
    if (!validBySlotKey.has(slot.slotKey)) {
      const key = `${slot.kind}:${slot.topicIndex}:${slot.difficulty}`;
      const existing = deficitMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        deficitMap.set(key, {
          kind: slot.kind,
          topicIndex: slot.topicIndex,
          difficulty: slot.difficulty,
          count: 1,
        });
      }
    }
  }

  const deficits: QuotaDeficit[] = Array.from(deficitMap.values());

  const issues: FieldIssue[] = [...validationIssues];
  if (accepted < requested && !shortfallAccepted) {
    issues.push({
      path: 'quota',
      code: 'quota_shortfall',
      messageKey: 'study.assessment.error.quota_shortfall',
    });
  }

  return {
    requested,
    accepted,
    slots,
    deficits,
    shortfallAccepted,
    duplicateQuestionFingerprints: duplicateFingerprints,
    validationIssues: issues,
  };
}

/**
 * Calculates maximum allowed model calls for question generation:
 * 2 * ceil(N / batchSize)
 */
export function calculateMaxQuestionModelCalls(
  requestedCount: number,
  isMobile: boolean = false
): number {
  const batchSize = isMobile ? QUOTA_BOUNDS.MOBILE_BATCH_SIZE : QUOTA_BOUNDS.DESKTOP_BATCH_SIZE;
  const initialBatches = Math.ceil(requestedCount / batchSize);
  return 2 * initialBatches;
}
