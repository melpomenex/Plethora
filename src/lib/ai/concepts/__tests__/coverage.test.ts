import { describe, expect, it, vi } from "vitest";
import type {
  CoverageDependencies,
  CoverageScope,
  CoverageAnnotationRecord,
} from "../coverage";
import {
  COVERAGE_LIMITATIONS,
  COVERAGE_RETRIEVAL_K,
  MAX_COVERAGE_CONCEPTS,
  computeActivity,
  computeEvidenceCoverage,
  conceptPhrasePattern,
  hasConceptMention,
  hasDefinitionHeading,
  hasInlineDefinitionCue,
  needsNonEnglishCueLimitation,
  runCoverageAnalysis,
  sourceStillContains,
} from "../coverage";
import type { RetrievalResponse, IndexStatusResponse } from "../../../../api/ai-learning";
import type { Document } from "../../../../types/document";

const doc = (id: string, content: string, overrides: Partial<Document> = {}): Document =>
  ({
    id,
    title: `Doc ${id}`,
    filePath: `/tmp/${id}.txt`,
    fileType: "other",
    content,
    contentHash: `hash-${id}`,
    tags: [],
    dateAdded: "2026-01-01T00:00:00Z",
    dateModified: "2026-01-01T00:00:00Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
    ...overrides,
  }) as Document;

function indexStatus(
  documents: Array<{ documentId: string; state: string; chunksIndexed: number; totalChunks: number }>
): IndexStatusResponse {
  return {
    aggregate: {
      totalDocuments: documents.length,
      indexedDocuments: documents.filter((d) => d.state === "indexed").length,
      queuedDocuments: 0,
      indexingDocuments: 0,
      staleDocuments: 0,
      failedDocuments: 0,
      totalChunks: documents.reduce((sum, d) => sum + d.chunksIndexed, 0),
      totalEmbeddings: 0,
      embeddingStorageBytes: 0,
      embeddingModels: [],
      paused: false,
      pendingDocuments: 0,
    },
    documents: documents.map((d) => ({
      documentId: d.documentId,
      state: d.state as never,
      chunksIndexed: d.chunksIndexed,
      totalChunks: d.totalChunks,
      updatedAt: "2026-01-01T00:00:00Z",
    })),
  };
}

function hit(input: {
  chunkId: string;
  documentId: string;
  text: string;
  sourceType?: string;
  sourceId?: string;
}): RetrievalResponse["results"][number] {
  return {
    chunkId: input.chunkId,
    documentId: input.documentId,
    sourceType: input.sourceType ?? "document",
    sourceId: input.sourceId,
    ordinal: 0,
    text: input.text,
    headingPath: [],
    location: {
      sourceType: "text",
      documentId: input.documentId,
      ordinal: 0,
      startOffset: 0,
      endOffset: input.text.length,
    },
    contentHash: "chunk-hash",
    tokenCount: 12,
    score: 0.9,
    mode: "lexicalOnly",
  };
}

function deps(overrides: Partial<CoverageDependencies> = {}): CoverageDependencies {
  return {
    retrieve: vi.fn(async () => ({ results: [], mode: "lexicalOnly" as const, candidatesScanned: 0 })),
    getIndexStatus: vi.fn(async () => indexStatus([{ documentId: "d1", state: "indexed", chunksIndexed: 4, totalChunks: 4 }])),
    getDocument: vi.fn(async (id: string) => doc(id, "Gravity is a force that attracts masses.")),
    getExtract: vi.fn(async () => null),
    getLearningItem: vi.fn(async () => null),
    getAnnotation: vi.fn(async () => null),
    getItemStatsSummary: vi.fn(async () => ({
      repetitions: { state: "value", value: 0 },
      totalActiveSeconds: { state: "value", value: 0 },
    })),
    findConceptsByNames: vi.fn(async () => []),
    getConceptBacklinks: vi.fn(async () => []),
    listConceptLinksFor: vi.fn(async () => []),
    getConcept: vi.fn(async () => null),
    preflight: vi.fn(async () => ({ allowed: true, remote: false, limitations: [] })),
    ...overrides,
  };
}

