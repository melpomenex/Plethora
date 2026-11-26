import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { LearnerEvidenceSection } from "../LearnerEvidenceSection";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import type { StudyPlanDetail } from "../../../types/learningPaths";

vi.mock("../../../api/languageLexicon", () => ({
  listLanguageLexicalEntries: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock("../../../api/languagePractice", () => ({
  listLanguagePracticeAttempts: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../api/learning-items", () => ({
  getAllLearningItems: vi.fn().mockResolvedValue([]),
}));

function makeDetail(overrides: Partial<StudyPlanDetail["plan"]> = {}): StudyPlanDetail {
  return {
    plan: {
      id: "sp_1",
      title: "Spanish Grammar",
      goal: "Master the subjunctive",
      depth: "foundational",
      status: "active",
      currentVersionId: "spv_1",
      currentVersion: 1,
      draftVersionId: null,
      revision: 1,
      languageProfileId: "profile-1",
      ...overrides,
      createdAt: "2026-11-10T00:00:00Z",
      updatedAt: "2026-11-10T00:00:00Z",
    },
    version: {
      id: "spv_1",
      planId: "sp_1",
      version: 1,
      state: "published",
      baseVersionId: null,
      sourceScope: null,
      knowledgeAuthority: { kind: "manual" },
      nodes: [
        {
          nodeId: "n1",
          title: "Subjunctive uses",
          summary: "When to use the subjunctive",
          learningObjectives: ["Uses of the subjunctive mood"],
          conceptId: null,
          conceptLabel: "Subjunctive",
          position: 0,
          included: true,
          locked: false,
          userAdded: false,
          userModified: false,
          materialSupport: "grounded",
          whyHere: null,
          sourceRefIds: ["ref1"],
        },
      ],
      prerequisites: [],
      changeSummary: null,
      createdBy: "user",
      createdAt: "2026-11-10T00:00:00Z",
      publishedAt: "2026-11-10T00:00:00Z",
    },
    activityByNodeId: { n1: "in-progress" },
    sourceRefs: {
      ref1: {
        ref: {
          schemaVersion: 1,
          id: "ref1",
          documentId: "doc1",
          excerpt: "The subjunctive…",
          revision: "rev1",
          revisionKind: "unknown",
          excerptSha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          documentTitle: "Grammar textbook",
          sourceType: "document",
          capturedAt: "2026-11-10T00:00:00Z",
        },
        status: "current",
        navigation: "exact",
      },
    },
  };
}

describe("LearnerEvidenceSection", () => {
  beforeEach(() => {
    useLanguageProfileStore.setState({
      activeProfile: {
        id: "profile-1",
        targetLanguage: "es",
        baseLanguage: "en",
      } as never,
    });
  });

  it("renders nothing when the plan is not linked to a language profile", () => {
    const { container } = render(<LearnerEvidenceSection planDetail={makeDetail({ languageProfileId: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders learner-evidence recommendations from empty evidence", async () => {
    render(<LearnerEvidenceSection planDetail={makeDetail()} />);
    expect(await screen.findByText("Learner evidence")).toBeTruthy();
    expect(await screen.findByText("Vocabulary coverage")).toBeTruthy();
    expect(await screen.findByText("Practice refresh")).toBeTruthy();
    expect(await screen.findByText("Flashcard mining")).toBeTruthy();
    expect(screen.getAllByText("Open Language Learning").length).toBeGreaterThanOrEqual(1);
  });
});
