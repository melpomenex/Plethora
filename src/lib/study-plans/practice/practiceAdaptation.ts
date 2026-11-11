import { shouldReusePracticeCheck } from '../attempts/attemptPolicy';

export interface ConceptPracticeSignal {
  conceptId: string;
  observedMean: number | null;
  hintsUsed: boolean;
  sessions: number;
}

export interface NextPracticeAdvice {
  conceptId: string;
  difficulty: number;
  reason: 'decrease' | 'increase' | 'same';
  excludeFingerprints: string[];
}

/**
 * Fixed between-paper adaptation (C7-T02): <.6 decrement/min1,
 * >.85 with no hints increment/max5, else same. No item changes mid-attempt.
 * AI/pending grades never trigger next recommendation (caller filters).
 */
export function adviseNextDifficulty(
  signal: ConceptPracticeSignal,
  currentDifficulty: number,
  excludeFingerprints: string[] = [],
): NextPracticeAdvice {
  const clamped = Math.max(1, Math.min(5, Math.floor(currentDifficulty)));
  const mean = signal.observedMean;
  if (mean !== null && mean < 0.6) {
    return {
      conceptId: signal.conceptId,
      difficulty: Math.max(1, clamped - 1),
      reason: 'decrease',
      excludeFingerprints: [...excludeFingerprints],
    };
  }
  if (mean !== null && mean > 0.85 && !signal.hintsUsed) {
    return {
      conceptId: signal.conceptId,
      difficulty: Math.min(5, clamped + 1),
      reason: 'increase',
      excludeFingerprints: [...excludeFingerprints],
    };
  }
  return {
    conceptId: signal.conceptId,
    difficulty: clamped,
    reason: 'same',
    excludeFingerprints: [...excludeFingerprints],
  };
}

export { shouldReusePracticeCheck };
