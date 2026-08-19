/**
 * Integration tests for TTS listening-position persistence (#2): save/flush/
 * restore round-trips (localStorage fallback — jsdom has no IndexedDB),
 * per-document independence, nearest-anchor reconciliation against a (re)built
 * speech index, the sync unload write, and freshest-record selection when both
 * the IndexedDB and localStorage backends hold a record.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ReaderSpeechIndex, type SpeechSectionInput } from "../readerSpeechIndex";
import { digestText128 } from "../ttsCache";
import {
  clearTTSListeningPosition,
  flushPendingListeningPosition,
  getProfileId,
  getTTSListeningPosition,
  resetTTSListeningPositionState,
  resolveListeningPosition,
  saveTTSListeningPosition,
  writeListeningPositionSync,
  fingerprintDocument,
  type TTSListeningPosition,
} from "../ttsListeningPosition";

const SECTIONS: SpeechSectionInput[] = [
  {
    key: "doc",
    text: Array.from(
      { length: 10 },
      (_, i) =>
        `Section ${i} alpha beta gamma delta epsilon zeta eta theta iota kappa. ` +
        `Lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.`,
    ).join(" "),
    anchorAt: (offset) => ({ kind: "text", surface: "test", startOffset: offset }),
    offsetForAnchor: (anchor) =>
      anchor.kind === "text" && anchor.surface === "test" ? anchor.startOffset : null,
  },
];

function makeIndex(text = SECTIONS[0].text): ReaderSpeechIndex {
  return new ReaderSpeechIndex([{ ...SECTIONS[0], text }]);
}

function makePosition(
  documentId: string,
  index: ReaderSpeechIndex,
  chunkIndex: number,
  wordIndex: number,
  overrides: Partial<TTSListeningPosition> = {},
): TTSListeningPosition {
  const chunk = index.chunks[Math.min(chunkIndex, index.chunks.length - 1)];
  const word = chunk.words[Math.min(wordIndex, chunk.words.length - 1)];
  const normStart = word?.normStart ?? 0;
  const normEnd = word?.normEnd ?? normStart;
  return {
    documentId,
    profileId: getProfileId(),
    updatedAt: Date.now(),
    textFingerprint: fingerprintDocument(SECTIONS[0].text),
    speechFingerprint: "",
    provider: "fal",
    model: "fal-ai/qwen-3-tts",
    voiceId: "voice-1",
    stableAnchor: { kind: "text", surface: "test", startOffset: word?.sectionOffset ?? 0 },
    chunkIndex,
    chunkTextHash: digestText128(chunk.text),
    wordIndex,
    normalizedCharOffset: word?.sectionOffset ?? 0,
    intraChunkMs: 1200,
    surroundingText: chunk.text.slice(Math.max(0, normStart - 60), Math.min(chunk.text.length, normEnd + 60)),
    scrollPercentHint: null,
    cfi: null,
    pageNumber: null,
    ...overrides,
  };
}

/**
 * Minimal IndexedDB mock so the module's IDB path can hold a record alongside
 * the localStorage fallback (jsdom ships no IndexedDB). `records` is keyed by
 * the store id (`<profile>::<documentId>`).
 */
