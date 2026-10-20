import { describe, expect, it } from "vitest";
import { createRelationshipAdapter } from "../relationshipAdapter";
import type { RelationshipEvidenceHandle } from "../../../schemas/conceptRelationship";

const handles: RelationshipEvidenceHandle[] = [
  { handle: "concept:gravity", kind: "concept", id: "gravity", label: "Gravity", conceptName: "Gravity" },
  {
    handle: "evidence:chunk:c1",
    kind: "chunk",
    id: "c1",
    label: "Gravity is a force",
    documentId: "d1",
    sourceRevision: "rev-1",
  },
  {
    handle: "evidence:card:card-1",
    kind: "card",
    id: "card-1",
    label: "What is gravity?",
    documentId: "d1",
    sourceRevision: "rev-2",
  },
];

function adapter(overrides: Partial<Parameters<typeof createRelationshipAdapter>[0]> = {}) {
  return createRelationshipAdapter({
    enabled: true,
    prerequisitesEnabled: true,
    evidenceHandles: handles,
    analysisId: "run-1",
    ...overrides,
  });
}

describe("createRelationshipAdapter", () => {
  it("returns typed unavailable when concept links are disabled", () => {
    expect(
      adapter({ enabled: false }).propose({
        sourceHandle: "concept:gravity",
        targetHandle: "evidence:chunk:c1",
        relationType: "supports",
        confidence: 0.9,
      })
    ).toMatchObject({ status: "unavailable", reason: "links-disabled" });
  });

  it("returns typed unavailable when prerequisites are unavailable", () => {
    expect(
      adapter({ prerequisitesEnabled: false }).propose({
        sourceHandle: "concept:gravity",
        targetHandle: "evidence:chunk:c1",
        relationType: "supports",
        confidence: 0.9,
      })
    ).toMatchObject({ status: "unavailable", reason: "prerequisites-disabled" });
  });

  it("returns typed unavailable without verified evidence handles", () => {
    expect(
      adapter({ evidenceHandles: [] }).propose({
        sourceHandle: "concept:gravity",
        targetHandle: "evidence:chunk:c1",
        relationType: "supports",
        confidence: 0.9,
      })
    ).toMatchObject({ status: "unavailable", reason: "missing-evidence" });
  });

  it("rejects injected endpoints, self-edges, unsupported types and low confidence", () => {
    const instance = adapter();
    expect(
      instance.propose({
        sourceHandle: "concept:invented",
        targetHandle: "evidence:chunk:c1",
        relationType: "supports",
        confidence: 0.9,
      }).status
    ).toBe("invalid");
    expect(
      instance.propose({
        sourceHandle: "concept:gravity",
        targetHandle: "concept:gravity",
        relationType: "supports",
        confidence: 0.9,
      }).status
    ).toBe("invalid");
    expect(
      instance.propose({
        sourceHandle: "concept:gravity",
        targetHandle: "evidence:chunk:c1",
        relationType: "derives-from",
        confidence: 0.9,
      }).status
    ).toBe("invalid");
    expect(
      instance.propose({
        sourceHandle: "concept:gravity",
        targetHandle: "evidence:chunk:c1",
        relationType: "supports",
        confidence: 0.5,
      }).status
    ).toBe("invalid");
  });

  it("never fabricates a concept from a document/card endpoint pair", () => {
    expect(
      adapter().propose({
        sourceHandle: "evidence:chunk:c1",
        targetHandle: "evidence:card:card-1",
        relationType: "related-to",
        confidence: 0.95,
      })
    ).toMatchObject({ status: "invalid" });
  });

  it("stages at most five drafts per analysis", () => {
    const instance = createRelationshipAdapter({
      enabled: true,
      prerequisitesEnabled: true,
      evidenceHandles: [
        ...handles,
        ...Array.from({ length: 6 }, (_, index) => ({
          handle: `evidence:chunk:extra-${index}`,
          kind: "chunk" as const,
          id: `extra-${index}`,
          label: `Extra ${index}`,
          documentId: "d1",
          sourceRevision: "rev",
        })),
      ],
      analysisId: "run-cap",
    });
    for (let index = 0; index < 5; index += 1) {
      expect(
        instance.propose({
          sourceHandle: "concept:gravity",
          targetHandle: `evidence:chunk:extra-${index}`,
          relationType: "supports",
          confidence: 0.9,
        }).status
      ).toBe("draft");
    }
    expect(
      instance.propose({
        sourceHandle: "concept:gravity",
        targetHandle: "evidence:chunk:extra-5",
        relationType: "supports",
        confidence: 0.9,
      }).status
    ).toBe("invalid");
    expect(instance.drafts).toHaveLength(5);
  });

  it("returns a draft-only proposal with provenance and no durable id", () => {
    const result = adapter().propose({
      sourceHandle: "concept:gravity",
      targetHandle: "evidence:chunk:c1",
      relationType: "supports",
      confidence: 0.9,
      rationale: "The source states the definition.",
    });
    expect(result.status).toBe("draft");
    if (result.status !== "draft") return;
    expect(result.draft.origin).toBe("ai");
    expect(result.draft.status).toBe("draft");
    expect(result.draft.analysisId).toBe("run-1");
    expect(result.draft.fingerprint).toContain("concept-link-v1");
    expect(result.draft.evidence[0]).toMatchObject({ kind: "chunk", id: "c1" });
  });
});
