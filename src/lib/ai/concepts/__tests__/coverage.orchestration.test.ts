/**
 * Coverage orchestration integration tests (K 1.2-1.4).
 *
 * These exercise the real orchestrator with fixed library/index/card/history
 * fixtures and injected dependencies. No model output can supply evidence.
 */

import { describe, expect, it } from "vitest";
import {
  runCoverageAnalysis,
  computeEvidenceCoverage,
  computeActivity,
  hasInlineDefinitionCue,
  needsNonEnglishCueLimitation,
  type CoverageDependencies,
} from "../coverage";

function indexStatus(overrides: Record<string, unknown> = {}) {
  return {
    aggregate: {
      totalDocuments: 1,
      indexedDocuments: 1,
      queuedDocuments: 0,
      indexingDocuments: 0,
      staleDocuments: 0,
      failedDocuments: 0,
      totalChunks: 3,
      totalEmbeddings: 3,
      embeddingStorageBytes: 0,
      embeddingModels: [],
      paused: false,
      pendingDocuments: 0,
      ...overrides,
    },
    documents: [
      {
        documentId: "doc-1",
        state: "indexed",
        chunksIndexed: 3,
        totalChunks: 3,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  } as never;
}

function hit(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: "chunk-1",
    documentId: "doc-1",
    documentTitle: "Synthetic paper",
    sourceType: "document",
    text: "Photosynthesis is the process by which plants convert light energy into chemical energy.",
    headingPath: ["Introduction"],
    score: 0.9,
    mode: "semantic",
    ordinal: 0,
    location: { sourceType: "pdf", startOffset: 0, endOffset: 80, pageNumber: 1 },
    ...overrides,
  };
}

function doc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Synthetic paper",
    fileType: "pdf",
    content:
      "Photosynthesis is the process by which plants convert light energy into chemical energy.",
    contentHash: "rev-1",
    dateModified: "2026-01-01T00:00:00Z",
    ...overrides,
  } as never;
}

function deps(overrides: Partial<CoverageDependencies> = {}): CoverageDependencies {
  return {
    retrieve: async () => ({ results: [hit()], mode: "semantic" }) as never,
    getIndexStatus: async () => indexStatus(),
    getDocument: async () => doc(),
    getExtract: async () => null,
    getLearningItem: async () => null,
    getAnnotation: async () => null,
    findConceptsByNames: async () => [] as never,
    getConceptBacklinks: async () => [] as never,
    listConceptLinksFor: async () => [] as never,
    preflight: async () => ({ allowed: true, remote: false, limitations: [] }),
    ...overrides,
  };
}

describe("coverage-v1 state rules", () => {
  it("requires a direct reference for supported", () => {
    expect(computeEvidenceCoverage({ refs: [{ strength: "direct" }], indexCompleteness: "partial", queriesSucceeded: true })).toBe("supported");
    expect(computeEvidenceCoverage({ refs: [{ strength: "mention" }], indexCompleteness: "complete", queriesSucceeded: true })).toBe("partial");
    expect(computeEvidenceCoverage({ refs: [], indexCompleteness: "complete", queriesSucceeded: true })).toBe("not-covered");
    expect(computeEvidenceCoverage({ refs: [], indexCompleteness: "partial", queriesSucceeded: true })).toBe("unknown");
    expect(computeEvidenceCoverage({ refs: [], indexCompleteness: "complete", queriesSucceeded: false })).toBe("unknown");
  });

  it("keeps activity independent of evidence coverage", () => {
    expect(computeActivity({ hasSupportingCard: true, hasSupportingExtract: false, reviewedCard: true, documentEncountered: false })).toBe("reviewed");
    expect(computeActivity({ hasSupportingCard: false, hasSupportingExtract: true, reviewedCard: false, documentEncountered: true })).toBe("studied");
    expect(computeActivity({ hasSupportingCard: false, hasSupportingExtract: false, reviewedCard: false, documentEncountered: true })).toBe("encountered");
    expect(computeActivity({ hasSupportingCard: false, hasSupportingExtract: false, reviewedCard: false, documentEncountered: false })).toBe("none");
  });

  it("recognizes only deterministic definition cues", () => {
    expect(hasInlineDefinitionCue("Photosynthesis is the process by which plants make food.", "photosynthesis")).toBe(true);
    expect(hasInlineDefinitionCue("Photosynthesis means the conversion of light energy.", "photosynthesis")).toBe(true);
    expect(hasInlineDefinitionCue("We discussed photosynthesis at length.", "photosynthesis")).toBe(false);
    expect(needsNonEnglishCueLimitation("Фотосинтез — это процесс преобразования света.")).toBe(true);
    expect(needsNonEnglishCueLimitation("Photosynthesis is a process.")).toBe(false);
  });
});

