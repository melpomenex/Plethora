/**
 * Section-audio LRU tests (task 5.2): eviction order, revoke-on-replace,
 * byte/count bounds enforced, revoke-on-delete, and post-delete live URLs
 * for that edition at zero.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  SECTION_AUDIO_CACHE_MAX_BYTES,
  SECTION_AUDIO_CACHE_MAX_ENTRIES,
  getSectionAudioBlobCacheStats,
  getSectionAudioUrl,
  revokeSectionAudioUrls,
  sectionAudioBlobCache,
  setSectionAudioUrl,
} from "../audioEditionGenerationStore";
import { resetOwnedObjectUrlRegistryForTests } from "../../diagnostics/ownedObjectUrl";
import { deleteAudioEdition, createAudioEdition } from "../../api/audioEditions";
import type { AudioEdition, AudioEditionSection } from "../../types/audioEdition";

let revoked: string[] = [];
let urlCounter = 0;
let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

const enableGate = (on: boolean) => {
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = on;
};

beforeEach(() => {
  revoked = [];
  urlCounter = 0;
  // Revoke (not .clear()) so the internal byte-estimate map stays consistent.
  revokeSectionAudioUrls([...sectionAudioBlobCache.keys()]);
  resetOwnedObjectUrlRegistryForTests();
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (() => `blob:sec-${++urlCounter}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => revoked.push(url)) as typeof URL.revokeObjectURL;
  enableGate(true);
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  enableGate(false);
  vi.restoreAllMocks();
});

const track = (sectionId: string, bytes: number) => {
  const url = `blob:sec-${++urlCounter}`;
  setSectionAudioUrl(sectionId, url, bytes);
  return url;
};

describe("bounded section-audio LRU (5.2)", () => {
  it("enforces the documented count cap, evicting least-recently-used first", () => {
    const first = track("s1", 1000);
    const second = track("s2", 1000);
    // Fill exactly to the cap.
    for (let i = 0; i < SECTION_AUDIO_CACHE_MAX_ENTRIES - 2; i++) {
      track(`n${i}`, 1000);
    }
    // Refresh s1 (most recent now); overflow by one more → the LRU victim
    // is s2.
    expect(getSectionAudioUrl("s1")).toBe(first);
    track("overflow", 1000);
    expect(sectionAudioBlobCache.size).toBe(SECTION_AUDIO_CACHE_MAX_ENTRIES);
    expect(sectionAudioBlobCache.has("s2")).toBe(false);
    expect(revoked).toContain(second);
    // The touched s1 survived.
    expect(sectionAudioBlobCache.has("s1")).toBe(true);
  });

  it("enforces the documented byte cap but never evicts the last entry", () => {
    const big = 80 * 1024 * 1024;
    track("a", big);
    track("b", big);
    track("c", big); // 240 MB > 192 MB cap → "a" evicted
    expect(getSectionAudioBlobCacheStats().bytes).toBeLessThanOrEqual(SECTION_AUDIO_CACHE_MAX_BYTES);
    expect(sectionAudioBlobCache.has("a")).toBe(false);
    expect(sectionAudioBlobCache.has("c")).toBe(true);
    // A single oversized entry stays: playback must not be revoked from
    // under itself.
    revokeSectionAudioUrls([...sectionAudioBlobCache.keys()]);
    track("huge", 10 * SECTION_AUDIO_CACHE_MAX_BYTES);
    expect(sectionAudioBlobCache.size).toBe(1);
  });

  it("revokes the replaced URL when a section is re-synthesized (retry orphan)", () => {
    const oldUrl = track("s1", 100);
    const newUrl = track("s1", 120);
    expect(newUrl).not.toBe(oldUrl);
    expect(revoked).toContain(oldUrl);
    expect(sectionAudioBlobCache.get("s1")).toBe(newUrl);
    expect(getSectionAudioBlobCacheStats()).toEqual({ entries: 1, bytes: 120 });
  });

  it("revokeSectionAudioUrls drops exactly the listed sections", () => {
    const u1 = track("s1", 10);
    track("s2", 10);
    expect(revokeSectionAudioUrls(["s1", "s-unknown"])).toBe(1);
    expect(revoked).toContain(u1);
    expect(sectionAudioBlobCache.size).toBe(1);
  });
});

describe("edition deletion revokes live URLs (5.2)", () => {
  it("deleteAudioEdition leaves zero live URLs for that edition's sections", async () => {
    // jsdom defines window.__TAURI__, so the api goes down the invoke path;
    // answer the section-list command the way the real backend would.
    const { invoke } = await import("@tauri-apps/api/core");
    const now = Date.now();
    const edition: AudioEdition = {
      id: "ed-1",
      sourceDocumentId: "doc-1",
      sourceRevisionHash: "x",
      provider: "scenario-synth",
      model: "synth-1",
      voice: "scenario",
      generationSettings: null,
      totalDurationSec: 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };
    const sections: AudioEditionSection[] = [1, 2, 3].map((i) => ({
      id: `sec-${i}`,
      editionId: edition.id,
      sectionIndex: i - 1,
      title: `Section ${i}`,
      characterCount: 10,
      audioMimeType: "audio/mpeg",
      durationSec: 0,
      generationStatus: "ready",
      retryCount: 0,
      cacheKey: `k${i}`,
      createdAt: now,
      updatedAt: now,
    }));
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "get_audio_edition_sections" ? sections : undefined,
    );
    await createAudioEdition(edition, sections);

    const urls = sections.map((s) => track(s.id, 50));
    expect(sectionAudioBlobCache.size).toBe(3);
    expect(urls.length).toBe(3);

    await deleteAudioEdition(edition.id);

    expect(sectionAudioBlobCache.size).toBe(0); // teardown-to-zero
    for (const url of urls) {
      expect(revoked).toContain(url);
    }
  });
});
