import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudyModeWorkspace } from "../../../../components/viewer/StudyModeWorkspace";
import * as studyModeApi from "../../../../api/study-mode";
import * as runTaskMod from "../../../ai/tasks/runTask";
import {
  CONTEXTUAL_TUTOR_PROMPTS,
  buildStudyModeTutorPacket,
} from "../contextualTutor";
import {
  INLINE_PERSONALIZATION_CHIPS,
  buildSubjectPreferenceUpdate,
} from "../inlinePersonalization";
import {
  buildConceptMapGraph,
  getPrerequisitesForNode,
} from "../conceptMapGraph";

vi.mock("../../../../components/tutor/TutorSheet", () => ({
  TutorSheet: ({
    open,
    material,
    topic,
    onClose,
  }: {
    open: boolean;
    material: string;
    topic?: string;
    onClose: () => void;
  }) =>
    open ? (
      <div data-testid="mock-tutor-sheet">
        <div data-testid="mock-tutor-topic">{topic}</div>
        <div data-testid="mock-tutor-material">{material}</div>
        <button type="button" onClick={onClose}>
          Close Tutor
        </button>
      </div>
    ) : null,
}));

describe("Wave 3: Contextual Tutor, Inline Personalization & Interactive Concept Map", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("injects source passage, anchor, objective, practice misconceptions, and prompt into existing TutorSheet", () => {
    expect(CONTEXTUAL_TUTOR_PROMPTS).toHaveLength(7);

    const packet = buildStudyModeTutorPacket({
      documentId: "doc-bio",
      documentTitle: "Cellular Respiration",
      passageText: "Mitochondria produce ATP through oxidative phosphorylation.",
      activeAnchor: {
        sourceId: "doc-bio",
        sourceRevision: "rev-1",
        quote: "oxidative phosphorylation",
        locator: { kind: "pdf", pageNumber: 4 },
      },
      activeObjectiveLabel: "Understand ATP generation",
      knowledgeAuthority: "source-only",
      recentEvaluations: [
        {
          questionId: "q1",
          conceptIds: ["doc-bio"],
          outcome: "needs_review",
          score: 0,
          feedback: "Incorrect.",
          misconceptionDetected: "Thought ribosomes produce ATP.",
          graderOrigin: "deterministic",
          difficulty: 2,
          usedHint: false,
          evaluatedAt: "2026-11-26T00:00:00Z",
        },
      ],
      selectedPrompt: "Explain why my recent practice answer was wrong",
    });

    expect(packet.topic).toBe("Understand ATP generation");
    expect(packet.material).toContain("Knowledge Authority: source-only");
    expect(packet.material).toContain("oxidative phosphorylation");
    expect(packet.material).toContain("Thought ribosomes produce ATP.");
    expect(packet.material).toContain("Explain why my recent practice answer was wrong");
  });

  it("builds subject-specific preference updates for all 5 inline personalization chips", () => {
    expect(INLINE_PERSONALIZATION_CHIPS.map((c) => c.label)).toEqual([
      "Simpler",
      "More technical",
      "Use an analogy",
      "Show an example",
      "Go deeper",
    ]);

    const patch = buildSubjectPreferenceUpdate({
      subjectKey: "Quantum Mechanics",
      adjustmentId: "simpler",
      existingPreferences: [],
    });
    expect(patch.subjectKey).toBe("quantum mechanics");
    expect(patch.vocabularyTolerance).toBe("plain");
    expect(patch.explanationDetail).toBe("concise");
  });

  it("builds layered concept map graph with honest evidence badges (never marking read-only nodes understood)", () => {
    const graph = buildConceptMapGraph(
      {
        title: "Respiration Map",
        nodes: [
          { id: "n1", label: "Glycolysis", definition: "Splits glucose into pyruvate." },
          { id: "n2", label: "Krebs Cycle", definition: "Oxidizes acetyl-CoA." },
          { id: "n3", label: "Electron Transport", definition: "Generates ATP gradient." },
        ],
        edges: [
          { from: "n1", to: "n2", relation: "prerequisite" },
          { from: "n2", to: "n3", relation: "leads_to" },
        ],
      },
      [
        {
          conceptId: "n1",
          conceptLabel: "Glycolysis",
          status: "demonstrated-consistently",
          observedMean: 0.95,
          evidenceCount: 3,
          uncertaintyReasons: [],
          misconceptions: [],
          hasRetentionData: true,
        },
        {
          conceptId: "n2",
          conceptLabel: "Krebs Cycle",
          status: "needs-attention",
          observedMean: 0.25,
          evidenceCount: 2,
          uncertaintyReasons: [],
          misconceptions: ["Confused outputs"],
          hasRetentionData: false,
        },
      ]
    );

    expect(graph.nodes.find((n) => n.id === "n1")?.mastery).toBe("demonstrated");
    expect(graph.nodes.find((n) => n.id === "n2")?.mastery).toBe("needs_practice");
    // Unassessed node stays not_assessed even when in the map
    expect(graph.nodes.find((n) => n.id === "n3")?.mastery).toBe("not_assessed");

    const prereqs = getPrerequisitesForNode(graph, "n2");
    expect(prereqs.map((p) => p.label)).toEqual(["Glycolysis"]);
  });

  it("supports inline adjustment chips with reversible Save/Undo, Contextual Tutor launch, and Interactive Concept Map in StudyModeWorkspace", async () => {
    const existingExplanation = {
      id: "art-exp-1",
      sessionId: "sess-w3",
      artifactType: "explanation",
      schemaVersion: 1,
      scopeKey: "doc:doc-w3|rev:rev-1",
      sourceIds: ["doc-w3"],
      sourceRevision: "rev-1",
      anchors: [
        {
          sourceId: "doc-w3",
          sourceRevision: "rev-1",
          quote: "Mitochondria produce ATP",
          locator: { kind: "text", scrollPercent: 0, textQuote: "Mitochondria produce ATP" },
        },
      ],
      segmentIds: [],
      conceptIds: [],
      objectiveIds: [],
      planId: null,
      planVersionId: null,
      preferenceFingerprint: "",
      taskId: "study-mode-generate-component",
      taskVersion: "1",
      promptVersion: "1",
      providerId: "local",
      modelId: "test",
      knowledgeAuthority: "source-only" as const,
      validationStatus: "verified",
      qualityEval: null,
      payload: { title: "ATP Basics", body: "ATP is cellular energy." },
      isStale: false,
      isLocked: false,
      dismissed: false,
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    };

    const existingMindMap = {
      ...existingExplanation,
      id: "art-mm-1",
      artifactType: "mind_map",
      payload: {
        title: "Cell Energy Graph",
        nodes: [
          { id: "n1", label: "Glucose", definition: "Primary sugar input." },
          { id: "n2", label: "ATP", definition: "Energy currency.", citations: [{ sourceId: "doc-w3", quote: "Mitochondria produce ATP" }] },
        ],
        edges: [{ from: "n1", to: "n2", relation: "prerequisite" }],
      },
    };

    vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockResolvedValue(null);
    vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue({
      id: "sess-w3",
      scopeKind: "standalone_document",
      documentId: "doc-w3",
      studyPlanId: null,
      planVersionId: null,
      topicId: null,
      segmentId: null,
      sourceRevision: "rev-1",
      knowledgeAuthority: "source-only",
      activeView: "learn",
      lastLocatorJson: null,
      status: "active",
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    });
    vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([
      existingExplanation,
      existingMindMap,
    ]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);
    const upsertPrefSpy = vi
      .spyOn(studyModeApi, "upsertStudyLearnerPreference")
      .mockResolvedValue({
        id: "pref-1",
        subjectKey: "biology",
        knowledgeLevel: null,
        interests: [],
        familiarDomains: [],
        explanationDetail: "concise",
        vocabularyTolerance: "plain",
        explanationLanguage: null,
        teachingApproach: "balanced",
        examplePreference: "everyday",
        questionDifficulty: "adaptive",
        updatedAt: "2026-11-26T00:00:00Z",
      });
    const deletePrefSpy = vi
      .spyOn(studyModeApi, "deleteStudyLearnerPreference")
      .mockResolvedValue();
    vi.spyOn(studyModeApi, "saveStudyModeArtifact").mockResolvedValue(existingExplanation);
    vi.spyOn(runTaskMod, "runTask").mockResolvedValue({
      taskId: "study-mode-generate-component",
      output: {
        title: "ATP Basics (Simpler)",
        componentType: "explanation",
        body: "Think of ATP like a rechargeable battery.",
        keyTakeaways: [],
        citations: [{ sourceId: "doc-w3", quote: "Mitochondria produce ATP" }],
      },
      text: "{}",
      providerId: "local",
      providerKind: "ondevice",
      requestedModelClass: "full",
      servedModelClass: "full",
      fallbackPath: "none",
      validationOutcome: { valid: true, mode: "strict-json", attempts: 1 },
      baseModelName: "test-model",
    } as never);

    render(
      <StudyModeWorkspace
        documentId="doc-w3"
        documentTitle="Cell Biology"
        subjectKey="biology"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP for cellular energy."
        onExitStudyMode={() => {}}
      />
    );

    // Inline personalization chip + Save as default + Undo
    await waitFor(() =>
      expect(screen.getByTestId("inline-personalization-chips")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText("Simpler"));
    const saveBtn = await screen.findByText(/Save as default for biology/i);
    fireEvent.click(saveBtn);
    await waitFor(() => expect(upsertPrefSpy).toHaveBeenCalledTimes(1));

    const undoBtn = await screen.findByText("Undo");
    fireEvent.click(undoBtn);
    await waitFor(() => expect(deletePrefSpy).toHaveBeenCalledWith("biology"));

    // Contextual Tutor Bar launches existing TutorSheet with injected context
    fireEvent.click(screen.getByText("What prerequisite am I missing?"));
    expect(screen.getByTestId("mock-tutor-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("mock-tutor-material")).toHaveTextContent(
      /What prerequisite concept am I missing/i
    );
    fireEvent.click(screen.getByText("Close Tutor"));

    // Explore -> Interactive Concept Map with node inspector & prerequisites
    fireEvent.click(screen.getByRole("tab", { name: /Explore/i }));
    expect(screen.getByTestId("interactive-concept-map")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ATP \(Not assessed\)/i }));
    expect(screen.getByTestId("concept-map-inspector")).toHaveTextContent("Prerequisites:");
    expect(screen.getByTestId("concept-inspector-mastery")).toHaveTextContent("Not assessed");
  });
});