describe("coverage-v1 predicates", () => {
  it("normalizes whitespace/case and enforces token boundaries", () => {
    expect(conceptPhrasePattern("  Gravity   Wells ").test("gravity wells")).toBe(true);
    expect(hasConceptMention("The gravity well is deep", "gravity well")).toBe(true);
    expect(hasConceptMention("The antigravity well is fake", "gravity well")).toBe(false);
    expect(hasConceptMention("Gravité is French", "gravity")).toBe(false);
    expect(hasConceptMention("An alias appears", "canonical", ["alias"])).toBe(true);
  });

  it("recognizes exact definition cues only for the phrase", () => {
    expect(hasInlineDefinitionCue("Gravity is a force.", "gravity")).toBe(true);
    expect(hasInlineDefinitionCue("Entropy means disorder.", "entropy")).toBe(true);
    expect(hasInlineDefinitionCue("Paging refers to memory blocks.", "paging")).toBe(true);
    expect(hasInlineDefinitionCue("Gravity wells are fun.", "gravity")).toBe(false);
    expect(hasInlineDefinitionCue("Antigravity is fictional.", "gravity")).toBe(false);
  });

  it("accepts a heading exactly naming the concept with >=60 substantive chars", () => {
    const body = "x".repeat(60);
    expect(hasDefinitionHeading(`# Gravity\n\n${body}`, "gravity")).toBe(true);
    expect(hasDefinitionHeading(`# Gravity\n\nshort`, "gravity")).toBe(false);
    expect(hasDefinitionHeading(body, "gravity", [], ["Gravity"])).toBe(true);
    expect(hasDefinitionHeading(body, "gravity", [], ["Gravity wells"])).toBe(false);
  });

  it("flags non-Latin scripts as outside the English cue ruleset", () => {
    expect(needsNonEnglishCueLimitation("gravity")).toBe(false);
    expect(needsNonEnglishCueLimitation("重力")).toBe(true);
    expect(needsNonEnglishCueLimitation("гравитация")).toBe(true);
  });

  it("computes the four states deterministically", () => {
    expect(
      computeEvidenceCoverage({
        refs: [{ strength: "direct" }],
        indexCompleteness: "partial",
        queriesSucceeded: true,
      })
    ).toBe("supported");
    expect(
      computeEvidenceCoverage({
        refs: [{ strength: "mention" }],
        indexCompleteness: "complete",
        queriesSucceeded: true,
      })
    ).toBe("partial");
    expect(
      computeEvidenceCoverage({ refs: [], indexCompleteness: "complete", queriesSucceeded: true })
    ).toBe("not-covered");
    expect(
      computeEvidenceCoverage({ refs: [], indexCompleteness: "partial", queriesSucceeded: true })
    ).toBe("unknown");
    expect(
      computeEvidenceCoverage({ refs: [], indexCompleteness: "unavailable", queriesSucceeded: true })
    ).toBe("unknown");
    expect(
      computeEvidenceCoverage({ refs: [], indexCompleteness: "complete", queriesSucceeded: false })
    ).toBe("unknown");
  });

  it("keeps activity independent of evidence and out of scheduling", () => {
    expect(
      computeActivity({
        hasSupportingCard: true,
        hasSupportingExtract: false,
        reviewedCard: true,
        documentEncountered: true,
      })
    ).toBe("reviewed");
    expect(
      computeActivity({
        hasSupportingCard: false,
        hasSupportingExtract: true,
        reviewedCard: false,
        documentEncountered: true,
      })
    ).toBe("studied");
    expect(
      computeActivity({
        hasSupportingCard: false,
        hasSupportingExtract: false,
        reviewedCard: false,
        documentEncountered: true,
      })
    ).toBe("encountered");
    expect(
      computeActivity({
        hasSupportingCard: false,
        hasSupportingExtract: false,
        reviewedCard: false,
        documentEncountered: false,
      })
    ).toBe("none");
  });

  it("verifies text against the current source", () => {
    expect(sourceStillContains("Gravity   is a force.", "Gravity is a force.")).toBe(true);
    expect(sourceStillContains("Edited text", "Gravity is a force")).toBe(false);
  });
});

