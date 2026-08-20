import { create } from "zustand";
import * as languageKnowledgeApi from "../api/languageKnowledge";
import type {
  LanguageKnowledgeStateChange,
  LanguageKnowledgeStateSnapshot,
} from "../types/languageKnowledge";

interface LanguageKnowledgeState {
  snapshots: Record<string, LanguageKnowledgeStateSnapshot>;
  loading: boolean;
  error: string | null;
  getStateForEntry: (profileId: string, entryId: string) => Promise<LanguageKnowledgeStateSnapshot>;
  resolveSurface: (profileId: string, surface: string) => Promise<LanguageKnowledgeStateSnapshot | null>;
  setState: (change: Omit<LanguageKnowledgeStateChange, "source">) => Promise<LanguageKnowledgeStateSnapshot>;
  setBatch: (changes: Omit<LanguageKnowledgeStateChange, "source">[]) => Promise<LanguageKnowledgeStateSnapshot[]>;
}

export const useLanguageKnowledgeStore = create<LanguageKnowledgeState>()((set) => ({
  snapshots: {},
  loading: false,
  error: null,
  getStateForEntry: async (profileId, entryId) => {
    set({ loading: true, error: null });
    try {
      const snapshot = await languageKnowledgeApi.getLanguageKnowledgeState(profileId, entryId);
      set((state) => ({ snapshots: { ...state.snapshots, [`${profileId}:${entryId}`]: snapshot }, loading: false }));
      return snapshot;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loading: false, error: message });
      throw error;
    }
  },
  resolveSurface: async (profileId, surface) => languageKnowledgeApi.resolveLanguageKnowledgeState(profileId, surface),
  setState: async (change) => {
    const snapshot = await languageKnowledgeApi.setLanguageKnowledgeState({ ...change, source: "manual" });
    set((state) => ({ snapshots: { ...state.snapshots, [`${snapshot.profileId}:${snapshot.lexicalEntryId}`]: snapshot } }));
    return snapshot;
  },
  setBatch: async (changes) => {
    const snapshots = await languageKnowledgeApi.setLanguageKnowledgeStatesBatch(changes.map((change) => ({ ...change, source: "manual" })));
    set((state) => ({ snapshots: { ...state.snapshots, ...Object.fromEntries(snapshots.map((snapshot) => [`${snapshot.profileId}:${snapshot.lexicalEntryId}`, snapshot])) } }));
    return snapshots;
  },
}));
