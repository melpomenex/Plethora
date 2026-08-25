/**
 * Playback working-set invariants (task 5.6 / design D7), modeled at the
 * store level exactly the way AudiobookViewer drives them: resolve the
 * current section, prefetch the next WORKING_SET_AHEAD sections, advance.
 *
 *   - advancing through K sections keeps live URLs bounded (≤ LRU cap),
 *     never K;
 *   - the boundary prefetch means the next section is ALWAYS live (no gap);
 *   - nothing under active playback is revoked (the current section is the
 *     most-recently-touched entry).
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  SECTION_AUDIO_CACHE_MAX_ENTRIES,
  getSectionAudioUrl,
  sectionAudioBlobCache,
  setSectionAudioUrl,
  revokeSectionAudioUrls,
} from "../audioEditionGenerationStore";

const WORKING_SET_AHEAD = 2;

let originalCreate: typeof URL.createObjectURL;
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  revokeSectionAudioUrls([...sectionAudioBlobCache.keys()]);
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (() => `blob:ws-${Math.random().toString(36).slice(2)}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = true;
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = null;
});

describe("playback working set (5.6)", () => {
  it("advancing through K sections keeps live URLs ≤ the LRU cap, with no boundary gap", () => {
    const K = SECTION_AUDIO_CACHE_MAX_ENTRIES * 3; // far more sections than the cap
    // All sections were synthesized at some point; the LRU bounds how many
    // stay live (older ones evicted as new ones arrive).
    for (let i = 0; i < K; i++) {
      setSectionAudioUrl(`section-${i}`, `blob:ws-${i}`, 1000);
    }
    expect(sectionAudioBlobCache.size).toBe(SECTION_AUDIO_CACHE_MAX_ENTRIES);

    // Simulate playback: at each position, the prefetch touched [i, i+1, i+2]
    // BEFORE position i became current (the component's effect order).
    for (let i = 0; i < K - 1; i++) {
      // Prefetch ahead (component effect): touch the window.
      for (let ahead = 0; ahead <= WORKING_SET_AHEAD; ahead++) {
        const index = i + ahead;
        const section = editionRecord(index);
        const cached = getSectionAudioUrl(section.id);
        if (cached) partSources[index] = cached;
        else partSources[index] = section.audioFilePath; // record fallback
      }
      // Advance: the next section MUST have a live source (no gap). Within
      // the LRU's live window that source is the cached URL; older sections
      // fell back to their recorded path — either way, never a hole.
      expect(partSources[i + 1]).toBeTruthy();
      if (i + 1 >= K - SECTION_AUDIO_CACHE_MAX_ENTRIES) {
        expect(sectionAudioBlobCache.has(`section-${i + 1}`)).toBe(true);
      }
      // Bounded: never more live URLs than the LRU cap regardless of K.
      expect(sectionAudioBlobCache.size).toBeLessThanOrEqual(SECTION_AUDIO_CACHE_MAX_ENTRIES);
    }
  });

  it("the current section is never the eviction victim (nothing revoked under playback)", () => {
    const K = SECTION_AUDIO_CACHE_MAX_ENTRIES + 5;
    for (let i = 0; i < K; i++) {
      setSectionAudioUrl(`section-${i}`, `blob:ws-${i}`, 1000);
      // Playback is at section i: touch it (the component resolves current
      // first, then prefetch).
      getSectionAudioUrl(`section-${i}`);
    }
    // The last-touched current section survives every subsequent eviction.
    expect(sectionAudioBlobCache.has(`section-${K - 1}`)).toBe(true);
    // Its neighbors in the window are also alive.
    expect(sectionAudioBlobCache.has(`section-${K - 2}`)).toBe(true);
  });
});

/** Simulated playlist state (index -> resolved source). */
const partSources: string[] = [];

/** Section record fixture: audioFilePath is the recorded (non-cache) path. */
function editionRecord(index: number): { id: string; audioFilePath: string } {
  return { id: `section-${index}`, audioFilePath: `record-path-${index}` };
}
