import { describe, it, expect, beforeEach } from 'vitest';
import { useKnowledgeGapsStore } from '../knowledgeGapsStore';

describe('KnowledgeGapsStore', () => {
  beforeEach(() => {
    useKnowledgeGapsStore.getState().clearGaps();
  });

  it('records gaps and filters active gaps', () => {
    const store = useKnowledgeGapsStore.getState();
    const id1 = store.recordGap({
      kind: 'weak_prerequisite',
      conceptId: 'concept-1',
      conceptName: 'Translation Lookaside Buffer',
      masteryEstimate: 0.25,
      variance: 0.15,
      evidence: [
        {
          recordId: 'rev-1',
          kind: 'review_lapse',
          description: '4 consecutive lapses on virtual page lookup cards',
        },
      ],
    });

    expect(useKnowledgeGapsStore.getState().getActiveGaps()).toHaveLength(1);
    expect(useKnowledgeGapsStore.getState().getActiveGapsForConcept('concept-1')).toHaveLength(1);

    store.dismissGap(id1);
    expect(useKnowledgeGapsStore.getState().getActiveGaps()).toHaveLength(0);
  });

  it('resolves gaps upon demonstrated mastery', () => {
    const store = useKnowledgeGapsStore.getState();
    const id = store.recordGap({
      kind: 'missing_concept',
      conceptName: 'Backpropagation Gradient Flow',
      masteryEstimate: 0.1,
      variance: 0.3,
      evidence: [],
    });

    store.resolveGap(id);
    expect(useKnowledgeGapsStore.getState().gaps[0].status).toBe('resolved');
  });
});
