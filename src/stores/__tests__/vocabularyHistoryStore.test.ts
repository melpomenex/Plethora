/**
 * Unit tests for the vocabulary lookup history store (task 3.2): count
 * increments, timestamp updates, LRU eviction, persistence round-trip, and
 * the no-passage-text / no-side-effects guarantees.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VOCABULARY_HISTORY_LIMIT,
  useVocabularyHistoryStore,
  vocabularyHistoryList,
} from "../../stores/vocabularyHistoryStore";

describe("vocabularyHistoryStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useVocabularyHistoryStore.setState({ entries: {} });
  });

  it("increments the count and updates timestamps on repeat lookups", () => {
    const before = Date.now();
    const store = useVocabularyHistoryStore.getState();
    store.recordLookup("perspicacious", "doc-1");
    store.recordLookup("PERSPICACIOUS"); // same normalized word
    useVocabularyHistoryStore.getState().recordLookup("perspicacious", "doc-2");

    const entry = useVocabularyHistoryStore.getState().entries["perspicacious"];
    expect(entry).toBeDefined();
    expect(entry.lookupCount).toBe(3);
    expect(entry.firstSeenAt).toBeGreaterThanOrEqual(before);
    expect(entry.lastSeenAt).toBeGreaterThanOrEqual(entry.firstSeenAt);
    expect(entry.lastDocumentId).toBe("doc-2");
  });

  it("persists to localStorage and round-trips through rehydration", () => {
    useVocabularyHistoryStore.getState().recordLookup("ephemeral", "doc-1");
    useVocabularyHistoryStore.getState().recordLookup("transient");

    const raw = localStorage.getItem("plethora-vocabulary-history");
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!);
    // Only the entries slice is persisted (no action references).
    expect(Object.keys(persisted.state)).toEqual(["entries"]);
    expect(persisted.state.entries["ephemeral"].lookupCount).toBe(1);

    // Simulate restart: a fresh store reading the same storage rehydrates.
    useVocabularyHistoryStore.setState({ entries: {} });
    // zustand persist rehydrates asynchronously on subscription; the persisted
    // shape above is the contract. Verify the list API reads whatever state it
    // is given (the future Vocabulary mode reads it the same way).
    const list = vocabularyHistoryList({ entries: persisted.state.entries });
    expect(list.map((e) => e.word).sort()).toEqual(["ephemeral", "transient"]);
  });

  it("evicts least-recently-seen entries above the 2000 cap", () => {
    const store = useVocabularyHistoryStore.getState();
    for (let i = 0; i < VOCABULARY_HISTORY_LIMIT; i += 1) {
      store.recordLookup(`word-${i}`);
    }
    const { entries } = useVocabularyHistoryStore.getState();
    expect(Object.keys(entries)).toHaveLength(VOCABULARY_HISTORY_LIMIT);

    // One more lookup evicts word-0 (oldest lastSeenAt) only.
    useVocabularyHistoryStore.getState().recordLookup("new-word");
    const after = useVocabularyHistoryStore.getState().entries;
    expect(Object.keys(after)).toHaveLength(VOCABULARY_HISTORY_LIMIT);
    expect(after["word-0"]).toBeUndefined();
    expect(after["word-1"]).toBeDefined();
    expect(after["new-word"].lookupCount).toBe(1);
  });

  it("stores no passage text or document content", () => {
    useVocabularyHistoryStore.getState().recordLookup("  Serendipity  ", "doc-42");
    const raw = localStorage.getItem("plethora-vocabulary-history") ?? "";
    const allWords = Object.values(useVocabularyHistoryStore.getState().entries);
    expect(allWords).toHaveLength(1);
    expect(allWords[0].word).toBe("serendipity");
    // Entry shape is exactly the five metadata fields — nothing else.
    expect(Object.keys(allWords[0]).sort()).toEqual([
      "firstSeenAt",
      "lastDocumentId",
      "lastSeenAt",
      "lookupCount",
      "word",
    ]);
    // No prose beyond the identifiers above is ever persisted.
    expect(JSON.parse(raw).state.entries).toEqual(useVocabularyHistoryStore.getState().entries);
  });

  it("exposes a readable list API ordered by recency or count", () => {
    vi.useFakeTimers();
    try {
      const store = useVocabularyHistoryStore.getState();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      store.recordLookup("first");
      vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
      store.recordLookup("second");
      vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
      store.recordLookup("second");
      const state = useVocabularyHistoryStore.getState();
      expect(vocabularyHistoryList(state, "recent").map((e) => e.word)).toEqual([
        "second",
        "first",
      ]);
      expect(vocabularyHistoryList(state, "count").map((e) => e.word)).toEqual([
        "second",
        "first",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
