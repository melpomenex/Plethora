/**
 * Assessment Question Generation Candidate Translation and Merge.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §4.1, §5.2
 * - openspec/changes/generate-study-plan-examinations/ (C3-T07)
 */

import type {
  AssessmentQuestion,
  ModelQuestionBatch,
  QuotaDeficit,
  QuotaReport,
  QuotaSlot,
} from '../../../types/assessmentQuestions';
import type { FieldIssue } from '../../../types/learningPaths';
import { convertModelQuestion } from './questionCodec';
import { computeQuestionFingerprint } from './questionFingerprint';
import { validateAssessmentQuestion } from './questionValidation';
import type { QuestionBatchPlan } from './evidencePlanner';

export interface ValidCandidate {
  slotKey: string;
  question: AssessmentQuestion;
  fingerprint: string;
}

export interface CandidateTranslationResult {
  acceptedCandidates: ValidCandidate[];
  rejectedSlotKeys: string[];
  duplicateFingerprints: string[];
  issues: FieldIssue[];
}

export interface TranslateCandidatesOptions {
  batch: ModelQuestionBatch;
  batchPlan: QuestionBatchPlan;
  existingFingerprints?: Set<string>;
  excludedFingerprints?: string[];
  idGenerator?: (prefix: string) => string;
}

/**
 * Translates model-generated local-handle questions into domain AssessmentQuestions,
 * performing validation, fingerprinting, and duplicate screening.
 */
export function translateAndFilterCandidates(
  options: TranslateCandidatesOptions
): CandidateTranslationResult {
  const { batch, batchPlan, existingFingerprints = new Set(), excludedFingerprints = [] } = options;

  const slotMap = new Map<string, QuotaSlot>(batchPlan.slots.map((s) => [s.slotKey, s]));
  const excludedSet = new Set(excludedFingerprints);

  const acceptedCandidates: ValidCandidate[] = [];
  const rejectedSlotKeys: string[] = [];
  const duplicateFingerprints: string[] = [];
  const issues: FieldIssue[] = [];

  for (const item of batch.questions) {
    const slot = slotMap.get(item.slotKey);
    if (!slot) {
      issues.push({
        path: `slots.${item.slotKey}`,
        code: 'unassigned_slot',
        messageKey: 'study.assessment.error.unassigned_slot',
      });
      rejectedSlotKeys.push(item.slotKey);
      continue;
    }

    try {
      // 1. Convert to domain question
      const question = convertModelQuestion(
        item.question,
        slot,
        batchPlan.sourceMap,
        options.idGenerator
      );

      // 2. Pure domain validation
      const validation = validateAssessmentQuestion(question);
      if (!validation.valid) {
        issues.push(...validation.issues);
        rejectedSlotKeys.push(item.slotKey);
        continue;
      }

      // 3. Compute canonical fingerprint
      const fingerprint = computeQuestionFingerprint(question);

      // 4. Duplicate checks
      if (excludedSet.has(fingerprint)) {
        duplicateFingerprints.push(fingerprint);
        issues.push({
          path: `questions.${item.slotKey}.fingerprint`,
          code: 'excluded_retake_repeat',
          messageKey: 'study.assessment.error.excluded_retake_repeat',
        });
        rejectedSlotKeys.push(item.slotKey);
        continue;
      }

      if (existingFingerprints.has(fingerprint)) {
        duplicateFingerprints.push(fingerprint);
        issues.push({
          path: `questions.${item.slotKey}.fingerprint`,
          code: 'duplicate_question',
          messageKey: 'study.assessment.error.duplicate_question',
        });
        rejectedSlotKeys.push(item.slotKey);
        continue;
      }

      // Candidate accepted!
      existingFingerprints.add(fingerprint);
      acceptedCandidates.push({
        slotKey: item.slotKey,
        question,
        fingerprint,
      });
    } catch (err) {
      issues.push({
        path: `questions.${item.slotKey}`,
        code: 'translation_failed',
        messageKey: err instanceof Error ? err.message : String(err),
      });
      rejectedSlotKeys.push(item.slotKey);
    }
  }

  return {
    acceptedCandidates,
    rejectedSlotKeys,
    duplicateFingerprints,
    issues,
  };
}

/**
 * Builds an aggregated QuotaReport by comparing requested count and planned slots
 * against accepted slot keys. Unfilled slots are grouped into deficits.
 */
export function buildQuotaReport(
  requestedCount: number,
  allSlots: QuotaSlot[],
  acceptedSlotKeys: Set<string>,
  duplicateQuestionFingerprints: string[] = [],
  validationIssues: FieldIssue[] = [],
  shortfallAccepted = false
): QuotaReport {
  const accepted = allSlots.filter((s) => acceptedSlotKeys.has(s.slotKey)).length;

  // Group unfilled slots into deficits
  const deficitMap = new Map<string, QuotaDeficit>();

  for (const slot of allSlots) {
    if (!acceptedSlotKeys.has(slot.slotKey)) {
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

  const deficits = Array.from(deficitMap.values());

  return {
    requested: requestedCount,
    accepted,
    slots: allSlots,
    deficits,
    shortfallAccepted,
    duplicateQuestionFingerprints,
    validationIssues,
  };
}
