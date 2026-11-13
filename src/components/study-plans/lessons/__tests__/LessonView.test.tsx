/**
 * LessonView authority tests: model-only lessons must never mount the scoped
 * tutor (zero retrieval) and never carry a source snapshot; library-backed
 * lessons expose the scoped tutor entry when verified refs exist.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LessonView } from "../LessonView";
import type { StudyPlanDetail } from "../../../../types/learningPaths";
import { createStudyPlanLesson, saveStudyPlanLessonCheckpoint, type StudyPlanLesson } from "../../../../api/study-lessons";
import { prepareLessonHelp } from "../../../../lib/study-plans/lessonHelp";
import { runTutorTurn } from "../../../../lib/ai/tasks/definitions/tutorTask";

vi.mock("../../../../lib/study-plans/lessonHelp", () => ({ prepareLessonHelp: vi.fn() }));
vi.mock("../../../../lib/ai/tasks/definitions/tutorTask", () => ({ runTutorTurn: vi.fn() }));

const savedLesson = vi.hoisted((): StudyPlanLesson => ({
  id: "spl_1", planId: "sp_1", planVersionId: "spv_1", nodeId: "n1", objectiveIndex: 0,
  style: "guided", knowledgeAuthorityJson: '{"kind":"model-only"}', sourceRevisionSnapshot: "",
  promptText: "Topic", answerDraft: "", hintCount: 0, turnCount: 0,
  turnStateJson: "{}", revision: 1, lastTurnRequestId: null,
  createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z",
}));

vi.mock("../../../../api/study-lessons", () => ({
  createStudyPlanLesson: vi.fn().mockResolvedValue(savedLesson),
  getStudyPlanLesson: vi.fn().mockResolvedValue(null),
  saveStudyPlanLessonCheckpoint: vi.fn().mockResolvedValue({
    ...savedLesson,
    revision: 2,
  }),
}));

function modelOnlyPlan(): StudyPlanDetail {
  return {
    plan: { id: "sp_1", title: "Plan", goal: "Goal", depth: "survey", status: "active", currentVersionId: null, currentVersion: 0, draftVersionId: "spv_1", revision: 1, createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z" },
    version: {
      id: "spv_1", planId: "sp_1", version: 1, state: "draft", baseVersionId: null,
      sourceScope: undefined,
      knowledgeAuthority: { kind: "model-only" },
      nodes: [{ nodeId: "n1", title: "Topic", summary: "S", learningObjectives: ["Obj"], conceptId: null, conceptLabel: "T", position: 0, included: true, locked: false, userAdded: false, userModified: false, materialSupport: "unsupported", whyHere: null, sourceRefIds: [] }],
      prerequisites: [], changeSummary: null, createdBy: "ai", createdAt: "2026-11-12T00:00:00Z", publishedAt: null,
    },
    activityByNodeId: {},
    sourceRefs: {},
  };
}

function libraryPlan(): StudyPlanDetail {
  const plan = modelOnlyPlan();
  plan.version.knowledgeAuthority = { kind: "library", policy: "source-only" };
  plan.version.sourceScope = {
    schemaVersion: 1,
    selected: { documentIds: ["doc_1"], extractIds: [], collectionIds: [], tagIds: [] },
    resolvedDocuments: [{ documentId: "doc_1", title: "D", sourceType: "pdf", revision: "r1", revisionKind: "content-hash", extractIds: [], isAiExcluded: false, isLocalOnly: false }],
    frozenAt: "2026-11-12T00:00:00Z",
    indexCompleteness: "complete",
    limitations: [],
  };
  plan.version.nodes[0].sourceRefIds = ["ssr_1"];
  plan.sourceRefs = {
    ssr_1: {
      status: "current",
      navigation: "exact",
      ref: { schemaVersion: 1, id: "ssr_1", documentId: "doc_1", excerpt: "passage", revision: "r1", revisionKind: "content-hash", excerptSha256: "h", documentTitle: "D", sourceType: "pdf", capturedAt: "2026-11-12T00:00:00Z" },
    },
  };
  return plan;
}

describe("LessonView authority surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the selected objective and repairs the old title prompt on save", async () => {
    const plan = libraryPlan();
    plan.version.nodes[0].learningObjectives = ["Define the terms", "Explain how the concepts relate"];
    const create = vi.mocked(createStudyPlanLesson);
    create.mockResolvedValueOnce({ ...savedLesson, objectiveIndex: 1, answerDraft: "My saved draft" });
    render(<LessonView planDetail={plan} nodeId="n1" objectiveIndex={1} onClose={vi.fn()} />);

    const answer = await screen.findByRole("textbox", { name: /reasoning/i });
    expect(answer).toHaveAccessibleDescription(
      "How would you complete this task? Write your answer in your own words. Explain how the concepts relate"
    );
    expect(answer).toHaveValue("My saved draft");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      objectiveIndex: 1,
      promptText: expect.stringContaining("Explain how the concepts relate"),
    }));
    fireEvent.click(screen.getByRole("button", { name: /save progress/i }));
    await waitFor(() => expect(saveStudyPlanLessonCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 1,
      promptText: expect.stringContaining("Explain how the concepts relate"),
      answerDraft: "My saved draft",
    })));
  });

  it("asks a topic question when the objective is blank", async () => {
    const plan = modelOnlyPlan();
    plan.version.nodes[0].learningObjectives = [" "];
    render(<LessonView planDetail={plan} nodeId="n1" onClose={vi.fn()} />);

    expect(await screen.findByRole("textbox", { name: /reasoning/i })).toHaveAccessibleDescription(
      "What are the main ideas behind “Topic”? Explain them in your own words."
    );
  });

  it("recovers old hint counters, renders tutor help, and saves the actual text", async () => {
    vi.mocked(createStudyPlanLesson).mockResolvedValueOnce({
      ...savedLesson, hintCount: 3, turnStateJson: '{"explained":true}', answerDraft: "Draft",
    });
    vi.mocked(prepareLessonHelp).mockResolvedValue({
      preflight: { featureAllowed: true }, route: { provider: { id: "local" } }, excerpts: ["Pinned passage"],
    } as Awaited<ReturnType<typeof prepareLessonHelp>>);
    vi.mocked(runTutorTurn)
      .mockResolvedValueOnce({ output: { move: "hint", content: "Compare the two definitions." } } as Awaited<ReturnType<typeof runTutorTurn>>)
      .mockResolvedValueOnce({ output: { move: "explain", content: "Here is how the two concepts relate." } } as Awaited<ReturnType<typeof runTutorTurn>>);
    vi.mocked(saveStudyPlanLessonCheckpoint).mockImplementation(async (input) => ({
      ...savedLesson,
      ...input,
      promptText: input.promptText ?? savedLesson.promptText,
      revision: input.expectedRevision + 1,
    }));
    render(<LessonView planDetail={libraryPlan()} nodeId="n1" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Hint (0/3)" }));
    expect(await screen.findByText("Compare the two definitions.")).toBeInTheDocument();
    expect(runTutorTurn).toHaveBeenCalledWith(expect.objectContaining({
      forcedMove: "hint", lessonAuthority: "library", selectedMaterial: "Pinned passage",
    }), expect.objectContaining({ provider: { id: "local" } }));
    expect(screen.getByRole("button", { name: "Hint (1/3)" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Explain directly" }));
    expect(await screen.findByText("Here is how the two concepts relate.")).toBeInTheDocument();
    expect(saveStudyPlanLessonCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedRevision: 2,
      answerDraft: "Draft",
      hintCount: 1,
      turnStateJson: expect.stringContaining("Here is how the two concepts relate."),
    }));
  });

  it("shows a failure without spending a hint", async () => {
    vi.mocked(prepareLessonHelp).mockRejectedValueOnce(new Error("studyPlans.lesson.helpNeedsSources"));
    render(<LessonView planDetail={libraryPlan()} nodeId="n1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Hint (0/3)" }));
    expect(await screen.findByText(/needs a verified source/i)).toHaveAttribute("role", "status");
    expect(saveStudyPlanLessonCheckpoint).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hint (0/3)" })).toBeEnabled();
  });

  it("waits for approval before sending lesson help to a remote model", async () => {
    const remote = {
      preflight: { featureAllowed: false, sendsSourceOffDevice: true, billable: true, providerId: "remote" },
      route: { provider: { id: "remote" } },
      excerpts: [],
    } as unknown as Awaited<ReturnType<typeof prepareLessonHelp>>;
    vi.mocked(prepareLessonHelp)
      .mockResolvedValueOnce(remote)
      .mockResolvedValueOnce({ ...remote, preflight: { ...remote.preflight, featureAllowed: true } });
    vi.mocked(runTutorTurn).mockResolvedValueOnce({
      output: { move: "hint", content: "Start with the main idea." },
    } as Awaited<ReturnType<typeof runTutorTurn>>);
    render(<LessonView planDetail={modelOnlyPlan()} nodeId="n1" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Hint (0/3)" }));
    const generate = await screen.findByRole("button", { name: "Generate hint" });
    expect(generate).toBeDisabled();
    expect(runTutorTurn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /approve the off-device/i }));
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /authorize the disclosed/i }));
    fireEvent.click(generate);
    expect(await screen.findByText("Start with the main idea.")).toBeInTheDocument();
    expect(prepareLessonHelp).toHaveBeenLastCalledWith(expect.anything(), {}, {
      route: remote.route, transfer: true, cost: true,
    });
    expect(runTutorTurn).toHaveBeenCalledWith(expect.objectContaining({
      lessonAuthority: "model-only", selectedMaterial: "",
    }), expect.anything());
  });

  it("model-only lessons show no scoped-tutor entry and launch without a source snapshot", async () => {
    const lessonsApi = await import("../../../../api/study-lessons");
    render(<LessonView planDetail={modelOnlyPlan()} nodeId="n1" onClose={vi.fn()} />);

    expect(await screen.findByText(/AI Knowledge Only · unverified/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open scoped tutor/i })).not.toBeInTheDocument();
    expect(lessonsApi.createStudyPlanLesson).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRevisionSnapshot: "" })
    );
  });

  it("library-backed lessons with verified refs expose the scoped tutor entry", async () => {
    render(<LessonView planDetail={libraryPlan()} nodeId="n1" onClose={vi.fn()} />);

    expect(await screen.findByText(/Library-backed · pinned authority/i)).toBeInTheDocument();
    const tutor = screen.getByRole("button", { name: /open scoped tutor/i });
    expect(tutor).toBeInTheDocument();
    // Opening mounts the scoped tutor host (authority + preflight enforced there).
    fireEvent.click(tutor);
    await waitFor(() => {
      expect(document.querySelector('[data-tutor-sheet="true"]')).not.toBeNull();
    });
  });

  it("hands off to an explicitly chosen independent practice route", async () => {
    const onHandoff = vi.fn();
    render(<LessonView planDetail={modelOnlyPlan()} nodeId="n1" onClose={vi.fn()} onHandoff={onHandoff} />);

    fireEvent.click(await screen.findByRole("button", { name: /practice independently/i }));
    expect(onHandoff).toHaveBeenCalledTimes(1);
  });
});
