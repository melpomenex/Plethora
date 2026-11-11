import { create } from 'zustand';
import type { KnowledgeGapView } from '../types/learningEvidence';
import type { KnowledgeGapKind } from '../types/knowledgeGaps';
import {
  getStudyPlanEvidence,
  listLearningGaps,
  dismissLearningGap as dismissNative,
  refreshLocalLearningGaps,
  reconcileLearningEvidence,
} from '../api/learning-evidence';

export interface KnowledgeGapsStoreState {
  gaps: KnowledgeGapView[];
  isLoading: boolean;
  lastError: string | null;

  // Legacy-compatible in-memory semantics (maps to native views in tests)
  recordGap: (gap: {
    kind: KnowledgeGapKind;
    conceptId?: string;
    conceptName: string;
    masteryEstimate?: number;
    variance?: number;
    evidence: Array<{ recordId: string; kind: 'review_lapse' | 'unreviewed_reading' | 'graph_edge' | 'assessment'; description: string }>;
  }) => string;
  dismissGap: (id: string) => void;
  resolveGap: (id: string) => void;
  getActiveGaps: () => KnowledgeGapView[];
  getActiveGapsForConcept: (conceptId: string) => KnowledgeGapView[];
  clearGaps: () => void;

  // Native-backed projection (non-persisted cache)
  loadGaps: (planId?: string | null) => Promise<void>;
  refreshGaps: (planId: string) => Promise<void>;
  dismissGapNative: (gapId: string, evidenceCutoff: string) => Promise<void>;
  reconcile: (afterGradeId?: string | null) => Promise<void>;
  loadPlanEvidence: (planId: string) => Promise<void>;
}

let localIdCounter = 0;

export const useKnowledgeGapsStore = create<KnowledgeGapsStoreState>()((set, get) => ({
  gaps: [],
  isLoading: false,
  lastError: null,

  recordGap: (gap) => {
    const id = `gap_local_${Date.now()}_${(localIdCounter += 1)}`;
    const now = new Date().toISOString();
    const view: KnowledgeGapView = {
      id,
      kind: gap.kind,
      conceptId: gap.conceptId ?? `legacy:${id}`,
      conceptName: gap.conceptName,
      planId: null,
      nodeId: null,
      ruleId: 'legacy-localstorage-v1',
      status: 'active',
      evidence: (gap.evidence ?? []).map((e) => ({
        recordId: e.recordId,
        kind: e.kind,
        description: e.description,
        learningEvidenceId: null,
        sourceRefId: null,
        payload: {
          legacyLocalstorageV1: true,
          legacyMasteryEstimate: gap.masteryEstimate ?? null,
          legacyVariance: gap.variance ?? null,
        },
      })),
      demonstrated: null,
      firstDetectedAt: now,
      lastDetectedAt: now,
      evidenceCutoff: now,
    };
    // Replace existing active gap for same concept & kind or append
    const filtered = get().gaps.filter(
      (g) =>
        !(
          g.conceptName.toLowerCase() === gap.conceptName.toLowerCase() &&
          g.kind === gap.kind &&
          g.status === 'active'
        ),
    );
    set({ gaps: [view, ...filtered] });
    return id;
  },

  dismissGap: (id) => {
    set({
      gaps: get().gaps.map((g) => (g.id === id ? { ...g, status: 'dismissed' as const } : g)),
    });
  },

  resolveGap: (id) => {
    set({
      gaps: get().gaps.map((g) => (g.id === id ? { ...g, status: 'resolved' as const } : g)),
    });
  },

  getActiveGaps: () => {
    return get().gaps.filter((g) => g.status === 'active');
  },

  getActiveGapsForConcept: (conceptId) => {
    return get().gaps.filter((g) => g.conceptId === conceptId && g.status === 'active');
  },

  clearGaps: () => {
    set({ gaps: [], lastError: null });
  },

  loadGaps: async (planId) => {
    set({ isLoading: true, lastError: null });
    try {
      const gaps = await listLearningGaps(planId ?? null, false);
      set({ gaps, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  refreshGaps: async (planId) => {
    set({ isLoading: true, lastError: null });
    try {
      const gaps = await refreshLocalLearningGaps(planId);
      set({ gaps, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  dismissGapNative: async (gapId, evidenceCutoff) => {
    await dismissNative(gapId, evidenceCutoff);
    set({
      gaps: get().gaps.map((g) =>
        g.id === gapId ? { ...g, status: 'dismissed' as const, evidenceCutoff } : g,
      ),
    });
  },

  reconcile: async (afterGradeId) => {
    set({ isLoading: true, lastError: null });
    try {
      let cursor = afterGradeId ?? null;
      for (let i = 0; i < 10; i++) {
        const res = await reconcileLearningEvidence(cursor, 100);
        cursor = res.nextAfterGradeId;
        if (res.completed) break;
      }
      const gaps = await listLearningGaps(null, false);
      set({ gaps, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        lastError: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  loadPlanEvidence: async (planId) => {
    // Warms native plan-evidence projection then refreshes gap cache.
    await getStudyPlanEvidence(planId);
    const gaps = await listLearningGaps(planId, false);
    set({ gaps });
  },
}));
