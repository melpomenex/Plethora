import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../styles/mobile.css";
import "../components/assistant/mobile/mobile-assistant.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { PresentationProvider } from "../contexts/PresentationContext";
import { BottomControlsGeometryProvider, usePublishBottomControls } from "../components/mobile/BottomControlsGeometry";
import { readAssistantViewport } from "../components/assistant/mobile/viewport";
import { useVisualViewport } from "../hooks/useVisualViewport";
import { StudyPlansTab, type StudyPlansView } from "../components/study-plans/StudyPlansTab";
import { StudyPlansScrollContainer } from "../components/study-plans/StudyPlansScrollContainer";
import { BlueprintQuotaControls } from "../components/study-plans/assessments/BlueprintQuotaControls";
import { QuestionEditor } from "../components/study-plans/assessments/QuestionEditor";
import { ConfidenceSelector } from "../components/study-plans/attempts/ConfidenceSelector";
import { useLearningPathsStore } from "../stores/learningPathsStore";
import type { StudyPlanDetail } from "../types/learningPaths";
import type { AttemptDetail, AttemptSummary } from "../types/assessmentSessions";
import type { AssessmentConfigV1, AssessmentQuestion, AssessmentQuestionRevision, BlueprintDetail } from "../types/assessmentQuestions";

const now = "2026-11-13T00:00:00.000Z";
const planDetail = {
  plan: {
    id: "sp_mobile_fixture",
    title: "Mobile Study Plan for Deep Cryptography and Secure Systems Design",
    goal: "Build a detailed understanding of applied cryptography and the systems that use it.",
    depth: "foundational",
    status: "active",
    currentVersionId: "spv_mobile_fixture",
    draftVersionId: "spv_mobile_fixture",
    currentVersion: 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  },
  version: {
    id: "spv_mobile_fixture",
    planId: "sp_mobile_fixture",
    version: 1,
    state: "draft",
    baseVersionId: null,
    sourceScope: null,
    knowledgeAuthority: { kind: "manual" },
    nodes: Array.from({ length: 32 }, (_, index) => ({
      nodeId: `node_${index + 1}`,
      position: index,
      title: `Cryptographic Foundations ${index + 1}: Long Form Topic for Mobile Reading`,
      summary: "A long summary that tests how detailed curriculum notes wrap in a narrow phone viewport without requiring page-level horizontal scrolling.",
      conceptId: null,
      conceptLabel: `Cryptographic Foundations ${index + 1}`,
      learningObjectives: ["Explain the core principle", "Apply the concept to a realistic secure-systems scenario"],
      included: true,
      locked: false,
      userAdded: false,
      userModified: false,
      materialSupport: "unverified",
      whyHere: null,
      sourceRefIds: [],
    })),
    prerequisites: [],
    changeSummary: null,
    createdBy: "user",
    createdAt: now,
    publishedAt: null,
  },
  activityByNodeId: {},
  sourceRefs: {},
} as unknown as StudyPlanDetail;

function makeQuestion(index: number): AssessmentQuestionRevision {
  const id = `question_${index + 1}`;
  return {
    id,
    questionId: id,
    blueprintRevisionId: "blueprint_revision_mobile_fixture",
    revision: 1,
    slotKey: `slot_${index + 1}`,
    fingerprint: `fingerprint_${index + 1}`,
    question: {
      schemaVersion: 1,
      kind: "single-select",
      prompt: `Question ${index + 1}: Which design choice best protects a long cryptographic explanation from losing readability on a small mobile screen? Select the response that preserves the complete statement and the learner's selected answer.`,
      learningObjectives: [],
      explanation: "The complete prompt should remain readable at narrow viewport widths.",
      sourceRefIds: [],
      applicationLevel: "apply",
      hints: [],
      options: [
        { id: "opt_wrap", text: "Allow the full prompt and answer to wrap within the viewport." },
        { id: "opt_clip", text: "Clip the content to the visible region." },
      ],
      correctOptionId: "opt_wrap",
      maxPoints: 1,
      difficulty: 2,
    },
    validation: "valid",
    committedAt: now,
    provider: null,
    createdAt: now,
  } as unknown as AssessmentQuestionRevision;
}

