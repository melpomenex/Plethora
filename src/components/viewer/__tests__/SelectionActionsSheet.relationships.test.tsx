import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({
  aiLearnThis: false,
  aiLibraryRag: false,
  aiSocraticTutor: false,
  aiPrerequisites: true,
  aiConceptLinks: true,
}));

const relationshipMock = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  related: vi.fn(),
  save: vi.fn(),
  accept: vi.fn(),
  dismiss: vi.fn(),
  remove: vi.fn(),
  edit: vi.fn(),
}));

const conceptLinksMock = vi.hoisted(() => ({
  listConceptLinksFor: vi.fn(async () => []),
  listConceptLinksTargeting: vi.fn(async () => []),
  acceptConceptLink: vi.fn(),
}));

const openLibrarySource = vi.hoisted(() => vi.fn(async () => {}));
const openConcept = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: { settings: { features: typeof flags } }) => unknown) =>
    selector({ settings: { features: flags } }),
}));

vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => ({ path: "cloud", available: true, loading: false }),
}));

vi.mock("../../../lib/ai/passageAI", () => ({
  explainPassage: vi.fn(),
  summarizePassage: vi.fn(),
  simplifyPassage: vi.fn(),
  keyTermsPassage: vi.fn(),
  answerPassage: vi.fn(),
}));

vi.mock("../../../lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasCloudProvider: () => true,
}));

vi.mock("../../../lib/ai/onDeviceAI", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOnDeviceRequirementStatus: vi.fn(async () => ({ status: "unavailable" })),
  isOnDeviceAiSupportedPlatform: () => false,
  requestModelDownload: vi.fn(),
  warmUpOnDevicePrompt: vi.fn(async () => {}),
}));

vi.mock("../../../lib/ai/useAskLibrary", () => ({
  useAskLibrary: () => ({
    ask: vi.fn(),
    reset: vi.fn(),
    running: false,
    error: null,
    result: null,
  }),
}));

vi.mock("../../../utils/openLibrarySource", () => ({
  openLibrarySource: (...args: unknown[]) => openLibrarySource(...(args as [])),
}));

vi.mock("../SelectionPopup", () => ({
  copySelectionTextToClipboard: vi.fn(async () => true),
}));

vi.mock("../../learn/LearnThisProposalSheet", () => ({
  LearnThisProposalSheet: () => <div data-testid="learn-this-stub" />,
}));

vi.mock("../../tutor/TutorSheet", () => ({
  TutorSheet: () => <div data-testid="tutor-stub" />,
}));

vi.mock("../../graph/conceptProjection", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openConceptInKnowledgeGraph: (...args: unknown[]) => openConcept(...(args as [])),
}));

vi.mock("../../../api/concept-links", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listConceptLinksFor: (...args: unknown[]) => conceptLinksMock.listConceptLinksFor(...(args as [])),
  listConceptLinksTargeting: (...args: unknown[]) =>
    conceptLinksMock.listConceptLinksTargeting(...(args as [])),
  acceptConceptLink: (...args: unknown[]) => conceptLinksMock.acceptConceptLink(...(args as [])),
}));

vi.mock("../../../lib/ai/concepts/relationships", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    ConceptRelationshipAnalysisOwner: class {
      start(input: unknown) {
        return relationshipMock.start(input);
      }
      cancel() {
        relationshipMock.cancel();
      }
      isCurrent() {
        return true;
      }
    },
    discoverRelatedContent: (...args: unknown[]) => relationshipMock.related(...(args as [])),
    saveRelationshipDrafts: (...args: unknown[]) => relationshipMock.save(...(args as [])),
    acceptRelationshipDraft: (...args: unknown[]) => relationshipMock.accept(...(args as [])),
    dismissRelationshipLink: (...args: unknown[]) => relationshipMock.dismiss(...(args as [])),
    removeRelationshipLink: (...args: unknown[]) => relationshipMock.remove(...(args as [])),
    editRelationshipLink: (...args: unknown[]) => relationshipMock.edit(...(args as [])),
  };
});

import { SelectionActionsSheet } from "../SelectionActionsSheet";
import type { ConceptCoverage } from "../../../lib/ai/concepts/coverage";
import type { RelationshipAnalysisOutcome } from "../../../lib/ai/concepts/relationships";

const coverage: ConceptCoverage = {
  conceptKey: "gravity",
  conceptName: "Gravity",
  evidenceCoverage: "partial",
  activity: "studied",
  indexCompleteness: "partial",
  limitations: ["coverage.limitation.auxiliary-freshness-unproven"],
  evidenceRefs: [
    {
      kind: "chunk",
      id: "c1",
      documentId: "doc-1",
      documentTitle: "Physics",
      sourceRevision: "rev-1",
      locator: {
        kind: "chunk",
        sourceType: "text",
        chunkId: "c1",
        documentId: "doc-1",
        ordinal: 0,
        startOffset: 0,
        endOffset: 30,
      },
      strength: "mention",
      text: "Gravity shapes the orbits of planets.",
    },
  ],
};

