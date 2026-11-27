import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudyModeWorkspace } from "../../../../components/viewer/StudyModeWorkspace";
import * as studyModeApi from "../../../../api/study-mode";
import * as runTaskMod from "../../../ai/tasks/runTask";
import {
  createInitialGuidedLoopState,
  guidedLoopReducer,
} from "../guidedLoop";
import {
  computeSemanticQuestionFingerprint,
  evaluatePracticeAnswerLocally,
  isSemanticallyDuplicateQuestion,
  selectAdaptiveDifficulty,
  type PracticeQuestionItem,
} from "../practiceEngine";
import { computeStudyProgressSnapshot } from "../evidenceProgress";

describe("Wave 2: Adaptive Study Loop, Practice Engine & Unified Progress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("transitions Guided Loop through introduce → anchor → understand → recall → adapt → reinforce → recap", () => {
    let state = createInitialGuidedLoopState();
    expect(state.mode).toBe("freeform");

    state = guidedLoopReducer(state, {
      type: "START_GUIDED",
      objectives: [{ id: "step-0", label: "ATP Synthesis", excerpt: "Mitochondria produce ATP." }],
    });
    expect(state.mode).toBe("guided");
    expect(state.stage).toBe("introduce");

    state = guidedLoopReducer(state, { type: "ADVANCE_STAGE" });
    expect(state.stage).toBe("anchor");

    state = guidedLoopReducer(state, { type: "ADVANCE_STAGE" });
    expect(state.stage).toBe("understand");

    state = guidedLoopReducer(state, { type: "ADVANCE_STAGE" });
    expect(state.stage).toBe("recall");

    // Needs practice branches into adapt
    state = guidedLoopReducer(state, {
      type: "RECORD_RECALL_OUTCOME",
      outcome: "needs_review",
      misconception: "Confused mitochondria with chloroplasts.",
    });
    expect(state.stage).toBe("adapt");
    expect(state.remediationCount).toBe(1);
    expect(state.needsPracticeObjectiveIds).toEqual(["step-0"]);

    // Retry loops back to recall
    state = guidedLoopReducer(state, { type: "ADVANCE_STAGE" });
    expect(state.stage).toBe("recall");

    // Understood advances to reinforce
    state = guidedLoopReducer(state, {
      type: "RECORD_RECALL_OUTCOME",
      outcome: "understood",
    });
    expect(state.stage).toBe("reinforce");
    expect(state.understoodObjectiveIds).toEqual(["step-0"]);
    expect(state.needsPracticeObjectiveIds).toEqual([]);

    // Optional flashcard promotion increments counter without mutating FSRS automatically
    state = guidedLoopReducer(state, { type: "RECORD_FLASHCARD_PROMOTED" });
    expect(state.promotedFlashcardCount).toBe(1);

    // Final advance reaches recap
    state = guidedLoopReducer(state, { type: "ADVANCE_STAGE" });
    expect(state.stage).toBe("recap");
  });

  it("deduplicates questions semantically without relying on Date.now() timestamps", () => {
    const fp1 = computeSemanticQuestionFingerprint({
      scopeKey: "doc:1",
      conceptIds: ["atp"],
      questionKind: "multiple_choice",
      prompt: "Which organelle produces ATP for cellular energy?",
    });
    const fp2 = computeSemanticQuestionFingerprint({
      scopeKey: "doc:1",
      conceptIds: ["atp"],
      questionKind: "multiple_choice",
      prompt: "Which organelle produces ATP for cellular energy?",
    });
    expect(fp1).toBe(fp2);
    expect(fp1.startsWith("sem:")).toBe(true);

    expect(
      isSemanticallyDuplicateQuestion(
        "What organelle produces ATP for cellular energy?",
        ["Which organelle produces ATP for cellular energy?"]
      )
    ).toBe(true);

    expect(
      isSemanticallyDuplicateQuestion(
        "How does glycolysis initiate glucose breakdown in the cytosol?",
        ["Which organelle produces ATP for cellular energy?"]
      )
    ).toBe(false);
  });

  it("selects difficulty dynamically from evidence and recent performance (never hardcoded 2)", () => {
    // Weak mastery steps down to 1
    expect(
      selectAdaptiveDifficulty({
        masterySummary: {
          conceptId: "c1",
          level: "needs-attention",
          observedMean: 0.3,
          evidenceWeight: 1,
          independentSessions: 1,
          distinctDays: 1,
          minimumObserved: 0.3,
          maximumObserved: 0.3,
          latestEvidenceAt: null,
          uncertainty: [],
          evidenceIds: ["e1"],
          policyVersion: "evidence-v1",
        },
        recentOutcomes: [],
      })
    ).toBe(1);

    // Strong mastery + 2 consecutive understood without hints steps up to 5
    expect(
      selectAdaptiveDifficulty({
        masterySummary: {
          conceptId: "c1",
          level: "demonstrated-consistently",
          observedMean: 0.92,
          evidenceWeight: 4,
          independentSessions: 3,
          distinctDays: 3,
          minimumObserved: 0.85,
          maximumObserved: 1.0,
          latestEvidenceAt: null,
          uncertainty: [],
          evidenceIds: ["e1", "e2", "e3"],
          policyVersion: "evidence-v1",
        },
        recentOutcomes: [
          { outcome: "understood", usedHint: false, difficulty: 4 },
          { outcome: "understood", usedHint: false, difficulty: 4 },
        ],
      })
    ).toBe(5);
  });

  it("evaluates all 5 question types deterministically with actionable misconception feedback", () => {
    const base: Omit<PracticeQuestionItem, "questionKind" | "prompt"> = {
      id: "q1",
      scopeKey: "doc:1",
      conceptIds: ["c1"],
      difficulty: 2,
      questionFingerprint: "sem:abc",
      explanation: "ATP is generated during cellular respiration.",
      anchors: [],
    };

    // 1. Multiple Choice with distractor misconception
    const mcRes = evaluatePracticeAnswerLocally(
      {
        ...base,
        questionKind: "multiple_choice",
        prompt: "Where is ATP made?",
        options: ["Mitochondria", "Ribosome"],
        correctIndex: 0,
        distractorMisconceptions: { "1": "Ribosomes synthesize proteins, not ATP." },
      },
      { selectedIndex: 1 }
    );
    expect(mcRes.outcome).toBe("needs_review");
    expect(mcRes.misconceptionDetected).toContain("Ribosomes synthesize proteins");

    // 2. Fill in the blank
    const fbRes = evaluatePracticeAnswerLocally(
      {
        ...base,
        questionKind: "fill_blank",
        prompt: "Mitochondria produce ___ for cellular energy.",
        expectedBlanks: ["ATP"],
      },
      { blankAnswers: ["atp"] }
    );
    expect(fbRes.outcome).toBe("understood");

    // 3. Ordering / Sequencing
    const ordRes = evaluatePracticeAnswerLocally(
      {
        ...base,
        questionKind: "ordering",
        prompt: "Order cellular respiration stages",
        orderingItems: ["Krebs", "Glycolysis", "ETC"],
        correctOrder: ["Glycolysis", "Krebs", "ETC"],
      },
      { orderedItems: ["Glycolysis", "Krebs", "ETC"] }
    );
    expect(ordRes.outcome).toBe("understood");

    // 4. Free recall
    const frRes = evaluatePracticeAnswerLocally(
      {
        ...base,
        questionKind: "free_recall",
        prompt: "Explain cellular respiration.",
        requiredKeyFacts: ["mitochondria produce ATP", "chemical energy"],
      },
      { writtenText: "Mitochondria produce ATP which stores chemical energy." }
    );
    expect(frRes.outcome).toBe("understood");

    // 5. Scenario / Error ID
    const errRes = evaluatePracticeAnswerLocally(
      {
        ...base,
        questionKind: "scenario_error",
        prompt: "What is wrong with the student's claim?",
        scenarioText: "A student claims chloroplasts produce ATP in animal cells.",
        requiredKeyFacts: ["animal cells lack chloroplasts"],
      },
      { writtenText: "It sounds mostly right." }
    );
    expect(errRes.outcome).toBe("needs_review");
    expect(errRes.misconceptionDetected).toContain("animal cells lack chloroplasts");
  });

  it("computes honest evidence-based progress separating exposure, understanding, and retention", () => {
    // Unassessed scope shows Not assessed / Insufficient evidence even with exposure
    const unassessed = computeStudyProgressSnapshot({
      scopeConceptId: "doc-1",
      scopeConceptLabel: "Cell Biology",
      supplementsViewed: 4,
      masterySummaries: [],
      gaps: [],
      sessionEvaluations: [],
    });
    expect(unassessed.exposure.supplementsViewed).toBe(4);
    expect(unassessed.understanding.label).toBe("Not assessed");
    expect(unassessed.understanding.insufficientEvidence).toBe(true);
    expect(unassessed.retention.label).toBe("Not assessed");
    expect(unassessed.recommendedNext.actionKind).toBe("assess_untested");

    // Weak concept with misconception surfaces targeted remediation
    const withMisconception = computeStudyProgressSnapshot({
      scopeConceptId: "doc-1",
      scopeConceptLabel: "Cell Biology",
      supplementsViewed: 2,
      masterySummaries: [],
      gaps: [],
      sessionEvaluations: [
        {
          questionId: "q1",
          conceptIds: ["doc-1"],
          outcome: "needs_review",
          score: 0,
          feedback: "Incorrect.",
          misconceptionDetected: "Confused mitosis with meiosis.",
          graderOrigin: "deterministic",
          difficulty: 2,
          usedHint: false,
          evaluatedAt: "2026-11-26T00:00:00Z",
        },
      ],
    });
    expect(withMisconception.understanding.needsPracticeCount).toBe(1);
    expect(withMisconception.misconceptions).toContain("Confused mitosis with meiosis.");
    expect(withMisconception.recommendedNext.actionKind).toBe("remediate_misconception");
  });

  it("wires Guided Session, Practice hints/feedback, and Progress panel inside StudyModeWorkspace", async () => {
    vi.spyOn(studyModeApi, "findStudyModeSessionByScope").mockResolvedValue(null);
    vi.spyOn(studyModeApi, "upsertStudyModeSession").mockResolvedValue({
      id: "sess-w2",
      scopeKind: "standalone_document",
      documentId: "doc-w2",
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
    vi.spyOn(studyModeApi, "createStudyFormativeQuestion").mockResolvedValue({
      id: "fq-w2-1",
      revision: 1,
      scopeKey: "doc:doc-w2|rev:rev-1",
      sessionId: "sess-w2",
      segmentId: null,
      conceptIds: ["doc-w2"],
      objectiveIds: [],
      questionKind: "multiple_choice",
      prompt: "What molecule acts as the cell's energy currency?",
      options: ["ATP", "DNA"],
      difficulty: 2,
      questionFingerprint: "sem:atp",
      sourceRefs: [],
      knowledgeAuthority: "source-only",
      createdAt: "2026-11-26T00:00:00Z",
    });
    vi.spyOn(studyModeApi, "submitStudyFormativeAnswer").mockResolvedValue({
      id: "sub-w2-1",
      submissionKey: "sub:fq-w2-1:0",
      questionId: "fq-w2-1",
      questionRevision: 1,
      outcome: "understood",
      score: 1,
      feedback: "Mitochondria produce ATP for cellular energy.",
      misconceptionDetected: null,
      graderOrigin: "deterministic",
      evidenceRecorded: true,
      deduplicated: false,
      createdAt: "2026-11-26T00:00:00Z",
    });
    vi.spyOn(runTaskMod, "runTask").mockResolvedValue({
      taskId: "study-mode-generate-formative-questions",
      output: {
        questionKind: "multiple_choice",
        prompt: "What molecule acts as the cell's energy currency?",
        hint: "Think of the three-letter nucleotide produced by mitochondria.",
        options: ["ATP", "DNA"],
        correctIndex: 0,
        distractorMisconceptions: { "1": "DNA stores genetic information, not immediate energy." },
        explanation: "Mitochondria produce ATP for cellular energy.",
        citations: [{ sourceId: "doc-w2", quote: "Mitochondria produce ATP for cellular energy." }],
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
        documentId="doc-w2"
        documentTitle="Bio 101"
        sourceRevision="rev-1"
        passageText="Mitochondria produce ATP for cellular energy."
        onExitStudyMode={() => {}}
      />
    );

    // Start Guided Session from Freeform Learn tab
    fireEvent.click(await screen.findByText("Start Guided Session"));
    expect(screen.getByTestId("guided-loop-banner")).toBeInTheDocument();

    // Switch to Practice, generate question, reveal hint, and submit correct answer
    fireEvent.click(screen.getByRole("tab", { name: /Practice/i }));
    fireEvent.click(screen.getByText("Next Adaptive Question"));
    await waitFor(() =>
      expect(screen.getByText("What molecule acts as the cell's energy currency?")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByText("Show Hint"));
    expect(screen.getByTestId("practice-hint-box")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("ATP"));
    fireEvent.click(screen.getByText("Check Understanding"));

    await waitFor(() =>
      expect(screen.getByTestId("practice-evaluation-feedback")).toHaveTextContent(/understood/i)
    );

    // Switch to Progress and verify honest evidence breakdown
    fireEvent.click(screen.getByRole("tab", { name: /Progress/i }));
    expect(screen.getByTestId("study-progress-panel")).toBeInTheDocument();
    expect(screen.getByTestId("progress-retention-value")).toHaveTextContent("Not assessed");
  });
});
