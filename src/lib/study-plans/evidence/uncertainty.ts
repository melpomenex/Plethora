/**
 * Uncertainty Reason Derivation Engine (`evidence-v1`).
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §8.1
 * - openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md (C6-T01)
 */

import type {
  LearningEvidence,
  UncertaintyReason,
} from '../../../types/learningEvidence';

export interface UncertaintyEvaluationInput {
  evidence: LearningEvidence[];
  independentSessions: number;
  minimumObserved: number | null;
  maximumObserved: number | null;
  latestEvidenceAt: string | null;
  hadRepeatPenalty: boolean;
  nowTimestamp: number;
}

export function deriveUncertaintyReasons(input: UncertaintyEvaluationInput): UncertaintyReason[] {
  const reasons = new Set<UncertaintyReason>();
  const {
    evidence,
    independentSessions,
    minimumObserved,
    maximumObserved,
    latestEvidenceAt,
    hadRepeatPenalty,
    nowTimestamp,
  } = input;

  const scoredItems = evidence.filter((e) => e.observedScore !== null);

  // 1. No assessment
  if (scoredItems.length === 0) {
    reasons.add('no-assessment');
  }

  // 2. Session counts
  if (independentSessions === 1) {
    reasons.add('one-independent-session');
  } else if (independentSessions > 1 && independentSessions < 3) {
    reasons.add('few-independent-sessions');
  }

  // 3. Same question repetition penalty
  if (hadRepeatPenalty) {
    reasons.add('same-question-repetition');
  }

  // 4. Hints used
  if (evidence.some((e) => e.hintLevel > 0)) {
    reasons.add('hints-used');
  }

  // 5. AI graded
  if (evidence.some((e) => e.graderOrigin === 'ai')) {
    reasons.add('ai-graded');
  }

  // 6. Conflicting outcomes (min and max observed differ by >= 0.4)
  if (minimumObserved !== null && maximumObserved !== null && maximumObserved - minimumObserved >= 0.4) {
    reasons.add('conflicting-outcomes');
  }

  // 7. Stale evidence (latest evidence older than 90 days from now)
  if (latestEvidenceAt) {
    const latestTime = new Date(latestEvidenceAt).getTime();
    if (!isNaN(latestTime)) {
      const ageDays = Math.floor((nowTimestamp - latestTime) / (24 * 3600 * 1000));
      if (ageDays >= 90) {
        reasons.add('stale-evidence');
      }
    }
  }

  // 8. Narrow difficulty (if difficulty is present on items and spans fewer than 2 difficulty levels)
  const difficulties = new Set<number>();
  for (const item of evidence) {
    if (typeof item.difficulty === 'number' && item.difficulty > 0) {
      difficulties.add(item.difficulty);
    }
  }
  if (difficulties.size > 0 && difficulties.size < 2 && scoredItems.length >= 2) {
    reasons.add('narrow-difficulty');
  }

  // 9. Learner confidence signals
  for (const item of evidence) {
    // Low learner confidence: any final answer with learnerConfidence <= 0.3
    if (
      item.learnerConfidence !== null &&
      item.learnerConfidence !== undefined &&
      item.learnerConfidence <= 0.3 &&
      item.outcome !== 'skipped' &&
      item.outcome !== 'unanswered'
    ) {
      reasons.add('low-learner-confidence');
    }

    // High confidence error: final score < 0.6 with learnerConfidence >= 0.9
    if (
      item.observedScore !== null &&
      item.observedScore < 0.6 &&
      item.learnerConfidence !== null &&
      item.learnerConfidence !== undefined &&
      item.learnerConfidence >= 0.9
    ) {
      reasons.add('high-confidence-error');
    }
  }

  return Array.from(reasons);
}
