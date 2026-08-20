import { describe, expect, it } from "vitest";
import { calculateCoverage, reverseInvalidateChunks, DEFAULT_COVERAGE_POLICY, type CoverageDocumentInput } from "../index";

const input: CoverageDocumentInput = {
  documentId: "doc-1",
  profileId: "profile-1",
  languageTag: "es",
  contentFingerprint: "content-1",
  processorVersion: "processor-1",
  lexiconStateVersion: "state-1",
  policy: DEFAULT_COVERAGE_POLICY,
  chunks: [{
    chunkId: "chunk-1",
    chunkIndex: 0,
    tokens: [
      { id: "known", surface: "hola", normalized: "hola", kind: "word", state: "known" },
      { id: "familiar", surface: "mundo", normalized: "mundo", kind: "word", lemmaState: "familiar", confidence: 1 },
      { id: "punct", surface: ".", normalized: ".", kind: "punctuation" },
      { id: "number", surface: "2", normalized: "2", kind: "number" },
    ],
  }],
};

describe("lexical coverage", () => {
  it("counts states deterministically and excludes punctuation/numbers by policy", () => {
    const result = calculateCoverage(input, { now: () => 123 });
    expect(result.summary.computedAt).toBe(123);
    expect(result.summary.stateCounts.known).toBe(1);
    expect(result.summary.stateCounts.familiar).toBe(1);
    expect(result.summary.excluded.punctuation).toBe(1);
    expect(result.summary.excluded.numbers).toBe(1);
    expect(result.summary.freshness).toBe("fresh");
  });

  it("reverse-invalidates only chunks that reference the changed entry", () => {
    const plan = reverseInvalidateChunks([
      { documentId: "doc-1", profileId: "profile-1", chunkId: "a", chunkIndex: 0, coverageKey: "k", lexicalEntryIds: ["entry-1"] },
      { documentId: "doc-1", profileId: "profile-1", chunkId: "b", chunkIndex: 1, coverageKey: "k", lexicalEntryIds: ["entry-2"] },
    ], "entry-1");
    expect(plan.chunks.map((chunk) => chunk.chunkId)).toEqual(["a"]);
    expect(plan.documentIds).toEqual(["doc-1"]);
  });
});
