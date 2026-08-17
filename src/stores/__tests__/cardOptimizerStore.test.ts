import { describe, it, expect, beforeEach } from 'vitest';
import { useCardOptimizerStore } from '../cardOptimizerStore';

describe('CardOptimizerStore', () => {
  beforeEach(() => {
    useCardOptimizerStore.getState().clearProposals();
  });

  it('adds optimization proposals and retrieves pending proposals', () => {
    const store = useCardOptimizerStore.getState();
    const id = store.addProposal({
      kind: 'rewrite',
      targetCardIds: ['card-101'],
      deckId: 'deck-os',
      evidence: '4 lapses in past 5 reviews; response latency > 18 seconds',
      confidence: 0.88,
      draft: {
        front: 'What does the Translation Lookaside Buffer (TLB) cache?',
        back: 'Page table translations (virtual-to-physical address mappings).',
      },
    });

    const pending = useCardOptimizerStore.getState().getPendingProposals();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id);
    expect(pending[0].kind).toBe('rewrite');
    expect(pending[0].draft?.front).toContain('Translation Lookaside Buffer');
  });

  it('accepts and dismisses optimization proposals non-destructively', () => {
    const store = useCardOptimizerStore.getState();
    const id1 = store.addProposal({
      kind: 'split',
      targetCardIds: ['card-202'],
      evidence: 'Complex multi-fact question with 4 sub-points',
      confidence: 0.92,
    });
    const id2 = store.addProposal({
      kind: 'retire',
      targetCardIds: ['card-303'],
      evidence: 'Source document deleted from library',
      confidence: 0.99,
    });

    store.acceptProposal(id1);
    expect(useCardOptimizerStore.getState().proposals.find((p) => p.id === id1)?.status).toBe('accepted');

    store.dismissProposal(id2);
    expect(useCardOptimizerStore.getState().proposals.find((p) => p.id === id2)?.status).toBe('dismissed');

    expect(useCardOptimizerStore.getState().getPendingProposals()).toHaveLength(0);
  });
});
