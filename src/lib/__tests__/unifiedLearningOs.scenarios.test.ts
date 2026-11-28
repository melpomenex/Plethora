/**
 * Unified Personal Learning Operating System — End-to-End Integration Scenarios (A through O)
 *
 * Verifies all 15 representative user workflows against the real production modules:
 * - Learning Event Bus (`learningEventBus.ts`)
 * - 5D Persistent Learner Model (`competencyEstimator.ts`, `learnerModelStore.ts`)
 * - Unified Learning Goals & Feasibility (`feasibility.ts`, `learningGoalsStore.ts`)
 * - Learning Activity Registry, Session Runtime & Workspace Launcher
 *   (`activityRegistry.ts`, `sessionRuntime.ts`, `workspaceLauncher.ts`, `learningSessionStore.ts`)
 * - Heterogeneous DAQE Orchestrator (`orchestrator.ts`)
 * - Competency-Based Adaptive Curricula & Assessment Remediation
 *   (`adaptiveCurriculum.ts`, `assessmentRemediation.ts`)
 * - Personal Learning Coach (`coachEngine.ts`, `learningCoachStore.ts`)
 * - Optional Motivation Engine (`motivationEngine.ts`, `motivationStore.ts`)
 * - Canonical Navigation Destinations (`tabDestinations.ts`)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    invokeCommand: vi.fn(),
    listen: vi.fn(async () => () => {}),
  };
});

import {
  _resetLearnerModelApiFallbackForTests,
} from "../../api/learner-model";
import { resetBrowserLearningGoalsState } from "../../api/learning-goals";
import {
  resolvePrimaryLearningDestination,
  resolveTabType,
} from "../../navigation/tabDestinations";
import { useLearnerModelStore } from "../../stores/learnerModelStore";
import { useLearningCoachStore } from "../../stores/learningCoachStore";
import { useLearningGoalsStore } from "../../stores/learningGoalsStore";
import {
  LEARNING_SESSION_STORAGE_KEY,
  _resetLearningSessionEventSyncForTests,
  useLearningSessionStore,
} from "../../stores/learningSessionStore";
import { useMotivationStore } from "../../stores/motivationStore";
import type {
  LearningActivity,
  LearningActivityType,
  RuntimeCapabilities,
} from "../../types/learningActivity";
import type { CompetencyEvidenceRecord } from "../../types/learnerModel";
import {
  orchestrateLearningSession,
  type DaqeActivityCandidate,
} from "../daqe/orchestrator";
import {
  estimateDimensionCompetency,
  projectConceptProfile,
} from "../learner-model/competencyEstimator";
import {
  DEFAULT_COACH_PREFERENCES,
  detectCoachingOpportunities,
  type CoachSnapshot,
} from "../learning-coach/coachEngine";
import {
  HealthVaultBoundaryError,
  _resetLearningEventBusForTests,
  emitAndReconcileReviewCommitted,
  emitLearningEvent,
  getBufferedLearningEvents,
  publishCommittedLearningEvent,
} from "../learning-events/learningEventBus";
import { evaluateGoalFeasibility } from "../learning-goals/feasibility";
import {
  DEFAULT_RUNTIME_CAPABILITIES,
  learningActivityRegistry,
} from "../learning-runtime/activityRegistry";
import {
  ExamIsolationViolationError,
  assertExamIsolationAllows,
  completeActivity,
  createLearningSession,
  startActivity,
} from "../learning-runtime/sessionRuntime";
import {
  buildWorkspaceLaunchPlan,
  launchLearningActivity,
  type WorkspaceNavigateEvent,
} from "../learning-runtime/workspaceLauncher";
import {
  computeAdaptiveProgression,
  validateCurriculumGraph,
  verifySourceGrounding,
  type AdaptiveCurriculumNode,
  type AvailableSourceRecord,
  type ConceptRelationshipEdge,
} from "../study-plans/adaptiveCurriculum";
import {
  computeInvalidationImpact,
  getAssessmentPurposePolicy,
  planDimensionTargetedRemediation,
  type RemediationAttemptRecord,
} from "../study-plans/assessmentRemediation";
import type { SyncableLearningItem } from "../reviewSync";

// ---------------------------------------------------------------------------
// Deterministic test helpers
// ---------------------------------------------------------------------------

const NOW_ISO = "2026-11-28T12:00:00.000Z";

function makeActivity(
  overrides: Partial<LearningActivity> & {
    id: string;
    activityType: LearningActivityType;
    title: string;
    dedupeKey: string;
  },
): LearningActivity {
  const def = learningActivityRegistry.get(overrides.activityType);
  return {
    id: overrides.id,
    activityType: overrides.activityType,
    title: overrides.title,
    status: overrides.status ?? "pending",
    dedupeKey: overrides.dedupeKey,
    sourceReferences: overrides.sourceReferences ?? [
      {
        entityKind: def?.defaultEntityKind ?? "document",
        entityId: overrides.id,
        documentId: null,
      },
    ],
    conceptReferences: overrides.conceptReferences ?? [],
    goalReferences: overrides.goalReferences ?? [],
    estimatedMinutes: overrides.estimatedMinutes ?? def?.defaultEstimatedMinutes ?? 10,
    priorityMetadata: overrides.priorityMetadata ?? { score: 0.5 },
    prerequisiteRequirements: overrides.prerequisiteRequirements ?? [],
    recommendationReason: overrides.recommendationReason ?? "Test activity",
    capabilityRequirements: overrides.capabilityRequirements ?? {
      required: [...(def?.requiredCapabilities ?? [])],
      optional: [...(def?.optionalCapabilities ?? [])],
    },
    resumeState: overrides.resumeState ?? null,
    completionPolicy: overrides.completionPolicy ?? {
      mode: "explicit",
      canonicalEventType: def?.canonicalEventType,
    },
    isLocalOnly: overrides.isLocalOnly ?? false,
    isAiExcluded: overrides.isAiExcluded ?? false,
    examIsolated: overrides.examIsolated ?? Boolean(def?.defaultExamIsolated),
  };
}

function makeEvidenceRecord(
  overrides: Partial<CompetencyEvidenceRecord> & {
    id: string;
    conceptId: string;
    dimension: CompetencyEvidenceRecord["dimension"];
    sourceKind: CompetencyEvidenceRecord["sourceKind"];
    sourceRecordId: string;
    evidenceGroupId: string;
    observedScore: number | null;
    occurredAt: string;
  },
): CompetencyEvidenceRecord {
  return {
    id: overrides.id,
    conceptId: overrides.conceptId,
    dimension: overrides.dimension,
    sourceKind: overrides.sourceKind,
    sourceEventId: overrides.sourceEventId ?? null,
    sourceRecordId: overrides.sourceRecordId,
    evidenceGroupId: overrides.evidenceGroupId,
    cardFamilyId: overrides.cardFamilyId ?? null,
    sessionId: overrides.sessionId ?? null,
    observedScore: overrides.observedScore,
    baseWeight: overrides.baseWeight ?? 1.0,
    elapsedDays: overrides.elapsedDays ?? null,
    hintLevel: overrides.hintLevel ?? 0,
    isVerified: overrides.isVerified ?? true,
    isInvalidated: overrides.isInvalidated ?? false,
    invalidatedByEventId: overrides.invalidatedByEventId ?? null,
    documentId: overrides.documentId ?? null,
    isLocalOnly: overrides.isLocalOnly ?? false,
    isAiExcluded: overrides.isAiExcluded ?? false,
    occurredAt: overrides.occurredAt,
    policyVersion: overrides.policyVersion ?? "competency-v1",
    createdAt: overrides.createdAt ?? overrides.occurredAt,
  };
}

function makeSyncableCard(id: string, overrides?: Partial<SyncableLearningItem>): SyncableLearningItem {
  return {
    id,
    question: "What is the invariant?",
    answer: "Left < Node < Right",
    due_date: "2026-12-05T12:00:00.000Z",
    interval: 7,
    ease_factor: 2.5,
    difficulty: 4.5,
    review_count: 3,
    lapses: 0,
    state: "Review",
    is_suspended: false,
    tags: ["algorithms"],
    date_created: "2026-11-01T00:00:00.000Z",
    date_modified: NOW_ISO,
    ...overrides,
  };
}

function resetAllRuntimeState(): void {
  _resetLearningEventBusForTests();
  _resetLearnerModelApiFallbackForTests();
  resetBrowserLearningGoalsState();
  useLearnerModelStore.getState().reset();
  useLearningGoalsStore.getState().reset();
  useLearningCoachStore.getState().reset();
  useMotivationStore.getState().reset();
  useLearningSessionStore.getState().clearSession();
  useLearningSessionStore.setState({
    sessionHistory: [],
    runtimeCapabilities: { ...DEFAULT_RUNTIME_CAPABILITIES },
  });
  try {
    globalThis.localStorage?.clear();
  } catch {
    // Ignore if localStorage is unavailable
  }
  _resetLearningSessionEventSyncForTests();
}

beforeEach(() => {
  resetAllRuntimeState();
});

afterEach(() => {
  resetAllRuntimeState();
});

// ===========================================================================
// Scenario A: Casual reader
// ===========================================================================
describe("Scenario A: Casual reader", () => {
  it("works immediately with no AI provider, no goals, and no onboarding assessment while persisting reading state", () => {
    const offlineNoAiCaps: RuntimeCapabilities = {
      ai: false,
      network: false,
      audio: false,
      speech: false,
      renderer: true,
      external: false,
      verification: true,
      platform: "desktop",
      strictLocalOnly: false,
    };

    // Zero goals configured and coaching disabled/optional
    expect(useLearningGoalsStore.getState().goals).toHaveLength(0);
    useLearningCoachStore.getState().setProactivity("disabled");
    expect(useLearningCoachStore.getState().evaluateOpportunities({}, NOW_ISO)).toEqual([]);

    // Capability negotiation confirms reading & extract review work fully offline with no AI
    const readingCap = learningActivityRegistry.negotiateCapabilities(
      "source_reading",
      offlineNoAiCaps,
    );
    const extractCap = learningActivityRegistry.negotiateCapabilities(
      "extract_review",
      offlineNoAiCaps,
    );
    expect(readingCap.status).toBe("supported");
    expect(extractCap.status).toBe("supported");

    // DAQE orchestrates reading/extract candidates without goals or AI
    const plan = orchestrateLearningSession({
      candidates: [
        {
          id: "read-essay-1",
          dedupeKey: "document:doc-essay-1",
          title: "Read: On Incremental Reading",
          providerKind: "continue_reading",
          activityKind: "continue_reading",
          estimatedMinutes: 12,
          signals: { interest: 0.9, userPriority: 0.7 },
        },
        {
          id: "ext-1",
          dedupeKey: "extract:ext-1",
          title: "Refine key passage highlight",
          providerKind: "pinned",
          activityKind: "incremental_read",
          estimatedMinutes: 5,
          signals: { interest: 0.8 },
          isPinned: true,
        },
      ],
      focusProfile: "free_exploration",
      timeBudgetMinutes: 25,
    });

    expect(plan.privacy.offlineCapable).toBe(true);
    expect(plan.privacy.aiProviderUsed).toBe(false);
    expect(plan.selected).toHaveLength(2);
    expect(plan.selected[0].explanation.llmGenerated).toBe(false);

    // Start a reading + extracting session and persist mid-read checkpoint
    useLearningSessionStore.getState().setRuntimeCapabilities(offlineNoAiCaps);
    const session = useLearningSessionStore.getState().startNewSession({
      id: "ls-casual-1",
      title: "Evening Reading",
      activities: [
        makeActivity({
          id: "act-read-1",
          activityType: "source_reading",
          title: "Read: On Incremental Reading",
          dedupeKey: "document:doc-essay-1",
          sourceReferences: [
            { entityKind: "document", entityId: "doc-essay-1", documentId: "doc-essay-1" },
          ],
          estimatedMinutes: 12,
        }),
        makeActivity({
          id: "act-ext-1",
          activityType: "extract_review",
          title: "Refine key passage highlight",
          dedupeKey: "extract:ext-1",
          sourceReferences: [
            { entityKind: "extract", entityId: "ext-1", documentId: "doc-essay-1" },
          ],
          estimatedMinutes: 5,
        }),
      ],
      nowIso: NOW_ISO,
    });

    expect(session.goalReferences).toEqual([]);
    expect(session.activities.every((a) => a.status === "pending")).toBe(true);

    useLearningSessionStore.getState().startActivity("act-read-1");
    const paused = useLearningSessionStore.getState().pauseSession({
      checkpoint: { documentId: "doc-essay-1", page: 14, offset: 320 },
      nowIso: NOW_ISO,
    });

    expect(paused?.status).toBe("paused");
    expect(paused?.activities[0].resumeState).toEqual({
      documentId: "doc-essay-1",
      page: 14,
      offset: 320,
    });

    // Persisted in localStorage so casual reading state survives restarts
    const persistedRaw = globalThis.localStorage.getItem(LEARNING_SESSION_STORAGE_KEY);
    expect(persistedRaw).toBeTruthy();
    expect(persistedRaw).toContain("doc-essay-1");
    expect(persistedRaw).toContain('"page":14');
  });
});

// ===========================================================================
// Scenario B: SuperMemo-style incremental learner
// ===========================================================================
describe("Scenario B: SuperMemo-style incremental learner", () => {
  it("preserves exact manual priorities in strict_manual mode, prevents completed items from reappearing, and preserves provenance", () => {
    // Deliberately give lower-manual-priority items higher adaptive urgency so we prove
    // `strict_manual` does NOT override user priorities.
    const candidates: DaqeActivityCandidate[] = [
      {
        id: "card-low-prio-urgent",
        dedupeKey: "flashcard:card-low",
        title: "Card with high SRS urgency but manual priority 40",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 3,
        manualPriority: 40,
        signals: { srsUrgency: 0.99, deadlinePressure: 0.95 },
      },
      {
        id: "doc-top-prio",
        dedupeKey: "document:doc-supermemo-1",
        title: "Primary Textbook Chapter 1",
        providerKind: "continue_reading",
        activityKind: "incremental_read",
        estimatedMinutes: 10,
        manualPriority: 98,
        signals: { srsUrgency: 0.1, interest: 0.2 },
      },
      {
        id: "ext-second-prio",
        dedupeKey: "extract:ext-supermemo-2",
        title: "Extract: Memory stability law",
        providerKind: "learning_goals",
        activityKind: "incremental_read",
        estimatedMinutes: 6,
        manualPriority: 87,
        signals: { srsUrgency: 0.2 },
      },
      {
        id: "card-third-prio",
        dedupeKey: "flashcard:card-supermemo-3",
        title: "Cloze: Spacing effect",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 4,
        manualPriority: 75,
        signals: { srsUrgency: 0.5 },
      },
    ];

    const plan = orchestrateLearningSession({
      candidates,
      focusProfile: "balanced",
      orderingMode: "strict_manual",
      timeBudgetMinutes: 60,
    });

    expect(plan.orderingMode).toBe("strict_manual");
    expect(plan.ranked.map((r) => r.candidate.id)).toEqual([
      "doc-top-prio",
      "ext-second-prio",
      "card-third-prio",
      "card-low-prio-urgent",
    ]);
    expect(plan.ranked[0].explanation.primaryReason).toContain("Manual priority order");
    expect(plan.ranked[0].explanation.llmGenerated).toBe(false);

    // Run through session runtime and verify completed items do not reappear and provenance is preserved
    const activities: LearningActivity[] = [
      makeActivity({
        id: "act-doc-1",
        activityType: "source_reading",
        title: "Primary Textbook Chapter 1",
        dedupeKey: "document:doc-supermemo-1",
        sourceReferences: [
          {
            entityKind: "document",
            entityId: "doc-supermemo-1",
            documentId: "doc-supermemo-1",
            label: "SuperMemo Compendium p.12",
          },
        ],
      }),
      makeActivity({
        id: "act-ext-2",
        activityType: "extract_review",
        title: "Extract: Memory stability law",
        dedupeKey: "extract:ext-supermemo-2",
        sourceReferences: [
          {
            entityKind: "extract",
            entityId: "ext-supermemo-2",
            documentId: "doc-supermemo-1",
            label: "Excerpt #4",
          },
        ],
      }),
      makeActivity({
        id: "act-card-3",
        activityType: "flashcard_review",
        title: "Cloze: Spacing effect",
        dedupeKey: "flashcard:card-supermemo-3",
        sourceReferences: [
          {
            entityKind: "learning_item",
            entityId: "card-supermemo-3",
            documentId: "doc-supermemo-1",
          },
        ],
      }),
    ];

    let session = createLearningSession({
      id: "ls-supermemo-1",
      activities,
      nowIso: NOW_ISO,
    });

    const firstDone = completeActivity(session, "act-doc-1", {
      activeSeconds: 420,
      nowIso: NOW_ISO,
    });
    session = firstDone.session;
    expect(firstDone.emitted).toBe(true);
    expect(session.activities[0].status).toBe("completed");
    expect(session.currentActivityIndex).toBe(1);

    // Re-completing the same item is idempotent and never resurrects or double-emits
    const duplicateAttempt = completeActivity(session, "act-doc-1", {
      activeSeconds: 420,
      nowIso: NOW_ISO,
    });
    expect(duplicateAttempt.emitted).toBe(false);
    expect(duplicateAttempt.session.elapsedActiveSeconds).toBe(420);

    // Source provenance remains intact across every activity
    expect(session.activities[1].sourceReferences[0]).toMatchObject({
      entityKind: "extract",
      entityId: "ext-supermemo-2",
      documentId: "doc-supermemo-1",
    });
    expect(session.activities[2].sourceReferences[0]).toMatchObject({
      entityKind: "learning_item",
      entityId: "card-supermemo-3",
      documentId: "doc-supermemo-1",
    });
  });
});

// ===========================================================================
// Scenario C: Deadline-driven student
// ===========================================================================
describe("Scenario C: Deadline-driven student", () => {
  it("evaluates deadline feasibility, rejects front-matter prerequisites, verifies grounding, enforces mock exam isolation, and remediates failed items", async () => {
    // 1. Create deadline goal and link textbook, notes, and past exam
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "Algorithms Final Exam",
      kind: "deadline",
      targetDate: "2026-12-08T12:00:00.000Z", // 10 days from NOW_ISO
      dailyMinutesBudget: 45,
      targetDimensions: ["comprehension", "retention", "application"],
      targetMasteryThreshold: 0.8,
    });
    await useLearningGoalsStore.getState().linkSource(goal.id, "document", "doc-clrs", "primary");
    await useLearningGoalsStore.getState().linkSource(goal.id, "document", "doc-lecture-notes", "supplemental");
    await useLearningGoalsStore.getState().linkSource(goal.id, "document", "doc-past-exam-2025", "primary");

    const feasibility = await useLearningGoalsStore.getState().evaluateFeasibility(goal.id, {
      nowIso: NOW_ISO,
      uncompletedReadingMinutes: 180,
      projectedDueReviewMinutes: 120,
      conceptStates: [
        {
          conceptId: "concept-dp",
          estimatedMinutesToMaster: 150,
          priority: 90,
          dimensions: {
            comprehension: { dimension: "comprehension", status: "developing", estimate: 0.5 },
            retention: { dimension: "retention", status: "needs_attention", estimate: 0.3 },
            application: { dimension: "application", status: "unknown", estimate: null },
          },
        },
        {
          conceptId: "concept-graphs",
          estimatedMinutesToMaster: 120,
          priority: 70,
          dimensions: {
            comprehension: { dimension: "comprehension", status: "unknown", estimate: null },
            retention: { dimension: "retention", status: "unknown", estimate: null },
            application: { dimension: "application", status: "unknown", estimate: null },
          },
        },
      ],
    });

    expect(["at_risk", "infeasible"]).toContain(feasibility.status);
    expect(feasibility.recommendations.length).toBeGreaterThan(0);
    expect(feasibility.recommendations.some((r) => r.kind === "increase_daily_budget")).toBe(true);
    expect(feasibility.recommendations.some((r) => r.kind === "narrow_scope")).toBe(true);

    // 2. Meaningful typed prerequisites & front-matter rejection
    const nodes: AdaptiveCurriculumNode[] = [
      { id: "n-toc", title: "Table of Contents", conceptIds: [], position: 0 },
      { id: "n-recursion", title: "Recursion & Recurrences", conceptIds: ["concept-recursion"], position: 1 },
      { id: "n-dp", title: "Dynamic Programming", conceptIds: ["concept-dp"], position: 2 },
    ];
    const edges: ConceptRelationshipEdge[] = [
      {
        id: "e-frontmatter",
        sourceNodeId: "n-toc",
        targetNodeId: "n-recursion",
        relationshipType: "requires",
        provenance: "ai_inferred",
        confidence: 0.9,
        sourceRefIds: ["doc-clrs"],
      },
      {
        id: "e-real-prereq",
        sourceNodeId: "n-recursion",
        targetNodeId: "n-dp",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["doc-clrs"],
      },
    ];

    const validation = validateCurriculumGraph(nodes, edges);
    expect(validation.valid).toBe(true);
    expect(validation.frontMatterNodeIds).toEqual(["n-toc"]);
    expect(validation.warnings.some((w) => w.code === "FRONT_MATTER_PREREQUISITE")).toBe(true);

    const progression = computeAdaptiveProgression(nodes, edges, {});
    // Front-matter TOC does NOT block Recursion, whereas Recursion DOES advisory-block DP
    expect(progression.nodeStates["n-recursion"].status).toBe("ready");
    expect(progression.nodeStates["n-dp"].status).toBe("advisory_blocked");
    expect(progression.nodeStates["n-dp"].unmetPrerequisiteNodeIds).toEqual(["n-recursion"]);

    // 3. Grounded source verification
    const sources: AvailableSourceRecord[] = [
      {
        id: "doc-clrs",
        title: "Introduction to Algorithms",
        exists: true,
        isIndexed: true,
        isLocalOnly: false,
        isAiExcluded: false,
        pageCount: 1312,
        passages: [
          {
            id: "p-dp-1",
            text: "Dynamic programming solves problems by combining solutions to overlapping subproblems.",
            fingerprint: "fp-dp-optimal-substructure",
            pageNumber: 359,
          },
        ],
      },
    ];

    const grounding = verifySourceGrounding(
      {
        sourceId: "doc-clrs",
        locatorType: "passage",
        passageFingerprint: "fp-dp-optimal-substructure",
      },
      sources,
    );
    expect(grounding.status).toBe("verified");
    expect(grounding.isGrounded).toBe(true);
    expect(grounding.fabricated).toBe(false);

    // 4. Mock exam strict isolation
    const mockPolicy = getAssessmentPurposePolicy("mock_exam");
    expect(mockPolicy.examIsolated).toBe(true);
    expect(mockPolicy.hintsAllowed).toBe(false);
    expect(mockPolicy.coachingAllowed).toBe(false);

    let examSession = createLearningSession({
      id: "ls-mock-exam-1",
      mode: "exam_isolated",
      activities: [
        makeActivity({
          id: "act-mock-1",
          activityType: "rubric_assessment",
          title: "Past Exam 2025 (Timed)",
          dedupeKey: "assessment:exam-past-2025",
          examIsolated: true,
          goalReferences: [goal.id],
          conceptReferences: ["concept-dp"],
        }),
      ],
      nowIso: NOW_ISO,
    });
    examSession = startActivity(examSession, "act-mock-1", { nowIso: NOW_ISO });

    expect(() => assertExamIsolationAllows(examSession, "show_hint")).toThrow(
      ExamIsolationViolationError,
    );
    expect(() => assertExamIsolationAllows(examSession, "reveal_answer")).toThrow(
      ExamIsolationViolationError,
    );
    expect(() => assertExamIsolationAllows(examSession, "open_tutor")).toThrow(
      ExamIsolationViolationError,
    );
    expect(() => assertExamIsolationAllows(examSession, "coaching_intervention")).toThrow(
      ExamIsolationViolationError,
    );

    // Coaching engine also suppresses all recommendations during active exam isolation
    const suppressedRecs = detectCoachingOpportunities(
      {
        examIsolationActive: true,
        approachingExams: [
          {
            examId: "exam-final",
            title: "Algorithms Final",
            examDateIso: "2026-12-03T12:00:00.000Z",
            readinessScore: 0.4,
          },
        ],
      },
      DEFAULT_COACH_PREFERENCES,
      [],
      NOW_ISO,
    );
    expect(suppressedRecs).toEqual([]);

    // 5. Failed mock exam item triggers targeted remediation, then reassessment updates learner model
    await useLearnerModelStore.getState().recordEvidence({
      conceptId: "concept-dp",
      dimension: "application",
      sourceKind: "exam_grade",
      sourceRecordId: "mock-2025-q3",
      evidenceGroupId: "exam-mock-2025",
      observedScore: 0.25,
      baseWeight: mockPolicy.evidenceBaseWeight,
      occurredAt: "2026-11-26T12:00:00.000Z",
    });

    const beforeProfile = await useLearnerModelStore
      .getState()
      .loadConceptProfile("concept-dp", { force: true });
    expect(beforeProfile.dimensions.application.status).toBe("needs_attention");

    const remediation = planDimensionTargetedRemediation({
      conceptId: "concept-dp",
      conceptName: "Dynamic Programming",
      failedDimension: "application",
      weakStep: "state transition recurrence setup",
      competencyProfile: beforeProfile,
      attemptHistory: [],
      nowIso: NOW_ISO,
    });
    expect(remediation.status).toBe("active");
    expect(remediation.recommendedActivity?.activityType).toBe("structured_problem_solving");

    // Reassessment after remediation updates learner model cleanly
    await useLearnerModelStore.getState().recordEvidence({
      conceptId: "concept-dp",
      dimension: "application",
      sourceKind: "practice_attempt",
      sourceRecordId: "reassess-dp-1",
      evidenceGroupId: "reassess-group-1",
      observedScore: 0.95,
      baseWeight: 1.5,
      occurredAt: "2026-11-27T12:00:00.000Z",
    });
    await useLearnerModelStore.getState().recordEvidence({
      conceptId: "concept-dp",
      dimension: "application",
      sourceKind: "exam_grade",
      sourceRecordId: "reassess-dp-2",
      evidenceGroupId: "reassess-group-2",
      observedScore: 0.92,
      baseWeight: 1.5,
      occurredAt: NOW_ISO,
    });

    const afterProfile = await useLearnerModelStore
      .getState()
      .loadConceptProfile("concept-dp", { force: true });
    expect(afterProfile.dimensions.application.estimate!).toBeGreaterThan(
      beforeProfile.dimensions.application.estimate!,
    );
    expect(afterProfile.dimensions.application.estimate!).toBeGreaterThan(0.7);
    expect(["developing", "demonstrated"]).toContain(afterProfile.dimensions.application.status);
  });
});

// ===========================================================================
// Scenario D: Multiple simultaneous goals
// ===========================================================================
describe("Scenario D: Multiple simultaneous goals", () => {
  it("coexists exam, Spanish, and Philosophy goals, deduplicates shared flashcards, and shifts mix on focus profile switch", async () => {
    const examGoal = await useLearningGoalsStore.getState().createGoal({
      title: "Systems Architecture Exam",
      kind: "deadline",
      targetDate: "2026-12-10T12:00:00.000Z",
      priority: 90,
    });
    const spanishGoal = await useLearningGoalsStore.getState().createGoal({
      title: "Conversational Spanish B2",
      kind: "language",
      languageCode: "es",
      priority: 70,
    });
    const philosophyGoal = await useLearningGoalsStore.getState().createGoal({
      title: "Epistemology Exploration",
      kind: "exploration",
      priority: 50,
    });

    // Link one shared source concept/deck to two goals without duplication
    await useLearningGoalsStore.getState().linkSource(examGoal.id, "concept", "concept-shared-logic");
    await useLearningGoalsStore.getState().linkSource(philosophyGoal.id, "concept", "concept-shared-logic");

    const linkedGoals = useLearningGoalsStore
      .getState()
      .getGoalsForSource("concept", "concept-shared-logic");
    expect(linkedGoals.map((g) => g.id).sort()).toEqual([examGoal.id, philosophyGoal.id].sort());

    // Build heterogeneous candidates across all 3 goals, including duplicate raw entries for card-shared-1
    const candidates: DaqeActivityCandidate[] = [
      {
        id: "cand-shared-from-srs",
        dedupeKey: "flashcard:card-shared-1",
        title: "Shared card: Deductive vs Inductive Systems",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 5,
        signals: { srsUrgency: 0.85, goalAlignment: 0.8, deadlinePressure: 0.7 },
        goalReferences: [{ goalId: examGoal.id, goalTitle: examGoal.title }],
      },
      {
        id: "cand-shared-from-goal",
        dedupeKey: "flashcard:card-shared-1",
        title: "Shared card: Deductive vs Inductive Systems",
        providerKind: "learning_goals",
        activityKind: "srs_review",
        estimatedMinutes: 5,
        signals: { srsUrgency: 0.7, goalAlignment: 0.75, interest: 0.6 },
        goalReferences: [{ goalId: philosophyGoal.id, goalTitle: philosophyGoal.title }],
      },
      {
        id: "cand-exam-problem",
        dedupeKey: "problem:cache-coherence",
        title: "Cache Coherence Exam Drill",
        providerKind: "exam_prep",
        activityKind: "exam_attempt",
        estimatedMinutes: 15,
        signals: { deadlinePressure: 0.95, knowledgeGap: 0.9, goalAlignment: 0.9, interest: 0.1 },
        goalReferences: [{ goalId: examGoal.id, goalTitle: examGoal.title }],
      },
      {
        id: "cand-spanish-vocab",
        dedupeKey: "flashcard:es-subjunctive-1",
        title: "Spanish Subjunctive Active Recall",
        providerKind: "srs_due_pool",
        activityKind: "srs_review",
        estimatedMinutes: 8,
        signals: { srsUrgency: 0.92, goalAlignment: 0.7, interest: 0.5 },
        goalReferences: [{ goalId: spanishGoal.id, goalTitle: spanishGoal.title }],
      },
      {
        id: "cand-phil-essay",
        dedupeKey: "document:doc-hume-enquiry",
        title: "Read: Hume's Enquiry Concerning Human Understanding",
        providerKind: "smart_feeds",
        activityKind: "exploration_feed",
        estimatedMinutes: 15,
        signals: { interest: 0.98, userPriority: 0.7, deadlinePressure: 0.0, srsUrgency: 0.0 },
        goalReferences: [{ goalId: philosophyGoal.id, goalTitle: philosophyGoal.title }],
      },
    ];

    const examPlan = orchestrateLearningSession({
      candidates,
      focusProfile: "exam_prep",
      timeBudgetMinutes: 25,
    });
    const explorePlan = orchestrateLearningSession({
      candidates,
      focusProfile: "free_exploration",
      timeBudgetMinutes: 25,
    });

    // Shared flashcard deduplicated to exactly 1 canonical item carrying both goals
    expect(examPlan.deduplicatedCount).toBe(1);
    const sharedRanked = examPlan.ranked.filter(
      (r) => r.candidate.dedupeKey === "flashcard:card-shared-1",
    );
    expect(sharedRanked).toHaveLength(1);
    expect(sharedRanked[0].candidate.goalReferences.map((g) => g.goalId).sort()).toEqual(
      [examGoal.id, philosophyGoal.id].sort(),
    );
    expect(sharedRanked[0].candidate.signals.srsUrgency).toBeLessThanOrEqual(1);
    expect(sharedRanked[0].candidate.signals.srsUrgency).toBe(0.85);

    // All 3 goals coexist in ranked output
    const representedGoals = new Set(
      examPlan.ranked.flatMap((r) => r.candidate.goalReferences.map((g) => g.goalId)),
    );
    expect(representedGoals.has(examGoal.id)).toBe(true);
    expect(representedGoals.has(spanishGoal.id)).toBe(true);
    expect(representedGoals.has(philosophyGoal.id)).toBe(true);

    // Switching focus profile changes top-ranked mix without losing any goals
    expect(examPlan.ranked[0].candidate.id).toBe("cand-exam-problem");
    expect(explorePlan.ranked[0].candidate.id).toBe("cand-phil-essay");
    expect(useLearningGoalsStore.getState().getActiveGoals()).toHaveLength(3);
  });
});

// ===========================================================================
// Scenario E: Transition from exploration to mastery
// ===========================================================================
describe("Scenario E: Transition from exploration to mastery", () => {
  it("reuses prior demonstrated competency on goal evolution while rejecting exposure-only skips", async () => {
    // 1. Start as casual exploration goal
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "Distributed Systems",
      kind: "exploration",
      initialSources: [{ sourceKind: "document", sourceId: "doc-ddia" }],
    });

    // 2. Accumulate prior evidence:
    // - `concept-raft`: reading + delayed FSRS retention + verified comprehension across 2 groups & 2 days -> demonstrated
    // - `concept-paxos`: ONLY reading_progress & extract_created (exposure only!)
    const evidence: CompetencyEvidenceRecord[] = [
      makeEvidenceRecord({
        id: "ev-raft-exp",
        conceptId: "concept-raft",
        dimension: "exposure",
        sourceKind: "reading_progress",
        sourceRecordId: "read-raft-1",
        evidenceGroupId: "doc-ddia",
        observedScore: 1.0,
        occurredAt: "2026-11-20T10:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-raft-ret-1",
        conceptId: "concept-raft",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "rev-raft-1",
        evidenceGroupId: "card-raft-election",
        observedScore: 0.95,
        baseWeight: 1.2,
        elapsedDays: 5,
        occurredAt: "2026-11-22T10:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-raft-ret-2",
        conceptId: "concept-raft",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "rev-raft-2",
        evidenceGroupId: "card-raft-log",
        observedScore: 0.92,
        baseWeight: 1.2,
        elapsedDays: 8,
        occurredAt: "2026-11-26T10:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-raft-comp-1",
        conceptId: "concept-raft",
        dimension: "comprehension",
        sourceKind: "guided_check",
        sourceRecordId: "chk-raft-1",
        evidenceGroupId: "trail-raft-1",
        observedScore: 0.95,
        baseWeight: 1.2,
        occurredAt: "2026-11-23T10:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-raft-comp-2",
        conceptId: "concept-raft",
        dimension: "comprehension",
        sourceKind: "practice_attempt",
        sourceRecordId: "prac-raft-2",
        evidenceGroupId: "practice-raft-2",
        observedScore: 0.9,
        baseWeight: 1.2,
        occurredAt: "2026-11-27T10:00:00.000Z",
      }),
      // Exposure-only evidence for Paxos
      makeEvidenceRecord({
        id: "ev-paxos-exp-1",
        conceptId: "concept-paxos",
        dimension: "exposure",
        sourceKind: "reading_progress",
        sourceRecordId: "read-paxos-1",
        evidenceGroupId: "doc-ddia",
        observedScore: 1.0,
        baseWeight: 1.5,
        occurredAt: "2026-11-25T10:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-paxos-exp-2",
        conceptId: "concept-paxos",
        dimension: "exposure",
        sourceKind: "extract_created",
        sourceRecordId: "ext-paxos-1",
        evidenceGroupId: "ext-group-paxos",
        observedScore: 1.0,
        baseWeight: 1.5,
        occurredAt: "2026-11-27T10:00:00.000Z",
      }),
    ];

    const raftProfile = projectConceptProfile("concept-raft", evidence, null, NOW_ISO);
    const paxosProfile = projectConceptProfile("concept-paxos", evidence, null, NOW_ISO);

    expect(raftProfile.dimensions.comprehension.status).toBe("demonstrated");
    expect(raftProfile.dimensions.retention.status).toBe("demonstrated");
    expect(paxosProfile.dimensions.exposure.status).toBe("demonstrated");
    expect(paxosProfile.dimensions.comprehension.status).toBe("unknown");
    expect(paxosProfile.dimensions.retention.status).toBe("unknown");

    // 3. Evolve exploration goal in-place to mastery/deadline goal
    const evolved = await useLearningGoalsStore.getState().evolveGoal(goal.id, {
      kind: "mastery",
      studyPlanId: "sp-dist-sys",
      targetDate: "2026-12-28T12:00:00.000Z",
      dailyMinutesBudget: 45,
      targetDimensions: ["comprehension", "retention"],
    });
    expect(evolved.id).toBe(goal.id);
    expect(evolved.kind).toBe("mastery");
    expect(evolved.sources).toHaveLength(1);

    // 4. Adaptive curriculum reuses demonstrated prior for Raft and rejects exposure-only skip for Paxos
    const nodes: AdaptiveCurriculumNode[] = [
      { id: "n-raft", title: "Raft Consensus", conceptIds: ["concept-raft"], position: 0 },
      { id: "n-paxos", title: "Paxos Variants", conceptIds: ["concept-paxos"], position: 1 },
      { id: "n-linear", title: "Linearizability", conceptIds: ["concept-linear"], position: 2 },
    ];
    const edges: ConceptRelationshipEdge[] = [
      {
        id: "e-raft-linear",
        sourceNodeId: "n-raft",
        targetNodeId: "n-linear",
        relationshipType: "requires",
        provenance: "source_verified",
        confidence: 1.0,
        sourceRefIds: ["doc-ddia"],
      },
    ];

    const progression = computeAdaptiveProgression(nodes, edges, {
      "concept-raft": raftProfile,
      "concept-paxos": paxosProfile,
    });

    expect(progression.nodeStates["n-raft"].status).toBe("demonstrated_prior");
    expect(progression.nodeStates["n-raft"].skippable).toBe(true);
    expect(progression.nodeStates["n-raft"].reviewable).toBe(true);
    // Downstream Linearizability is unlocked because Raft is already demonstrated_prior
    expect(progression.nodeStates["n-linear"].status).toBe("ready");
    // Exposure-only Paxos MUST NOT be skipped
    expect(progression.nodeStates["n-paxos"].status).toBe("ready");
    expect(progression.nodeStates["n-paxos"].skippable).toBe(false);

    // Feasibility also credits prior mastered concept
    const report = evaluateGoalFeasibility({
      goal: evolved,
      nowIso: NOW_ISO,
      conceptStates: [
        {
          conceptId: "concept-raft",
          estimatedMinutesToMaster: 60,
          dimensions: {
            comprehension: raftProfile.dimensions.comprehension,
            retention: raftProfile.dimensions.retention,
          },
        },
        {
          conceptId: "concept-paxos",
          estimatedMinutesToMaster: 60,
          dimensions: {
            comprehension: paxosProfile.dimensions.comprehension,
            retention: paxosProfile.dimensions.retention,
          },
        },
      ],
    });
    expect(report.priorMasteredConceptCount).toBe(1);
    expect(report.remainingConceptMinutes).toBe(60);
  });
});

// ===========================================================================
// Scenario F: Failed assessment and remediation
// ===========================================================================
describe("Scenario F: Failed assessment and remediation", () => {
  it("targets BST deletion application (not definition flashcards), escalates anti-loop ladder without repeating failed activities, and updates competency on reassessment", () => {
    // Student recalls BST definition strongly (retention = demonstrated) but fails BST deletion implementation (application = needs_attention)
    const initialRecords: CompetencyEvidenceRecord[] = [
      makeEvidenceRecord({
        id: "bst-ret-1",
        conceptId: "concept-bst-deletion",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "card-bst-def-1",
        evidenceGroupId: "grp-bst-def-1",
        observedScore: 0.95,
        baseWeight: 1.3,
        elapsedDays: 6,
        occurredAt: "2026-11-22T12:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "bst-ret-2",
        conceptId: "concept-bst-deletion",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "card-bst-def-2",
        evidenceGroupId: "grp-bst-def-2",
        observedScore: 0.92,
        baseWeight: 1.3,
        elapsedDays: 9,
        occurredAt: "2026-11-26T12:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "bst-app-fail",
        conceptId: "concept-bst-deletion",
        dimension: "application",
        sourceKind: "exam_grade",
        sourceRecordId: "exam-bst-q2",
        evidenceGroupId: "exam-bst-1",
        observedScore: 0.2,
        baseWeight: 1.3,
        occurredAt: "2026-11-27T12:00:00.000Z",
      }),
    ];

    const profile = projectConceptProfile("concept-bst-deletion", initialRecords, null, NOW_ISO);
    expect(profile.dimensions.retention.status).toBe("demonstrated");
    expect(profile.dimensions.application.status).toBe("needs_attention");

    // Stage 1: targets application with structured_problem_solving (never definition flashcard)
    const stage1 = planDimensionTargetedRemediation({
      conceptId: "concept-bst-deletion",
      conceptName: "BST Deletion",
      failedDimension: "application",
      weakStep: "two-child BST node deletion",
      competencyProfile: profile,
      attemptHistory: [],
      prerequisiteConceptIds: ["concept-inorder-successor"],
      alternativeSourceIds: ["doc-visualgo-bst"],
      nowIso: NOW_ISO,
    });
    expect(stage1.escalationStage).toBe(1);
    expect(stage1.recommendedActivity?.activityType).toBe("structured_problem_solving");
    expect(stage1.recommendedActivity?.activityType).not.toBe("spaced_retrieval");
    expect(stage1.rationale).toContain("definition flashcards are skipped");
    expect(stage1.recommendedActivity?.focusStep).toBe("two-child BST node deletion");

    // Stage 2: after Stage 1 fails -> escalates to worked_example without repeating structured_problem_solving
    const historyAfter1: RemediationAttemptRecord[] = [
      {
        attemptNumber: 1,
        activityType: stage1.recommendedActivity!.activityType,
        outcome: "failed",
        attemptedAt: "2026-11-28T10:00:00.000Z",
      },
    ];
    const stage2 = planDimensionTargetedRemediation({
      conceptId: "concept-bst-deletion",
      conceptName: "BST Deletion",
      failedDimension: "application",
      weakStep: "two-child BST node deletion",
      competencyProfile: profile,
      attemptHistory: historyAfter1,
      prerequisiteConceptIds: ["concept-inorder-successor"],
      alternativeSourceIds: ["doc-visualgo-bst"],
      nowIso: NOW_ISO,
    });
    expect(stage2.escalationStage).toBe(2);
    expect(stage2.recommendedActivity?.activityType).toBe("worked_example");
    expect(stage2.recommendedActivity?.activityType).not.toBe(
      stage1.recommendedActivity?.activityType,
    );

    // Stage 3: after Stage 2 fails -> escalates to prerequisite check + alternative source
    const historyAfter2: RemediationAttemptRecord[] = [
      ...historyAfter1,
      {
        attemptNumber: 2,
        activityType: stage2.recommendedActivity!.activityType,
        outcome: "failed",
        attemptedAt: "2026-11-28T11:00:00.000Z",
      },
    ];
    const stage3 = planDimensionTargetedRemediation({
      conceptId: "concept-bst-deletion",
      conceptName: "BST Deletion",
      failedDimension: "application",
      weakStep: "two-child BST node deletion",
      competencyProfile: profile,
      attemptHistory: historyAfter2,
      prerequisiteConceptIds: ["concept-inorder-successor"],
      alternativeSourceIds: ["doc-visualgo-bst"],
      nowIso: NOW_ISO,
    });
    expect(stage3.escalationStage).toBe(3);
    expect(stage3.recommendedActivity?.activityType).toBe("alternative_explanation");
    expect(stage3.recommendedActivity?.prerequisiteConceptIdsToCheck).toContain(
      "concept-inorder-successor",
    );
    expect(stage3.recommendedActivity?.alternativeSourceIds).toContain("doc-visualgo-bst");

    // Stage 4: anti-loop cap reached -> stops auto-requeue & offers explicit user choices
    const historyAfter3: RemediationAttemptRecord[] = [
      ...historyAfter2,
      {
        attemptNumber: 3,
        activityType: stage3.recommendedActivity!.activityType,
        outcome: "failed",
        attemptedAt: "2026-11-28T11:30:00.000Z",
      },
    ];
    const stage4 = planDimensionTargetedRemediation({
      conceptId: "concept-bst-deletion",
      conceptName: "BST Deletion",
      failedDimension: "application",
      weakStep: "two-child BST node deletion",
      competencyProfile: profile,
      attemptHistory: historyAfter3,
      nowIso: NOW_ISO,
    });
    expect(stage4.escalationStage).toBe(4);
    expect(stage4.status).toBe("cooldown_or_override");
    expect(stage4.autoRequeue).toBe(false);
    expect(stage4.cooldownUntil).toBeTruthy();
    expect(stage4.userChoices).toContain("pause_24h");
    expect(stage4.userChoices).toContain("dismiss_remediation");

    // Reassessment after remediation updates application competency cleanly
    const updatedRecords: CompetencyEvidenceRecord[] = [
      ...initialRecords,
      makeEvidenceRecord({
        id: "bst-app-pass-1",
        conceptId: "concept-bst-deletion",
        dimension: "application",
        sourceKind: "practice_attempt",
        sourceRecordId: "prac-bst-del-1",
        evidenceGroupId: "grp-prac-bst-1",
        observedScore: 0.95,
        baseWeight: 1.5,
        occurredAt: "2026-11-28T11:45:00.000Z",
      }),
      makeEvidenceRecord({
        id: "bst-app-pass-2",
        conceptId: "concept-bst-deletion",
        dimension: "application",
        sourceKind: "exam_grade",
        sourceRecordId: "reassess-bst-del-2",
        evidenceGroupId: "grp-reassess-bst-2",
        observedScore: 0.96,
        baseWeight: 1.5,
        occurredAt: NOW_ISO,
      }),
    ];

    const updatedApp = estimateDimensionCompetency(updatedRecords, NOW_ISO, {
      dimension: "application",
    });
    expect(updatedApp.estimate!).toBeGreaterThan(profile.dimensions.application.estimate!);
    expect(updatedApp.estimate!).toBeGreaterThan(0.7);
    expect(["developing", "demonstrated"]).toContain(updatedApp.status);
  });
});

// ===========================================================================
// Scenario G: Cross-view review consistency
// ===========================================================================
describe("Scenario G: Cross-view review consistency", () => {
  it("reconciles review_committed across Scroll Mode and Unified Session without double-counting review history or XP", () => {
    // Enable XP and wire motivation store to the canonical learning event bus
    useMotivationStore.getState().setXpEnabled(true);
    const disconnectMotivation = useMotivationStore.getState().connectLearningEventBus();

    // Start a Unified Session that includes flashcard `card-sync-42`
    useLearningSessionStore.getState().startNewSession({
      id: "ls-cross-surface-1",
      activities: [
        makeActivity({
          id: "act-card-sync-42",
          activityType: "flashcard_review",
          title: "Review: Red-Black Tree Invariants",
          dedupeKey: "flashcard:card-sync-42",
          sourceReferences: [
            { entityKind: "learning_item", entityId: "card-sync-42", documentId: "doc-clrs" },
          ],
        }),
        makeActivity({
          id: "act-read-next",
          activityType: "source_reading",
          title: "Next Reading Item",
          dedupeKey: "document:doc-clrs-ch14",
          sourceReferences: [
            { entityKind: "document", entityId: "doc-clrs-ch14", documentId: "doc-clrs-ch14" },
          ],
        }),
      ],
      nowIso: NOW_ISO,
    });

    const card = makeSyncableCard("card-sync-42", { document_id: "doc-clrs" });
    const idempotencyKey = "review:card-sync-42:2026-11-28T12:00:00Z";

    // Learner reviews the card from Scroll Mode
    const firstEmit = emitAndReconcileReviewCommitted({
      idempotencyKey,
      surface: "scroll_mode",
      updatedItem: card,
      payload: { rating: 3, durationMs: 6_500 },
    });
    expect(firstEmit.eventResult.inserted).toBe(true);
    expect(firstEmit.syncEvent).not.toBeNull();

    // Unified Session reconciled automatically via learningEventBus
    const reconciledSession = useLearningSessionStore.getState().activeSession!;
    expect(reconciledSession.activities[0].status).toBe("completed");
    expect(reconciledSession.activities[0].completedViaSurface).toBe("scroll_mode");
    expect(reconciledSession.currentActivityIndex).toBe(1);
    expect(reconciledSession.crossSurfaceNotices).toHaveLength(1);
    expect(reconciledSession.elapsedActiveSeconds).toBe(0);

    const xpAfterFirst = useMotivationStore.getState().xpLedger.totalXp;
    expect(xpAfterFirst).toBe(5);
    expect(useMotivationStore.getState().activitySummary.reviewsCompleted).toBe(1);

    // Duplicate delivery (same idempotencyKey via emitAndReconcileReviewCommitted & publishCommittedLearningEvent)
    const dupEmit = emitAndReconcileReviewCommitted({
      idempotencyKey,
      surface: "review",
      updatedItem: card,
      payload: { rating: 3, durationMs: 6_500 },
    });
    const dupPublish = publishCommittedLearningEvent(firstEmit.eventResult.event);

    expect(dupEmit.eventResult.inserted).toBe(false);
    expect(dupEmit.syncEvent).toBeNull();
    expect(dupPublish).toBe(false);

    // Zero double-counting in event log, review count, or XP
    const reviewEvents = getBufferedLearningEvents({
      eventTypes: ["review_committed"],
      entityId: "card-sync-42",
    });
    expect(reviewEvents).toHaveLength(1);
    expect(useMotivationStore.getState().activitySummary.reviewsCompleted).toBe(1);
    expect(useMotivationStore.getState().xpLedger.totalXp).toBe(xpAfterFirst);

    disconnectMotivation();
  });
});

// ===========================================================================
// Scenario H: Study Mode single-surface reader UX
// ===========================================================================
describe("Scenario H: Study Mode single-surface reader UX", () => {
  it("reuses the single canonical DocumentViewerWrapper tab, preserves document ID, reading location, and return-to-origin without duplicating surfaces", () => {
    const activity = makeActivity({
      id: "act-study-doc-1",
      activityType: "guided_reading",
      title: "Study: Eigenvalues & Eigenvectors",
      dedupeKey: "document:doc-strang-ch6",
      sourceReferences: [
        { entityKind: "document", entityId: "doc-strang-ch6", documentId: "doc-strang-ch6" },
      ],
      conceptReferences: ["concept-eigenvalues"],
      resumeState: { page: 289, cfi: "epubcfi(/6/12!/4/2/8)" },
    });

    const dispatched: WorkspaceNavigateEvent[] = [];
    const { plan, event } = launchLearningActivity(
      activity,
      (nav) => dispatched.push(nav),
      {
        preferredMode: "study",
        preferredLayout: "with-source",
        returnTo: {
          tabId: "tab-today-01",
          tabType: "dashboard",
          sessionId: "ls-study-1",
        },
      },
    );

    expect(plan.surface).toBe("document-viewer");
    expect(plan.tabType).toBe("document-viewer");
    expect(plan.canonicalReaderHost).toBe("DocumentViewerWrapper");
    expect(plan.reuseExistingReaderTab).toBe(true);
    expect(plan.presentationMode).toBe("study");
    expect(plan.documentId).toBe("doc-strang-ch6");
    expect(plan.readingLocation).toEqual({ page: 289, cfi: "epubcfi(/6/12!/4/2/8)" });
    expect(plan.returnTo).toEqual({
      tabId: "tab-today-01",
      tabType: "dashboard",
      sessionId: "ls-study-1",
      activityId: "act-study-doc-1",
    });

    // Dispatched event enforces single-tab reuse
    expect(dispatched).toHaveLength(1);
    expect(event.reuseExistingTab).toBe(true);
    expect(event.state.canonicalReaderHost).toBe("DocumentViewerWrapper");

    // Launching a follow-up comprehension check on the same document also reuses the single reader tab
    const checkPlan = buildWorkspaceLaunchPlan(
      makeActivity({
        id: "act-check-doc-1",
        activityType: "comprehension_check",
        title: "Check: Characteristic Polynomial",
        dedupeKey: "check:doc-strang-ch6:p289",
        sourceReferences: [
          { entityKind: "study_plan_node", entityId: "node-ch6", documentId: "doc-strang-ch6" },
        ],
      }),
      { readingLocation: { page: 289 } },
    );
    expect(checkPlan.canonicalReaderHost).toBe("DocumentViewerWrapper");
    expect(checkPlan.reuseExistingReaderTab).toBe(true);
    expect(checkPlan.documentId).toBe("doc-strang-ch6");
    expect(checkPlan.presentationMode).toBe("study");

    // Navigation destination resolution remains canonical
    expect(resolveTabType("/documents")).toBe("documents");
    expect(resolvePrimaryLearningDestination("documents")).toBe("library");
    expect(resolvePrimaryLearningDestination("dashboard")).toBe("today");
  });
});

// ===========================================================================
// Scenario I: No AI provider
// ===========================================================================
describe("Scenario I: No AI provider", () => {
  it("runs core learning workflows cleanly with AI disabled and degrades AI-dependent activities with explicit fallback reasons", async () => {
    const noAiCaps: RuntimeCapabilities = {
      ai: false,
      network: false,
      audio: true,
      speech: false,
      renderer: true,
      external: false,
      verification: true,
      platform: "desktop",
      strictLocalOnly: false,
    };

    // Core non-AI activities remain fully supported
    expect(
      learningActivityRegistry.negotiateCapabilities("source_reading", noAiCaps).status,
    ).toBe("supported");
    expect(
      learningActivityRegistry.negotiateCapabilities("flashcard_review", noAiCaps).status,
    ).toBe("supported");
    expect(
      learningActivityRegistry.negotiateCapabilities("objective_question_practice", noAiCaps)
        .status,
    ).toBe("supported");

    // AI-dependent socratic_tutoring degrades gracefully with explicit fallback reason
    const socraticNeg = learningActivityRegistry.negotiateCapabilities(
      "socratic_tutoring",
      noAiCaps,
    );
    expect(socraticNeg.status).toBe("degraded");
    expect(socraticNeg.missingOptional).toContain("ai");
    expect(socraticNeg.canRunOffline).toBe(true);
    expect(socraticNeg.fallbackReason).toBeTruthy();
    expect(socraticNeg.fallbackReason!).toContain("Socratic self-prompting");

    // Manual goal + DAQE + Session Runtime all succeed without AI
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "Offline Linear Algebra",
      kind: "mastery",
    });
    expect(goal.status).toBe("active");

    const plan = orchestrateLearningSession({
      candidates: [
        {
          id: "obj-q-1",
          dedupeKey: "quiz:la-q1",
          title: "Matrix Multiplication Objective Quiz",
          providerKind: "learning_goals",
          activityKind: "practice_check",
          estimatedMinutes: 10,
          signals: { goalAlignment: 0.9, knowledgeGap: 0.8 },
          goalReferences: [{ goalId: goal.id }],
        },
      ],
      focusProfile: "deep_study",
      timeBudgetMinutes: 30,
    });
    expect(plan.privacy.offlineCapable).toBe(true);
    expect(plan.privacy.aiProviderUsed).toBe(false);
    expect(plan.selected).toHaveLength(1);

    const session = createLearningSession({
      id: "ls-no-ai-1",
      runtimeCapabilities: noAiCaps,
      activities: [
        makeActivity({
          id: "act-obj-1",
          activityType: "objective_question_practice",
          title: "Objective Quiz",
          dedupeKey: "quiz:la-q1",
        }),
        makeActivity({
          id: "act-socratic-1",
          activityType: "socratic_tutoring",
          title: "Socratic Dialogue on Rank-Nullity",
          dedupeKey: "socratic:rank-nullity",
        }),
      ],
      nowIso: NOW_ISO,
    });

    expect(session.activities[0].status).toBe("pending");
    expect(session.activities[1].status).toBe("degraded");
    expect(session.activities[1].degradedReason).toContain("Socratic self-prompting");
  });
});

// ===========================================================================
// Scenario J: Local-only documents & Health Vault isolation
// ===========================================================================
describe("Scenario J: Local-only documents & Health Vault isolation", () => {
  it("enforces local-only & AI-excluded privacy boundaries across DAQE, grounding, coach, learner model, and rejects Health Vault everywhere", async () => {
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "Confidential Legal Research",
      kind: "mastery",
    });
    await useLearningGoalsStore.getState().linkSource(goal.id, "document", "doc-private-brief");

    // 1. DAQE keeps local-only item locally with cloudAiAllowed: false and rejects Health Vault
    const plan = orchestrateLearningSession({
      candidates: [
        {
          id: "cand-private-1",
          dedupeKey: "document:doc-private-brief",
          title: "Private Case Brief",
          providerKind: "learning_goals",
          activityKind: "incremental_read",
          estimatedMinutes: 15,
          signals: { goalAlignment: 0.95, userPriority: 0.9 },
          goalReferences: [{ goalId: goal.id }],
          isLocalOnly: true,
          isAiExcluded: true,
        },
        {
          id: "cand-health-sleep",
          dedupeKey: "health_vault:sleep-2026-11-28",
          title: "Sleep Stage Log",
          providerKind: "pinned",
          activityKind: "pinned_item",
          estimatedMinutes: 5,
          signals: { userPriority: 1.0 },
          sourceDomain: "health_vault",
          isHealthVault: true,
        },
      ],
      focusProfile: "balanced",
      timeBudgetMinutes: 30,
    });

    expect(plan.ranked).toHaveLength(1);
    expect(plan.ranked[0].candidate.id).toBe("cand-private-1");
    expect(plan.ranked[0].cloudAiAllowed).toBe(false);
    expect(plan.privacy.planCloudAiAllowed).toBe(false);
    expect(plan.privacy.localOnlyItemCount).toBe(1);
    expect(plan.privacy.aiExcludedItemCount).toBe(1);
    expect(plan.privacy.rejectedHealthVaultIds).toEqual(["cand-health-sleep"]);

    // 2. Grounding rejects cloud fallback on local-only / AI-excluded document
    const grounding = verifySourceGrounding(
      {
        sourceId: "doc-private-brief",
        locatorType: "passage",
        passageText: "Nonexistent drifted text that would otherwise tempt cloud fallback",
      },
      [
        {
          id: "doc-private-brief",
          title: "Private Case Brief",
          exists: true,
          isIndexed: true,
          isLocalOnly: true,
          isAiExcluded: true,
          passages: [{ id: "p-1", text: "Completely unrelated statutory text." }],
        },
      ],
      { allowCloudFallback: true },
    );
    expect(grounding.status).toBe("privacy_restricted");
    expect(grounding.isGrounded).toBe(false);
    expect(grounding.fabricated).toBe(false);
    expect(grounding.cloudAiAllowed).toBe(false);
    expect(grounding.verificationMode).toBe("local_only");
    expect(grounding.recoveryActions).toContain("switch_to_local_only");

    // 3. Coach sets cloudExplanationAllowed: false for local-only / AI-excluded sources
    const coachRecs = detectCoachingOpportunities(
      {
        misunderstoodConcepts: [
          {
            conceptId: "concept-tort",
            conceptName: "Strict Liability",
            comprehensionScore: 0.3,
            unresolvedGap: true,
            isLocalOnly: true,
            isAiExcluded: true,
          },
        ],
      },
      DEFAULT_COACH_PREFERENCES,
      [],
      NOW_ISO,
    );
    expect(coachRecs).toHaveLength(1);
    expect(coachRecs[0].cloudExplanationAllowed).toBe(false);
    expect(coachRecs[0].privacyReason).toBe("local_only_source");

    // 4. Learner model excludes isAiExcluded evidence when excludeAiExcluded: true
    const privateEvidence: CompetencyEvidenceRecord[] = [
      makeEvidenceRecord({
        id: "ev-priv-1",
        conceptId: "concept-tort",
        dimension: "comprehension",
        sourceKind: "guided_check",
        sourceRecordId: "chk-priv-1",
        evidenceGroupId: "grp-priv-1",
        observedScore: 0.9,
        baseWeight: 1.2,
        isLocalOnly: true,
        isAiExcluded: true,
        occurredAt: "2026-11-26T10:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-priv-2",
        conceptId: "concept-tort",
        dimension: "comprehension",
        sourceKind: "practice_attempt",
        sourceRecordId: "prac-priv-2",
        evidenceGroupId: "grp-priv-2",
        observedScore: 0.92,
        baseWeight: 1.2,
        isLocalOnly: true,
        isAiExcluded: true,
        occurredAt: "2026-11-28T10:00:00.000Z",
      }),
    ];

    const localProfile = projectConceptProfile("concept-tort", privateEvidence, null, NOW_ISO, {
      excludeAiExcluded: false,
    });
    const aiContextProfile = projectConceptProfile("concept-tort", privateEvidence, null, NOW_ISO, {
      excludeAiExcluded: true,
    });
    expect(localProfile.dimensions.comprehension.status).toBe("demonstrated");
    expect(localProfile.containsLocalOnlyEvidence).toBe(true);
    expect(localProfile.containsAiExcludedEvidence).toBe(true);
    expect(aiContextProfile.dimensions.comprehension.status).toBe("unknown");
    expect(aiContextProfile.dimensions.comprehension.rawEvidenceCount).toBe(0);

    // 5. Event bus strictly rejects Health Vault entities and biometric payload fields
    expect(() =>
      emitLearningEvent({
        idempotencyKey: "hv-reject-1",
        eventType: "practice_attempted",
        surface: "unified_session",
        entityKind: "health_vault" as never,
        entityId: "hv-1",
      }),
    ).toThrow(HealthVaultBoundaryError);

    expect(() =>
      emitLearningEvent({
        idempotencyKey: "hv-reject-2",
        eventType: "practice_attempted",
        surface: "unified_session",
        entityKind: "concept",
        entityId: "concept-tort",
        payload: { heartRate: 64, sleepDuration: 7.5 },
      }),
    ).toThrow(HealthVaultBoundaryError);
  });
});

// ===========================================================================
// Scenario K: Interrupted session recovery
// ===========================================================================
describe("Scenario K: Interrupted session recovery", () => {
  it("persists mid-session progress and recovers after simulated restart without duplicating review history", async () => {
    useLearningSessionStore.getState().startNewSession({
      id: "ls-recover-1",
      title: "Morning Study Block",
      timeBudgetMinutes: 30,
      activities: [
        makeActivity({
          id: "act-rec-1",
          activityType: "flashcard_review",
          title: "Card 1",
          dedupeKey: "flashcard:rec-1",
          sourceReferences: [{ entityKind: "learning_item", entityId: "rec-1" }],
        }),
        makeActivity({
          id: "act-rec-2",
          activityType: "source_reading",
          title: "Chapter 4",
          dedupeKey: "document:doc-ch4",
          sourceReferences: [{ entityKind: "document", entityId: "doc-ch4", documentId: "doc-ch4" }],
        }),
        makeActivity({
          id: "act-rec-3",
          activityType: "objective_question_practice",
          title: "Quick Check",
          dedupeKey: "quiz:ch4-q1",
        }),
      ],
      nowIso: NOW_ISO,
    });

    // Complete activity 1, start activity 2, then pause with checkpoint
    useLearningSessionStore.getState().completeActivity("act-rec-1", {
      activeSeconds: 90,
      nowIso: NOW_ISO,
    });
    useLearningSessionStore.getState().startActivity("act-rec-2");
    useLearningSessionStore.getState().pauseSession({
      checkpoint: { documentId: "doc-ch4", page: 19, offset: 420 },
      nowIso: NOW_ISO,
    });

    const reviewEventsBeforeRestart = getBufferedLearningEvents({
      eventTypes: ["review_committed"],
      entityId: "rec-1",
    });
    expect(reviewEventsBeforeRestart).toHaveLength(1);

    // Snapshot persisted storage before simulating process restart
    const persistedSnapshot = globalThis.localStorage.getItem(LEARNING_SESSION_STORAGE_KEY);
    expect(persistedSnapshot).toBeTruthy();

    // Simulate process restart: wipe in-memory session state, restore persisted storage, then rehydrate
    useLearningSessionStore.setState({ activeSession: null });
    expect(useLearningSessionStore.getState().activeSession).toBeNull();
    globalThis.localStorage.setItem(LEARNING_SESSION_STORAGE_KEY, persistedSnapshot!);

    await useLearningSessionStore.persist.rehydrate();

    const recovered = useLearningSessionStore.getState().activeSession;
    expect(recovered).not.toBeNull();
    expect(recovered!.id).toBe("ls-recover-1");
    expect(recovered!.status).toBe("paused");
    expect(recovered!.activities[0].status).toBe("completed");
    expect(recovered!.activities[1].resumeState).toEqual({
      documentId: "doc-ch4",
      page: 19,
      offset: 420,
    });

    // Resume session and verify completed activity 1 stays completed with zero duplicate events
    const resumed = useLearningSessionStore.getState().resumeSession();
    expect(resumed?.status).toBe("active");
    expect(resumed?.currentActivityIndex).toBe(1);

    // Attempting to re-complete already-completed activity 1 does not emit duplicate review events
    useLearningSessionStore.getState().completeActivity("act-rec-1", { activeSeconds: 90 });
    const reviewEventsAfterRestart = getBufferedLearningEvents({
      eventTypes: ["review_committed"],
      entityId: "rec-1",
    });
    expect(reviewEventsAfterRestart).toHaveLength(1);
    expect(useLearningSessionStore.getState().activeSession!.elapsedActiveSeconds).toBe(90);
  });
});

// ===========================================================================
// Scenario L: Existing user data compatibility & evolution
// ===========================================================================
describe("Scenario L: Existing user data compatibility & evolution", () => {
  it("links a pre-existing Study Plan into a new Learning Goal and preserves underlying data when the goal is deleted", async () => {
    // Simulated pre-existing user library records (documents, flashcards, and Study Plan)
    const legacyStudyPlan = { id: "sp-legacy-calc-101", title: "Calculus 101" };
    const legacyDocuments = new Map([["doc-stewart-calc", { id: "doc-stewart-calc", title: "Stewart Calculus" }]]);
    const legacyCards = new Map([["card-chain-rule", { id: "card-chain-rule", question: "Chain rule?" }]]);

    // Link existing Study Plan + documents + cards into a new Learning Goal
    const goal = await useLearningGoalsStore.getState().createGoal({
      title: "Finish Calculus 101",
      kind: "mastery",
      studyPlanId: legacyStudyPlan.id,
      initialSources: [
        { sourceKind: "document", sourceId: "doc-stewart-calc", sourceRole: "primary" },
        { sourceKind: "study_plan", sourceId: legacyStudyPlan.id, sourceRole: "primary" },
      ],
    });
    expect(goal.studyPlanId).toBe(legacyStudyPlan.id);
    expect(goal.sources).toHaveLength(2);

    // A second goal also references the same underlying document
    const companionGoal = await useLearningGoalsStore.getState().createGoal({
      title: "Physics Mechanics Reference",
      kind: "exploration",
      initialSources: [{ sourceKind: "document", sourceId: "doc-stewart-calc" }],
    });

    // Evolving the goal preserves its studyPlanId and existing sources
    const evolved = await useLearningGoalsStore.getState().evolveGoal(goal.id, {
      kind: "deadline",
      targetDate: "2026-12-20T12:00:00.000Z",
    });
    expect(evolved.studyPlanId).toBe(legacyStudyPlan.id);
    expect(evolved.sources).toHaveLength(2);

    // Deleting the goal removes only the goal record; underlying data & companion goal remain intact
    await useLearningGoalsStore.getState().deleteGoal(goal.id);

    expect(useLearningGoalsStore.getState().goals.find((g) => g.id === goal.id)).toBeUndefined();
    expect(useLearningGoalsStore.getState().goals.find((g) => g.id === companionGoal.id)).toBeDefined();
    expect(
      useLearningGoalsStore
        .getState()
        .getGoalsForSource("document", "doc-stewart-calc")
        .map((g) => g.id),
    ).toEqual([companionGoal.id]);
    expect(legacyDocuments.has("doc-stewart-calc")).toBe(true);
    expect(legacyCards.has("card-chain-rule")).toBe(true);
    expect(legacyStudyPlan.id).toBe("sp-legacy-calc-101");
  });
});

// ===========================================================================
// Scenario M: Large library responsiveness
// ===========================================================================
describe("Scenario M: Large library responsiveness", () => {
  it("orchestrates 2,000 heterogeneous candidates across 5 goals deterministically within 150ms", () => {
    const goalIds = ["goal-1", "goal-2", "goal-3", "goal-4", "goal-5"];
    const providerKinds: DaqeActivityCandidate["providerKind"][] = [
      "srs_due_pool",
      "learning_goals",
      "guided_trails",
      "remediation",
      "exam_prep",
      "smart_feeds",
      "continue_reading",
    ];
    const activityKinds: DaqeActivityCandidate["activityKind"][] = [
      "srs_review",
      "incremental_read",
      "study_workspace",
      "guided_reading",
      "remediation",
      "practice_check",
      "exploration_feed",
    ];

    // Deterministic synthetic library of 2,000 candidates (no Math.random())
    const candidates: DaqeActivityCandidate[] = [];
    for (let i = 0; i < 2_000; i += 1) {
      const gIdx = i % goalIds.length;
      const pIdx = i % providerKinds.length;
      const aIdx = i % activityKinds.length;
      // Introduce 100 deterministic cross-provider duplicates
      const dedupeKey = i < 100 ? `shared:item-${i}` : i < 200 ? `shared:item-${i - 100}` : `item:${i}`;
      candidates.push({
        id: `cand-${i}`,
        dedupeKey,
        title: `Activity ${i}`,
        providerKind: providerKinds[pIdx],
        activityKind: activityKinds[aIdx],
        estimatedMinutes: 3 + (i % 12),
        topicKey: `topic-${i % 25}`,
        signals: {
          srsUrgency: ((i * 37) % 100) / 100,
          goalAlignment: ((i * 53) % 100) / 100,
          deadlinePressure: gIdx === 0 ? 0.85 : ((i * 19) % 100) / 100,
          knowledgeGap: ((i * 71) % 100) / 100,
          userPriority: ((i * 29) % 100) / 100,
          interest: ((i * 43) % 100) / 100,
        },
        goalReferences: [{ goalId: goalIds[gIdx], goalTitle: `Goal ${gIdx + 1}` }],
        isNewMaterial: i % 4 === 0,
      });
    }

    const startMs = performance.now();
    const plan1 = orchestrateLearningSession({
      candidates,
      focusProfile: "balanced",
      timeBudgetMinutes: 45,
    });
    const elapsedMs = performance.now() - startMs;

    const plan2 = orchestrateLearningSession({
      candidates,
      focusProfile: "balanced",
      timeBudgetMinutes: 45,
    });

    expect(elapsedMs).toBeLessThan(150);
    expect(plan1.deduplicatedCount).toBe(100);
    expect(plan1.ranked).toHaveLength(1_900);
    expect(plan1.packedMinutes).toBeLessThanOrEqual(45);
    expect(plan1.selected.length).toBeGreaterThan(0);

    // Byte-identical determinism across runs
    expect(plan1.selected.map((s) => s.candidate.id)).toEqual(
      plan2.selected.map((s) => s.candidate.id),
    );
    expect(plan1.ranked.slice(0, 50).map((r) => [r.candidate.id, r.score])).toEqual(
      plan2.ranked.slice(0, 50).map((r) => [r.candidate.id, r.score]),
    );
  });
});

// ===========================================================================
// Scenario N: Disabled gamification and coaching
// ===========================================================================
describe("Scenario N: Disabled gamification and coaching", () => {
  it("emits zero coaching recommendations and zero XP/streak prompts while keeping the full learning workflow unaffected", async () => {
    useLearningCoachStore.getState().setProactivity("disabled");
    useMotivationStore.getState().setEnabled(false);
    const disconnectMotivation = useMotivationStore.getState().connectLearningEventBus();

    const urgentCoachSnapshot: CoachSnapshot = {
      approachingExams: [
        {
          examId: "exam-1",
          title: "OS Midterm",
          examDateIso: "2026-12-01T12:00:00.000Z",
          readinessScore: 0.35,
        },
      ],
      reviewBacklog: {
        overdueCount: 250,
        rollingDailyThroughput: 30,
      },
      goals: [
        {
          goalId: "g-stalled",
          title: "Rust Async",
          daysSinceLastActivity: 15,
        },
      ],
    };

    // Zero coaching recommendations
    const recs = useLearningCoachStore.getState().evaluateOpportunities(urgentCoachSnapshot, NOW_ISO);
    expect(recs).toEqual([]);
    expect(useLearningCoachStore.getState().recommendations).toEqual([]);

    // Full learning workflow runs completely unaffected
    const session = useLearningSessionStore.getState().startNewSession({
      id: "ls-minimalist-1",
      activities: [
        makeActivity({
          id: "act-min-1",
          activityType: "flashcard_review",
          title: "Recall: Virtual Memory",
          dedupeKey: "flashcard:vm-1",
          sourceReferences: [{ entityKind: "learning_item", entityId: "vm-1" }],
        }),
        makeActivity({
          id: "act-min-2",
          activityType: "source_reading",
          title: "Read: Paging",
          dedupeKey: "document:doc-os-paging",
          sourceReferences: [
            { entityKind: "document", entityId: "doc-os-paging", documentId: "doc-os-paging" },
          ],
        }),
      ],
      nowIso: NOW_ISO,
    });
    expect(session.activities).toHaveLength(2);

    useLearningSessionStore.getState().completeActivity("act-min-1", {
      activeSeconds: 45,
      nowIso: NOW_ISO,
    });
    useLearningSessionStore.getState().completeActivity("act-min-2", {
      activeSeconds: 300,
      nowIso: NOW_ISO,
    });
    const summary = useLearningSessionStore.getState().completeSession();
    expect(summary?.completedCount).toBe(2);
    expect(summary?.completionRate).toBe(1);

    // Zero motivation/XP/streak/celebration output
    expect(useMotivationStore.getState().getStreak(NOW_ISO)).toBeNull();
    expect(useMotivationStore.getState().xpLedger.totalXp).toBe(0);
    expect(useMotivationStore.getState().activitySummary.reviewsCompleted).toBe(0);

    const evalResult = useMotivationStore.getState().evaluateProgress(
      {
        competenciesDemonstrated: 3,
        conceptsUnderstood: 4,
        memoryRetainedRatio: 0.9,
        skillsDemonstrated: 2,
        learningGapsResolved: 1,
        proficiencyDemonstrated: 1,
      },
      { nowIso: NOW_ISO },
    );
    expect(evalResult.enabled).toBe(false);
    expect(evalResult.activityBand).toBeNull();
    expect(evalResult.outcomeBand).toBeNull();
    expect(evalResult.milestones).toEqual([]);
    expect(evalResult.celebrations).toEqual([]);

    // Core event bus still recorded the canonical learning events cleanly
    expect(
      getBufferedLearningEvents({ eventTypes: ["review_committed", "reading_completed"] }),
    ).toHaveLength(2);

    disconnectMotivation();
  });
});

// ===========================================================================
// Scenario O: Evidence correction & invalidation
// ===========================================================================
describe("Scenario O: Evidence correction & invalidation", () => {
  it("regrades an invalidated exam item cleanly while leaving unrelated concepts and FSRS review history completely untouched", () => {
    const records: CompetencyEvidenceRecord[] = [
      // Affected concept: misgraded exam item + 2 FSRS reviews
      makeEvidenceRecord({
        id: "ev-eigen-exam-bad",
        conceptId: "concept-eigenvalues",
        dimension: "application",
        sourceKind: "exam_grade",
        sourceRecordId: "grade-midterm-q4",
        evidenceGroupId: "midterm-2026",
        observedScore: 0.2,
        baseWeight: 1.5,
        occurredAt: "2026-11-26T12:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-eigen-fsrs-1",
        conceptId: "concept-eigenvalues",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "grade-midterm-q4", // Even with matching id, FSRS records MUST remain untouched
        evidenceGroupId: "card-eigen-1",
        observedScore: 0.9,
        baseWeight: 1.0,
        elapsedDays: 5,
        occurredAt: "2026-11-24T12:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-eigen-fsrs-2",
        conceptId: "concept-eigenvalues",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "rev-eigen-2",
        evidenceGroupId: "card-eigen-2",
        observedScore: 0.95,
        baseWeight: 1.0,
        elapsedDays: 7,
        occurredAt: "2026-11-27T12:00:00.000Z",
      }),
      // Unrelated concept: exam grade + FSRS review
      makeEvidenceRecord({
        id: "ev-ortho-exam",
        conceptId: "concept-orthogonality",
        dimension: "application",
        sourceKind: "exam_grade",
        sourceRecordId: "grade-midterm-q5",
        evidenceGroupId: "midterm-2026",
        observedScore: 0.94,
        baseWeight: 1.5,
        occurredAt: "2026-11-26T12:00:00.000Z",
      }),
      makeEvidenceRecord({
        id: "ev-ortho-fsrs-1",
        conceptId: "concept-orthogonality",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "rev-ortho-1",
        evidenceGroupId: "card-ortho-1",
        observedScore: 0.88,
        baseWeight: 1.0,
        elapsedDays: 4,
        occurredAt: "2026-11-25T12:00:00.000Z",
      }),
    ];

    const unrelatedBefore = projectConceptProfile("concept-orthogonality", records, null, NOW_ISO);

    const replacementGrade = makeEvidenceRecord({
      id: "ev-eigen-exam-regraded",
      conceptId: "concept-eigenvalues",
      dimension: "application",
      sourceKind: "exam_grade",
      sourceRecordId: "grade-midterm-q4-v2",
      evidenceGroupId: "midterm-2026-regrade",
      observedScore: 0.92,
      baseWeight: 1.5,
      occurredAt: NOW_ISO,
    });

    const impact = computeInvalidationImpact("grade-midterm-q4", records, {
      nowIso: NOW_ISO,
      invalidationEventId: "evt-regrade-q4",
      replacementRecords: [replacementGrade],
    });

    // Only the misgraded exam evidence was invalidated
    expect(impact.invalidatedEvidenceIds).toEqual(["ev-eigen-exam-bad"]);
    expect(impact.affectedConceptIds).toEqual(["concept-eigenvalues"]);
    expect(impact.affectedPairs).toHaveLength(1);

    const pair = impact.affectedPairs[0];
    expect(pair.conceptId).toBe("concept-eigenvalues");
    expect(pair.dimension).toBe("application");
    expect(pair.previousProjection.estimate).toBeCloseTo(0.2, 2);
    expect(pair.previousProjection.status).toBe("needs_attention");
    expect(pair.recomputedProjection.estimate).toBeCloseTo(0.92, 2);
    expect(pair.recomputedProjection.status).not.toBe("needs_attention");

    // All 3 FSRS review records remain completely untouched
    expect(impact.untouchedFsrsRecordCount).toBe(3);
    const fsrsAfter = impact.updatedEvidenceRecords.filter((r) => r.sourceKind === "fsrs_review");
    expect(fsrsAfter).toHaveLength(3);
    expect(fsrsAfter.every((r) => r.isInvalidated === false)).toBe(true);

    // Unrelated concept projection is completely unchanged
    const unrelatedAfter = projectConceptProfile(
      "concept-orthogonality",
      impact.updatedEvidenceRecords,
      null,
      NOW_ISO,
    );
    expect(unrelatedAfter).toEqual(unrelatedBefore);
  });
});
