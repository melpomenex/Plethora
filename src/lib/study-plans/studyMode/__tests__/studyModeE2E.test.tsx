import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StudyModeWorkspace } from "../../../../components/viewer/StudyModeWorkspace";
import { buildBoundedLearnerContext } from "../learnerContext";
import { verifyStudyModeArtifactDeterministic } from "../pedagogicalVerifier";
import * as studyModeApi from "../../../../api/study-mode";
import * as runTaskMod from "../../../ai/tasks/runTask";

describe("StudyMode End-to-End Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("supports standalone learning without creating any Study Plan and exits cleanly (Scenario B)", async () => {
    const upsertSpy = vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue({
      id: "sess-1",
      scopeKind: "standalone_document",
      documentId: "doc-1",
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
    vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);
    vi.spyOn(studyModeApi, "saveStudyModeArtifact").mockImplementation(async (input) => ({
      id: "art-1",
      sessionId: input.sessionId ?? null,
      artifactType: input.artifactType,
      schemaVersion: 1,
      scopeKey: input.scopeKey,
      sourceIds: input.sourceIds,
      sourceRevision: input.sourceRevision,
      anchors: input.anchors,
      segmentIds: input.segmentIds,
      conceptIds: input.conceptIds,
      objectiveIds: input.objectiveIds,
      planId: null,
      planVersionId: null,
      preferenceFingerprint: "",
      taskId: input.taskId,
      taskVersion: "1",
      promptVersion: "1",
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      knowledgeAuthority: "source-only",
      validationStatus: "verified",
      qualityEval: null,
      payload: input.payload,
      isStale: false,
      isLocked: false,
      dismissed: false,
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    }));

    vi.spyOn(runTaskMod, "runTask").mockResolvedValue({
      taskId: "study-mode-generate-component",
      output: {
        title: "Cell Energy Explained",
        componentType: "explanation",
        body: "ATP is the primary energy currency.",
        keyTakeaways: ["ATP stores chemical energy"],
        citations: [
          {
            sourceId: "doc-1",
            quote: "Mitochondria produce ATP for cellular energy.",
          },
        ],
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

    const onExit = vi.fn();
    render(
      <StudyModeWorkspace
        documentId="doc-1"
        documentTitle="Cell Biology"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP for cellular energy."
        onExitStudyMode={onExit}
      />
    );

    await waitFor(() => expect(upsertSpy).toHaveBeenCalled());
    expect(upsertSpy.mock.calls[0][0].studyPlanId).toBeNull();

    fireEvent.click(screen.getByText("Alternative Explanation"));
    await waitFor(() => expect(screen.getByText("Cell Energy Explained")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Exit Study Mode"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("handles missing AI provider gracefully without fabricating content (Scenario H)", async () => {
    vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue({
      id: "sess-2",
      scopeKind: "standalone_document",
      documentId: "doc-2",
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
    vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);
    vi.spyOn(runTaskMod, "runTask").mockRejectedValue(
      new Error("No eligible AI provider is configured.")
    );

    render(
      <StudyModeWorkspace
        documentId="doc-2"
        documentTitle="Physics"
        sourceRevision="rev-1"
        passageText="Force equals mass times acceleration."
        onExitStudyMode={() => {}}
      />
    );

    fireEvent.click(screen.getByText("Alternative Explanation"));
    await waitFor(() =>
      expect(screen.getByText("No eligible AI provider is configured.")).toBeInTheDocument()
    );
  });

  it("resolves subject-specific learner preferences without global conflation", () => {
    const packet = buildBoundedLearnerContext({
      subjectKey: "Economics",
      preferences: [
        {
          id: "p1",
          subjectKey: "__global__",
          knowledgeLevel: "advanced",
          interests: ["compilers"],
          familiarDomains: ["computer science"],
          explanationDetail: "concise",
          vocabularyTolerance: "technical",
          explanationLanguage: null,
          teachingApproach: "first-principles",
          examplePreference: "formal",
          questionDifficulty: "challenging",
          updatedAt: "2026-11-26T00:00:00Z",
        },
        {
          id: "p2",
          subjectKey: "economics",
          knowledgeLevel: "beginner",
          interests: ["cooking"],
          familiarDomains: [],
          explanationDetail: "detailed",
          vocabularyTolerance: "plain",
          explanationLanguage: null,
          teachingApproach: "example-first",
          examplePreference: "everyday",
          questionDifficulty: "foundational",
          updatedAt: "2026-11-26T00:00:00Z",
        },
      ],
    });
    expect(packet.knowledgeLevel).toBe("beginner");
    expect(packet.vocabularyTolerance).toBe("plain");
    expect(packet.interests).toEqual(["cooking"]);
  });

  it("enforces source revision staleness without fabricating verification (Scenario F)", () => {
    const res = verifyStudyModeArtifactDeterministic({
      artifactType: "mind_map",
      knowledgeAuthority: "source-only",
      authorizedSourceIds: ["doc-1"],
      expectedRevision: "rev-2",
      artifactRevision: "rev-1",
      sourceTexts: ["Updated document content."],
      payload: {
        nodes: [{ id: "n1", label: "Concept" }],
        citations: [{ sourceId: "doc-1", quote: "Updated document content." }],
      },
    });
    expect(res.valid).toBe(false);
    expect(res.issues).toContain("source_revision_mismatch");
  });
});
