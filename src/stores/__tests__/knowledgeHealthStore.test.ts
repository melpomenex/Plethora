import { describe, it, expect, beforeEach } from 'vitest';
import { useKnowledgeHealthStore } from '../knowledgeHealthStore';
import { formatHealthConfidenceLabel } from '../../types/knowledgeHealth';

describe('KnowledgeHealthStore', () => {
  beforeEach(() => {
    useKnowledgeHealthStore.getState().reset();
  });

  it('computes retention distribution and funnel statistics honestly', () => {
    const store = useKnowledgeHealthStore.getState();

    // 15 items with known retrievability
    const sampleR = [
      0.95, 0.92, 0.91, 0.88, 0.85, 0.82, 0.78, 0.74, 0.71, 0.65, 0.58, 0.52, 0.45, 0.35, 0.2,
    ];

    store.recordReviewSignals({
      retrievabilityValues: sampleR,
      readCount: 120,
      extractCount: 45,
      cardCount: 30,
      unstableCards: 2,
    });

    const summary = useKnowledgeHealthStore.getState().summary;
    expect(summary).not.toBeNull();
    expect(summary?.sampleSize).toBe(15);
    expect(summary?.hasSufficientData).toBe(true);
    expect(summary?.funnel.readCount).toBe(120);
    expect(summary?.funnel.extractCount).toBe(45);
    expect(summary?.funnel.cardCount).toBe(30);
    expect(summary?.retentionBuckets).toHaveLength(4);

    expect(formatHealthConfidenceLabel(summary!)).toBe('Early Trend (moderate variance)');
  });

  it('marks insufficient data when sample size is below threshold', () => {
    const store = useKnowledgeHealthStore.getState();
    store.recordReviewSignals({
      retrievabilityValues: [0.95, 0.85],
      readCount: 5,
      extractCount: 2,
      cardCount: 2,
      unstableCards: 0,
    });

    const summary = useKnowledgeHealthStore.getState().summary;
    expect(summary?.hasSufficientData).toBe(false);
    expect(formatHealthConfidenceLabel(summary!)).toContain('Insufficient Data');
  });
});
