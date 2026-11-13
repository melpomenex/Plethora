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

vi.mock("../../../../api/study-lessons", () => ({
  createStudyPlanLesson: vi.fn().mockResolvedValue({
    id: "spl_1", planId: "sp_1", planVersionId: "spv_1", nodeId: "n1", objectiveIndex: 0,
    style: "guided", knowledgeAuthorityJson: '{"kind":"model-only"}', sourceRevisionSnapshot: "",
    promptText: "Topic", answerDraft: "", hintCount: 0, turnCount: 0,
    turnStateJson: "{}", revision: 1, lastTurnRequestId: null,
    createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z",
  }),
  getStudyPlanLesson: vi.fn().mockResolvedValue(null),
  saveStudyPlanLessonCheckpoint: vi.fn().mockResolvedValue({
    id: "spl_1", planId: "sp_1", planVersionId: "spv_1", nodeId: "n1", objectiveIndex: 0,
    style: "guided", knowledgeAuthorityJson: '{"kind":"model-only"}', sourceRevisionSnapshot: "",
    promptText: "Topic", answerDraft: "", hintCount: 0, turnCount: 0,
    turnStateJson: "{}", revision: 2, lastTurnRequestId: null,
    createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z",
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
