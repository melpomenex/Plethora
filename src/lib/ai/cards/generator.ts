import { CardProposal, CardForm, CardSourceRef } from './types';
import { detectCardDuplicates } from './duplicates';

export interface ValidationResult {
  valid: boolean;
  qualityScore: number;
  warnings: string[];
}

/**
 * Validates a generated card proposal against knowledge formulation heuristics:
 * - Minimum information principle (conciseness)
 * - Answer-in-question leakage
 * - Cloze syntax validity
 */
export function validateCardProposal(proposal: CardProposal): ValidationResult {
  const warnings: string[] = [];
  let score = 100;

  // 1. Length checks
  if (proposal.front.trim().length < 5) {
    warnings.push('Question is too short or empty');
    score -= 30;
  }
  if (proposal.front.length > 500) {
    warnings.push('Question violates minimum information principle (too verbose)');
    score -= 20;
  }
  if (proposal.back.trim().length === 0) {
    warnings.push('Answer is empty');
    score -= 50;
  }

  // 2. Answer-in-question leakage check
  const backClean = proposal.back.toLowerCase().trim();
  if (backClean.length > 4 && proposal.front.toLowerCase().includes(backClean)) {
    warnings.push('Answer appears directly in the question text (leakage)');
    score -= 40;
  }

  // 3. Cloze validation
  if (proposal.form === 'cloze') {
    const hasClozeSyntax =
      proposal.front.includes('{{c') ||
      proposal.front.includes('[...]') ||
      proposal.front.includes('__');
    if (!hasClozeSyntax) {
      warnings.push('Cloze card missing deletion marker syntax');
      score -= 25;
    }
  }

  return {
    valid: score >= 50 && warnings.length === 0,
    qualityScore: Math.max(0, Math.min(100, score)),
    warnings,
  };
}

/**
 * Helper to construct and sanitize a CardProposal from raw LLM output.
 */
export function createCardProposal(params: {
  id: string;
  form: CardForm;
  front: string;
  back: string;
  sourceQuote: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  sourceRef: CardSourceRef;
  existingCards?: Array<{ front: string; back: string }>;
}): CardProposal {
  const proposal: CardProposal = {
    id: params.id,
    form: params.form,
    front: params.front.trim(),
    back: params.back.trim(),
    sourceQuote: params.sourceQuote.trim(),
    difficulty: params.difficulty || 'medium',
    qualityScore: 100,
    sourceRef: params.sourceRef,
  };

  const validation = validateCardProposal(proposal);
  proposal.qualityScore = validation.qualityScore;

  if (params.existingCards && params.existingCards.length > 0) {
    const dup = detectCardDuplicates(proposal, params.existingCards);
    if (dup.isDuplicate && dup.matchedCard) {
      proposal.duplicateMatch = {
        similarity: dup.maxSimilarity,
        existingFront: dup.matchedCard.front,
      };
    }
  }

  return proposal;
}
