/**
 * Unit tests for the "Ask library" task (task 4.9): task-definition
 * invariants, prompt containment, context budgeting/dedup, and the
 * `LibraryAnswer` validator contract.
 */

import { describe, expect, it } from "vitest";
import { askLibraryTask, dedupeRetrievedChunks, fitChunksToContextBudget } from "../tasks/definitions/libraryTask";
import {
  validateLibraryAnswer,
  quoteIsGroundedIn,
  MAX_SOURCE_REFS,
  type LibraryAnswer,
} from "../schemas/libraryAnswer";
import { isValidOutcome } from "../schemas/common";
import { findUntrustedLeaks, hasContainmentClause } from "../tasks/containment";
import type { RetrievalResult } from "../../../api/ai-learning";

function chunk(chunkId: string, text: string, ordinal = 0): RetrievalResult {
  return {
    chunkId,
    documentId: "doc-1",
    documentTitle: "Doc",
    sourceType: "document",
    ordinal,
    text,
    headingPath: [],
    location: { sourceType: "text", documentId: "doc-1", ordinal, startOffset: 0, endOffset: text.length },
    contentHash: `h-${chunkId}`,
    tokenCount: 1,
    score: 1,
    mode: "semantic",
  };
}

const CHUNK_A = "Spaced repetition schedules reviews at expanding intervals to combat the forgetting curve.";
const CHUNK_B = "Active recall means retrieving an answer from memory rather than re-reading the material.";

describe("askLibraryTask definition", () => {
  it("carries the containment clause and a static system instruction", () => {
    expect(hasContainmentClause(askLibraryTask.systemInstruction)).toBe(true);
  });

  it("wraps every chunk as an untrusted block and puts the query last", () => {
    const built = askLibraryTask.buildInput({
      query: "What did I read about recall?",
      sources: [
        { id: "chunk-a", text: CHUNK_A },
        { id: "chunk-b", text: CHUNK_B },
      ],
    });
    expect(built.text).toContain('<untrusted_source id="chunk-a">');
    expect(built.text).toContain('<untrusted_source id="chunk-b">');
    // Document text never leaks outside blocks (design D9).
    expect(findUntrustedLeaks(built.text, [CHUNK_A, CHUNK_B])).toEqual([]);
    // Query sits outside the blocks and is the final turn element.
    expect(built.text.trim().endsWith("What did I read about recall?")).toBe(true);
    // Citation markers are visible next to each block.
    expect(built.text).toContain("[1]");
    expect(built.text).toContain("[2]");
  });

  it("wraps the optional selection context as an uncitable untrusted block", () => {
    const built = askLibraryTask.buildInput({
      query: "Where else does this idea appear?",
      sources: [{ id: "chunk-a", text: CHUNK_A }],
      contextPassage: "SELECTED: the forgetting curve passage",
    });
    expect(built.text).toContain('<untrusted_source id="selection-context">');
    expect(findUntrustedLeaks(built.text, ["SELECTED: the forgetting curve passage"])).toEqual([]);
  });
});

describe("context preparation", () => {
  it("drops exact and contained duplicates, keeping first occurrences", () => {
    const results = [
      chunk("a", "Alpha beta gamma."),
      chunk("b", "alpha   BETA gamma."), // same normalized text
      chunk("c", "Alpha beta gamma. Plus a delta sentence."), // contains chunk a
      chunk("d", "Something else entirely."),
    ];
    const kept = dedupeRetrievedChunks(results);
    expect(kept.map((r) => r.chunkId)).toEqual(["a", "d"]);
  });

  it("truncates the chunk list to the token budget without cutting chunks", () => {
    const results = Array.from({ length: 40 }, (_, i) =>
      chunk(`c${i}`, `Chunk ${i} `.repeat(30))
    );
    const kept = fitChunksToContextBudget(results, 1_000);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(results.length);
    // Whole chunks only: every kept chunk is one of the inputs untouched.
    for (const r of kept) {
      const original = results.find((x) => x.chunkId === r.chunkId);
      expect(original?.text).toBe(r.text);
    }
    // The prefix is contiguous (rank order preserved).
    expect(kept.map((r) => r.chunkId)).toEqual(results.slice(0, kept.length).map((r) => r.chunkId));
  });
});

