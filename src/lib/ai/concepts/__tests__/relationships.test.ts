import { describe, expect, it, vi } from "vitest";
import {
  ConceptRelationshipAnalysisOwner,
  EMPTY_PREREQUISITES_MESSAGE,
  buildRelationshipDraft,
  discoverRelatedContent,
  relationshipTaskHandles,
  type RelationshipAnalysisOwnerDeps,
} from "../relationships";
import type { CoverageAnalysisResult, ConceptCoverage } from "../coverage";
import { canonicalConceptLinkFingerprint } from "../../../../api/concept-links";

function coverageFor(
  concepts: Array<{ key: string; name: string; refs?: Array<{ kind: "chunk" | "card"; id: string; documentId: string }> }>
): CoverageAnalysisResult {
  const items: ConceptCoverage[] = concepts.map((concept) => ({
    conceptKey: concept.key,
    conceptName: concept.name,
    evidenceCoverage: concept.refs?.length ? "partial" : "unknown",
    activity: "none",
    indexCompleteness: "partial",
    evidenceRefs: (concept.refs ?? []).map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      documentId: ref.documentId,
      sourceRevision: "rev",
      locator: {
        kind: "chunk",
        sourceType: "text",
        chunkId: ref.id,
        documentId: ref.documentId,
        ordinal: 0,
        startOffset: 0,
        endOffset: 0,
      },
      strength: "mention",
      text: `Evidence for ${concept.name}`,
    })),
    limitations: [],
  }));
  return {
    concepts: items,
    indexCompleteness: "partial",
    limitations: [],
    blocked: false,
  };
}

function prerequisites(concepts: Array<{ concept: string; why?: string }>) {
  return {
    analysis: {
      prerequisites: concepts.map((concept) => ({
        concept: concept.concept,
        why: concept.why ?? "Needed for this passage.",
      })),
    },
    run: {},
  } as never;
}

function relationshipRun(proposals: Array<{ sourceHandle: string; targetHandle: string; relationType: string; confidence: number; rationale?: string }>) {
  return {
    proposals: proposals.map((proposal) => ({
      ...proposal,
      rationale: proposal.rationale ?? "Grounded in the supplied evidence.",
    })),
    rejected: [],
    run: {},
  } as never;
}

function ownerDeps(overrides: Partial<RelationshipAnalysisOwnerDeps> = {}): RelationshipAnalysisOwnerDeps {
  return {
    prerequisitesEnabled: true,
    linksEnabled: true,
    preflight: vi.fn(async () => ({
      generationPath: "ondevice" as const,
      generationRemote: false,
      embeddingRemote: false,
      allowed: true,
      limitations: [],
    })),
    runPrerequisites: vi.fn(async () => prerequisites([{ concept: "Gravity" }])),
    runCoverage: vi.fn(async () => coverageFor([{ key: "gravity", name: "Gravity" }])),
    runRelationships: vi.fn(async () =>
      relationshipRun([
        {
          sourceHandle: "draft:concept:0",
          targetHandle: "evidence:chunk:c1",
          relationType: "prerequisite-of",
          confidence: 0.9,
        },
      ])
    ),
    findConcepts: vi.fn(async () => []),
    fingerprintDismissed: vi.fn(async () => false),
    now: () => 1_000,
    ...overrides,
  };
}

const passage = "Gravity attracts masses and shapes planetary orbits.";

describe("canonical relationship fingerprints", () => {
  it("sorts symmetric endpoints but preserves direction", () => {
    const forward = canonicalConceptLinkFingerprint({
      sourceKind: "concept",
      sourceId: "a",
      targetKind: "concept",
      targetId: "b",
      relationType: "same-as",
      sourceRevision: "r1",
      targetRevision: "r2",
    });
    const backward = canonicalConceptLinkFingerprint({
      sourceKind: "concept",
      sourceId: "b",
      targetKind: "concept",
      targetId: "a",
      relationType: "same-as",
      sourceRevision: "r2",
      targetRevision: "r1",
    });
    expect(forward).toBe(backward);

    const directionalForward = canonicalConceptLinkFingerprint({
      sourceKind: "concept",
      sourceId: "a",
      targetKind: "concept",
      targetId: "b",
      relationType: "prerequisite-of",
    });
    const directionalBackward = canonicalConceptLinkFingerprint({
      sourceKind: "concept",
      sourceId: "b",
      targetKind: "concept",
      targetId: "a",
      relationType: "prerequisite-of",
    });
    expect(directionalForward).not.toBe(directionalBackward);
  });

  it("includes evidence revisions and policy version", () => {
    const base = {
      sourceKind: "concept",
      sourceId: "a",
      targetKind: "concept",
      targetId: "b",
      relationType: "related-to",
    };
    expect(canonicalConceptLinkFingerprint({ ...base, sourceRevision: "r1" })).not.toBe(
      canonicalConceptLinkFingerprint({ ...base, sourceRevision: "r2" })
    );
    expect(canonicalConceptLinkFingerprint({ ...base, policyVersion: "v2" })).not.toBe(
      canonicalConceptLinkFingerprint({ ...base, policyVersion: "v1" })
    );
  });
});