describe("runCoverageAnalysis", () => {
  it("returns supported for a verified definition in current source text", async () => {
    const result = await runCoverageAnalysis({
      concepts: [{ name: "Photosynthesis" }],
      dependencies: deps(),
    });
    expect(result.concepts).toHaveLength(1);
    expect(result.concepts[0].evidenceCoverage).toBe("supported");
    expect(result.concepts[0].evidenceRefs).toHaveLength(1);
    expect(result.concepts[0].evidenceRefs[0].kind).toBe("chunk");
    expect(result.concepts[0].evidenceRefs[0].locator).toBeTruthy();
    expect(result.concepts[0].activity).toBe("none");
  });

  it("returns partial for a verified mention without a definition cue", async () => {
    const result = await runCoverageAnalysis({
      concepts: [{ name: "Photosynthesis" }],
      dependencies: deps({
        retrieve: async () =>
          ({
            results: [hit({ text: "The role of photosynthesis in ecosystems varies with rainfall." })],
            mode: "semantic",
          }) as never,
        getDocument: async () =>
          doc({
            content: "The role of photosynthesis in ecosystems varies with rainfall.",
          }),
      }),
    });
    expect(result.concepts[0].evidenceCoverage).toBe("partial");
  });

  it("returns not-covered only when the relevant scope is fully indexed", async () => {
    const complete = await runCoverageAnalysis({
      concepts: [{ name: "Osmosis" }],
      scope: { includeAuxiliarySources: false },
      dependencies: deps({
        retrieve: async () => ({ results: [], mode: "semantic" }) as never,
      }),
    });
    expect(complete.concepts[0].evidenceCoverage).toBe("not-covered");
    expect(complete.concepts[0].activity).toBe("none");

    const partial = await runCoverageAnalysis({
      concepts: [{ name: "Osmosis" }],
      scope: { includeAuxiliarySources: false },
      dependencies: deps({
        retrieve: async () => ({ results: [], mode: "semantic" }) as never,
        getIndexStatus: async () =>
          ({
            aggregate: {
              totalDocuments: 1,
              indexedDocuments: 0,
              queuedDocuments: 0,
              indexingDocuments: 0,
              staleDocuments: 1,
              failedDocuments: 0,
              totalChunks: 3,
              totalEmbeddings: 0,
              embeddingStorageBytes: 0,
              embeddingModels: [],
              paused: false,
              pendingDocuments: 0,
            },
            documents: [
              {
                documentId: "doc-1",
                state: "stale",
                chunksIndexed: 0,
                totalChunks: 3,
                updatedAt: "2026-01-01T00:00:00Z",
              },
            ],
          }) as never,
      }),
    });
    expect(partial.concepts[0].evidenceCoverage).toBe("unknown");
  });

  it("never counts a stale or fabricated evidence hit", async () => {
    const result = await runCoverageAnalysis({
      concepts: [{ name: "Photosynthesis" }],
      scope: { includeAuxiliarySources: false },
      dependencies: deps({
        // The hit text no longer exists in the current document revision.
        getDocument: async () => doc({ content: "Completely different current text." }),
      }),
    });
    expect(result.concepts[0].evidenceRefs).toHaveLength(0);
    expect(result.concepts[0].evidenceCoverage).toBe("not-covered");
  });

  it("deduplicates case/whitespace variants without merging synonyms", async () => {
    const result = await runCoverageAnalysis({
      concepts: [
        { name: "Photosynthesis" },
        { name: "  photosynthesis  " },
        { name: "Light capture" },
      ],
      dependencies: deps(),
    });
    expect(result.concepts).toHaveLength(2);
    expect(result.concepts.filter((concept) => concept.evidenceCoverage === "supported")).toHaveLength(1);
  });

  it("does not count a card as reviewed without a real review event", async () => {
    const result = await runCoverageAnalysis({
      concepts: [{ name: "Photosynthesis" }],
      dependencies: deps({
        retrieve: async () =>
          ({
            results: [
              hit({
                sourceType: "card",
                sourceId: "card-1",
                text: "Photosynthesis converts light energy.",
              }),
            ],
            mode: "semantic",
          }) as never,
        getLearningItem: async () =>
          ({
            id: "card-1",
            document_id: "doc-1",
            question: "What is photosynthesis?",
            answer: "Photosynthesis converts light energy.",
            cloze_text: null,
            date_modified: "2026-01-02",
          }) as never,
        getItemStatsSummary: async () => ({ repetitions: { state: "value", value: 0 } }) as never,
      }),
    });
    expect(result.concepts[0].evidenceCoverage).toBe("supported");
    expect(result.concepts[0].activity).toBe("studied");
  });

  it("cancels before any query when the signal is aborted", async () => {
    let queried = false;
    const controller = new AbortController();
    controller.abort();
    await expect(
      runCoverageAnalysis({
        concepts: [{ name: "Photosynthesis" }],
        signal: controller.signal,
        dependencies: deps({
          retrieve: async () => {
            queried = true;
            return { results: [], mode: "semantic" } as never;
          },
        }),
      })
    ).rejects.toThrow(/cancelled/i);
    expect(queried).toBe(false);
  });

  it("returns unknown instead of querying when remote preflight is denied", async () => {
    let queried = false;
    const result = await runCoverageAnalysis({
      concepts: [{ name: "Photosynthesis" }],
      preflight: { allowed: false, remote: true, limitations: ["coverage.remoteDenied"] },
      dependencies: deps({
        retrieve: async () => {
          queried = true;
          return { results: [], mode: "semantic" } as never;
        },
      }),
    });
    expect(queried).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.concepts[0].evidenceCoverage).toBe("unknown");
  });
});