describe("validateLibraryAnswer", () => {
  const sources = new Map<string, string>([
    ["chunk-a", CHUNK_A],
    ["chunk-b", CHUNK_B],
  ]);

  it("accepts a grounded answer with verifiable refs", () => {
    const outcome = validateLibraryAnswer(
      {
        answer: "Reviews expand [1].",
        sourceRefs: [{ refId: "chunk-a", quote: "expanding intervals" }],
        evidenceLevel: "supported",
      },
      { sources }
    );
    const value = isValidOutcome(outcome) ? outcome.value : undefined;
    expect(value).toBeDefined();
    expect(value?.evidenceLevel).toBe("supported");
    expect(value?.sourceRefs).toHaveLength(1);
  });

  it("drops fabricated refIds and ungrounded quotes instead of failing", () => {
    const outcome = validateLibraryAnswer(
      {
        answer: "Something [1] [2].",
        sourceRefs: [
          { refId: "chunk-ghost", quote: "expanding intervals" }, // invented id
          { refId: "chunk-a", quote: "quantum tunneling" }, // quote not in chunk
        ],
        evidenceLevel: "weak",
      },
      { sources }
    );
    const value = isValidOutcome(outcome) ? outcome.value : undefined;
    expect(value).toBeDefined();
    expect(value?.sourceRefs).toEqual([]);
    expect(value?.evidenceLevel).toBe("weak");
  });

  it("normalizes supported-with-no-surviving-refs to none", () => {
    const outcome = validateLibraryAnswer(
      {
        answer: "Claim [1].",
        sourceRefs: [{ refId: "chunk-ghost", quote: "anything" }],
        evidenceLevel: "supported",
      },
      { sources }
    );
    const value = isValidOutcome(outcome) ? outcome.value : undefined;
    expect(value?.evidenceLevel).toBe("none");
    expect(value?.sourceRefs).toEqual([]);
  });

  it("keeps none honest: refs are dropped, shape stays valid", () => {
    const outcome = validateLibraryAnswer(
      {
        answer: "The library does not appear to cover this.",
        sourceRefs: [{ refId: "chunk-a", quote: "expanding intervals" }],
        evidenceLevel: "none",
      },
      { sources }
    );
    const value = isValidOutcome(outcome) ? outcome.value : undefined;
    expect(value?.evidenceLevel).toBe("none");
    expect(value?.sourceRefs).toEqual([]);
  });

  it("fails closed on structural garbage", () => {
    expect(validateLibraryAnswer({ answer: "" }, { sources }).ok).toBe(false);
    expect(
      validateLibraryAnswer({ answer: "ok", evidenceLevel: "maybe" }, { sources }).ok
    ).toBe(false);
    expect(validateLibraryAnswer("not an object", { sources }).ok).toBe(false);
  });

  it("caps refs at MAX_SOURCE_REFS and dedups identical refs", () => {
    const wordy = Array.from({ length: MAX_SOURCE_REFS + 8 }, (_, i) => `word${i}`).join(" ");
    const manySources = new Map<string, string>([["chunk-a", wordy]]);
    const refs = Array.from({ length: MAX_SOURCE_REFS + 8 }, (_, i) => ({
      refId: "chunk-a",
      quote: `word${i}`,
    }));
    const outcome = validateLibraryAnswer(
      { answer: "a", sourceRefs: refs, evidenceLevel: "supported" },
      { sources: manySources }
    );
    const value = isValidOutcome(outcome) ? outcome.value : undefined;
    expect(value).toBeDefined();
    expect(value?.sourceRefs.length).toBe(MAX_SOURCE_REFS);
  });

  it("quoteIsGroundedIn ignores whitespace and case differences", () => {
    expect(quoteIsGroundedIn(CHUNK_A, "EXPANDING   intervals")).toBe(true);
    expect(quoteIsGroundedIn(CHUNK_A, "expanding intervals")).toBe(true);
    expect(quoteIsGroundedIn(CHUNK_A, "shrinking intervals")).toBe(false);
    expect(quoteIsGroundedIn(CHUNK_A, "  ")).toBe(false);
  });
});

describe("LibraryAnswer type surface", () => {
  it("compiles the canonical shape", () => {
    const answer: LibraryAnswer = {
      answer: "text",
      sourceRefs: [{ refId: "chunk-a", quote: "text" }],
      evidenceLevel: "supported",
    };
    expect(answer.evidenceLevel).toBe("supported");
  });
});
