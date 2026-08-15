/**
 * Unit tests for the recall fingerprint module (task 5.3): normalization
 * invariants, stable fingerprinting, and near-duplicate detection including
 * the paraphrase case from the ai-active-recall spec.
 */

import { describe, expect, it } from "vitest";
import {
  fingerprintRecallQuestion,
  findDuplicatePrompt,
  jaccardSimilarity,
  nearDuplicate,
  normalizeConceptKeys,
  normalizeQuestion,
} from "../fingerprint";

describe("normalizeQuestion", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeQuestion("What, exactly, is Osmosis?!")).toBe("what exactly is osmosis");
  });

  it("collapses whitespace", () => {
    expect(normalizeQuestion("  Why\t does\n the   membrane…  ")).toBe(
      "why does the membrane"
    );
  });

  it("is idempotent", () => {
    const once = normalizeQuestion("State Ohm's law (V = IR).");
    expect(normalizeQuestion(once)).toBe(once);
  });

  it("keeps digits and unicode letters", () => {
    expect(normalizeQuestion("Chapter 3 — Überzahlung")).toBe("chapter 3 überzahlung");
  });
});

describe("normalizeConceptKeys", () => {
  it("lowercases, trims, dedupes and sorts", () => {
    expect(normalizeConceptKeys(["Osmosis", " osmosis ", "Active Transport", ""])).toEqual([
      "active transport",
      "osmosis",
    ]);
  });

  it("drops empties entirely", () => {
    expect(normalizeConceptKeys(["  ", ""])).toEqual([]);
  });
});

describe("fingerprintRecallQuestion", () => {
  it("is stable across casing, punctuation and key order", () => {
    const a = fingerprintRecallQuestion("What is osmosis?", ["diffusion", "water"]);
    const b = fingerprintRecallQuestion("what   is   OSMOSIS", ["water", "DIFFUSION"]);
    expect(a).toBe(b);
  });

  it("differs when the question or the concept keys differ", () => {
    const base = fingerprintRecallQuestion("What is osmosis?", ["osmosis"]);
    expect(fingerprintRecallQuestion("What is diffusion?", ["osmosis"])).not.toBe(base);
    expect(fingerprintRecallQuestion("What is osmosis?", ["diffusion"])).not.toBe(base);
  });

  it("is an 8-hex fnv1a digest", () => {
    expect(fingerprintRecallQuestion("x")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("nearDuplicate", () => {
  it("flags a paraphrase as a near-duplicate (spec scenario)", () => {
    // 7 shared tokens, 1 added → Jaccard 0.875 ≥ 0.8.
    const a = { question: "Why can virtual memory exceed physical RAM?" };
    const b = { question: "Why can virtual memory exceed the physical RAM?" };
    expect(nearDuplicate(a, b)).toBe(true);
  });

  it("flags punctuation/casing-only variants", () => {
    expect(
      nearDuplicate(
        { question: "Define osmosis." },
        { question: "define OSMOSIS!" }
      )
    ).toBe(true);
  });

  it("does not flag distinct questions about different concepts", () => {
    expect(
      nearDuplicate(
        { question: "Why can virtual memory exceed physical RAM?" },
        { question: "Which Paging mechanism evicts pages to disk under pressure?" }
      )
    ).toBe(false);
  });

  it("does not flag a same-topic question with a different ask", () => {
    expect(
      nearDuplicate(
        { question: "What does the kernel do when a page fault occurs?" },
        { question: "How does copy-on-write reduce memory usage after fork?" }
      )
    ).toBe(false);
  });

  it("treats empty questions as duplicates of each other but not of content", () => {
    expect(nearDuplicate({ question: "" }, { question: "" })).toBe(true);
    expect(nearDuplicate({ question: "" }, { question: "anything at all" })).toBe(false);
  });
});

describe("jaccardSimilarity", () => {
  it("is 1 for identical sets and 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(1);
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("computes intersection over union", () => {
    // {a} vs {a,b,c}: 1 / 3
    expect(jaccardSimilarity(new Set(["a"]), new Set(["a", "b", "c"]))).toBeCloseTo(1 / 3);
  });
});

describe("findDuplicatePrompt", () => {
  const history = [
    { fingerprint: "aaaa0001", question: "Why can virtual memory exceed physical RAM?" },
    { fingerprint: "aaaa0002", question: "Define osmosis." },
  ];

  it("matches by exact stored fingerprint", () => {
    const hit = findDuplicatePrompt(
      { question: "Something else entirely?", fingerprint: "aaaa0001" },
      history
    );
    expect(hit?.fingerprint).toBe("aaaa0001");
  });

  it("matches by near-duplicate question text despite a different fingerprint", () => {
    const hit = findDuplicatePrompt(
      {
        question: "Why can virtual memory exceed the physical RAM?",
        fingerprint: "ffff0009",
      },
      history
    );
    expect(hit?.fingerprint).toBe("aaaa0001");
  });

  it("returns null for a genuinely new question", () => {
    expect(
      findDuplicatePrompt(
        { question: "How does copy-on-write reduce memory usage?", fingerprint: "beef0000" },
        history
      )
    ).toBeNull();
  });
});