describe("runCoverageAnalysis", () => {
  it("counts a verified definition mention as supported", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps({
        retrieve: vi.fn(async () => ({
          results: [hit({ chunkId: "c1", documentId: "d1", text: "Gravity is a force that attracts masses." })],
          mode: "lexicalOnly" as const,
          candidatesScanned: 1,
        })),
      }),
    });
    expect(analysis.concepts[0].evidenceCoverage).toBe("supported");
    expect(analysis.concepts[0].evidenceRefs).toHaveLength(1);
    expect(analysis.concepts[0].evidenceRefs[0].strength).toBe("direct");
  });

  it("counts a bare mention as partial", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps({
        getDocument: vi.fn(async (id: string) =>
          doc(id, "Gravity shapes the orbits of planets and moons.")
        ),
        retrieve: vi.fn(async () => ({
          results: [
            hit({
              chunkId: "c1",
              documentId: "d1",
              text: "Gravity shapes the orbits of planets and moons.",
            }),
          ],
          mode: "lexicalOnly" as const,
          candidatesScanned: 1,
        })),
      }),
    });
    expect(analysis.concepts[0].evidenceCoverage).toBe("partial");
    expect(analysis.concepts[0].evidenceRefs[0].strength).toBe("mention");
  });

  it("returns not-covered only for a provably complete document-only scope", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      scope: { documentIds: ["d1"], includeAuxiliarySources: false },
      dependencies: deps({
        retrieve: vi.fn(async () => ({ results: [], mode: "lexicalOnly" as const, candidatesScanned: 0 })),
      }),
    });
    expect(analysis.indexCompleteness).toBe("complete");
    expect(analysis.concepts[0].evidenceCoverage).toBe("not-covered");
  });

  it("never claims not-covered when card/annotation freshness is unproven", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps(),
    });
    expect(analysis.indexCompleteness).toBe("partial");
    expect(analysis.concepts[0].evidenceCoverage).toBe("unknown");
    expect(analysis.concepts[0].limitations).toContain(
      COVERAGE_LIMITATIONS.auxiliaryFreshnessUnproven
    );
  });

  it("uses k=6 and never exceeds the 72-candidate budget", async () => {
    const retrieve = vi.fn(async () => ({
      results: Array.from({ length: 6 }, (_, index) =>
        hit({
          chunkId: `c${index}`,
          documentId: "d1",
          text: `Gravity chunk ${index}`,
        })
      ),
      mode: "lexicalOnly" as const,
      candidatesScanned: 6,
    }));
    const concepts = Array.from({ length: MAX_COVERAGE_CONCEPTS + 3 }, (_, index) => ({
      name: `concept ${index}`,
    }));
    const analysis = await runCoverageAnalysis({ concepts, dependencies: deps({ retrieve }) });
    expect(analysis.concepts).toHaveLength(MAX_COVERAGE_CONCEPTS);
    expect(retrieve).toHaveBeenCalledTimes(MAX_COVERAGE_CONCEPTS);
    expect((retrieve.mock.calls[0] as unknown as [string, { k?: number }])[1].k).toBe(COVERAGE_RETRIEVAL_K);
    const totalRefs = analysis.concepts.reduce((sum, concept) => sum + concept.evidenceRefs.length, 0);
    expect(totalRefs).toBeLessThanOrEqual(72);
  });

  it("dedupes case/whitespace variants without merging synonyms", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "Gravity" }, { name: "  gravity " }, { name: "gravitation" }],
      dependencies: deps(),
    });
    expect(analysis.concepts.map((c) => c.conceptKey)).toEqual(["gravity", "gravitation"]);
  });

  it("does not count fabricated or stale evidence ids", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps({
        retrieve: vi.fn(async () => ({
          results: [
            hit({ chunkId: "missing", documentId: "nope", text: "Gravity is a force." }),
            hit({ chunkId: "stale", documentId: "d1", text: "Gravity is a force." }),
          ],
          mode: "lexicalOnly" as const,
          candidatesScanned: 2,
        })),
        getDocument: vi.fn(async (id: string) =>
          id === "d1" ? doc("d1", "The source was edited.") : null
        ),
      }),
    });
    expect(analysis.concepts[0].evidenceRefs).toHaveLength(0);
    expect(analysis.concepts[0].evidenceCoverage).toBe("unknown");
    expect(analysis.concepts[0].limitations).toContain(COVERAGE_LIMITATIONS.unresolvedHit);
  });

  it("marks retrieval failure as unknown with a limitation", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps({
        retrieve: vi.fn(async () => {
          throw new Error("index offline");
        }),
      }),
    });
    expect(analysis.concepts[0].evidenceCoverage).toBe("unknown");
    expect(analysis.concepts[0].limitations).toContain(COVERAGE_LIMITATIONS.retrievalFailed);
  });

  it("honors confirmed aliases and user-confirmed definition links", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity", conceptId: "concept-1" }],
      dependencies: deps({
        findConceptsByNames: vi.fn(async () => [
          {
            id: "concept-1",
            name: "Gravity",
            normalizedName: "gravity",
            createdAt: "",
            updatedAt: "",
          },
        ]),
        getConceptBacklinks: vi.fn(async () => [
          {
            id: "link-1",
            sourceKind: "concept",
            sourceId: "concept-2",
            sourceConceptName: "gravitation",
            targetKind: "concept",
            targetId: "concept-1",
            relationType: "same-as",
            confidence: 0.95,
            createdBy: "user",
            createdAt: "",
            isDismissed: false,
          },
          {
            id: "link-2",
            sourceKind: "document",
            sourceId: "d2",
            targetKind: "concept",
            targetId: "concept-1",
            relationType: "definition-of",
            confidence: 0.95,
            createdBy: "user",
            createdAt: "",
            isDismissed: false,
          },
        ]),
        getDocument: vi.fn(async (id: string) =>
          id === "d2"
            ? doc("d2", "Gravitation is the mutual attraction between masses.")
            : doc(id, "Gravity shapes orbits.")
        ),
        retrieve: vi.fn(async () => ({
          results: [hit({ chunkId: "c1", documentId: "d1", text: "Gravity shapes orbits." })],
          mode: "lexicalOnly" as const,
          candidatesScanned: 1,
        })),
      }),
    });
    expect(analysis.concepts[0].evidenceCoverage).toBe("supported");
    expect(analysis.concepts[0].evidenceRefs.some((ref) => ref.id === "concept-link:link-2")).toBe(
      true
    );
  });

  it("treats a card mention as direct and reads validated review history", async () => {
    const card = {
      id: "card-1",
      document_id: "d1",
      item_type: "Flashcard",
      question: "What does gravity do?",
      answer: "It attracts masses.",
      difficulty: 0,
      interval: 0,
      ease_factor: 2.5,
      due_date: "",
      date_created: "",
      date_modified: "2026-01-02T00:00:00Z",
      review_count: 2,
      lapses: 0,
      state: "Review",
      is_suspended: false,
      tags: [],
    } as never;
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps({
        getLearningItem: vi.fn(async () => card),
        getItemStatsSummary: vi.fn(async (_type, id) => ({
          repetitions: { state: "value", value: id === "card-1" ? 2 : 0 },
          totalActiveSeconds: { state: "value", value: 0 },
        })),
        retrieve: vi.fn(async () => ({
          results: [
            hit({
              chunkId: "card-chunk",
              documentId: "d1",
              sourceType: "card",
              sourceId: "card-1",
              text: "What does gravity do?",
            }),
          ],
          mode: "lexicalOnly" as const,
          candidatesScanned: 1,
        })),
      }),
    });
    expect(analysis.concepts[0].evidenceCoverage).toBe("supported");
    expect(analysis.concepts[0].activity).toBe("reviewed");
  });

  it("adds the non-English cue limitation while still counting mentions", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "重力" }],
      dependencies: deps({
        getDocument: vi.fn(async (id: string) => doc(id, "重力是物体之间的吸引力。")),
        retrieve: vi.fn(async () => ({
          results: [hit({ chunkId: "c1", documentId: "d1", text: "重力是物体之间的吸引力。" })],
          mode: "lexicalOnly" as const,
          candidatesScanned: 1,
        })),
      }),
    });
    expect(analysis.concepts[0].evidenceCoverage).toBe("partial");
    expect(analysis.concepts[0].limitations).toContain(COVERAGE_LIMITATIONS.englishCuesOnly);
  });

  it("blocks all queries when preflight denies remote work", async () => {
    const retrieve = vi.fn();
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps({ retrieve }),
      preflight: {
        allowed: false,
        remote: true,
        limitations: [COVERAGE_LIMITATIONS.remoteDenied],
      },
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(analysis.blocked).toBe(true);
    expect(analysis.concepts[0].evidenceCoverage).toBe("unknown");
  });

  it("returns unavailable index completeness when there is no index status", async () => {
    const analysis = await runCoverageAnalysis({
      concepts: [{ name: "gravity" }],
      dependencies: deps({ getIndexStatus: vi.fn(async () => indexStatus([])) }),
    });
    expect(analysis.indexCompleteness).toBe("unavailable");
    expect(analysis.concepts[0].evidenceCoverage).toBe("unknown");
  });
});