describe("ConceptRelationshipAnalysisOwner", () => {
  it("dedupes case/whitespace variants, caps 12, and never merges synonyms", async () => {
    const runCoverage = vi.fn(async () => coverageFor([]));
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({
        runPrerequisites: vi.fn(async () =>
          prerequisites(
            Array.from({ length: 14 }, (_, index) => ({
              concept: index < 2 ? (index === 0 ? "Gravity" : "  gravity ") : `Concept ${index}`,
            }))
          )
        ),
        runCoverage,
      })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.prerequisites.map((p) => p.conceptKey)).toEqual([
      "gravity",
      "concept 2",
      "concept 3",
      "concept 4",
      "concept 5",
      "concept 6",
      "concept 7",
      "concept 8",
      "concept 9",
      "concept 10",
      "concept 11",
      "concept 12",
    ]);
    expect((runCoverage.mock.calls[0] as unknown[])[0]).toMatchObject({ concepts: expect.any(Array) });
    expect(((runCoverage.mock.calls[0] as unknown[])[0] as { concepts: unknown[] }).concepts).toHaveLength(12);
  });

  it("keeps prerequisites independent from concept links", async () => {
    const runRelationships = vi.fn();
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({ linksEnabled: false, runRelationships })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.status).toBe("coverage-only");
    expect(outcome.prerequisites).toHaveLength(1);
    expect(outcome.drafts).toHaveLength(0);
    expect(runRelationships).not.toHaveBeenCalled();
  });

  it("keeps related-content discovery independent of prerequisite inference", async () => {
    const runPrerequisites = vi.fn();
    const runCoverage = vi.fn();
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({ prerequisitesEnabled: false, runPrerequisites, runCoverage })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.status).toBe("coverage-only");
    expect(runPrerequisites).not.toHaveBeenCalled();
    expect(runCoverage).not.toHaveBeenCalled();
  });

  it("states only the exact empty inference message", async () => {
    const runCoverage = vi.fn();
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({
        runPrerequisites: vi.fn(async () => prerequisites([])),
        runCoverage,
      })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.status).toBe("empty");
    expect(outcome.emptyMessage).toBe(EMPTY_PREREQUISITES_MESSAGE);
    expect(outcome.emptyMessage).not.toMatch(/you (know|are missing)/i);
    expect(runCoverage).not.toHaveBeenCalled();
  });

  it("does no work when preflight denies a remote destination", async () => {
    const runPrerequisites = vi.fn();
    const runCoverage = vi.fn();
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({
        preflight: vi.fn(async () => ({
          generationPath: "cloud" as const,
          generationRemote: true,
          embeddingRemote: true,
          allowed: false,
          limitations: ["relationships.limitation.generation-denied"],
        })),
        runPrerequisites,
        runCoverage,
      })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.status).toBe("denied");
    expect(runPrerequisites).not.toHaveBeenCalled();
    expect(runCoverage).not.toHaveBeenCalled();
  });

  it("cancels before generation and never proceeds to retrieval", async () => {
    let release: ((value: never) => void) | undefined;
    const runPrerequisites = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve as never;
        })
    );
    const runCoverage = vi.fn();
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({ runPrerequisites: runPrerequisites as never, runCoverage })
    );
    const pending = owner.start({ passage });
    owner.cancel();
    release?.(prerequisites([{ concept: "Gravity" }]) as never);
    const outcome = await pending;
    expect(outcome.status).toBe("cancelled");
    expect(runCoverage).not.toHaveBeenCalled();
  });

  it("a late result cannot replace a newer selection", async () => {
    let resolveFirst: ((value: never) => void) | undefined;
    const runPrerequisites = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve as never;
          })
      )
      .mockImplementationOnce(async () => prerequisites([{ concept: "Second" }]));
    const runCoverage = vi.fn(async () => coverageFor([{ key: "second", name: "Second" }]));
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({ runPrerequisites: runPrerequisites as never, runCoverage })
    );

    const first = owner.start({ passage: "First passage" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = owner.start({ passage: "Second passage" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    resolveFirst?.(prerequisites([{ concept: "First" }]) as never);

    const firstOutcome = await first;
    const secondOutcome = await second;
    expect(firstOutcome.status).toBe("cancelled");
    expect(secondOutcome.prerequisites[0].concept).toBe("Second");
  });

  it("surfaces malformed/unavailable generation as a safe unavailable state", async () => {
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({
        runPrerequisites: vi.fn(async () => {
          throw new Error("InvalidStructuredOutput");
        }),
      })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.prerequisites).toHaveLength(0);
    expect(outcome.error).toBeTruthy();
  });

  it("builds typed drafts only for proposals that resolve at least one concept", async () => {
    const runRelationships = vi.fn(async () =>
      relationshipRun([
        {
          sourceHandle: "draft:concept:0",
          targetHandle: "evidence:chunk:c1",
          relationType: "prerequisite-of",
          confidence: 0.9,
        },
        {
          sourceHandle: "evidence:chunk:c1",
          targetHandle: "evidence:chunk:c2",
          relationType: "related-to",
          confidence: 0.95,
        },
      ])
    );
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({
        runRelationships,
        runCoverage: vi.fn(async () =>
          coverageFor([
            {
              key: "gravity",
              name: "Gravity",
              refs: [
                { kind: "chunk", id: "c1", documentId: "d1" },
                { kind: "chunk", id: "c2", documentId: "d1" },
              ],
            },
          ])
        ),
      })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.status).toBe("complete");
    expect(outcome.drafts).toHaveLength(1);
    expect(outcome.drafts[0].source.kind).toBe("concept");
    expect(outcome.drafts[0].target.kind).toBe("chunk");
    expect(outcome.drafts[0].origin).toBe("ai");
  });

  it("suppresses dismissed fingerprints", async () => {
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({
        fingerprintDismissed: vi.fn(async () => true),
        runCoverage: vi.fn(async () =>
          coverageFor([
            {
              key: "gravity",
              name: "Gravity",
              refs: [{ kind: "chunk", id: "c1", documentId: "d1" }],
            },
          ])
        ),
      })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.drafts).toHaveLength(0);
    expect(outcome.limitations).toContain("relationships.limitation.dismissed");
  });

  it("does not write before an explicit save/accept", async () => {
    const owner = new ConceptRelationshipAnalysisOwner(
      ownerDeps({
        runCoverage: vi.fn(async () =>
          coverageFor([
            {
              key: "gravity",
              name: "Gravity",
              refs: [{ kind: "chunk", id: "c1", documentId: "d1" }],
            },
          ])
        ),
      })
    );
    const outcome = await owner.start({ passage });
    expect(outcome.status).toBe("complete");
    // Drafts are plain objects; no persisted id/origin mutation.
    expect(outcome.drafts[0].status).toBe("draft");
  });
});

