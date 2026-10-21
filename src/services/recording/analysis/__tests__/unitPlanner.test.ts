import { describe, expect, it } from "vitest";
import {
  calculateTokenBudget,
  getRecommendedConcurrency,
  hashUnitInput,
  planSummaryTree,
  planTranscriptUnits,
  sha256Sync,
  splitOversizeSegment,
  DEFAULT_MAX_OVERVIEW_REQUESTS,
  DEFAULT_MAX_SECTION_REQUESTS,
  MAX_AVAILABLE_TOKENS,
  MAX_CONTEXT_OVERLAP_TOKENS,
  MAX_SOURCE_TOKENS,
  MIN_AVAILABLE_TOKENS,
} from "../unitPlanner";
import type { SessionTranscriptSegment } from "../../../../types/recordingSession";

describe("unitPlanner (Task 3.3, Design D8)", () => {
  describe("calculateTokenBudget", () => {
    it("refuses context windows where available source tokens < 512", () => {
      // Small context: 1024 context, 600 system
      // outputReserve = min(1500, floor(1024 / 3)) = 341
      // available = 1024 - 600 - 341 - 256 = -173 < 512
      const budget = calculateTokenBudget({
        contextTokens: 1024,
        systemTokens: 600,
      });

      expect(budget.fits).toBe(false);
      expect(budget.maxSourceTokens).toBe(0);
      expect(budget.error).toContain("Insufficient context window");
      expect(budget.available).toBeLessThan(MIN_AVAILABLE_TOKENS);
    });

    it("accepts exactly 512 available tokens at boundary", () => {
      // We want rawAvailable = 512
      // contextTokens - systemTokens - outputReserve - 256 = 512
      // e.g. contextTokens = 2400
      // outputReserve = min(1500, floor(2400/3)) = 800
      // 2400 - systemTokens - 800 - 256 = 512 => systemTokens = 832
      const budget = calculateTokenBudget({
        contextTokens: 2400,
        systemTokens: 832,
      });

      expect(budget.fits).toBe(true);
      expect(budget.available).toBe(512);
      expect(budget.maxSourceTokens).toBe(512);
      expect(budget.error).toBeUndefined();
    });

    it("caps available at 6000 and maxSourceTokens at 2000 for large cloud models", () => {
      // 128k context, 1000 system
      const budget = calculateTokenBudget({
        contextTokens: 128000,
        systemTokens: 1000,
      });

      expect(budget.fits).toBe(true);
      expect(budget.outputReserve).toBe(1500); // capped at 1500
      expect(budget.safetyReserve).toBe(256);
      expect(budget.available).toBe(MAX_AVAILABLE_TOKENS); // capped at 6000
      expect(budget.maxSourceTokens).toBe(MAX_SOURCE_TOKENS); // capped at 2000
    });

    it("correctly handles typical on-device Gemini Nano context (4096 tokens)", () => {
      // 4096 context, 800 system
      // outputReserve = floor(4096 / 3) = 1365
      // available = min(4096 - 800 - 1365 - 256, 6000) = 1675
      const budget = calculateTokenBudget({
        contextTokens: 4096,
        systemTokens: 800,
      });

      expect(budget.fits).toBe(true);
      expect(budget.outputReserve).toBe(1365);
      expect(budget.available).toBe(1675);
      expect(budget.maxSourceTokens).toBe(1675);
    });
  });

  describe("getRecommendedConcurrency", () => {
    it("limits mobile to 1 heavy task", () => {
      expect(getRecommendedConcurrency({ isMobile: true })).toBe(1);
      expect(getRecommendedConcurrency({ isMobile: true, isRecordingOrSttActive: false })).toBe(1);
    });

    it("allows desktop 2 concurrent tasks when idle, 1 when recording/STT active", () => {
      expect(getRecommendedConcurrency({ isMobile: false, isRecordingOrSttActive: false })).toBe(2);
      expect(getRecommendedConcurrency({ isMobile: false, isRecordingOrSttActive: true })).toBe(1);
    });
  });

  describe("splitOversizeSegment", () => {
    it("returns single range if segment text fits within maxSourceTokens", () => {
      const seg: SessionTranscriptSegment = {
        segmentKey: "seg-1",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        text: "This is a brief sentence that fits easily.",
        timing: { kind: "measured", startMs: 0, endMs: 2000 },
      };

      const ranges = splitOversizeSegment(seg, 500);
      expect(ranges).toHaveLength(1);
      expect(ranges[0].segmentKey).toBe("seg-1");
      expect(ranges[0].startUtf16).toBe(0);
      expect(ranges[0].endUtf16).toBe(seg.text.length);
      expect(ranges[0].text).toBe(seg.text);
    });

    it("splits massive paragraph across sentence boundaries with exact code-unit ranges", () => {
      const s1 = "First sentence of the long lecture explanation. ";
      const s2 = "Second sentence diving deeply into cell biology mechanisms. ";
      const s3 = "Third sentence outlining mitochondria and ATP synthesis. ";
      const s4 = "Fourth sentence summarizing energy conversion in organisms.";
      const longText = (s1 + s2 + s3 + s4).repeat(5);

      const seg: SessionTranscriptSegment = {
        segmentKey: "seg-huge",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        text: longText,
        timing: { kind: "measured", startMs: 0, endMs: 30000 },
      };

      // Set maxSourceTokens small so it splits
      const maxTokens = 40; // 160 characters
      const ranges = splitOversizeSegment(seg, maxTokens);

      expect(ranges.length).toBeGreaterThan(1);

      // Verify every range retains segmentKey and contiguous code units
      let reconstructed = "";
      let expectedStart = 0;
      for (const r of ranges) {
        expect(r.segmentKey).toBe("seg-huge");
        expect(r.startUtf16).toBe(expectedStart);
        expect(r.endUtf16).toBeGreaterThan(r.startUtf16);
        expect(r.text).toBe(longText.slice(r.startUtf16, r.endUtf16));
        reconstructed += r.text;
        expectedStart = r.endUtf16;
      }
      expect(reconstructed).toBe(longText);
    });

    it("preserves Unicode astral code points (surrogate pairs) without splitting them", () => {
      const emojiParagraph = "Key point 🌟🔬🚀. ".repeat(20);
      const seg: SessionTranscriptSegment = {
        segmentKey: "seg-emoji",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        text: emojiParagraph,
        timing: { kind: "none" },
      };

      const ranges = splitOversizeSegment(seg, 25);
      expect(ranges.length).toBeGreaterThan(1);

      for (const r of ranges) {
        // Validate that no range starts with a low surrogate or ends with a high surrogate
        const startCode = r.text.charCodeAt(0);
        const endCode = r.text.charCodeAt(r.text.length - 1);
        expect(startCode >= 0xdc00 && startCode <= 0xdfff).toBe(false);
        expect(endCode >= 0xd800 && endCode <= 0xdbff).toBe(false);
      }

      const reconstructed = ranges.map((r) => r.text).join("");
      expect(reconstructed).toBe(emojiParagraph);
    });
  });

  describe("planTranscriptUnits", () => {
    const defaultBudget = calculateTokenBudget({
      contextTokens: 8192,
      systemTokens: 1000,
    });

    it("throws if budget does not fit", () => {
      const badBudget = calculateTokenBudget({
        contextTokens: 500,
        systemTokens: 400,
      });

      expect(() =>
        planTranscriptUnits([], { budget: badBudget })
      ).toThrow("Insufficient context window");
    });

    it("returns empty result for empty segments", () => {
      const result = planTranscriptUnits([], { budget: defaultBudget });
      expect(result.units).toHaveLength(0);
      expect(result.totalPlannedUnits).toBe(0);
      expect(result.deferredUnitsCount).toBe(0);
      expect(result.hasDeferredUnits).toBe(false);
    });

    it("packs small segments into a single unit without context overlap", () => {
      const segments: SessionTranscriptSegment[] = [
        {
          segmentKey: "seg-1",
          transcriptId: 1,
          ordinal: 0,
          revision: 1,
          text: "Hello everyone, welcome to the course.",
          timing: { kind: "measured", startMs: 0, endMs: 2500 },
        },
        {
          segmentKey: "seg-2",
          transcriptId: 1,
          ordinal: 1,
          revision: 1,
          text: "Today we will study differential equations.",
          timing: { kind: "measured", startMs: 2600, endMs: 5500 },
        },
      ];

      const result = planTranscriptUnits(segments, { budget: defaultBudget });

      expect(result.units).toHaveLength(1);
      const u0 = result.units[0];
      expect(u0.unitIndex).toBe(0);
      expect(u0.unitKey).toBe("unit-0");
      expect(u0.ownedSegmentKeys).toEqual(["seg-1", "seg-2"]);
      expect(u0.ownedRanges).toHaveLength(2);
      expect(u0.contextOverlap).toBeUndefined();
      expect(u0.timing).toEqual({
        kind: "measured",
        startMs: 0,
        endMs: 5500,
      });
      expect(u0.inputHash).toBeTruthy();
    });

    it("generates context overlap (<= 128 tokens) for subsequent units and preserves ownership integrity", () => {
      // Create segments that exceed 1 unit
      const tightBudget = calculateTokenBudget({
        contextTokens: 2500,
        systemTokens: 500,
      }); // maxSourceTokens approx 911 tokens

      const segments: SessionTranscriptSegment[] = [];
      // 80 segments * ~22 tokens = ~1760 tokens, exceeding 911 tokens
      for (let i = 0; i < 80; i++) {
        segments.push({
          segmentKey: `seg-${i}`,
          transcriptId: 1,
          ordinal: i,
          revision: 1,
          text: `Detailed discussion on topic ${i} explaining fundamental theorems with various applications. `,
          timing: { kind: "measured", startMs: i * 5000, endMs: (i + 1) * 5000 },
        });
      }

      const result = planTranscriptUnits(segments, {
        budget: tightBudget,
        contextOverlapTokens: 64,
      });

      expect(result.units.length).toBeGreaterThan(1);

      const u0 = result.units[0];
      const u1 = result.units[1];

      expect(u0.contextOverlap).toBeUndefined();
      expect(u1.contextOverlap).toBeDefined();

      // Overlap must be bounded by contextOverlapTokens
      expect(u1.contextOverlap!.estimatedTokens).toBeLessThanOrEqual(64);

      // Ownership integrity: u1 ownedSegmentKeys must NOT include context-only overlap segments
      // unless u1 also has owned ranges in them.
      for (const ownedKey of u1.ownedSegmentKeys) {
        expect(u0.ownedSegmentKeys).not.toContain(ownedKey);
      }

      // Check text in overlap is from tail of u0
      expect(u0.ownedText).toContain(u1.contextOverlap!.text.trim());
    });

    it("truthfully handles untimed transcripts with timing: { kind: 'none' } and no synthetic 0 timestamps", () => {
      const segments: SessionTranscriptSegment[] = [
        {
          segmentKey: "seg-untimed-1",
          transcriptId: 1,
          ordinal: 0,
          revision: 1,
          text: "Untimed transcript imported from text file.",
          timing: { kind: "none" },
        },
        {
          segmentKey: "seg-untimed-2",
          transcriptId: 1,
          ordinal: 1,
          revision: 1,
          text: "Second untimed paragraph discussing software architecture.",
          timing: { kind: "none" },
        },
      ];

      const result = planTranscriptUnits(segments, { budget: defaultBudget });
      expect(result.units).toHaveLength(1);
      expect(result.units[0].timing).toEqual({ kind: "none" });
      expect((result.units[0].timing as any).startMs).toBeUndefined();
      expect((result.units[0].timing as any).endMs).toBeUndefined();
    });

    it("defers units beyond maxSectionRequests (cap: 64)", () => {
      // Generate enough segments to produce > 64 units
      // Using tightBudget with maxSourceTokens = 512
      const tightBudget = calculateTokenBudget({
        contextTokens: 2400,
        systemTokens: 832,
      }); // maxSourceTokens = 512
      const segments: SessionTranscriptSegment[] = [];
      // 80 segments of ~500 tokens each
      const paragraph = "The algorithm converges under standard regularity conditions. ".repeat(25); // ~1500 chars = ~375 tokens
      for (let i = 0; i < 90; i++) {
        segments.push({
          segmentKey: `seg-${i}`,
          transcriptId: 1,
          ordinal: i,
          revision: 1,
          text: paragraph,
          timing: { kind: "measured", startMs: i * 10000, endMs: (i + 1) * 10000 },
        });
      }

      const result = planTranscriptUnits(segments, {
        budget: tightBudget,
        maxSectionRequests: 64,
      });

      expect(result.units.length).toBe(64);
      expect(result.totalPlannedUnits).toBeGreaterThan(64);
      expect(result.deferredUnitsCount).toBe(result.totalPlannedUnits - 64);
      expect(result.hasDeferredUnits).toBe(true);
    });

    it("produces deterministic unit keys and stable input hashes across restarts", () => {
      const segments: SessionTranscriptSegment[] = [
        {
          segmentKey: "seg-a",
          transcriptId: 1,
          ordinal: 0,
          revision: 2,
          text: "Deterministic input hash verification segment A.",
          timing: { kind: "measured", startMs: 0, endMs: 3000 },
        },
        {
          segmentKey: "seg-b",
          transcriptId: 1,
          ordinal: 1,
          revision: 2,
          text: "Deterministic input hash verification segment B.",
          timing: { kind: "measured", startMs: 3000, endMs: 6000 },
        },
      ];

      const run1 = planTranscriptUnits(segments, {
        budget: defaultBudget,
        transcriptRevision: 2,
      });
      const run2 = planTranscriptUnits(segments, {
        budget: defaultBudget,
        transcriptRevision: 2,
      });

      expect(run1.units).toHaveLength(run2.units.length);
      expect(run1.units[0].unitKey).toBe(run2.units[0].unitKey);
      expect(run1.units[0].inputHash).toBe(run2.units[0].inputHash);

      // Changing revision changes inputHash
      const runDiffRev = planTranscriptUnits(segments, {
        budget: defaultBudget,
        transcriptRevision: 3,
      });
      expect(runDiffRev.units[0].inputHash).not.toBe(run1.units[0].inputHash);
    });
  });

  describe("sha256Sync & hashUnitInput", () => {
    it("hashes known test strings matching standard SHA-256 test vectors", () => {
      expect(sha256Sync("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
      expect(sha256Sync("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });

    it("hashUnitInput returns identical hash for identical payload and differs when content changes", () => {
      const payload1 = {
        unitKey: "unit-0",
        transcriptRevision: 1,
        ownedRanges: [{ segmentKey: "seg-1", startUtf16: 0, endUtf16: 15 }],
        ownedText: "Sample text one",
      };

      const payload2 = {
        unitKey: "unit-0",
        transcriptRevision: 1,
        ownedRanges: [{ segmentKey: "seg-1", startUtf16: 0, endUtf16: 15 }],
        ownedText: "Sample text one",
      };

      const payloadModified = {
        unitKey: "unit-0",
        transcriptRevision: 1,
        ownedRanges: [{ segmentKey: "seg-1", startUtf16: 0, endUtf16: 15 }],
        ownedText: "Sample text two",
      };

      const hash1 = hashUnitInput(payload1);
      const hash2 = hashUnitInput(payload2);
      const hashModified = hashUnitInput(payloadModified);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashModified);
    });
  });

  describe("planSummaryTree (D8 Hierarchical Overview)", () => {
    it("handles 0 sections", () => {
      const plan = planSummaryTree([]);
      expect(plan.levels).toHaveLength(0);
      expect(plan.totalCalls).toBe(0);
      expect(plan.fitsBudget).toBe(true);
    });

    it("handles 1 section with 1 overview call", () => {
      const plan = planSummaryTree(["unit-0"]);
      expect(plan.levels).toHaveLength(1);
      expect(plan.levels[0]).toHaveLength(1);
      expect(plan.levels[0][0].isFinal).toBe(true);
      expect(plan.totalCalls).toBe(1);
      expect(plan.fitsBudget).toBe(true);
    });

    it("handles 8 sections with 1 overview call (fits in single group <= 8)", () => {
      const unitKeys = Array.from({ length: 8 }, (_, i) => `unit-${i}`);
      const plan = planSummaryTree(unitKeys);

      expect(plan.levels).toHaveLength(1);
      expect(plan.levels[0]).toHaveLength(1);
      expect(plan.levels[0][0].inputUnitKeys).toHaveLength(8);
      expect(plan.levels[0][0].isFinal).toBe(true);
      expect(plan.totalCalls).toBe(1);
      expect(plan.fitsBudget).toBe(true);
    });

    it("handles 16 sections in 2 levels: 2 intermediate summaries + 1 final overview = 3 calls", () => {
      const unitKeys = Array.from({ length: 16 }, (_, i) => `unit-${i}`);
      const plan = planSummaryTree(unitKeys);

      expect(plan.levels).toHaveLength(2);
      expect(plan.levels[0]).toHaveLength(2); // 2 groups of 8
      expect(plan.levels[1]).toHaveLength(1); // 1 final overview of 2 items
      expect(plan.levels[1][0].isFinal).toBe(true);
      expect(plan.totalCalls).toBe(3);
      expect(plan.fitsBudget).toBe(true);
    });

    it("handles 64 sections (cap): 8 intermediate summaries + 1 final overview = 9 calls (<= 16)", () => {
      const unitKeys = Array.from({ length: 64 }, (_, i) => `unit-${i}`);
      const plan = planSummaryTree(unitKeys);

      expect(plan.levels).toHaveLength(2);
      expect(plan.levels[0]).toHaveLength(8); // 8 groups of 8
      expect(plan.levels[1]).toHaveLength(1); // 1 final overview
      expect(plan.levels[1][0].isFinal).toBe(true);
      expect(plan.totalCalls).toBe(9);
      expect(plan.fitsBudget).toBe(true);
    });

    it("flags budget error if overview calls exceed maxOverviewRequests cap", () => {
      // 256 sections with maxGroupSize = 4 and maxOverviewRequests = 10
      const unitKeys = Array.from({ length: 64 }, (_, i) => `unit-${i}`);
      const plan = planSummaryTree(unitKeys, {
        maxOverviewRequests: 5, // small limit to trigger overflow
      });

      expect(plan.fitsBudget).toBe(false);
      expect(plan.totalCalls).toBe(9);
      expect(plan.error).toContain("exceeding maximum budget (5)");
    });
  });
});
