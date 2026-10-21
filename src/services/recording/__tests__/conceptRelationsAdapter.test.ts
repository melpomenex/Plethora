import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  querySessionConceptRelations,
  linkSessionDocumentToConcept,
} from "../conceptRelationsAdapter";
import * as conceptLinksApi from "../../../api/concept-links";

vi.mock("../../../api/concept-links", () => ({
  findConceptsByNames: vi.fn(),
  getConceptBacklinks: vi.fn(),
  proposeConceptLink: vi.fn(),
  acceptConceptLink: vi.fn(),
  normalizeConceptName: (name: string) =>
    name.toLowerCase().split(/\s+/u).filter((p) => p.length > 0).join(" "),
}));

const SESSION_DOC_ID = "doc-session-quantum";

function makeConcept(
  overrides: Partial<conceptLinksApi.Concept> & Pick<conceptLinksApi.Concept, "id" | "name">
): conceptLinksApi.Concept {
  return {
    normalizedName: overrides.name.toLowerCase(),
    createdAt: "2026-10-15T10:00:00Z",
    updatedAt: "2026-10-15T10:00:00Z",
    ...overrides,
  };
}

function makeBacklink(
  overrides: Partial<conceptLinksApi.ConceptBacklink> &
    Pick<conceptLinksApi.ConceptBacklink, "id" | "sourceId" | "targetId">
): conceptLinksApi.ConceptBacklink {
  return {
    sourceKind: "document",
    targetKind: "concept",
    relationType: "supports",
    confidence: 0.95,
    createdBy: "user",
    createdAt: "2026-10-16T10:00:00Z",
    isDismissed: false,
    ...overrides,
  };
}

function makeLink(
  overrides: Partial<conceptLinksApi.ConceptLink> &
    Pick<conceptLinksApi.ConceptLink, "id" | "sourceId" | "targetId">
): conceptLinksApi.ConceptLink {
  return {
    sourceKind: "document",
    targetKind: "concept",
    relationType: "related-to",
    confidence: 1,
    createdBy: "user",
    createdAt: "2026-10-21T10:00:00Z",
    isDismissed: false,
    ...overrides,
  };
}

