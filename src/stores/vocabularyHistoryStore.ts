/**
 * Vocabulary lookup history (spec: vocabulary-lookup-history; change:
 * unify-selection-dictionary-lookup, design D9).
 *
 * Minimal, non-polluting local record of dictionary lookups: per word the
 * lookup count, first/last-seen timestamps and the last source document id.
 * Persisted to localStorage (`plethora-vocabulary-history`), LRU-bounded at
 * 2000 entries by `lastSeenAt`. Recording a lookup has NO learning-item or
 * queue side effects — this is purely the extension point a future Vocabulary
 * review mode reads. No passage text is ever stored.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { migrateLanguageLookupHistory } from "../api/languageLexicon";
import type { LegacyLookupRecord } from "../types/languageLexicon";

export const VOCABULARY_HISTORY_LIMIT = 2000;

export interface VocabularyHistoryEntry {
  word: string;
  lookupCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastDocumentId?: string;
}

export interface VocabularyHistoryState {
  /** Keyed by normalized (lowercased, trimmed) word. */
  entries: Record<string, VocabularyHistoryEntry>;
  recordLookup: (word: string, documentId?: string | null) => void;
  clearHistory: () => void;
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export const useVocabularyHistoryStore = create<VocabularyHistoryState>()(
  persist(
    (set, get) => ({
      entries: {},
      recordLookup: (word, documentId) => {
        const key = normalizeWord(word);
        if (!key) return;
        const now = Date.now();
        const previous = get().entries[key];
        const next: VocabularyHistoryEntry = {
          word: key,
          lookupCount: (previous?.lookupCount ?? 0) + 1,
          firstSeenAt: previous?.firstSeenAt ?? now,
          lastSeenAt: now,
          ...(documentId ? { lastDocumentId: documentId } : {}),
        };
        const entries = { ...get().entries, [key]: next };

        const keys = Object.keys(entries);
        if (keys.length > VOCABULARY_HISTORY_LIMIT) {
          // LRU eviction by lastSeenAt: drop the least-recently-seen overflow.
          const byRecency = keys.sort((a, b) => entries[a].lastSeenAt - entries[b].lastSeenAt);
          const evictCount = keys.length - VOCABULARY_HISTORY_LIMIT;
          for (let i = 0; i < evictCount; i += 1) delete entries[byRecency[i]];
        }
        set({ entries });
      },
      clearHistory: () => set({ entries: {} }),
    }),
    {
      name: "plethora-vocabulary-history",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);

/**
 * Readable list API for a future Vocabulary review surface: entries ordered
 * by recency (default) or lookup count, no schema changes needed.
 */
export function vocabularyHistoryList(
  state: Pick<VocabularyHistoryState, "entries">,
  sort: "recent" | "count" = "recent",
): VocabularyHistoryEntry[] {
  return Object.values(state.entries).sort((a, b) =>
    sort === "count" ? b.lookupCount - a.lookupCount : b.lastSeenAt - a.lastSeenAt,
  );
}

/** Explicit migration action used when a learner selects a language profile. */
export async function migrateLegacyVocabularyHistory(profileId: string): Promise<number> {
  const records: LegacyLookupRecord[] = Object.values(useVocabularyHistoryStore.getState().entries).map((entry) => ({
    word: entry.word,
    lookupCount: entry.lookupCount,
    firstSeenAt: Math.floor(entry.firstSeenAt / 1000),
    lastSeenAt: Math.floor(entry.lastSeenAt / 1000),
    lastDocumentId: entry.lastDocumentId,
  }));
  return migrateLanguageLookupHistory(profileId, records);
}