const questions = Array.from({ length: 20 }, (_, index) => makeQuestion(index));
const assessmentConfig: AssessmentConfigV1 = {
  schemaVersion: 1,
  mode: "exam",
  requestedCount: 10,
  typeWeights: { "single-select": 4, "multi-select": 2, cloze: 2, "short-answer": 1, essay: 1 },
  difficultyWeights: { 1: 1, 2: 3, 3: 4, 4: 2, 5: 1 },
  topicTargets: [],
  timeLimitSeconds: 1800,
  knowledgePolicy: "model-only",
  excludedQuestionFingerprints: [],
  pointsByKind: { "single-select": 1, "multi-select": 1, cloze: 1, "short-answer": 2, essay: 8 },
};
const emptySourceScope = {
  schemaVersion: 1,
  selected: { documentIds: [], extractIds: [], collectionIds: [], tagIds: [] },
  resolvedDocuments: [],
  frozenAt: now,
  indexCompleteness: "complete",
  limitations: [],
};
const createdBlueprint: BlueprintDetail = {
  blueprint: {
    id: "blueprint_mobile_created",
    planId: planDetail.plan.id,
    title: "Mobile Study Plan Examination",
    currentRevisionId: "blueprint_revision_mobile_created",
    lifecycle: "active",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  },
  revision: {
    id: "blueprint_revision_mobile_created",
    blueprintId: "blueprint_mobile_created",
    revision: 1,
    state: "draft",
    planVersionId: planDetail.version.id,
    config: {
      ...assessmentConfig,
      topicTargets: planDetail.version.nodes.slice(0, 1).map((node) => ({
        nodeId: node.nodeId,
        conceptId: node.conceptId,
        weight: 1,
      })),
    },
    scoring: {} as never,
    sourceScope: emptySourceScope as never,
    quota: {} as never,
    generationJobId: null,
    sourceSnapshotHash: "sha256:mobile-fixture",
    createdAt: now,
    publishedAt: null,
  },
  questions: [],
};

function makeAttempt(id: string, status: "complete" | "in-progress"): AttemptDetail {
  const completed = status === "complete";
  return {
    attempt: {
      id,
      blueprintRevisionId: "blueprint_revision_mobile_fixture",
      blueprintTitle: "Mobile Assessment with Long Prompts and Full Answer Review",
      clientStartKey: `client_${id}`,
      mode: "exam",
      status,
      questionRevisionIds: questions.map((question) => question.id),
      revision: 1,
      startedAt: now,
      deadlineAt: null,
      submittedAt: completed ? now : null,
      completedAt: completed ? now : null,
      submissionReason: completed ? "user" : null,
      submissionKey: completed ? `submission_${id}` : null,
      awardedPoints: completed ? questions.length : null,
      maximumPoints: questions.length,
      createdAt: now,
      updatedAt: now,
    },
    responses: questions.map((question, index) => ({
      id: `response_${id}_${index + 1}`,
      attemptId: id,
      questionRevisionId: question.id,
      draft: { kind: "single-select", optionId: "opt_wrap" },
      mark: "answered",
      revision: 1,
      lastClientMutationId: `mutation_${id}_${index + 1}`,
      updatedAt: now,
    })),
    submissions: [],
    currentGrades: [],
    questions,
  } as unknown as AttemptDetail;
}

const completedAttempt = makeAttempt("attempt_complete_mobile", "complete");
const activeAttempt = makeAttempt("attempt_active_mobile", "in-progress");
const history: AttemptSummary[] = [
  ...Array.from({ length: 36 }, (_, index) => ({
    id: `attempt_history_${index + 1}`,
    blueprintRevisionId: "blueprint_revision_mobile_fixture",
    blueprintId: "blueprint_mobile_fixture",
    blueprintTitle: `Secure Systems Assessment ${index + 1} with a Detailed Mobile Review History`,
    mode: "exam" as const,
    status: "complete" as const,
    startedAt: now,
    deadlineAt: null,
    completedAt: now,
    awardedPoints: 16,
    maximumPoints: 20,
    questionCount: 20,
  })),
  {
    id: activeAttempt.attempt.id,
    blueprintRevisionId: activeAttempt.attempt.blueprintRevisionId,
    blueprintId: "blueprint_mobile_fixture",
    blueprintTitle: activeAttempt.attempt.blueprintTitle!,
    mode: "exam",
    status: "in-progress",
    startedAt: now,
    deadlineAt: null,
    completedAt: null,
    awardedPoints: null,
    maximumPoints: 20,
    questionCount: 20,
  },
];

