import { CardProposal } from './types';

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'in', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'with',
  'what', 'does', 'play', 'role', 'how', 'why', 'can', 'are', 'was', 'were', 'it'
]);

/**
 * Computes token-level similarity (overlap coefficient + Jaccard) between two strings.
 */
export function calculateTextJaccardSimilarity(textA: string, textB: string): number {
  const tokenize = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    );

  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionCount++;
    }
  }

  const minSize = Math.min(tokensA.size, tokensB.size);
  const unionCount = tokensA.size + tokensB.size - intersectionCount;
  
  // Weighted combination of overlap coefficient and Jaccard index
  const overlap = minSize > 0 ? intersectionCount / minSize : 0;
  const jaccard = unionCount > 0 ? intersectionCount / unionCount : 0;
  
  return (overlap * 0.6) + (jaccard * 0.4);
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  maxSimilarity: number;
  matchedCard?: { front: string; back: string };
}

/**
 * Checks a card proposal against existing deck cards.
 * Flags duplicates if Jaccard similarity on front or back exceeds threshold (default 0.75).
 */
export function detectCardDuplicates(
  proposal: CardProposal,
  existingCards: Array<{ front: string; back: string }>,
  threshold = 0.75
): DuplicateDetectionResult {
  let maxSimilarity = 0;
  let matchedCard: { front: string; back: string } | undefined;

  for (const card of existingCards) {
    const frontSim = calculateTextJaccardSimilarity(proposal.front, card.front);
    const backSim = calculateTextJaccardSimilarity(proposal.back, card.back);
    const combinedSim = Math.max(frontSim, (frontSim + backSim) / 2);

    if (combinedSim > maxSimilarity) {
      maxSimilarity = combinedSim;
      matchedCard = card;
    }
  }

  return {
    isDuplicate: maxSimilarity >= threshold,
    maxSimilarity,
    matchedCard: maxSimilarity >= threshold ? matchedCard : undefined,
  };
}