describe("relationshipTaskHandles", () => {
  it("bounds verified handles to concepts plus evidence", () => {
    const handleSet = relationshipTaskHandles({
      prerequisites: [
        { concept: "Gravity", why: "", conceptKey: "gravity", draftHandle: "draft:concept:0" },
      ],
      coverage: [
        {
          conceptKey: "gravity",
          conceptName: "Gravity",
          evidenceCoverage: "partial",
          activity: "none",
          indexCompleteness: "partial",
          limitations: [],
          evidenceRefs: [
            {
              kind: "chunk",
              id: "c1",
              documentId: "d1",
              sourceRevision: "r",
              locator: {
                kind: "chunk",
                sourceType: "text",
                chunkId: "c1",
                documentId: "d1",
                ordinal: 0,
                startOffset: 0,
                endOffset: 0,
              },
              strength: "mention",
              text: "Gravity",
            },
          ],
        },
      ],
    });
    expect(handleSet.handles.map((handle) => handle.handle)).toEqual([
      "draft:concept:0",
      "evidence:chunk:c1",
    ]);
  });
});

describe("buildRelationshipDraft", () => {
  it("uses the app-generated fingerprint, never a model string", () => {
    const draft = buildRelationshipDraft({
      analysisId: "analysis-1",
      source: { handle: "draft:concept:0", kind: "concept", conceptName: "Gravity", label: "Gravity" },
      target: { handle: "evidence:chunk:c1", kind: "chunk", id: "c1", label: "Source" },
      relationType: "supports",
      confidence: 0.9,
      rationale: "Grounded.",
      evidence: [],
    });
    expect(draft.fingerprint).toContain("concept-link-v1");
    expect(draft.fingerprint).not.toBe("model-fingerprint");
  });
});

describe("discoverRelatedContent", () => {
  it("returns verified retrievable sources without writing", async () => {
    const result = await discoverRelatedContent({
      passage: "Gravity attracts masses.",
      documentId: "d1",
      dependencies: {
        preflight: async () => ({ allowed: true, remote: false, limitations: [] }),
        retrieve: vi.fn(async () => ({
          results: [
            {
              chunkId: "c1",
              documentId: "d1",
              sourceType: "document" as const,
              ordinal: 0,
              text: "Gravity attracts masses.",
              headingPath: [],
              location: {
                sourceType: "text" as const,
                documentId: "d1",
                ordinal: 0,
                startOffset: 0,
                endOffset: 24,
              },
              contentHash: "h",
              tokenCount: 4,
              score: 0.9,
              mode: "lexicalOnly" as const,
            },
          ],
          mode: "lexicalOnly" as const,
          candidatesScanned: 1,
        })),
        getDocument: vi.fn(async (id: string) => ({
          id,
          title: "Physics",
          contentHash: "rev",
          dateModified: "2026-01-01",
          tags: [],
        })) as never,
        listLinksFor: vi.fn(async () => []),
        getConcept: vi.fn(async () => null),
      },
    });
    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].documentId).toBe("d1");
  });

  it("returns typed unavailable when remote work is denied", async () => {
    const retrieve = vi.fn();
    const result = await discoverRelatedContent({
      passage: "Gravity attracts masses.",
      dependencies: {
        preflight: async () => ({ allowed: false, remote: true, limitations: ["denied"] }),
        retrieve,
      },
    });
    expect(result.status).toBe("unavailable");
    expect(retrieve).not.toHaveBeenCalled();
  });
});
