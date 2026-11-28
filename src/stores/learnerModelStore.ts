/**
 * Zustand store caching canonical SQLite-backed ConceptCompetencyProfiles (Phase 1B).
 *
 * Subscribes to `learningEventBus` so relevant learning events automatically
 * invalidate and refresh affected cached concept profiles.
 */

import { create } from "zustand";
import {
  getConceptCompetencyProfile,
  listConceptCompetencyProfiles,
  recordCompetencyEvidence,
  setLearnerCompetencyDeclaration,
} from "../api/learner-model";
import {
  getHighWaterSeq,
  subscribeLearningEvents,
} from "../lib/learning-events/learningEventBus";
import type { LearningEvent, LearningEventType } from "../types/learningEvent";
import type {
  CompetencyEvidenceRecord,
  ConceptCompetencyProfile,
  DeclaredCompetencyLevel,
  LearnerCompetencyDeclaration,
  RecordCompetencyEvidenceInput,
} from "../types/learnerModel";

const COMPETENCY_INVALIDATING_EVENTS: LearningEventType[] = [
  "assessment_graded",
  "assessment_grade_invalidated",
  "review_committed",
  "review_undone",
  "reading_progressed",
  "concept_mastery_declared",
];

function extractConceptIdsFromEvent(event: LearningEvent): string[] {
  const ids = new Set<string>();
  if (event.entityKind === "concept" && event.entityId) {
    ids.add(event.entityId);
  }
  const payload = event.payload as Record<string, unknown> | null | undefined;
  if (payload && typeof payload === "object") {
    if (typeof payload.conceptId === "string" && payload.conceptId.length > 0) {
      ids.add(payload.conceptId);
    }
    if (Array.isArray(payload.conceptIds)) {
      for (const cid of payload.conceptIds) {
        if (typeof cid === "string" && cid.length > 0) {
          ids.add(cid);
        }
      }
    }
  }
  return Array.from(ids);
}

export interface LearnerModelStoreState {
  profilesByConceptId: Record<string, ConceptCompetencyProfile>;
  staleConceptIds: Record<string, boolean>;
  loadingByConceptId: Record<string, boolean>;
  error: string | null;
  highWaterSeq: number;
  isSubscribed: boolean;

  loadConceptProfile: (
    conceptId: string,
    options?: { conceptName?: string; aiContext?: boolean; force?: boolean },
  ) => Promise<ConceptCompetencyProfile>;
  loadConceptProfiles: (
    conceptIds?: string[],
    options?: { aiContext?: boolean },
  ) => Promise<ConceptCompetencyProfile[]>;
  setDeclaration: (
    conceptId: string,
    declaredLevel: DeclaredCompetencyLevel,
    note?: string | null,
  ) => Promise<LearnerCompetencyDeclaration>;
  recordEvidence: (
    input: RecordCompetencyEvidenceInput,
  ) => Promise<CompetencyEvidenceRecord>;
  invalidateConcept: (conceptId: string) => void;
  invalidateAll: () => void;
  connectLearningEventBus: () => () => void;
  reset: () => void;
}

let activeBusUnsubscribe: (() => void) | null = null;

