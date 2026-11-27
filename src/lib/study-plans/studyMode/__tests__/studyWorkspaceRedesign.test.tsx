import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudyModeWorkspace } from "../../../../components/viewer/StudyModeWorkspace";
import { StudyTimelineView } from "../../../../components/viewer/study-mode/StudyTimelineView";
import {
  clampSourceSplitPercent,
  readRememberedPresentationMode,
  toggleStudyWorkspaceLayout,
  writeRememberedPresentationMode,
} from "../../../../components/viewer/study-mode/studyWorkspaceState";
import { buildStudyScopeKey } from "../scopeKey";
import { boundSourcePassage, resolveStudyScopes } from "../sourceScopeResolver";
import { buildStudyAssistantContext } from "../studyAssistantContext";
import { classifyStudyModeError } from "../studyErrorTaxonomy";
import { loadCachedStudyMedia, saveCachedStudyMedia } from "../studyMediaCache";
import { AIError } from "../../../ai/errors";
import * as studyModeApi from "../../../../api/study-mode";
import * as runTaskMod from "../../../ai/tasks/runTask";
import type { StudyModeArtifact } from "../../../../types/studyMode";

describe("Study Mode Workspace Redesign — Presentation, Scopes, Assistant & Reliability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  describe("Presentation & Layout Coordination", () => {
    it("defaults to Read Mode unless rememberModePerSource is explicitly enabled", () => {
      writeRememberedPresentationMode("doc-1", "study", true);
      expect(readRememberedPresentationMode("doc-1", false)).toBe("read");
      expect(readRememberedPresentationMode("doc-1", true)).toBe("study");
    });

    it("enforces mutually exclusive optional companion pane (never 3 columns)", () => {
      expect(toggleStudyWorkspaceLayout("focused", "with-source")).toBe("with-source");
      expect(toggleStudyWorkspaceLayout("with-source", "with-assistant")).toBe("with-assistant");
      expect(toggleStudyWorkspaceLayout("with-assistant", "with-source")).toBe("with-source");
      expect(toggleStudyWorkspaceLayout("with-assistant", "with-assistant")).toBe("focused");
      expect(clampSourceSplitPercent(10)).toBe(28);
      expect(clampSourceSplitPercent(95)).toBe(68);
    });

    it("eliminates duplicate full-document OriginalSourcePane and LearningPathPane inside StudyModeWorkspace", async () => {
      const onToggleSource = vi.fn();
      const onToggleAssistant = vi.fn();
      const onExitStudyMode = vi.fn();

      render(
        <StudyModeWorkspace
          documentId="book-1"
          documentTitle="Cellular Energetics"
          docType="epub"
          sourceRevision="rev-1"
          passageText="Mitochondria generate most of the cell's supply of ATP via oxidative phosphorylation."
          workspaceLayout="focused"
          onToggleSource={onToggleSource}
          onToggleAssistant={onToggleAssistant}
          onExitStudyMode={onExitStudyMode}
        />,
      );

      expect(screen.getByTestId("study-mode-workspace")).toBeInTheDocument();
      // No duplicate plain-text Original Source or Learning Path panes
      expect(screen.queryByRole("region", { name: "Original Source" })).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Learning Path" })).not.toBeInTheDocument();

      // Compact header exposes View Source, Ask Assistant, Back to Reading, and Scope Selector
      fireEvent.click(screen.getByTestId("study-toggle-source"));
      expect(onToggleSource).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("study-toggle-assistant"));
      expect(onToggleAssistant).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Back to Reading" }));
      expect(onExitStudyMode).toHaveBeenCalledTimes(1);
    });
  });

  describe("Source-Aware Study Scopes & Bounded Context", () => {
    it("resolves PDF page range from live context rather than empty documentContent", () => {
      const resolved = resolveStudyScopes({
        documentId: "pdf-1",
        documentTitle: "Neuroscience Primer",
        docType: "pdf",
        liveContextText: "Page 12 discusses synaptic plasticity and long-term potentiation.",
        documentContent: "",
        pdfPageNumber: 12,
        pdfTotalPages: 120,
      });

      expect(resolved.defaultScopeId).toBe("pdf_page_range");
      const pageOpt = resolved.options.find((o) => o.id === "pdf_page_range");
      expect(pageOpt?.label).toContain("11–13");
      expect(pageOpt?.passageText).toContain("synaptic plasticity");
    });

    it("defaults to selected_passage when selectionText is provided and study_plan_assignment when launched from a plan", () => {
      const fromSel = resolveStudyScopes({
        documentId: "doc-1",
        documentTitle: "Article",
        docType: "html",
        documentContent: "<p>Full article body text here.</p>",
        selectionText: "Specific selected paragraph to study closely.",
      });
      expect(fromSel.defaultScopeId).toBe("selected_passage");

      const fromPlan = resolveStudyScopes({
        documentId: "doc-1",
        documentTitle: "Article",
        docType: "markdown",
        documentContent: "Assigned chapter text.",
        studyPlanContext: {
          planId: "plan-1",
          versionId: "v1",
          topicId: "topic-atp",
          topicTitle: "ATP Synthesis",
        },
      });
      expect(fromPlan.defaultScopeId).toBe("study_plan_assignment");
      expect(fromPlan.options[0].label).toContain("ATP Synthesis");
    });

    it("bounds large documents deterministically and marks partial coverage honestly", () => {
      const largeBook = "Mitochondrial respiration converts chemical energy into ATP. ".repeat(400);
      const result = boundSourcePassage(largeBook, 2000, 0.5);
      expect(result.bounded.length).toBeLessThanOrEqual(2000);
      expect(result.isPartial).toBe(true);
      expect(result.totalChars).toBeGreaterThan(2000);
    });

    it("produces revision-independent scope keys so stale detection works across revisions while isolating scopes", () => {
      const ch1Rev1 = buildStudyScopeKey({
        scopeKind: "standalone_document",
        documentId: "book-1",
        scopeIdentity: "epub:sec:ch1",
        sourceRevision: "rev-1",
      });
      const ch1Rev2 = buildStudyScopeKey({
        scopeKind: "standalone_document",
        documentId: "book-1",
        scopeIdentity: "epub:sec:ch1",
        sourceRevision: "rev-2",
      });
      const ch2Rev1 = buildStudyScopeKey({
        scopeKind: "standalone_document",
        documentId: "book-1",
        scopeIdentity: "epub:sec:ch2",
        sourceRevision: "rev-1",
      });

      expect(ch1Rev1).toBe(ch1Rev2);
      expect(ch1Rev1).not.toBe(ch2Rev1);
    });
  });

  describe("Assistant Context & Answer-Key Protection", () => {
    it("strictly withholds answer keys and rubrics for unanswered formative questions", () => {
      const summary = buildStudyAssistantContext({
        documentTitle: "Biochemistry",
        scopeLabel: "Chapter 3",
        scopeExcerpt: "ATP synthase uses a proton gradient to synthesize ATP.",
        activeTab: "practice",
        knowledgeAuthority: "source-only",
        activeQuestion: {
          id: "q-1",
          backendQuestionId: "q-1",
          scopeKey: "doc:bio|scope:ch3",
          conceptIds: ["atp"],
          questionKind: "multiple_choice",
          prompt: "What drives ATP synthase?",
          difficulty: 2,
          questionFingerprint: "fp-1",
          hint: "Think about chemiosmosis.",
          options: ["Sodium pump", "Proton gradient", "Direct heat"],
          correctIndex: 1,
          expectedBlanks: ["proton gradient"],
          orderingItems: null,
          correctOrder: null,
          scenarioText: null,
          requiredKeyFacts: ["SECRET_RUBRIC_FACT_XYZ"],
          explanation: "SECRET_EXPLANATION_ANSWER_KEY",
          distractorMisconceptions: null,
          anchors: [],
        },
        activeQuestionSubmitted: false,
      });

      expect(summary.withheldAnswerKey).toBe(true);
      expect(summary.contextText).toContain("What drives ATP synthase?");
      expect(summary.contextText).not.toContain("SECRET_RUBRIC_FACT_XYZ");
      expect(summary.contextText).not.toContain("SECRET_EXPLANATION_ANSWER_KEY");
    });

    it("includes outcome and misconception after submission", () => {
      const summary = buildStudyAssistantContext({
        documentTitle: "Biochemistry",
        scopeLabel: "Chapter 3",
        activeTab: "practice",
        knowledgeAuthority: "source-only",
        activeQuestion: {
          id: "q-1",
          backendQuestionId: "q-1",
          scopeKey: "doc:bio|scope:ch3",
          conceptIds: ["atp"],
          questionKind: "multiple_choice",
          prompt: "What drives ATP synthase?",
          difficulty: 2,
          questionFingerprint: "fp-1",
          hint: null,
          options: ["A", "B"],
          correctIndex: 1,
          expectedBlanks: null,
          orderingItems: null,
          correctOrder: null,
          scenarioText: null,
          requiredKeyFacts: null,
          explanation: "Proton gradient.",
          distractorMisconceptions: null,
          anchors: [],
        },
        activeQuestionSubmitted: true,
        lastEvaluation: {
          questionId: "q-1",
          conceptIds: ["atp"],
          outcome: "needs_review",
          score: 0,
          feedback: "Review chemiosmosis.",
          misconceptionDetected: "Confused sodium pump with proton gradient",
          graderOrigin: "deterministic",
          difficulty: 2,
          usedHint: false,
          evaluatedAt: new Date().toISOString(),
        },
      });

      expect(summary.withheldAnswerKey).toBe(false);
      expect(summary.contextText).toContain("Confused sodium pump with proton gradient");
    });
  });

  describe("Actionable Provider Error Taxonomy & Artifact Preservation", () => {
    it("maps AIError categories and empty-response errors to concise actionable messages", () => {
      const emptyErr = classifyStudyModeError(
        new AIError(
          "InvalidStructuredOutput",
          "Task study-mode-mind-map produced structured output that failed validation: empty response (provider body had no content)",
        ),
        { activityLabel: "concept map" },
      );
      expect(emptyErr.category).toBe("empty-response");
      expect(emptyErr.title).toContain("concept map");
      expect(emptyErr.description).toContain("empty response");
      expect(emptyErr.actions).toContain("retry");
      expect(emptyErr.actions).toContain("open-ai-settings");

      const disabledErr = classifyStudyModeError(new AIError("FeatureDisabled", "AI off"));
      expect(disabledErr.category).toBe("provider-disabled");
      expect(disabledErr.actions).toContain("open-ai-settings");

      const largeErr = classifyStudyModeError(new AIError("InputTooLarge", "Too big"));
      expect(largeErr.category).toBe("context-too-large");
      expect(largeErr.actions).toContain("narrow-scope");

      const consentErr = classifyStudyModeError(new AIError("PermissionDenied", "Consent needed"));
      expect(consentErr.category).toBe("consent-required");
    });

    it("preserves previously saved valid artifacts when regeneration fails", async () => {
      const existingArtifact: StudyModeArtifact = {
        id: "art-existing",
        sessionId: "sess-1",
        artifactType: "explanation",
        schemaVersion: 1,
        scopeKey: "doc:doc-1|scope:entire_document",
        sourceIds: ["doc-1"],
        sourceRevision: "rev-1",
        anchors: [],
        segmentIds: [],
        conceptIds: [],
        objectiveIds: [],
        planId: null,
        planVersionId: null,
        preferenceFingerprint: "",
        taskId: "study-mode-generate-component",
        taskVersion: "1",
        promptVersion: "1",
        providerId: "mock",
        modelId: "mock",
        knowledgeAuthority: "source-only",
        validationStatus: "verified",
        qualityEval: null,
        payload: { title: "Saved ATP Explanation", body: "ATP stores chemical energy." },
        isStale: false,
        isLocked: false,
        dismissed: false,
        createdAt: "2026-11-27T00:00:00Z",
        updatedAt: "2026-11-27T00:00:00Z",
      };

      vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockResolvedValue(null);
      vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue({
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
        createdAt: "2026-11-27T00:00:00Z",
        updatedAt: "2026-11-27T00:00:00Z",
      });
      vi.spyOn(studyModeApi, "listStudyLearnerPreferences").mockResolvedValue([]);
      vi.spyOn(studyModeApi, "listStudyModeArtifacts").mockResolvedValue([existingArtifact]);
      vi.spyOn(runTaskMod, "runTask").mockRejectedValue(
        new AIError("InvalidStructuredOutput", "empty response (provider body had no content)"),
      );

      const onOpenAiSettings = vi.fn();
      render(
        <StudyModeWorkspace
          documentId="doc-1"
          documentTitle="Bio"
          sourceRevision="rev-1"
          passageText="ATP stores chemical energy."
          onOpenAiSettings={onOpenAiSettings}
          onExitStudyMode={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Saved ATP Explanation")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole("button", { name: "Alternative Explanation" }));

      await waitFor(() => {
        expect(screen.getByTestId("study-panel-error-learn")).toBeInTheDocument();
      });

      // Human-readable error + actionable button + preserved prior artifact
      expect(screen.getByTestId("study-panel-error-learn")).toHaveTextContent(/empty response/i);
      expect(screen.getByText("Saved ATP Explanation")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Open AI Settings" }));
      expect(onOpenAiSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe("Timeline View & Honest Media Cache", () => {
    it("renders dedicated StudyTimelineView with citation jump and explain actions", () => {
      const onJump = vi.fn();
      const onExplain = vi.fn();
      const timelineArtifact: StudyModeArtifact = {
        id: "tl-1",
        sessionId: "s-1",
        artifactType: "timeline",
        schemaVersion: 1,
        scopeKey: "doc:d1",
        sourceIds: ["d1"],
        sourceRevision: "r1",
        anchors: [],
        segmentIds: [],
        conceptIds: [],
        objectiveIds: [],
        planId: null,
        planVersionId: null,
        preferenceFingerprint: "",
        taskId: "study-mode-timeline",
        taskVersion: "1",
        promptVersion: "1",
        providerId: null,
        modelId: null,
        knowledgeAuthority: "source-only",
        validationStatus: "verified",
        qualityEval: null,
        payload: {
          title: "Cellular Respiration Sequence",
          events: [
            {
              order: 1,
              label: "Glycolysis",
              dateOrStage: "Cytosol",
              description: "Glucose splits into pyruvate.",
              quote: "Glucose splits into pyruvate",
            },
          ],
        },
        isStale: false,
        isLocked: false,
        dismissed: false,
        createdAt: "2026-11-27T00:00:00Z",
        updatedAt: "2026-11-27T00:00:00Z",
      };

      render(
        <StudyTimelineView
          artifact={timelineArtifact}
          onJumpToQuote={onJump}
          onExplainEvent={onExplain}
        />,
      );

      expect(screen.getByText("Cellular Respiration Sequence")).toBeInTheDocument();
      expect(screen.getByText("Glycolysis")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Verify in source" }));
      expect(onJump).toHaveBeenCalledWith("Glucose splits into pyruvate");
      fireEvent.click(screen.getByRole("button", { name: "Explain stage" }));
      expect(onExplain).toHaveBeenCalledWith("Glycolysis");
    });

    it("strips ephemeral blob: URLs when persisting study media cache manifests", () => {
      saveCachedStudyMedia({
        artifactId: "aud-1",
        kind: "audio_script",
        scopeKey: "doc:d1",
        sourceRevision: "r1",
        lastPositionIndex: 0,
        segments: [
          {
            index: 0,
            textHash: "abc",
            durationSec: 5,
            audioUrl: "blob:http://localhost/ephemeral-123",
            source: "tts_provider",
          },
        ],
        cachedAt: "2026-11-27T00:00:00Z",
      });

      const loaded = loadCachedStudyMedia("aud-1", "r1");
      expect(loaded?.segments[0].audioUrl).toBeNull();
    });
  });
});
