import { describe, expect, it, vi } from "vitest";
import { runCoverageAnalysis, type CoverageDependencies } from "../coverage";
import type { Document } from "../../../../types/document";
import type { RetrievalResponse } from "../../../../api/ai-learning";

const physics: Document = {
  id: "doc-physics",
  title: "Physics",
  filePath: "/tmp/physics.txt",
  fileType: "other",
  content:
    "Gravity is a force. Gravity shapes the orbits of planets. Orbits are elliptical paths.",
  contentHash: "physics-rev",
  tags: [],
  dateAdded: "2026-01-01T00:00:00Z",
  dateModified: "2026-01-02T00:00:00Z",
  extractCount: 1,
  learningItemCount: 1,
  priorityRating: 0,
  prioritySlider: 0,
  priorityScore: 0,
  isArchived: false,
  isFavorite: false,
};

const historyDoc: Document = {
  ...physics,
  id: "doc-history",
  title: "History",
  content: "Entropy is disorder in a thermodynamic system.",
  contentHash: "history-rev",
};

function retrieval(hits: RetrievalResponse["results"]): RetrievalResponse {
  return { results: hits, mode: "lexicalOnly", candidatesScanned: hits.length };
}

function baseHit(
  input: Partial<RetrievalResponse["results"][number]> & {
    chunkId: string;
    documentId: string;
    text: string;
  }
): RetrievalResponse["results"][number] {
  return {
    sourceType: "document",
    ordinal: 0,
    headingPath: [],
    location: {
      sourceType: "text",
      documentId: input.documentId,
      ordinal: 0,
      startOffset: 0,
      endOffset: input.text.length,
    },
    contentHash: "chunk-hash",
    tokenCount: 10,
    score: 0.9,
    mode: "lexicalOnly",
    ...input,
  };
}

const extract = {
  id: "ext-1",
  document_id: "doc-physics",
  content: "Gravity refers to the attraction between masses.",
  progressive_disclosure_level: 0,
  max_disclosure_level: 3,
  date_created: "2026-01-01T00:00:00Z",
  date_modified: "2026-01-03T00:00:00Z",
  review_count: 0,
  reps: 0,
  tags: [],
};

const card = {
  id: "card-1",
  extract_id: "ext-1",
  document_id: "doc-physics",
  item_type: "Flashcard",
  question: "What does gravity do?",
  answer: "It attracts masses and shapes orbits.",
  difficulty: 3,
  interval: 2,
  ease_factor: 2.5,
  due_date: "2026-01-10T00:00:00Z",
  date_created: "2026-01-01T00:00:00Z",
  date_modified: "2026-01-04T00:00:00Z",
  review_count: 2,
  lapses: 0,
  state: "Review",
  is_suspended: false,
  tags: [],
};

function dependencies(hits: RetrievalResponse["results"]): CoverageDependencies {
  return {
    retrieve: vi.fn(async () => retrieval(hits)),
    getIndexStatus: vi.fn(async () => ({
      aggregate: {
        totalDocuments: 2,
        indexedDocuments: 2,
        queuedDocuments: 0,
        indexingDocuments: 0,
        staleDocuments: 0,
        failedDocuments: 0,
        totalChunks: 8,
        totalEmbeddings: 0,
        embeddingStorageBytes: 0,
        embeddingModels: [],
        paused: false,
        pendingDocuments: 0,
      },
      documents: [
        {
          documentId: "doc-physics",
          state: "indexed" as const,
          chunksIndexed: 4,
          totalChunks: 4,
          updatedAt: "2026-01-05T00:00:00Z",
        },
        {
          documentId: "doc-history",
          state: "indexed" as const,
          chunksIndexed: 4,
          totalChunks: 4,
          updatedAt: "2026-01-05T00:00:00Z",
        },
      ],
    })),
    getDocument: vi.fn(async (id: string) => {
      if (id === "doc-physics") return physics;
      if (id === "doc-history") return historyDoc;
      return null;
    }),
    getExtract: vi.fn(async (id: string) => (id === "ext-1" ? (extract as never) : null)),
    getLearningItem: vi.fn(async (id: string) => (id === "card-1" ? (card as never) : null)),
    getAnnotation: vi.fn(async (id: string) =>
      id === "ann-1"
        ? {
            id: "ann-1",
            documentId: "doc-physics",
            content: "Gravity means the attraction between masses.",
            pageNumber: 2,
            dateModified: "2026-01-04T00:00:00Z",
          }
        : null
    ),
    getCardSourceContext: vi.fn(async () => ({
      document_id: "doc-physics",
      document_title: "Physics",
      extract_id: "ext-1",
    })),
    getItemStatsSummary: vi.fn(async (type: string, id: string) => ({
      repetitions: {
        state: "value",
        value: id === "card-1" && type === "learning-item" ? 2 : 0,
      },
      totalActiveSeconds: {
        state: "value",
        value: id === "doc-physics" && type === "document" ? 120 : 0,
      },
    })),
    findConceptsByNames: vi.fn(async () => []),
    getConceptBacklinks: vi.fn(async () => []),
    listConceptLinksFor: vi.fn(async () => []),
    getConcept: vi.fn(async () => null),
    preflight: vi.fn(async () => ({ allowed: true, remote: false, limitations: [] })),
  };
}