function outcome(overrides: Partial<RelationshipAnalysisOutcome> = {}): RelationshipAnalysisOutcome {
  return {
    status: "complete",
    analysis: {
      analysisId: "analysis-1",
      passageHash: "hash",
      sourceRevision: "rev",
      authorizedDestinations: {
        generationPath: "ondevice",
        generationRemote: false,
        embeddingRemote: false,
        allowed: true,
      },
      signal: new AbortController().signal,
    },
    prerequisites: [
      {
        concept: "Gravity",
        why: "The passage builds on gravitational attraction.",
        conceptKey: "gravity",
        draftHandle: "draft:concept:0",
        coverage,
      },
    ],
    drafts: [
      {
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
        confidence: 0.91,
        rationale: "The evidence supplies the foundational concept.",
        fingerprint: "fp-1",
        policyVersion: "relationship-policy-v1",
        origin: "ai",
        status: "draft",
        evidence: [],
      },
    ],
    limitations: [],
    ...overrides,
  };
}

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    sourceKind: "concept",
    sourceId: "concept-1",
    targetKind: "document",
    targetId: "doc-1",
    relationType: "supports",
    confidence: 0.9,
    createdBy: "ai",
    createdAt: "",
    isDismissed: false,
    origin: "ai",
    ...overrides,
  };
}

function renderSheet(props: Partial<Parameters<typeof SelectionActionsSheet>[0]> = {}) {
  return render(
    <SelectionActionsSheet
      open
      text="Gravity shapes orbits."
      passage="Gravity shapes the orbits of planets and moons."
      onClose={vi.fn()}
      onCreateExtract={vi.fn()}
      learnThis={{ documentId: "doc-1", documentTitle: "Physics" }}
      {...props}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.aiPrerequisites = true;
  flags.aiConceptLinks = true;
  relationshipMock.start.mockResolvedValue(outcome());
  relationshipMock.save.mockResolvedValue({
    results: [{ draft: outcome().drafts[0], outcome: "created", link: link({ id: "saved-1", createdBy: "ai" }) }],
    newConcepts: [],
  });
  relationshipMock.accept.mockResolvedValue(link({ id: "accepted-1", createdBy: "user", endorsedAt: "now" }));
  relationshipMock.dismiss.mockResolvedValue(link({ id: "dismissed-1", isDismissed: true }));
  relationshipMock.remove.mockResolvedValue(true);
  relationshipMock.edit.mockResolvedValue({
    outcome: "updated",
    link: link({ id: "saved-1", relationType: "extends", confidence: 0.8, createdBy: "user" }),
  });
  relationshipMock.related.mockResolvedValue({
    status: "ok",
    items: [
      {
        handle: "evidence:chunk:c1",
        kind: "chunk",
        id: "c1",
        documentId: "doc-1",
        documentTitle: "Physics",
        text: "Gravity shapes the orbits of planets.",
        sourceRevision: "rev",
        locator: {
          kind: "chunk",
          sourceType: "text",
          chunkId: "c1",
          documentId: "doc-1",
          ordinal: 0,
          startOffset: 0,
          endOffset: 10,
        },
      },
    ],
    concepts: [{ conceptId: "concept-1", name: "Gravity", relationType: "supports" }],
    limitations: [],
  });
  conceptLinksMock.listConceptLinksFor.mockResolvedValue([]);
  conceptLinksMock.listConceptLinksTargeting.mockResolvedValue([]);
  conceptLinksMock.acceptConceptLink.mockResolvedValue(link({ createdBy: "user" }));
});

