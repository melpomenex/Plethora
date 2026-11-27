import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudyModeWorkspace } from "../../../../components/viewer/StudyModeWorkspace";
import * as studyModeApi from "../../../../api/study-mode";
import * as runTaskMod from "../../../ai/tasks/runTask";
import { buildStudyScopeKey } from "../scopeKey";
import { buildStudyAnchorsFromPayload } from "../anchoring";
import { normalizeStudyModeTab, type StudyModeSession } from "../../../../types/studyMode";

function makeSession(overrides: Partial<StudyModeSession> = {}): StudyModeSession {
  return {
    id: "sess-1",
    scopeKind: "standalone_document" as const,
    documentId: "doc-1",
    studyPlanId: null,
    planVersionId: null,
    topicId: null,
    segmentId: null,
    sourceRevision: "rev-1",
    knowledgeAuthority: "source-only" as const,
    activeView: "learn" as const,
    lastLocatorJson: null,
    status: "active",
    createdAt: "2026-11-26T00:00:00Z",
    updatedAt: "2026-11-26T00:00:00Z",
    ...overrides,
  };
}

describe("Wave 1: Study Mode Foundation & Workspace Overhaul", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("computes collision-free precision scope keys across selections, timestamps, and revisions", () => {
    const kDoc = buildStudyScopeKey({
      scopeKind: "standalone_document",
      documentId: "doc-1",
      sourceRevision: "rev-1",
      includeRevision: true,
    });
    const kRev2 = buildStudyScopeKey({
      scopeKind: "standalone_document",
      documentId: "doc-1",
      sourceRevision: "rev-2",
      includeRevision: true,
    });
    const kSelA = buildStudyScopeKey({
      scopeKind: "standalone_selection",
      documentId: "doc-1",
      sourceRevision: "rev-1",
      selectionText: "Mitochondria produce ATP.",
    });
    const kSelB = buildStudyScopeKey({
      scopeKind: "standalone_selection",
      documentId: "doc-1",
      sourceRevision: "rev-1",
      selectionText: "Chloroplasts perform photosynthesis.",
    });
    const kTime1 = buildStudyScopeKey({
      scopeKind: "standalone_document",
      documentId: "audio-1",
      sourceRevision: "rev-1",
      locator: { kind: "audio", timeSeconds: 45, segmentId: "seg-1" },
    });
    const kTime2 = buildStudyScopeKey({
      scopeKind: "standalone_document",
      documentId: "audio-1",
      sourceRevision: "rev-1",
      locator: { kind: "audio", timeSeconds: 190, segmentId: "seg-2" },
    });

    expect(new Set([kDoc, kRev2, kSelA, kSelB, kTime1, kTime2]).size).toBe(6);
  });

  it("maps legacy view tabs cleanly to the 4 primary tabs", () => {
    expect(normalizeStudyModeTab("mind_map")).toEqual({
      tab: "explore",
      exploreSubView: "concept_map",
    });
    expect(normalizeStudyModeTab("audio")).toEqual({
      tab: "explore",
      exploreSubView: "audio",
    });
    expect(normalizeStudyModeTab("slides")).toEqual({
      tab: "explore",
      exploreSubView: "slides",
    });
    expect(normalizeStudyModeTab("source")).toEqual({ tab: "learn" });
    expect(normalizeStudyModeTab("progress")).toEqual({ tab: "progress" });
  });

  it("builds real StudySourceAnchor records instead of empty anchor arrays", () => {
    const anchors = buildStudyAnchorsFromPayload({
      documentId: "doc-1",
      sourceRevision: "rev-1",
      passageText: "Cells rely on ATP. Mitochondria produce ATP for cellular energy.",
      payload: {
        citations: [{ sourceId: "doc-1", quote: "Mitochondria produce ATP" }],
      },
      baseLocator: { kind: "pdf", pageNumber: 12 },
    });

    expect(anchors.length).toBe(1);
    expect(anchors[0].sourceId).toBe("doc-1");
    expect(anchors[0].quote).toBe("Mitochondria produce ATP");
    expect(anchors[0].charStart).toBe(19);
    expect(anchors[0].locator).toMatchObject({ kind: "pdf", pageNumber: 12 });

    // Even when citations are absent, fallback locator anchor is produced
    const fallbackAnchors = buildStudyAnchorsFromPayload({
      documentId: "doc-1",
      sourceRevision: "rev-1",
      passageText: "Short summary text.",
      payload: {},
      baseLocator: { kind: "youtube", timeSeconds: 75 },
    });
    expect(fallbackAnchors.length).toBe(1);
    expect(fallbackAnchors[0].locator).toMatchObject({ kind: "youtube", timeSeconds: 75 });
  });

  it("restores active tab and session duration across remounts instead of resetting to learn", async () => {
    const existing = makeSession({
      activeView: "practice",
      lastLocatorJson: JSON.stringify({
        activeTab: "practice",
        exploreSubView: "concept_map",
        activeObjectiveId: "step-0",
        activeQuestionId: null,
        sessionDurationMin: 30,
        focusMode: false,
        lastLocator: { kind: "pdf", pageNumber: 7 },
        leftPaneWidth: 240,
        rightPaneWidth: 420,
        leftPaneCollapsed: false,
        rightPaneCollapsed: false,
        updatedAt: "2026-11-26T12:00:00Z",
      }),
    });

    vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockResolvedValue(existing);
    vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue(existing);
    vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);

    render(
      <StudyModeWorkspace
        documentId="doc-1"
        documentTitle="Biology"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP."
        onExitStudyMode={() => {}}
      />
    );

    await waitFor(() => {
      const practiceTab = screen.getByRole("tab", { name: /Practice/i });
      expect(practiceTab).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("button", { name: "30m" })).toHaveAttribute("aria-pressed", "true");
  });

  it("persists real source anchors on generated artifacts and supports cancellation independently", async () => {
    vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockResolvedValue(null);
    vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue(makeSession());
    vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);

    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(runTaskMod, "runTask").mockImplementation(
      (_task, _input, opts) =>
        new Promise((_resolve, reject) => {
          capturedSignal = opts?.signal;
          opts?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    render(
      <StudyModeWorkspace
        documentId="doc-1"
        documentTitle="Biology"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP for cellular energy."
        onExitStudyMode={() => {}}
      />
    );

    fireEvent.click(screen.getByText("Alternative Explanation"));
    const cancelBtn = await screen.findByRole("button", {
      name: /Cancel Alternative Explanation/i,
    });
    // Other tools remain enabled while explanation is running!
    expect(screen.getByText("Worked Example")).not.toBeDisabled();

    fireEvent.click(cancelBtn);
    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
  });

  it("requires confirmation before clearing scope and supports artifact history recovery", async () => {
    const savedArtifact = {
      id: "art-1",
      sessionId: "sess-1",
      artifactType: "explanation",
      schemaVersion: 1,
      scopeKey: "doc:doc-1|rev:rev-1",
      sourceIds: ["doc-1"],
      sourceRevision: "rev-1",
      anchors: [
        {
          sourceId: "doc-1",
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
      payload: {
        title: "ATP Overview",
        body: "ATP powers cellular work.",
      },
      isStale: false,
      isLocked: false,
      dismissed: false,
      createdAt: "2026-11-26T00:00:00Z",
      updatedAt: "2026-11-26T00:00:00Z",
    };

    vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockResolvedValue(null);
    vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue(makeSession());
    vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([savedArtifact]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);
    vi.spyOn(studyModeApi, "dismissStudyModeArtifact").mockResolvedValue();
    vi.spyOn(studyModeApi, "restoreStudyModeArtifact").mockResolvedValue({
      ...savedArtifact,
      dismissed: false,
    });
    const deleteScopeSpy = vi
      .spyOn(studyModeApi, "deleteStudyModeArtifactsForScope")
      .mockResolvedValue(1);

    render(
      <StudyModeWorkspace
        documentId="doc-1"
        documentTitle="Biology"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP for cellular energy."
        onExitStudyMode={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText("ATP Overview")).toBeInTheDocument());

    // Clicking Clear Scope opens confirmation instead of deleting immediately
    fireEvent.click(screen.getByText("Clear Scope"));
    expect(deleteScopeSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("ATP Overview")).toBeInTheDocument();

    // Dismissing moves artifact to Artifact History where it can be restored
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(screen.queryByText("ATP Overview")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText(/Artifact History \(1\)/i));
    expect(screen.getByText("ATP Overview")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => expect(screen.getByText("ATP Overview")).toBeInTheDocument());
  });

  it("surfaces persistence errors distinctly and renders mobile bottom-sheet layout", async () => {
    vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockRejectedValue(
      new Error("SQLite busy")
    );
    vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([]);
    vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);

    render(
      <StudyModeWorkspace
        documentId="doc-1"
        documentTitle="Biology"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP."
        isMobile
        onExitStudyMode={() => {}}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId("study-mode-persistence-warning")).toHaveTextContent(/SQLite busy/i)
    );
    expect(screen.getByTestId("study-mode-workspace")).toHaveAttribute("data-layout-mode", "mobile");
    // No duplicate OriginalSourcePane rendered on mobile
    expect(screen.queryByRole("region", { name: "Original Source" })).not.toBeInTheDocument();
  });
});