describe("coverage integration over a fixed library", () => {
  it("hydrates chunk/extract/card/annotation evidence from real records and derives activity", async () => {
    const deps = dependencies([
      baseHit({
        chunkId: "chunk-doc",
        documentId: "doc-physics",
        text: "Gravity shapes the orbits of planets.",
      }),
      baseHit({
        chunkId: "chunk-extract",
        documentId: "doc-physics",
        sourceType: "extract",
        sourceId: "ext-1",
        text: "Gravity refers to the attraction between masses.",
      }),
      baseHit({
        chunkId: "chunk-card",
        documentId: "doc-physics",
        sourceType: "card",
        sourceId: "card-1",
        text: "What does gravity do?",
      }),
      baseHit({
        chunkId: "chunk-annotation",
        documentId: "doc-physics",
        sourceType: "annotation",
        sourceId: "ann-1",
        text: "Gravity means the attraction between masses.",
      }),
    ]);
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      scope: { documentIds: ["doc-physics", "doc-history"] },
      dependencies: deps,
    });

    const gravity = analysis.concepts[0];
    expect(gravity.evidenceCoverage).toBe("supported");
    expect(gravity.activity).toBe("reviewed");
    expect(gravity.indexCompleteness).toBe("partial");
    expect(gravity.evidenceRefs.map((ref) => `${ref.kind}:${ref.id}`).sort()).toEqual([
      "annotation:ann-1",
      "card:card-1",
      "chunk:chunk-doc",
      "extract:ext-1",
    ]);
    expect(deps.getAnnotation).toHaveBeenCalledWith("ann-1");
    // Every counted id resolves to a real record; no model-supplied ids exist.
    for (const ref of gravity.evidenceRefs) {
      expect(ref.documentId).toBe("doc-physics");
      expect(ref.sourceRevision.length).toBeGreaterThan(0);
    }
  });

  it("assesses concepts across two documents in one bounded run", async () => {
    const deps = dependencies([
      baseHit({
        chunkId: "chunk-gravity",
        documentId: "doc-physics",
        text: "Gravity is a force.",
      }),
      baseHit({
        chunkId: "chunk-entropy",
        documentId: "doc-history",
        text: "Entropy is disorder in a thermodynamic system.",
      }),
    ]);
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }, { name: "entropy" }],
      dependencies: deps,
    });
    expect(analysis.concepts.map((concept) => concept.conceptKey)).toEqual([
      "gravity",
      "entropy",
    ]);
    expect(analysis.concepts.every((concept) => concept.evidenceCoverage === "supported")).toBe(
      true
    );
    expect(
      analysis.concepts.flatMap((concept) => concept.evidenceRefs.map((ref) => ref.documentId))
    ).toEqual(expect.arrayContaining(["doc-physics", "doc-history"]));
  });

  it("keeps a zero-hit concept unknown when auxiliary freshness is unproven", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "entropy" }],
      dependencies: dependencies([]),
    });
    expect(analysis.indexCompleteness).toBe("partial");
    expect(analysis.concepts[0].evidenceCoverage).toBe("unknown");
    expect(analysis.concepts[0].evidenceCoverage).not.toBe("not-covered");
  });

  it("drops a deleted annotation and reports the unresolved limitation", async () => {
    const deps = dependencies([
      baseHit({
        chunkId: "chunk-annotation",
        documentId: "doc-physics",
        sourceType: "annotation",
        sourceId: "ann-deleted",
        text: "Gravity means the attraction between masses.",
      }),
    ]);
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps,
    });
    expect(analysis.concepts[0].evidenceRefs).toHaveLength(0);
    expect(analysis.concepts[0].limitations).toContain("coverage.limitation.unresolved-hit");
  });

  it("never writes learner state while inspecting coverage", async () => {
    const deps = dependencies([]);
    await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps,
    });
    // The dependency surface has no scheduling/review write at all.
    expect(Object.keys(deps)).not.toContain("submitReview");
    expect(Object.keys(deps)).not.toContain("recordActivity");
  });
});
