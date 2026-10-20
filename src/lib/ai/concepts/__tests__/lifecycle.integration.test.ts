import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  saveConceptLinkSuggestions: vi.fn(),
  acceptConceptLink: vi.fn(),
  dismissConceptLink: vi.fn(),
  deleteConceptLink: vi.fn(),
  updateConceptLink: vi.fn(),
  conceptLinkFingerprintDismissed: vi.fn(async () => false),
  findConceptsByNames: vi.fn(async () => []),
  getConcept: vi.fn(async () => null),
  getConceptBacklinks: vi.fn(async () => []),
  listConceptLinksFor: vi.fn(async () => []),
  normalizeConceptName: (value: string) =>
    value.toLowerCase().split(/\s+/u).filter(Boolean).join(" "),
  canonicalConceptLinkFingerprint: vi.fn(() => "fp"),
}));

vi.mock("../../../../api/concept-links", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import {
  acceptRelationshipDraft,
  dismissRelationshipLink,
  editRelationshipLink,
  removeRelationshipLink,
  saveRelationshipDrafts,
  type RelationshipDraft,
} from "../relationships";
import type { ConceptLink } from "../../../../api/concept-links";

function draft(overrides: Partial<RelationshipDraft> = {}): RelationshipDraft {
  return {
    id: "draft-1",
    analysisId: "analysis-1",
    source: {
      handle: "draft:concept:0",
      kind: "concept",
      conceptName: "Gravity",
      label: "Gravity",
    },
    target: { handle: "evidence:chunk:c1", kind: "chunk", id: "c1", label: "Physics" },
    relationType: "prerequisite-of",
    confidence: 0.9,
    rationale: "Grounded in the source.",
    fingerprint: "fp-1",
    policyVersion: "relationship-policy-v1",
    origin: "ai",
    status: "draft",
    evidence: [
      {
        kind: "chunk",
        id: "c1",
        documentId: "doc-1",
        sourceRevision: "rev-1",
      },
    ],
    ...overrides,
  };
}

function link(overrides: Partial<ConceptLink> = {}): ConceptLink {
  return {
    id: "link-1",
    sourceKind: "concept",
    sourceId: "concept-1",
    targetKind: "chunk",
    targetId: "c1",
    relationType: "prerequisite-of",
    confidence: 0.9,
    createdBy: "ai",
    createdAt: "",
    isDismissed: false,
    origin: "ai",
    ...overrides,
  };
}

describe("relationship lifecycle wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends unresolved concept handles and provenance only on explicit save", async () => {
    api.saveConceptLinkSuggestions.mockResolvedValue([{ outcome: "created", link: link() }]);
    const saved = await saveRelationshipDrafts("analysis-1", [draft()]);
    expect(api.saveConceptLinkSuggestions).toHaveBeenCalledWith({
      analysisId: "analysis-1",
      proposals: [
        expect.objectContaining({
          sourceKind: "concept",
          sourceId: "draft:concept:0",
          targetKind: "chunk",
          targetId: "c1",
          relationType: "prerequisite-of",
          confidence: 0.9,
          sourceRevision: null,
          targetRevision: null,
          fingerprint: "fp-1",
          provenance: expect.objectContaining({
            analysisId: "analysis-1",
            policyVersion: "relationship-policy-v1",
            origin: "ai",
            taskId: "concept-relationship-analysis",
          }),
        }),
      ],
      newConcepts: [{ handle: "draft:concept:0", name: "Gravity" }],
    });
    expect(saved.results[0].outcome).toBe("created");
  });

  it("caps a save batch at five proposals", async () => {
    api.saveConceptLinkSuggestions.mockResolvedValue([]);
    await saveRelationshipDrafts(
      "analysis-1",
      Array.from({ length: 8 }, (_, index) => draft({ id: `draft-${index}` }))
    );
    expect(api.saveConceptLinkSuggestions.mock.calls[0][0].proposals).toHaveLength(5);
  });

  it("accepts a saved link with an endorsement command only", async () => {
    api.acceptConceptLink.mockResolvedValue(link({ createdBy: "user" }));
    const accepted = await acceptRelationshipDraft("analysis-1", draft(), link());
    expect(api.acceptConceptLink).toHaveBeenCalledWith("link-1");
    expect(accepted?.createdBy).toBe("user");
    expect(api.saveConceptLinkSuggestions).not.toHaveBeenCalled();
  });

  it("accepts an unsaved draft by saving then endorsing", async () => {
    api.saveConceptLinkSuggestions.mockResolvedValue([{ outcome: "created", link: link() }]);
    api.acceptConceptLink.mockResolvedValue(link({ createdBy: "user" }));
    const accepted = await acceptRelationshipDraft("analysis-1", draft());
    expect(api.saveConceptLinkSuggestions).toHaveBeenCalledTimes(1);
    expect(api.acceptConceptLink).toHaveBeenCalledWith("link-1");
    expect(accepted?.createdBy).toBe("user");
  });

  it("keeps dismissal distinct from removal", async () => {
    api.dismissConceptLink.mockResolvedValue(link({ isDismissed: true }));
    api.deleteConceptLink.mockResolvedValue(true);
    await dismissRelationshipLink("link-1");
    await removeRelationshipLink("link-1");
    expect(api.dismissConceptLink).toHaveBeenCalledWith("link-1");
    expect(api.deleteConceptLink).toHaveBeenCalledWith("link-1");
  });

  it("edits through the narrow update command and returns conflicts", async () => {
    api.updateConceptLink.mockResolvedValue({
      outcome: "conflict",
      link: null,
      conflictingLink: link({ id: "existing" }),
    });
    const result = await editRelationshipLink({
      linkId: "link-1",
      relationType: "supports",
      confidence: 0.8,
    });
    expect(api.updateConceptLink).toHaveBeenCalledWith({
      linkId: "link-1",
      relationType: "supports",
      confidence: 0.8,
    });
    expect(result.outcome).toBe("conflict");
  });

  it("propagates a failed batch so the caller can keep drafts visible", async () => {
    api.saveConceptLinkSuggestions.mockRejectedValueOnce(new Error("transaction rolled back"));
    await expect(saveRelationshipDrafts("analysis-1", [draft()])).rejects.toThrow(
      "transaction rolled back"
    );
  });
});