describe("Cross-Session Concept Relations Adapter (Task 5.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries bounded course concepts and maps existing concepts and other linked sources", async () => {
    const existingConcept = makeConcept({
      id: "concept-entanglement",
      name: "Quantum Entanglement",
      description: "Non-local quantum correlations",
    });

    vi.mocked(conceptLinksApi.findConceptsByNames).mockResolvedValue([existingConcept]);
    vi.mocked(conceptLinksApi.getConceptBacklinks).mockResolvedValue([
      makeBacklink({
        id: "link-1",
        sourceId: "doc-earlier-recording",
        targetId: existingConcept.id,
      }),
    ]);

    const result = await querySessionConceptRelations(SESSION_DOC_ID, [
      "Quantum Entanglement",
      "Wavefunction Collapse",
    ]);

    expect(result.available).toBe(true);
    expect(result.matches).toHaveLength(2);

    // Matched existing concept
    const entanglementMatch = result.matches.find(
      (m) => m.normalizedName === "quantum entanglement"
    );
    expect(entanglementMatch).toBeDefined();
    expect(entanglementMatch?.existingConcept?.id).toBe(existingConcept.id);
    expect(entanglementMatch?.isAlreadyLinkedToSession).toBe(false);
    expect(entanglementMatch?.otherLinkedSources).toHaveLength(1);
    expect(entanglementMatch?.otherLinkedSources[0].sourceId).toBe("doc-earlier-recording");
    // Distinguishes known evidence from mastery: reflects source linkages
    expect(entanglementMatch?.evidenceCoverage).toBe("partial");

    // Unmatched concept
    const collapseMatch = result.matches.find(
      (m) => m.normalizedName === "wavefunction collapse"
    );
    expect(collapseMatch).toBeDefined();
    expect(collapseMatch?.existingConcept).toBeUndefined();
    expect(collapseMatch?.evidenceCoverage).toBe("unknown");

    // Querying is read-only: no graph write happens merely by opening the
    // session overview.
    expect(conceptLinksApi.proposeConceptLink).not.toHaveBeenCalled();
    expect(conceptLinksApi.acceptConceptLink).not.toHaveBeenCalled();
  });

  it("counts only user-endorsed sources and never overstates coverage", async () => {
    const existingConcept = makeConcept({
      id: "concept-paxos",
      name: "Paxos",
    });

    vi.mocked(conceptLinksApi.findConceptsByNames).mockResolvedValue([existingConcept]);
    vi.mocked(conceptLinksApi.getConceptBacklinks).mockResolvedValue([
      // Pending AI proposal: a draft, not established evidence.
      makeBacklink({
        id: "link-pending",
        sourceId: "doc-ai-draft",
        targetId: existingConcept.id,
        createdBy: "ai",
      }),
      // Two relations from the same accepted source still count once.
      makeBacklink({
        id: "link-same-source-a",
        sourceId: "doc-textbook",
        targetId: existingConcept.id,
        createdBy: "user",
        relationType: "definition-of",
      }),
      makeBacklink({
        id: "link-same-source-b",
        sourceId: "doc-textbook",
        targetId: existingConcept.id,
        createdBy: "user",
        relationType: "supports",
      }),
    ]);

    const result = await querySessionConceptRelations(SESSION_DOC_ID, ["Paxos"]);

    const match = result.matches[0];
    expect(match.otherLinkedSources).toHaveLength(1);
    expect(match.otherLinkedSources[0].sourceId).toBe("doc-textbook");
    expect(match.evidenceCoverage).toBe("partial");
    expect(match.isAlreadyLinkedToSession).toBe(false);
  });

  it("detects when session is already linked to existing concept", async () => {
    const existingConcept = makeConcept({
      id: "concept-decoherence",
      name: "Decoherence",
    });

    vi.mocked(conceptLinksApi.findConceptsByNames).mockResolvedValue([existingConcept]);
    vi.mocked(conceptLinksApi.getConceptBacklinks).mockResolvedValue([
      makeBacklink({
        id: "link-session",
        sourceId: SESSION_DOC_ID, // Already linked to this session
        targetId: existingConcept.id,
        relationType: "related-to",
        confidence: 1,
      }),
      makeBacklink({
        id: "link-other",
        sourceId: "doc-textbook-chapter",
        targetId: existingConcept.id,
        relationType: "definition-of",
        confidence: 0.9,
      }),
    ]);

    const result = await querySessionConceptRelations(SESSION_DOC_ID, ["Decoherence"]);

    expect(result.available).toBe(true);
    const match = result.matches[0];
    expect(match.isAlreadyLinkedToSession).toBe(true);
    expect(match.otherLinkedSources).toHaveLength(1);
    expect(match.otherLinkedSources[0].sourceId).toBe("doc-textbook-chapter");
    // Two source links -> supported evidence
    expect(match.evidenceCoverage).toBe("supported");
  });

  it("links the same concept from two recordings without creating duplicate cards", async () => {
    const concept = makeConcept({
      id: "concept-consensus",
      name: "Consensus",
    });

    vi.mocked(conceptLinksApi.proposeConceptLink).mockResolvedValue({
      outcome: "created",
      link: makeLink({
        id: "link-recording-a",
        sourceId: "doc-recording-a",
        targetId: concept.id,
      }),
    });
    vi.mocked(conceptLinksApi.acceptConceptLink).mockResolvedValue(
      makeLink({
        id: "link-recording-a",
        sourceId: "doc-recording-a",
        targetId: concept.id,
        endorsedAt: "2026-10-21T10:01:00Z",
      })
    );

    await expect(
      linkSessionDocumentToConcept("doc-recording-a", concept.id)
    ).resolves.toBe(true);
    await expect(
      linkSessionDocumentToConcept("doc-recording-b", concept.id)
    ).resolves.toBe(true);

    expect(conceptLinksApi.proposeConceptLink).toHaveBeenCalledTimes(2);
    expect(conceptLinksApi.acceptConceptLink).toHaveBeenCalledTimes(2);

    // Linking records source evidence only. It never creates a card or
    // touches the review scheduler; those commands are not part of this
    // adapter's import graph.
    expect(conceptLinksApi.proposeConceptLink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceKind: "document",
        sourceId: "doc-recording-a",
        targetKind: "concept",
        targetId: concept.id,
      })
    );
    expect(conceptLinksApi.proposeConceptLink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sourceKind: "document",
        sourceId: "doc-recording-b",
        targetKind: "concept",
        targetId: concept.id,
      })
    );
  });

  it("bounds queried concepts to maximum limit of 12", async () => {
    vi.mocked(conceptLinksApi.findConceptsByNames).mockResolvedValue([]);

    const manyConcepts = Array.from({ length: 25 }, (_, i) => `Concept ${i + 1}`);
    const result = await querySessionConceptRelations(SESSION_DOC_ID, manyConcepts);

    expect(result.available).toBe(true);
    expect(result.matches.length).toBeLessThanOrEqual(12);
    expect(conceptLinksApi.findConceptsByNames).toHaveBeenCalledWith(
      expect.arrayContaining(["concept 1", "concept 12"])
    );
    expect(conceptLinksApi.findConceptsByNames).toHaveBeenCalledWith(
      expect.not.arrayContaining(["concept 13"])
    );
  });

  it("returns available=false gracefully when concept dependency is absent or errors", async () => {
    vi.mocked(conceptLinksApi.findConceptsByNames).mockRejectedValue(
      new Error("Tauri command find_concepts_by_names not available")
    );

    const result = await querySessionConceptRelations(SESSION_DOC_ID, [
      "Quantum Mechanics",
    ]);

    expect(result.available).toBe(false);
    expect(result.reason).toContain("not available");
    expect(result.matches).toHaveLength(0);
  });

  it("links session document to concept with explicit proposal and acceptance", async () => {
    vi.mocked(conceptLinksApi.proposeConceptLink).mockResolvedValue({
      outcome: "created",
      link: makeLink({
        id: "new-link-id",
        sourceId: SESSION_DOC_ID,
        targetId: "concept-123",
      }),
    });
    vi.mocked(conceptLinksApi.acceptConceptLink).mockResolvedValue(
      makeLink({
        id: "new-link-id",
        sourceId: SESSION_DOC_ID,
        targetId: "concept-123",
        endorsedAt: "2026-10-21T10:01:00Z",
      })
    );

    const success = await linkSessionDocumentToConcept(SESSION_DOC_ID, "concept-123");

    expect(success).toBe(true);
    expect(conceptLinksApi.proposeConceptLink).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKind: "document",
        sourceId: SESSION_DOC_ID,
        targetKind: "concept",
        targetId: "concept-123",
        relationType: "related-to",
      })
    );
    expect(conceptLinksApi.acceptConceptLink).toHaveBeenCalledWith("new-link-id");
  });

  it("refuses to resurrect a previously dismissed relationship", async () => {
    vi.mocked(conceptLinksApi.proposeConceptLink).mockResolvedValue({
      outcome: "dismissed",
      link: makeLink({
        id: "dismissed-link",
        sourceId: SESSION_DOC_ID,
        targetId: "concept-123",
      }),
    });

    await expect(
      linkSessionDocumentToConcept(SESSION_DOC_ID, "concept-123")
    ).rejects.toThrow(/previously dismissed/i);
    expect(conceptLinksApi.acceptConceptLink).not.toHaveBeenCalled();
  });

  it("fails honestly when the adapter cannot confirm an explicit link", async () => {
    vi.mocked(conceptLinksApi.proposeConceptLink).mockResolvedValue({
      outcome: "created",
      link: makeLink({
        id: "unconfirmed-link",
        sourceId: SESSION_DOC_ID,
        targetId: "concept-123",
      }),
    });
    vi.mocked(conceptLinksApi.acceptConceptLink).mockResolvedValue(null);

    await expect(
      linkSessionDocumentToConcept(SESSION_DOC_ID, "concept-123")
    ).rejects.toThrow(/could not confirm/i);
  });
});