export const useLearnerModelStore = create<LearnerModelStoreState>((set, get) => ({
  profilesByConceptId: {},
  staleConceptIds: {},
  loadingByConceptId: {},
  error: null,
  highWaterSeq: 0,
  isSubscribed: false,

  loadConceptProfile: async (conceptId, options) => {
    const state = get();
    const cached = state.profilesByConceptId[conceptId];
    const isStale = Boolean(state.staleConceptIds[conceptId]);

    if (cached && !isStale && !options?.force && !options?.aiContext) {
      return cached;
    }

    set((prev) => ({
      loadingByConceptId: { ...prev.loadingByConceptId, [conceptId]: true },
      error: null,
    }));

    try {
      const profile = await getConceptCompetencyProfile(conceptId, {
        conceptName: options?.conceptName,
        aiContext: options?.aiContext,
      });

      // Do not overwrite standard local cache with AI-filtered projections
      if (options?.aiContext) {
        set((prev) => {
          const nextLoading = { ...prev.loadingByConceptId };
          delete nextLoading[conceptId];
          return { loadingByConceptId: nextLoading };
        });
        return profile;
      }

      set((prev) => {
        const nextStale = { ...prev.staleConceptIds };
        delete nextStale[conceptId];
        const nextLoading = { ...prev.loadingByConceptId };
        delete nextLoading[conceptId];
        return {
          profilesByConceptId: {
            ...prev.profilesByConceptId,
            [conceptId]: profile,
          },
          staleConceptIds: nextStale,
          loadingByConceptId: nextLoading,
          highWaterSeq: Math.max(prev.highWaterSeq, getHighWaterSeq()),
        };
      });

      return profile;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((prev) => {
        const nextLoading = { ...prev.loadingByConceptId };
        delete nextLoading[conceptId];
        return {
          loadingByConceptId: nextLoading,
          error: message,
        };
      });
      throw err;
    }
  },

  loadConceptProfiles: async (conceptIds, options) => {
    set({ error: null });
    try {
      const profiles = await listConceptCompetencyProfiles({
        conceptIds,
        aiContext: options?.aiContext,
      });

      if (!options?.aiContext) {
        set((prev) => {
          const nextProfiles = { ...prev.profilesByConceptId };
          const nextStale = { ...prev.staleConceptIds };
          for (const profile of profiles) {
            nextProfiles[profile.conceptId] = profile;
            delete nextStale[profile.conceptId];
          }
          return {
            profilesByConceptId: nextProfiles,
            staleConceptIds: nextStale,
            highWaterSeq: Math.max(prev.highWaterSeq, getHighWaterSeq()),
          };
        });
      }

      return profiles;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    }
  },

  setDeclaration: async (conceptId, declaredLevel, note) => {
    const declaration = await setLearnerCompetencyDeclaration(
      conceptId,
      declaredLevel,
      note,
    );
    await get().loadConceptProfile(conceptId, { force: true });
    return declaration;
  },

  recordEvidence: async (input) => {
    const record = await recordCompetencyEvidence(input);
    get().invalidateConcept(input.conceptId);
    if (get().profilesByConceptId[input.conceptId]) {
      await get().loadConceptProfile(input.conceptId, { force: true });
    }
    return record;
  },

  invalidateConcept: (conceptId) => {
    set((prev) => ({
      staleConceptIds: { ...prev.staleConceptIds, [conceptId]: true },
    }));
  },

  invalidateAll: () => {
    set((prev) => {
      const nextStale: Record<string, boolean> = { ...prev.staleConceptIds };
      for (const conceptId of Object.keys(prev.profilesByConceptId)) {
        nextStale[conceptId] = true;
      }
      return { staleConceptIds: nextStale };
    });
  },

  connectLearningEventBus: () => {
    if (activeBusUnsubscribe) {
      return activeBusUnsubscribe;
    }

    const unsubscribe = subscribeLearningEvents(
      { eventTypes: COMPETENCY_INVALIDATING_EVENTS },
      (event) => {
        set((prev) => ({
          highWaterSeq: Math.max(prev.highWaterSeq, event.seq),
        }));

        const affectedConceptIds = extractConceptIdsFromEvent(event);
        if (affectedConceptIds.length === 0) {
          get().invalidateAll();
          return;
        }

        const cached = get().profilesByConceptId;
        for (const conceptId of affectedConceptIds) {
          get().invalidateConcept(conceptId);
          if (cached[conceptId]) {
            void get()
              .loadConceptProfile(conceptId, { force: true })
              .catch(() => {
                // Keep marked stale on transient refresh error
              });
          }
        }
      },
    );

    activeBusUnsubscribe = () => {
      unsubscribe();
      activeBusUnsubscribe = null;
      set({ isSubscribed: false });
    };

    set({
      isSubscribed: true,
      highWaterSeq: Math.max(get().highWaterSeq, getHighWaterSeq()),
    });

    return activeBusUnsubscribe;
  },

  reset: () => {
    if (activeBusUnsubscribe) {
      activeBusUnsubscribe();
    }
    set({
      profilesByConceptId: {},
      staleConceptIds: {},
      loadingByConceptId: {},
      error: null,
      highWaterSeq: 0,
      isSubscribed: false,
    });
  },
}));
