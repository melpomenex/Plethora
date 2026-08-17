import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { KnowledgeHealthSummary } from '../types/knowledgeHealth';

export interface KnowledgeHealthStoreState {
  summary: KnowledgeHealthSummary | null;
  isLoading: boolean;

  // Actions
  setSummary: (summary: KnowledgeHealthSummary) => void;
  recordReviewSignals: (params: {
    retrievabilityValues: number[];
    readCount: number;
    extractCount: number;
    cardCount: number;
    unstableCards: number;
  }) => void;
  reset: () => void;
}

export const useKnowledgeHealthStore = create<KnowledgeHealthStoreState>()(
  persist(
    (set) => ({
      summary: null,
      isLoading: false,

      setSummary: (summary) => {
        set({ summary });
      },

      recordReviewSignals: ({
        retrievabilityValues,
        readCount,
        extractCount,
        cardCount,
        unstableCards,
      }) => {
        const sampleSize = retrievabilityValues.length;
        if (sampleSize === 0) {
          set({
            summary: {
              overallRetentionEstimate: 0,
              retentionBuckets: [],
              funnel: { readCount, extractCount, cardCount, retainedCount: 0 },
              unstableCardCount: unstableCards,
              calibrations: [],
              sampleSize: 0,
              hasSufficientData: false,
              computedAt: new Date().toISOString(),
            },
          });
          return;
        }

        const sumR = retrievabilityValues.reduce((acc, v) => acc + v, 0);
        const meanR = sumR / sampleSize;

        let b90 = 0;
        let b70 = 0;
        let b50 = 0;
        let bUnder50 = 0;

        for (const r of retrievabilityValues) {
          if (r >= 0.9) b90++;
          else if (r >= 0.7) b70++;
          else if (r >= 0.5) b50++;
          else bUnder50++;
        }

        const buckets = [
          { range: '90-100%', itemCount: b90, percentage: Math.round((b90 / sampleSize) * 100) },
          { range: '70-89%', itemCount: b70, percentage: Math.round((b70 / sampleSize) * 100) },
          { range: '50-69%', itemCount: b50, percentage: Math.round((b50 / sampleSize) * 100) },
          { range: '<50%', itemCount: bUnder50, percentage: Math.round((bUnder50 / sampleSize) * 100) },
        ];

        const retainedCount = retrievabilityValues.filter((r) => r >= 0.8).length;

        const summary: KnowledgeHealthSummary = {
          overallRetentionEstimate: Number(meanR.toFixed(3)),
          retentionBuckets: buckets,
          funnel: {
            readCount,
            extractCount,
            cardCount,
            retainedCount,
          },
          unstableCardCount: unstableCards,
          calibrations: [
            {
              algorithm: 'fsrs',
              predictedRecall: Number(meanR.toFixed(3)),
              actualRecall: Number((retainedCount / sampleSize).toFixed(3)),
              sampleCount: sampleSize,
              brierScore: Number(Math.abs(meanR - retainedCount / sampleSize).toFixed(4)),
            },
          ],
          sampleSize,
          hasSufficientData: sampleSize >= 10,
          computedAt: new Date().toISOString(),
        };

        set({ summary });
      },

      reset: () => {
        set({ summary: null });
      },
    }),
    {
      name: 'plethora-knowledge-health',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        summary: state.summary,
      }),
    }
  )
);
