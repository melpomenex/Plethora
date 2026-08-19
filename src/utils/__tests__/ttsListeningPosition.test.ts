/**
 * Integration tests for TTS listening-position persistence (#2): save/flush/
 * restore round-trips (localStorage fallback — jsdom has no IndexedDB),
 * per-document independence, fingerprint-based reconciliation against a
 * (re)built speech index, and the sync unload write.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ReaderSpeechIndex, type SpeechSectionInput } from "../readerSpeechIndex";
import {
  clearTTSListeningPosition,
  flushPendingListeningPosition,
  getProfileId,
  getTTSListeningPosition,
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
    chunkTextHash: "",
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

describe("ttsListeningPosition", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("saves and restores the exact chunk+word via the localStorage fallback", async () => {
    const index = makeIndex();
    const chunkIdx = Math.min(2, index.chunks.length - 1);
    const wordIdx = 3;

    const pos = makePosition("doc-a", index, chunkIdx, wordIdx, { chunkTextHash: "" });
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
    // Throttled (non-flush) write: lands in the pending slot.
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

  it("reconciles a persisted position against a changed document via nearest anchor", async () => {
    const original = makeIndex();
    const saved = makePosition("doc-c", original, 0, 0);
    // Document regenerated between sessions: same surface but new offsets/text.
    const regenerated = makeIndex(
      "Beta gamma delta epsilon zeta theta. Iota kappa lambda mu nu xi omicron. " +
        "Pi rho sigma tau upsilon phi chi psi omega omega omega.",
    );
    const resolved = resolveListeningPosition(regenerated, saved);
    // Nearest resolvable position (never null, never the session start chunk 0
    // when the anchor resolves to a later chunk).
    expect(resolved).not.toBeNull();
    expect(resolved!.chunkIndex).toBeGreaterThanOrEqual(0);
    expect(resolved!.chunkIndex).toBeLessThan(regenerated.chunks.length);
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