describe("SelectionActionsSheet knowledge relationships", () => {
  it("renders concept/why plus deterministic coverage and navigable evidence", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));

    await waitFor(() => expect(screen.getByTestId("prereq-concept")).toBeTruthy());
    expect(screen.getByText("Gravity")).toBeTruthy();
    expect(screen.getByText("The passage builds on gravitational attraction.")).toBeTruthy();
    expect(screen.getByTestId("coverage-badge").textContent).toBe("Partial coverage (mentions only)");
    expect(screen.getByTestId("activity-badge").textContent).toBe("Studied");
    expect(screen.getByTestId("index-badge").textContent).toContain("partial");
    expect(screen.getByText(/Card and annotation freshness/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("evidence-row"));
    expect(openLibrarySource).toHaveBeenCalledWith(
      "doc-1",
      "Gravity shapes the orbits of planets.",
      expect.objectContaining({ sourceType: "text", documentId: "doc-1" })
    );
  });

  it("renders the supported label for direct evidence", async () => {
    relationshipMock.start.mockResolvedValue(
      outcome({
        prerequisites: [
          {
            concept: "Gravity",
            why: "Needed.",
            conceptKey: "gravity",
            draftHandle: "draft:concept:0",
            coverage: { ...coverage, evidenceCoverage: "supported" },
          },
        ],
        drafts: [],
      })
    );
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));
    await waitFor(() => expect(screen.getByTestId("coverage-badge")).toBeTruthy());
    expect(screen.getByTestId("coverage-badge").textContent).toBe(
      "Supported by identified sources"
    );
  });

  it("states only the exact empty inference message", async () => {
    relationshipMock.start.mockResolvedValue(
      outcome({
        status: "empty",
        prerequisites: [],
        drafts: [],
        emptyMessage: "No prerequisites suggested for this passage",
      })
    );
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));
    await waitFor(() => expect(screen.getByTestId("prereq-empty")).toBeTruthy());
    expect(screen.getByTestId("prereq-empty").textContent).toBe(
      "No prerequisites suggested for this passage"
    );
  });

  it("shows not-covered and unknown without mastery language", async () => {
    relationshipMock.start.mockResolvedValue(
      outcome({
        prerequisites: [
          {
            concept: "Gravity",
            why: "Needed.",
            conceptKey: "gravity",
            draftHandle: "draft:concept:0",
            coverage: { ...coverage, evidenceCoverage: "unknown", evidenceRefs: [] },
          },
          {
            concept: "Orbits",
            why: "Needed.",
            conceptKey: "orbits",
            draftHandle: "draft:concept:1",
            coverage: { ...coverage, conceptKey: "orbits", evidenceCoverage: "not-covered", evidenceRefs: [] },
          },
        ],
        drafts: [],
      })
    );
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));
    await waitFor(() => expect(screen.getAllByTestId("coverage-badge")).toHaveLength(2));
    expect(screen.getByText("Unknown (insufficient indexed evidence)")).toBeTruthy();
    expect(screen.getByText("Not covered by indexed evidence")).toBeTruthy();
    expect(screen.queryByText(/mastery/i)).toBeNull();
  });

  it("saves suggestions only on the explicit action and then shows saved state", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));
    await waitFor(() => expect(screen.getByTestId("relationship-draft")).toBeTruthy());
    expect(relationshipMock.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("save-suggestions"));
    await waitFor(() => expect(relationshipMock.save).toHaveBeenCalledWith("analysis-1", [expect.anything()]));
    await waitFor(() => expect(screen.getByTestId("saved-link")).toBeTruthy());
    expect(screen.queryByTestId("relationship-draft")).toBeNull();
  });

  it("accepts a draft explicitly", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));
    await waitFor(() => expect(screen.getByTestId("relationship-draft")).toBeTruthy());
    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() =>
      expect(relationshipMock.accept).toHaveBeenCalledWith("analysis-1", expect.anything(), null)
    );
  });

  it("dismisses a draft by persisting then dismissing its canonical fingerprint", async () => {
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));
    await waitFor(() => expect(screen.getByTestId("relationship-draft")).toBeTruthy());
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(relationshipMock.dismiss).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("relationship-draft")).toBeNull());
  });

  it("edits and removes a saved link, keeping it visible on failure", async () => {
    conceptLinksMock.listConceptLinksFor.mockResolvedValue([link({ id: "saved-2" })]);
    renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));
    await waitFor(() => expect(screen.getByTestId("saved-link")).toBeTruthy());

    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Relationship type"), {
      target: { value: "extends" },
    });
    fireEvent.click(screen.getByText("Save edit"));
    await waitFor(() =>
      expect(relationshipMock.edit).toHaveBeenCalledWith({
        linkId: "saved-2",
        relationType: "extends",
        confidence: 0.9,
      })
    );

    relationshipMock.remove.mockRejectedValueOnce(new Error("persistence failed"));
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(screen.getByText("Retry")).toBeTruthy());
    expect(screen.getByTestId("saved-link")).toBeTruthy();
  });

  it("offers related content independently when prerequisites are off", async () => {
    flags.aiPrerequisites = false;
    flags.aiConceptLinks = true;
    relationshipMock.start.mockResolvedValue(
      outcome({ status: "coverage-only", prerequisites: [], drafts: [] })
    );
    renderSheet();
    expect(screen.queryByText("aiLearning.prerequisites")).toBeNull();
    fireEvent.click(screen.getByText("Find related content"));
    await waitFor(() => expect(screen.getByTestId("related-item")).toBeTruthy());
    expect(relationshipMock.related).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("related-concept"));
    expect(openConcept).toHaveBeenCalledWith("concept-1");
  });

  it("drops a late result after the selection changes", async () => {
    let resolveFirst: ((value: RelationshipAnalysisOutcome) => void) | undefined;
    relationshipMock.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const { rerender } = renderSheet();
    fireEvent.click(screen.getByText("aiLearning.prerequisites"));

    rerender(
      <SelectionActionsSheet
        open
        text="A completely different selection."
        passage="A completely different selection with new context."
        onClose={vi.fn()}
        onCreateExtract={vi.fn()}
        learnThis={{ documentId: "doc-1", documentTitle: "Physics" }}
      />
    );

    resolveFirst?.(outcome());
    await waitFor(() => expect(screen.queryByTestId("prereq-concept")).toBeNull());
  });
});
