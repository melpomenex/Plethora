import { describe, expect, it, vi } from "vitest";
import {
  LEARNING_ACTIVITY_TYPES,
  type LearningActivity,
  type LearningActivityType,
} from "../../../types/learningActivity";
import {
  PRIMARY_LEARNING_DESTINATIONS,
  PRIMARY_LEARNING_DESTINATION_ORDER,
  resolvePrimaryLearningDestination,
  resolveTabType,
} from "../../../navigation/tabDestinations";
import {
  buildWorkspaceLaunchPlan,
  launchLearningActivity,
  type WorkspaceNavigateEvent,
} from "../workspaceLauncher";

function makeActivity(
  activityType: LearningActivityType,
  overrides: Partial<LearningActivity> = {}
): LearningActivity {
  return {
    id: `act-${activityType}`,
    activityType,
    title: `Activity ${activityType}`,
    status: "pending",
    dedupeKey: `dedupe-${activityType}`,
    sourceReferences: [
      {
        entityKind: "document",
        entityId: "doc-123",
        documentId: "doc-123",
        label: "Linear Algebra Ch. 3",
      },
    ],
    conceptReferences: ["concept-eigenvalues"],
    goalReferences: ["goal-linear-algebra"],
    estimatedMinutes: 15,
    priorityMetadata: { score: 0.8, urgency: "normal" },
    prerequisiteRequirements: [],
    recommendationReason: "Scheduled in today's session",
    capabilityRequirements: { required: [], optional: [] },
    resumeState: { page: 42, locator: "ch3-sec2" },
    completionPolicy: { mode: "explicit" },
    isLocalOnly: false,
    isAiExcluded: false,
    examIsolated: false,
    ...overrides,
  };
}

