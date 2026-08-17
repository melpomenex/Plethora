import { describe, expect, it } from 'vitest';
import { createCardProposal, validateCardProposal } from '../generator';
import { detectCardDuplicates } from '../duplicates';
import { CardProposal } from '../types';

describe('Intelligent Flashcard Generation & Quality Heuristics', () => {
  it('validates good card proposals', () => {
    const proposal: CardProposal = {
      id: 'card-1',
      form: 'qa',
      front: 'What is the primary function of the hippocampus in memory?',
      back: 'Consolidation of information from short-term memory to long-term memory.',
      sourceQuote: 'The hippocampus plays key roles in the consolidation of information...',
      difficulty: 'medium',
      qualityScore: 100,
      sourceRef: { documentId: 'doc-1' },
    };

    const res = validateCardProposal(proposal);
    expect(res.valid).toBe(true);
    expect(res.qualityScore).toBe(100);
  });

  it('penalizes answer-in-question leakage', () => {
    const leakyProposal: CardProposal = {
      id: 'card-2',
      form: 'qa',
      front: 'Why does the hippocampus consolidate memories in the hippocampus?',
      back: 'hippocampus',
      sourceQuote: 'hippocampus quote',
      difficulty: 'easy',
      qualityScore: 100,
      sourceRef: { documentId: 'doc-1' },
    };

    const res = validateCardProposal(leakyProposal);
    expect(res.warnings).toContain('Answer appears directly in the question text (leakage)');
    expect(res.qualityScore).toBeLessThan(70);
  });

  it('detects near-duplicate flashcards using Jaccard similarity', () => {
    const newProposal: CardProposal = {
      id: 'card-3',
      form: 'qa',
      front: 'What role does the hippocampus play in memory consolidation?',
      back: 'It converts short-term memory into permanent long-term storage.',
      sourceQuote: '...',
      difficulty: 'medium',
      qualityScore: 100,
      sourceRef: { documentId: 'doc-1' },
    };

    const existingCards = [
      {
        front: 'What is the function of the hippocampus in memory consolidation?',
        back: 'Converts short-term memories into long-term memories.',
      },
    ];

    const dup = detectCardDuplicates(newProposal, existingCards, 0.6);
    expect(dup.isDuplicate).toBe(true);
    expect(dup.maxSimilarity).toBeGreaterThan(0.6);
  });
});
