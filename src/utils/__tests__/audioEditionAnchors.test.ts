/**
 * Smart extraction test matrix (task 11.2): empty anchor set, exact overlap,
 * boundary crossing, document start/end, 15/30/60/Smart windows, paragraph
 * snapping, typed outcome tiers (no fake text), repeat extension semantics.
 */

import { describe, it, expect } from "vitest";
import {
  computeSentenceAnchors,
  resolveRecentPassage,
  findAnchorIndexAtTimestamp,
  resolveAnchorAtTimestamp,
  paragraphStartIndex,
  extendStartBySemanticUnit,
} from "../audioEditionAnchors";

const PARAGRAPH_TEXT =
  "One one one one one.\n\nTwo two two two.\n\nThree three three three three.";

describe("anchor computation", () => {
  it("computes sentence anchors with paragraph-detectable gaps", () => {
    const anchors = computeSentenceAnchors("sec-1", PARAGRAPH_TEXT, 30, "0");
    expect(anchors.length).toBe(3);
    // Sentences within a paragraph have gap 1 (single space).
    // Paragraph breaks have gap >= 2 (blank line).
    const gap12 = Number(anchors[1].sourceStartAnchor) - Number(anchors[0].sourceEndAnchor);
    expect(gap12).toBeGreaterThanOrEqual(2);
  });

  it("returns no anchors for empty text", () => {
    expect(computeSentenceAnchors("sec-1", "   ", 30)).toEqual([]);
  });
});

describe("resolveRecentPassage — typed outcomes", () => {
  // 30s total: s1 ≈ 0-9.5s, s2 ≈ 9.5-17.5s, s3 ≈ 17.5-30s.
  const anchors = computeSentenceAnchors("sec-1", PARAGRAPH_TEXT, 30, "0");

  it("empty anchor set → pending audio bookmark with empty text", () => {
    const result = resolveRecentPassage([], 30, 30);
    expect(result.kind).toBe("pending_audio_bookmark");
    expect(result.text).toBe("");
  });

  it("high confidence + overlapping anchors → resolved with real text", () => {
    const result = resolveRecentPassage(anchors, 20, 15, "high");
    expect(result.kind).toBe("resolved");
    // Window [5, 20] overlaps sentences 2 and 3.
    expect(result.text).toContain("Two two");
    expect(result.text).not.toMatch(/Audio extract at/);
  });

  it("medium confidence → needs_confirmation (candidate, not permanent)", () => {
    const result = resolveRecentPassage(anchors, 20, 15, "medium");
    expect(result.kind).toBe("needs_confirmation");
    expect(result.confidence).toBe("medium");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("low confidence → pending bookmark even when anchors exist (no fabricated text)", () => {
    const result = resolveRecentPassage(anchors, 20, 15, "low");
    expect(result.kind).toBe("pending_audio_bookmark");
    expect(result.text).toBe("");
  });
});

describe("resolveRecentPassage — windows and boundaries", () => {
  const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} here.`).join(" ");
  const anchors = computeSentenceAnchors("sec-1", text, 120, "0"); // 10s per sentence

  it("15s window covers ~1.5 sentences snapped to sentence boundaries", () => {
    const result = resolveRecentPassage(anchors, 25, 15, "high");
    expect(result.kind).toBe("resolved");
    // Window [10, 25] overlaps sentences 2-3; start snaps to sentence 2 start.
    expect(result.text).toContain("Sentence number 2");
    expect(result.text).not.toContain("Sentence number 1 ");
  });

  it("30s window covers ~3 sentences", () => {
    const result = resolveRecentPassage(anchors, 35, 30, "high");
    expect(result.text).toContain("Sentence number 1");
  });

  it("60s window covers ~6 sentences", () => {
    const result = resolveRecentPassage(anchors, 65, 60, "high");
    expect(result.text.split("Sentence number").length - 1).toBeGreaterThanOrEqual(6);
  });

  it("document start: window clamps to 0 and includes the first sentence", () => {
    const result = resolveRecentPassage(anchors, 5, 30, "high");
    expect(result.text).toContain("Sentence number 1");
  });

  it("document end: timestamp past the last anchor clamps to the final sentence", () => {
    const result = resolveRecentPassage(anchors, 500, 15, "high");
    expect(result.kind).toBe("resolved");
    expect(result.text).toContain("Sentence number 12");
  });

  it("timestamp exactly at an anchor boundary resolves deterministically", () => {
    // Sentence 2 starts at t=10 exactly.
    const idx = findAnchorIndexAtTimestamp(anchors, 10);
    expect(anchors[idx].textContent).toContain("Sentence number 2");
  });
});

describe("resolveRecentPassage — Smart window paragraph snapping", () => {
  const anchors = computeSentenceAnchors("sec-1", PARAGRAPH_TEXT, 90, "0");

  it("smart snaps to the enclosing paragraph, bounded to ≤ 90s and ≤ 3 units", () => {
    // Paragraph 3 is the final third of the audio; a capture there snaps to
    // its paragraph start and can extend back at most 2 more units.
    const t = anchors[anchors.length - 1].audioStartSec + 1;
    const result = resolveRecentPassage(anchors, t, "smart", "high");
    expect(result.kind).toBe("resolved");
    expect(result.text).toContain("Three three three");
    expect(result.windowSec).toBeLessThanOrEqual(90);
    // All three paragraphs is also legal (3 units) — but never more.
    const sentenceCount = result.matchedAnchors.length;
    expect(sentenceCount).toBeLessThanOrEqual(3);
  });

  it("smart at document start covers the first paragraph only", () => {
    const result = resolveRecentPassage(anchors, 1, "smart", "high");
    expect(result.text).toContain("One one one");
    expect(result.text).not.toContain("Two two");
  });
});

describe("paragraph helpers", () => {
  // Two paragraphs of two sentences each (gap ≥ 2 marks the paragraph break).
  const multi = [
    "The quick brown fox. Jumps over the dog.",
    "New paragraph starts. And continues here.",
  ].join("\n\n");
  const anchors = computeSentenceAnchors("sec-multi", multi, 100, "0");

  it("paragraphStartIndex walks back to the paragraph's first sentence", () => {
    // Index 3 is p2s2; its paragraph starts at index 2.
    expect(paragraphStartIndex(anchors, 3)).toBe(2);
    expect(paragraphStartIndex(anchors, 1)).toBe(0);
  });

  it("extendStartBySemanticUnit pulls in the previous paragraph when already at a boundary", () => {
    expect(extendStartBySemanticUnit(anchors, 2)).toBe(0);
  });

  it("extendStartBySemanticUnit mid-paragraph snaps back to the paragraph start", () => {
    expect(extendStartBySemanticUnit(anchors, 3)).toBe(2);
  });

  it("extension never crosses index 0", () => {
    expect(extendStartBySemanticUnit(anchors, 0)).toBe(0);
  });
});

describe("binary search resolution", () => {
  const text = Array.from({ length: 50 }, (_, i) => `S${i}.`).join(" ");
  const anchors = computeSentenceAnchors("sec-bin", text, 50, "0"); // 1s per sentence

  it("finds every containing anchor", () => {
    for (let i = 0; i < anchors.length; i++) {
      const t = anchors[i].audioStartSec + 0.1;
      const resolved = resolveAnchorAtTimestamp(anchors, t);
      expect(resolved?.id).toBe(anchors[i].id);
    }
  });

  it("clamps past-the-end timestamps to the last anchor", () => {
    const resolved = resolveAnchorAtTimestamp(anchors, 10_000);
    expect(resolved?.id).toBe(anchors[anchors.length - 1].id);
  });
});