describe("Universal Study Workspace Launcher", () => {
  it("resolves every canonical LearningActivityType into a valid launch plan", () => {
    for (const type of LEARNING_ACTIVITY_TYPES) {
      const activity = makeActivity(type);
      const plan = buildWorkspaceLaunchPlan(activity);
      expect(plan.activityId).toBe(activity.id);
      expect(plan.activityType).toBe(type);
      expect(plan.tabType).toBeTruthy();
      expect(plan.routePath.startsWith("/")).toBe(true);
    }
  });

  it("routes source_reading into single canonical DocumentViewerWrapper in read mode with preserved location and return-to-origin", () => {
    const activity = makeActivity("source_reading", {
      resumeState: { page: 18, cfi: "epubcfi(/6/4[chap02]!/4/2)" },
    });
    const dispatch = vi.fn<(event: WorkspaceNavigateEvent) => void>();

    const { plan, event } = launchLearningActivity(activity, dispatch, {
      returnTo: { tabId: "tab-today", tabType: "dashboard", sessionId: "sess-1" },
    });

    expect(plan.surface).toBe("document-viewer");
    expect(plan.canonicalReaderHost).toBe("DocumentViewerWrapper");
    expect(plan.reuseExistingReaderTab).toBe(true);
    expect(plan.presentationMode).toBe("read");
    expect(plan.documentId).toBe("doc-123");
    expect(plan.readingLocation).toEqual({
      page: 18,
      cfi: "epubcfi(/6/4[chap02]!/4/2)",
    });
    expect(plan.returnTo).toEqual({
      tabId: "tab-today",
      tabType: "dashboard",
      sessionId: "sess-1",
      activityId: activity.id,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(event.reuseExistingTab).toBe(true);
    expect(event.state.canonicalReaderHost).toBe("DocumentViewerWrapper");
    expect(event.state.returnTo?.tabType).toBe("dashboard");
  });

  it("routes guided_reading, comprehension_check, socratic_tutoring, and targeted_remediation into single canonical DocumentViewerWrapper in study mode", () => {
    const studyReaderTypes: LearningActivityType[] = [
      "guided_reading",
      "comprehension_check",
      "socratic_tutoring",
      "targeted_remediation",
    ];

    for (const type of studyReaderTypes) {
      const plan = buildWorkspaceLaunchPlan(makeActivity(type));
      expect(plan.surface).toBe("document-viewer");
      expect(plan.canonicalReaderHost).toBe("DocumentViewerWrapper");
      expect(plan.reuseExistingReaderTab).toBe(true);
      expect(plan.presentationMode).toBe("study");
      expect(plan.documentId).toBe("doc-123");
    }

    const socraticPlan = buildWorkspaceLaunchPlan(makeActivity("socratic_tutoring"));
    expect(socraticPlan.layout).toBe("with-assistant");
    expect(socraticPlan.assistantSuppressed).toBe(false);
  });

  it("routes flashcard_review to the review surface without reader host", () => {
    const activity = makeActivity("flashcard_review", {
      sourceReferences: [{ entityKind: "learning_item", entityId: "card-99" }],
    });
    const plan = buildWorkspaceLaunchPlan(activity);

    expect(plan.surface).toBe("review");
    expect(plan.tabType).toBe("review");
    expect(plan.routePath).toBe("/review");
    expect(plan.canonicalReaderHost).toBeNull();
    expect(plan.reuseExistingReaderTab).toBe(false);
    expect(plan.entityId).toBe("card-99");
  });

  it("enforces exam isolation on rubric_assessment and suppresses assistant and coaching", () => {
    const activity = makeActivity("rubric_assessment", {
      examIsolated: false, // Even if unset on activity, rubric_assessment enforces isolation
    });
    const dispatch = vi.fn<(event: WorkspaceNavigateEvent) => void>();

    const { plan, event } = launchLearningActivity(activity, dispatch, {
      returnTo: { tabId: "tab-learn", tabType: "study-plans" },
    });

    expect(plan.surface).toBe("study-plans");
    expect(plan.tabType).toBe("study-plans");
    expect(plan.examIsolated).toBe(true);
    expect(plan.assistantSuppressed).toBe(true);
    expect(plan.assistantSuppressionReason).toBe("exam_isolated");
    expect(plan.payload.runner).toBe("exam");
    expect(plan.payload.suppressAssistant).toBe(true);
    expect(plan.payload.suppressCoaching).toBe(true);

    expect(event.state.examIsolated).toBe(true);
    expect(event.state.assistantSuppressed).toBe(true);
  });

  it("propagates exam isolation and privacy flags to suppress assistant layout in DocumentViewerWrapper", () => {
    const socraticExam = buildWorkspaceLaunchPlan(
      makeActivity("socratic_tutoring"),
      { examIsolated: true, preferredLayout: "with-assistant" }
    );
    expect(socraticExam.examIsolated).toBe(true);
    expect(socraticExam.assistantSuppressed).toBe(true);
    expect(socraticExam.assistantSuppressionReason).toBe("exam_isolated");
    expect(socraticExam.layout).toBe("focused");

    const localOnlyGuided = buildWorkspaceLaunchPlan(
      makeActivity("guided_reading", { isLocalOnly: true }),
      { preferredLayout: "with-assistant" }
    );
    expect(localOnlyGuided.assistantSuppressed).toBe(true);
    expect(localOnlyGuided.assistantSuppressionReason).toBe("local_only");
    expect(localOnlyGuided.layout).toBe("focused");

    const aiExcludedGuided = buildWorkspaceLaunchPlan(
      makeActivity("guided_reading", { isAiExcluded: true }),
      { preferredLayout: "with-assistant" }
    );
    expect(aiExcludedGuided.assistantSuppressed).toBe(true);
    expect(aiExcludedGuided.assistantSuppressionReason).toBe("ai_excluded");
    expect(aiExcludedGuided.layout).toBe("focused");
  });

  it("falls back to study-plans for targeted_remediation when no document is referenced", () => {
    const activity = makeActivity("targeted_remediation", {
      sourceReferences: [{ entityKind: "concept", entityId: "concept-1" }],
      resumeState: null,
    });
    const plan = buildWorkspaceLaunchPlan(activity);
    expect(plan.surface).toBe("study-plans");
    expect(plan.tabType).toBe("study-plans");
    expect(plan.documentId).toBeNull();
    expect(plan.payload.remediation).toBe(true);
  });
});

describe("Consolidated Primary Learning Navigation & Aliases", () => {
  it("defines all 7 primary learning destinations with canonical and secondary tabs", () => {
    expect(PRIMARY_LEARNING_DESTINATION_ORDER).toEqual([
      "today",
      "library",
      "learn",
      "review",
      "discover",
      "knowledge",
      "insights",
    ]);

    expect(PRIMARY_LEARNING_DESTINATIONS.today.canonicalTabType).toBe("dashboard");
    expect(PRIMARY_LEARNING_DESTINATIONS.library.canonicalTabType).toBe("documents");
    expect(PRIMARY_LEARNING_DESTINATIONS.learn.canonicalTabType).toBe("study-plans");
    expect(PRIMARY_LEARNING_DESTINATIONS.review.canonicalTabType).toBe("review");
    expect(PRIMARY_LEARNING_DESTINATIONS.discover.canonicalTabType).toBe("rss");
    expect(PRIMARY_LEARNING_DESTINATIONS.knowledge.canonicalTabType).toBe("knowledge-sphere");
    expect(PRIMARY_LEARNING_DESTINATIONS.insights.canonicalTabType).toBe("learning-insights");

    expect(resolvePrimaryLearningDestination("continue-reading")).toBe("today");
    expect(resolvePrimaryLearningDestination("queue-scroll")).toBe("review");
    expect(resolvePrimaryLearningDestination("podcast")).toBe("discover");
    expect(resolvePrimaryLearningDestination("analytics")).toBe("insights");
  });

  it("resolves friendly primary aliases without breaking legacy aliases", () => {
    // New friendly primary aliases
    expect(resolveTabType("today")).toBe("dashboard");
    expect(resolveTabType("/today")).toBe("dashboard");
    expect(resolveTabType("learn")).toBe("study-plans");
    expect(resolveTabType("/learn")).toBe("study-plans");
    expect(resolveTabType("discover")).toBe("rss");
    expect(resolveTabType("/discover")).toBe("rss");
    expect(resolveTabType("insights")).toBe("learning-insights");
    expect(resolveTabType("/insights")).toBe("learning-insights");
    expect(resolveTabType("library")).toBe("documents");
    expect(resolveTabType("knowledge")).toBe("knowledge-sphere");

    // Existing aliases remain intact
    expect(resolveTabType("dash")).toBe("dashboard");
    expect(resolveTabType("home")).toBe("dashboard");
    expect(resolveTabType("docs")).toBe("documents");
    expect(resolveTabType("qs")).toBe("queue-scroll");
    expect(resolveTabType("rev")).toBe("review");
    expect(resolveTabType("anal")).toBe("analytics");
    expect(resolveTabType("stats")).toBe("analytics");
    expect(resolveTabType("feeds")).toBe("rss");
    expect(resolveTabType("ks")).toBe("knowledge-sphere");
    expect(resolveTabType("curriculum")).toBe("study-plans");
    expect(resolveTabType("learning-insights")).toBe("learning-insights");
  });
});