Object.defineProperty(window, "__TAURI_INTERNALS__", {
  configurable: true,
  value: {
    invoke: async (command: string, args?: Record<string, unknown>) => {
      if (command === "list_study_plans") return [];
      if (command === "recover_interrupted_study_jobs" || command === "list_study_generation_jobs") return [];
      if (command === "list_exam_attempts") return history;
      if (command === "get_exam_attempt") {
        return args?.attemptId === activeAttempt.attempt.id ? activeAttempt : completedAttempt;
      }
      if (command === "get_assessment_blueprint_revision") {
        return {
          blueprint: { id: "blueprint_mobile_fixture", planId: null },
          revision: { id: "blueprint_revision_mobile_fixture", planVersionId: null, config: { knowledgePolicy: "model-only" } },
          questions,
        };
      }
      if (command === "get_workload_data") return [];
      if (command === "create_assessment_blueprint") return createdBlueprint;
      if (command === "create_study_plan_lesson") {
        const input = args?.input as Record<string, unknown> | undefined;
        return {
          id: "lesson_mobile_fixture",
          planId: input?.planId,
          planVersionId: input?.planVersionId,
          nodeId: input?.nodeId,
          objectiveIndex: input?.objectiveIndex ?? 0,
          style: "guided",
          knowledgeAuthorityJson: String(input?.knowledgeAuthorityJson ?? "{}"),
          sourceRevisionSnapshot: String(input?.sourceRevisionSnapshot ?? ""),
          promptText: String(input?.promptText ?? "Mobile lesson fixture"),
          answerDraft: "",
          hintCount: 0,
          turnCount: 0,
          turnStateJson: "{}",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
      }
      return [];
    },
  },
});

useLearningPathsStore.setState({
  plans: [],
  activePlanId: planDetail.plan.id,
  activePlanDetail: planDetail,
  isLoading: false,
  error: null,
  createStudyPlan: async () => planDetail,
  selectPlan: async () => {
    useLearningPathsStore.setState({ activePlanId: planDetail.plan.id, activePlanDetail: planDetail });
    return planDetail;
  },
});

const params = new URLSearchParams(location.search);
const startView: StudyPlansView = params.get("view") === "history"
  ? { name: "assessment-history" }
  : params.get("view") === "runner"
    ? { name: "attempt-runner", attemptId: activeAttempt.attempt.id, fromHistory: true }
    : params.get("view") === "plan-home"
      ? { name: "plan-home", planId: planDetail.plan.id }
      : params.get("view") === "editor"
        ? { name: "plan", planId: planDetail.plan.id }
        : { name: "home" };

function StudyPlanSurface() {
  const surface = params.get("view");
  if (surface === "question-editor") {
    return (
      <>
        <StudyPlansScrollContainer data-study-plans-scroll="question-editor-background">
          <div className="p-4" />
        </StudyPlansScrollContainer>
        <QuestionEditor
          initialQuestion={questions[0].question as AssessmentQuestion}
          availableSourceRefs={[]}
          onSave={async () => undefined}
          onClose={() => undefined}
        />
      </>
    );
  }

  if (surface === "assessment-controls") {
    return (
      <StudyPlansScrollContainer className="p-4 sm:p-6 space-y-6" data-study-plans-scroll="assessment-controls">
        <BlueprintQuotaControls config={assessmentConfig} onChange={() => undefined} />
        <ConfidenceSelector value={undefined} onChange={() => undefined} />
      </StudyPlansScrollContainer>
    );
  }

  return <StudyPlansTab initialView={startView} />;
}

function ShellControls() {
  const navRef = useRef<HTMLElement>(null);
  const audioRef = useRef<HTMLElement>(null);
  const assistantRef = useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = useState(readAssistantViewport);
  useEffect(() => {
    const update = () => setViewport(readAssistantViewport());
    const rootObserver = new MutationObserver(update);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      rootObserver.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  const audioVisible = params.has("audio");
  usePublishBottomControls({
    viewport,
    navRef,
    audioRef,
    audioVisible,
    pillRef: assistantRef,
    pillVisible: true,
    blocked: false,
    fullscreen: false,
  });

  return (
    <>
      {audioVisible && <aside ref={audioRef} aria-label="Audio dock" style={{ position: "fixed", right: 0, bottom: 56, left: 0, height: 64, zIndex: 999 }}>Audio dock</aside>}
      <div className="mobile-assistant-layer" style={{ top: 0, height: "100dvh" }}>
        <div className="mobile-assistant-pill-position" style={{ bottom: 64 }}>
          <button ref={assistantRef} type="button" className="mobile-assistant-pill">Assistant</button>
        </div>
      </div>
      <nav ref={navRef} className="mobile-bottom-nav" aria-label="Main navigation" style={{ height: 56 }}>
        <button type="button" className="mobile-nav-item">Study Plans</button>
      </nav>
    </>
  );
}

function Harness() {
  useVisualViewport();
  return (
    <ThemeProvider>
      <PresentationProvider>
        <BottomControlsGeometryProvider>
          <div className="adaptive-shell-root" style={{ "--shell-mobile-nav-height": "56px" } as CSSProperties}>
            <main className="mobile-main-content">
              <StudyPlanSurface />
            </main>
            <ShellControls />
          </div>
        </BottomControlsGeometryProvider>
      </PresentationProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