function mockIndexedDB(records: Map<string, TTSListeningPosition>): void {
  (globalThis as any).indexedDB = {
    open: () => {
      const req: any = { result: null, error: null };
      req.onupgradeneeded = null;
      req.onsuccess = null;
      req.onerror = null;
      const db = {
        transaction: () => ({
          objectStore: () => ({
            get: (id: string) => {
              const getReq: any = {
                onsuccess: null,
                onerror: null,
                result: records.get(id) ? { id, value: records.get(id) } : undefined,
              };
              queueMicrotask(() => getReq.onsuccess?.());
              return getReq;
            },
          }),
        }),
      };
      req.result = db;
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
}

describe("ttsListeningPosition", () => {
  beforeEach(() => {
    resetTTSListeningPositionState();
    localStorage.clear();
  });

  afterEach(() => {
    resetTTSListeningPositionState();
    localStorage.clear();
    delete (globalThis as any).indexedDB;
  });

  it("saves and restores the exact chunk+word via the localStorage fallback", async () => {
    const index = makeIndex();
    const chunkIdx = Math.min(2, index.chunks.length - 1);
    const wordIdx = 3;

    const pos = makePosition("doc-a", index, chunkIdx, wordIdx);
    await saveTTSListeningPosition(pos, { flush: true });

    const restored = await getTTSListeningPosition("doc-a");
    expect(restored).not.toBeNull();
    expect(restored!.documentId).toBe("doc-a");
    expect(restored!.chunkIndex).toBe(chunkIdx);
    expect(restored!.wordIndex).toBe(wordIdx);

    const resolved = resolveListeningPosition(index, restored!);
    expect(resolved).not.toBeNull();
    expect(resolved!.chunkIndex).toBe(chunkIdx);
    expect(resolved!.wordIndex).toBe(wordIdx);
  });

  it("throttled save is flushed on demand (restart reads the latest position)", async () => {
    const index = makeIndex();
    const first = makePosition("doc-b", index, 0, 1);
    // Throttled (non-flush) write: with the reset throttle state this always
    // lands in the pending slot (deterministic, not order-dependent).
    await saveTTSListeningPosition(first, { flush: false });
    // A later throttled update supersedes the pending record without persisting yet.
    const second = makePosition("doc-b", index, 1, 0, { intraChunkMs: 555 });
    await saveTTSListeningPosition(second, { flush: false });
    expect(await getTTSListeningPosition("doc-b")).toBeNull();

    // Restart/unload flushes the pending record.
    await flushPendingListeningPosition();
    const restored = await getTTSListeningPosition("doc-b");
    expect(restored).not.toBeNull();
    expect(restored!.chunkIndex).toBe(1);
    expect(restored!.intraChunkMs).toBe(555);
  });

  it("keeps per-document positions independent", async () => {
    const index = makeIndex();
    const last = index.chunks.length - 1;
    await saveTTSListeningPosition(makePosition("doc-a", index, 2, 0), { flush: true });
    await saveTTSListeningPosition(makePosition("doc-b", index, last, 0), { flush: true });

    const a = await getTTSListeningPosition("doc-a");
    const b = await getTTSListeningPosition("doc-b");
    expect(a!.chunkIndex).toBe(2);
    expect(b!.chunkIndex).toBe(last);
    // Clearing one document does not affect the other.
    await clearTTSListeningPosition("doc-a");
    expect(await getTTSListeningPosition("doc-a")).toBeNull();
    expect((await getTTSListeningPosition("doc-b"))!.chunkIndex).toBe(last);
  });

  it("rejects an exact anchor when the chunk text hash no longer matches (nearest-anchor fallback)", async () => {
    const index = makeIndex();
    const chunkIdx = Math.min(2, index.chunks.length - 1);
    // The anchor still locates, but the stored chunk hash no longer matches
    // the current chunk text (document regenerated) → exact-word resolution
    // must be rejected in favor of the nearest resolvable chunk.
    const saved = makePosition("doc-c", index, chunkIdx, 3, { chunkTextHash: "0".repeat(32) });
    const resolved = resolveListeningPosition(index, saved);
    expect(resolved).not.toBeNull();
    expect(resolved!.wordIndex).toBe(0);
    const foldedChunk = index.chunks[resolved!.chunkIndex].text.replace(/\s+/g, " ").toLowerCase();
    expect(foldedChunk).toContain(saved.surroundingText.slice(0, 20).toLowerCase());
  });

  it("resolves to the nearest existing chunk when the anchor no longer exists", async () => {
    const index = makeIndex();
    const chunkIdx = Math.min(2, index.chunks.length - 1);
    const saved = makePosition("doc-c", index, chunkIdx, 3, {
      stableAnchor: { kind: "text", surface: "gone", startOffset: 0 },
    });
    const resolved = resolveListeningPosition(index, saved);
    // Unresolvable anchor → the chunk still containing the surrounding text.
    expect(resolved).not.toBeNull();
    expect(resolved!.wordIndex).toBe(0);
    const foldedChunk = index.chunks[resolved!.chunkIndex].text.replace(/\s+/g, " ").toLowerCase();
    expect(foldedChunk).toContain(saved.surroundingText.slice(0, 20).toLowerCase());
  });

  it("returns the exact word when the stored chunk hash still matches", async () => {
    const index = makeIndex();
    const chunkIdx = Math.min(2, index.chunks.length - 1);
    const saved = makePosition("doc-c", index, chunkIdx, 3);
    const resolved = resolveListeningPosition(index, saved);
    expect(resolved).toEqual({ chunkIndex: chunkIdx, wordIndex: 3 });
  });

  it("writeListeningPositionSync persists for unload and is readable after restart", async () => {
    const index = makeIndex();
    const pos = makePosition("doc-d", index, 1, 2);
    writeListeningPositionSync(pos);

    const restored = await getTTSListeningPosition("doc-d");
    expect(restored).not.toBeNull();
    expect(restored!.chunkIndex).toBe(1);
    expect(restored!.wordIndex).toBe(2);
  });

  it("restores the freshest record when IndexedDB and localStorage disagree (unload sync write wins)", async () => {
    const index = makeIndex();
    const staleIdb = makePosition("doc-f", index, 1, 0, { updatedAt: 1000 });
    mockIndexedDB(new Map([["anon::doc-f", staleIdb]]));

    // The unload handler writes the NEWER exact position synchronously to
    // localStorage; the async IDB write may have been throttled/stale.
    const freshLocal = makePosition("doc-f", index, 7, 2, { updatedAt: 9999 });
    writeListeningPositionSync(freshLocal);

    const restored = await getTTSListeningPosition("doc-f");
    expect(restored).not.toBeNull();
    expect(restored!.chunkIndex).toBe(7);
    expect(restored!.wordIndex).toBe(2);
  });

  it("restores the freshest record when IndexedDB is newer than localStorage", async () => {
    const index = makeIndex();
    const freshIdb = makePosition("doc-g", index, 9, 1, { updatedAt: 9999 });
    mockIndexedDB(new Map([["anon::doc-g", freshIdb]]));
    const staleLocal = makePosition("doc-g", index, 0, 0, { updatedAt: 100 });
    writeListeningPositionSync(staleLocal);

    const restored = await getTTSListeningPosition("doc-g");
    expect(restored).not.toBeNull();
    expect(restored!.chunkIndex).toBe(9);
  });

  it("namespaces by profile id", async () => {
    expect(getProfileId()).toBe("anon");
    localStorage.setItem("plethora_user", JSON.stringify({ id: "p-42" }));
    expect(getProfileId()).toBe("u:p-42");
    // The same document under a different profile resolves to a different key.
    const index = makeIndex();
    await saveTTSListeningPosition(makePosition("doc-e", index, 1, 0), { flush: true });
    expect((await getTTSListeningPosition("doc-e", "u:p-42"))!.chunkIndex).toBe(1);
    // Default profile (anon) has no record for this document under the other key.
    localStorage.setItem("plethora_user", JSON.stringify({ id: "other" }));
    expect(await getTTSListeningPosition("doc-e")).toBeNull();
  });
});
