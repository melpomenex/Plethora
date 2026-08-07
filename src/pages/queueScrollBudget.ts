/**
 * How many flashcards and extracts a scroll session may show.
 *
 * It lives here rather than inline in QueueScrollPage so the rule is testable
 * without mounting a ~4000-line component (same reasoning as extractModeGate).
 *
 * `extractsCountAsFlashcards` is what the Scroll Queue setting promises in its
 * own description — "percentage of the queue that should be flashcards AND
 * extracts". It used to be read nowhere: extracts were injected
 * unconditionally, up to the per-session cap, whatever the percentage said, so
 * dragging the slider to 0 still produced a queue full of extract cards.
 */
export interface ReviewBudgetInput {
  /** Flashcard count implied by the percentage slider and the reading queue size. */
  targetFlashcardCount: number;
  /** Setting: do extracts draw from the same budget as flashcards? */
  extractsCountAsFlashcards: boolean;
  /** Hard per-session cap on extracts, applied either way. */
  maxExtractsPerSession: number;
  /** How many are actually available. */
  availableFlashcards: number;
  availableExtracts: number;
}

export function splitReviewBudget({
  targetFlashcardCount,
  extractsCountAsFlashcards,
  maxExtractsPerSession,
  availableFlashcards,
  availableExtracts,
}: ReviewBudgetInput): { flashcards: number; extracts: number } {
  const target = Math.max(0, targetFlashcardCount);

  if (!extractsCountAsFlashcards) {
    return {
      flashcards: Math.min(target, availableFlashcards),
      extracts: Math.min(maxExtractsPerSession, availableExtracts),
    };
  }

  // Extracts are taken first. There are typically far fewer due extracts than
  // due flashcards, so filling flashcards first would starve them at every
  // percentage; taking them first barely dents the flashcard share.
  const extracts = Math.min(target, maxExtractsPerSession, availableExtracts);
  return {
    flashcards: Math.min(target - extracts, availableFlashcards),
    extracts,
  };
}
