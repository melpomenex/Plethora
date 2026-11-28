import { describe, expect, it } from "vitest";
import {
  ALL_ASSESSMENT_PURPOSES,
  canAssessmentContributeToMastery,
  computeInvalidationImpact,
  getAssessmentPurposePolicy,
  planDimensionTargetedRemediation,
  type RemediationAttemptRecord,
} from "../assessmentRemediation";
import { projectConceptProfile } from "../../learner-model/competencyEstimator";
import type {
  CompetencyDimension,
  CompetencyEvidenceRecord,
} from "../../../types/learnerModel";

const NOW_ISO = "2026-11-28T12:00:00.000Z";

function makeEvidence(
  overrides: Partial<CompetencyEvidenceRecord> & {
    id: string;
    conceptId: string;
    dimension: CompetencyDimension;
  },
): CompetencyEvidenceRecord {
  return {
    sourceKind: "exam_grade",
    sourceEventId: `evt-${overrides.id}`,
    sourceRecordId: `grade-${overrides.id}`,
    evidenceGroupId: `grp-${overrides.id}`,
    cardFamilyId: null,
    sessionId: "sess-1",
    observedScore: 0.9,
    baseWeight: 1.4,
    elapsedDays: 5,
    hintLevel: 0,
    isVerified: true,
    isInvalidated: false,
    invalidatedByEventId: null,
    documentId: "doc-1",
    isLocalOnly: false,
    isAiExcluded: false,
    occurredAt: "2026-11-25T12:00:00.000Z",
    policyVersion: "competency-v1",
    createdAt: "2026-11-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("assessmentRemediation — 8-purpose Assessment Taxonomy", () => {
  it("provides deterministic policies for all 8 assessment purposes", () => {
    expect(ALL_ASSESSMENT_PURPOSES).toEqual([
      "diagnostic",
      "formative",
      "retrieval_practice",
      "mastery",
      "mock_exam",
      "summative_exam",
      "practical_skill",
      "self_assessment",
    ]);

    for (const purpose of ALL_ASSESSMENT_PURPOSES) {
      const policy = getAssessmentPurposePolicy(purpose);
      expect(policy.purpose).toBe(purpose);
      expect(policy.targetDimensions.length).toBeGreaterThan(0);
    }
  });

  it("enforces strict exam isolation for mock_exam and summative_exam (and mastery)", () => {
    for (const purpose of ["mock_exam", "summative_exam", "mastery"] as const) {
      const policy = getAssessmentPurposePolicy(purpose);
      expect(policy.examIsolated).toBe(true);
      expect(policy.hintsAllowed).toBe(false);
      expect(policy.coachingAllowed).toBe(false);
      expect(policy.feedbackTiming).toBe("end_of_assessment");
      expect(policy.contributesToMastery).toBe(true);
    }
  });

  it("excludes self_assessment and model-only blueprints from demonstrated mastery", () => {
    const selfPolicy = getAssessmentPurposePolicy("self_assessment");
    expect(selfPolicy.contributesToMastery).toBe(false);
    expect(selfPolicy.evidenceBaseWeight).toBe(0);
    expect(selfPolicy.examIsolated).toBe(false);

    expect(canAssessmentContributeToMastery("self_assessment", "source-grounded")).toBe(
      false,
    );
    expect(canAssessmentContributeToMastery("summative_exam", "model-only")).toBe(false);
    expect(canAssessmentContributeToMastery("summative_exam", "source-grounded")).toBe(
      true,
    );
  });
});

describe("assessmentRemediation — dimension-targeted remediation & 4-stage anti-loop ladder", () => {
  it("routes BST deletion application failure to structured problem-solving/worked example instead of a definition flashcard", () => {
    // Learner already demonstrated retention (recalls BST definition)
    const bstProfile = projectConceptProfile(
      "c-bst-deletion",
      [
        makeEvidence({
          id: "ret-1",
          conceptId: "c-bst-deletion",
          dimension: "retention",
          sourceKind: "fsrs_review",
          evidenceGroupId: "ret-g1",
          occurredAt: "2026-11-20T12:00:00.000Z",
          observedScore: 0.95,
          baseWeight: 1.5,
          elapsedDays: 5,
        }),
        makeEvidence({
          id: "ret-2",
          conceptId: "c-bst-deletion",
          dimension: "retention",
          sourceKind: "fsrs_review",
          evidenceGroupId: "ret-g2",
          occurredAt: "2026-11-25T12:00:00.000Z",
          observedScore: 0.95,
          baseWeight: 1.5,
          elapsedDays: 5,
        }),
      ],
      null,
      NOW_ISO,
    );

    const plan = planDimensionTargetedRemediation({
      conceptId: "c-bst-deletion",
      conceptName: "Binary Search Tree Deletion",
      failedDimension: "application",
      errorNature: "procedural_step_failure",
      weakStep: "replacing a two-child node with its inorder successor",
      competencyProfile: bstProfile,
      attemptHistory: [],
      nowIso: NOW_ISO,
    });

    expect(plan.status).toBe("active");
    expect(plan.escalationStage).toBe(1);
    expect(plan.escalationStageName).toBe("targeted_practice");
    expect(plan.recommendedActivity?.activityType).toBe("structured_problem_solving");
    expect(plan.recommendedActivity?.focusStep).toBe(
      "replacing a two-child node with its inorder successor",
    );
    expect(plan.rationale).toContain("definition flashcards are skipped");
  });

  it("selects appropriate non-flashcard modalities for comprehension, transfer, retention, and exposure", () => {
    const retentionPlan = planDimensionTargetedRemediation({
      conceptId: "c1",
      conceptName: "CAP Theorem",
      failedDimension: "retention",
      errorNature: "recall_lapse",
      attemptHistory: [],
    });
    expect(retentionPlan.recommendedActivity?.activityType).toBe("spaced_retrieval");

    const comprehensionPlan = planDimensionTargetedRemediation({
      conceptId: "c2",
      conceptName: "Eventual Consistency",
      failedDimension: "comprehension",
      errorNature: "misconception",
      attemptHistory: [],
    });
    expect(comprehensionPlan.recommendedActivity?.activityType).toBe(
      "source_grounded_explanation",
    );

    const transferPlan = planDimensionTargetedRemediation({
      conceptId: "c3",
      conceptName: "Dynamic Programming",
      failedDimension: "transfer",
      errorNature: "novel_context_failure",
      attemptHistory: [],
    });
    expect(transferPlan.recommendedActivity?.activityType).toBe(
      "cross_context_comparison",
    );

    const exposurePlan = planDimensionTargetedRemediation({
      conceptId: "c4",
      conceptName: "Lamport Clocks",
      failedDimension: "exposure",
      errorNature: "unseen_concept",
      attemptHistory: [],
    });
    expect(exposurePlan.recommendedActivity?.activityType).toBe(
      "guided_reading_passage",
    );
  });

  it("progresses through the 4-stage anti-loop escalation ladder, never repeats the last failed activity, and stops auto-requeuing at stage 4", () => {
    const baseInput = {
      conceptId: "c-bst-deletion",
      conceptName: "BST Deletion",
      failedDimension: "application" as const,
      prerequisiteConceptIds: ["c-inorder-traversal", "c-tree-pointers"],
      weakPrerequisiteConceptIds: ["c-inorder-traversal"],
      alternativeSourceIds: ["src-visualgo-bst"],
      nowIso: NOW_ISO,
    };

    // Stage 1: targeted_practice
    const stage1 = planDimensionTargetedRemediation({
      ...baseInput,
      attemptHistory: [],
    });
    expect(stage1.escalationStage).toBe(1);
    expect(stage1.escalationStageName).toBe("targeted_practice");
    expect(stage1.recommendedActivity?.activityType).toBe("structured_problem_solving");

    // Stage 2: worked_example_or_socratic (must differ from stage 1 failed activity)
    const history1: RemediationAttemptRecord[] = [
      {
        attemptNumber: 1,
        activityType: stage1.recommendedActivity!.activityType,
        outcome: "failed",
        attemptedAt: "2026-11-28T10:00:00.000Z",
      },
    ];
    const stage2 = planDimensionTargetedRemediation({
      ...baseInput,
      attemptHistory: history1,
    });
    expect(stage2.escalationStage).toBe(2);
    expect(stage2.escalationStageName).toBe("worked_example_or_socratic");
    expect(stage2.recommendedActivity?.activityType).toBe("worked_example");
    expect(stage2.recommendedActivity?.activityType).not.toBe(
      history1[0].activityType,
    );

    // Stage 3: prerequisite_check_and_alternative_source (must differ from stage 2 failed activity)
    const history2: RemediationAttemptRecord[] = [
      ...history1,
      {
        attemptNumber: 2,
        activityType: stage2.recommendedActivity!.activityType,
        outcome: "failed",
        attemptedAt: "2026-11-28T10:30:00.000Z",
      },
    ];
    const stage3 = planDimensionTargetedRemediation({
      ...baseInput,
      attemptHistory: history2,
    });
    expect(stage3.escalationStage).toBe(3);
    expect(stage3.escalationStageName).toBe(
      "prerequisite_check_and_alternative_source",
    );
    expect(stage3.recommendedActivity?.activityType).toBe("alternative_explanation");
    expect(stage3.recommendedActivity?.activityType).not.toBe(
      history2[1].activityType,
    );
    expect(stage3.recommendedActivity?.prerequisiteConceptIdsToCheck).toEqual([
      "c-inorder-traversal",
      "c-tree-pointers",
    ]);
    expect(stage3.recommendedActivity?.alternativeSourceIds).toEqual([
      "src-visualgo-bst",
    ]);

    // Stage 4: user_override_or_defer — stops auto-requeue & sets 24h cooldown
    const history3: RemediationAttemptRecord[] = [
      ...history2,
      {
        attemptNumber: 3,
        activityType: stage3.recommendedActivity!.activityType,
        outcome: "failed",
        attemptedAt: "2026-11-28T11:00:00.000Z",
      },
    ];
    const stage4 = planDimensionTargetedRemediation({
      ...baseInput,
      attemptHistory: history3,
    });
    expect(stage4.status).toBe("cooldown_or_override");
    expect(stage4.escalationStage).toBe(4);
    expect(stage4.escalationStageName).toBe("user_override_or_defer");
    expect(stage4.autoRequeue).toBe(false);
    expect(stage4.recommendedActivity).toBeNull();
    expect(stage4.cooldownUntil).toBe("2026-11-29T12:00:00.000Z");
    expect(stage4.userChoices).toContain("pause_24h");
    expect(stage4.userChoices).toContain("dismiss_remediation");
  });

  it("never repeats the exact same failed activity twice even if history already used the stage default", () => {
    const plan = planDimensionTargetedRemediation({
      conceptId: "c-comp",
      conceptName: "Closures",
      failedDimension: "comprehension",
      attemptHistory: [
        {
          attemptNumber: 1,
          activityType: "socratic_dialogue", // Already tried Stage 2's default
          outcome: "failed",
          attemptedAt: "2026-11-28T11:00:00.000Z",
        },
      ],
    });
    expect(plan.recommendedActivity?.activityType).not.toBe("socratic_dialogue");
  });

  it("respects immediate dismissal and user override at any stage", () => {
    const dismissed = planDimensionTargetedRemediation({
      conceptId: "c1",
      conceptName: "Red-Black Trees",
      failedDimension: "comprehension",
      attemptHistory: [],
      isDismissed: true,
      dismissReason: "Out of scope for my exam",
    });
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.autoRequeue).toBe(false);
    expect(dismissed.recommendedActivity).toBeNull();

    const overridden = planDimensionTargetedRemediation({
      conceptId: "c1",
      conceptName: "Red-Black Trees",
      failedDimension: "comprehension",
      attemptHistory: [],
      isOverridden: true,
    });
    expect(overridden.status).toBe("overridden");
    expect(overridden.autoRequeue).toBe(false);
  });
});

describe("assessmentRemediation — computeInvalidationImpact", () => {
  it("invalidates only the target grade, recomputes affected projections cleanly, and never touches unrelated concepts or FSRS history", () => {
    const records: CompetencyEvidenceRecord[] = [
      // Affected concept A — comprehension (two independent groups across 2 days)
      makeEvidence({
        id: "ev-bad-grade",
        conceptId: "c-bst",
        dimension: "comprehension",
        sourceKind: "exam_grade",
        sourceRecordId: "grade-99",
        evidenceGroupId: "grp-grade-99",
        observedScore: 0.2,
        baseWeight: 1.5,
        occurredAt: "2026-11-26T12:00:00.000Z",
      }),
      makeEvidence({
        id: "ev-good-1",
        conceptId: "c-bst",
        dimension: "comprehension",
        sourceKind: "exam_grade",
        sourceRecordId: "grade-50",
        evidenceGroupId: "grp-grade-50",
        observedScore: 0.92,
        baseWeight: 1.5,
        occurredAt: "2026-11-20T12:00:00.000Z",
      }),
      makeEvidence({
        id: "ev-good-2",
        conceptId: "c-bst",
        dimension: "comprehension",
        sourceKind: "practice_attempt",
        sourceRecordId: "prac-1",
        evidenceGroupId: "grp-prac-1",
        observedScore: 0.94,
        baseWeight: 1.5,
        occurredAt: "2026-11-24T12:00:00.000Z",
      }),
      // FSRS review record (even if sourceRecordId collided, FSRS history is never touched)
      makeEvidence({
        id: "ev-fsrs-1",
        conceptId: "c-bst",
        dimension: "retention",
        sourceKind: "fsrs_review",
        sourceRecordId: "grade-99",
        evidenceGroupId: "fsrs-card-1",
        observedScore: 0.95,
        baseWeight: 1.0,
        elapsedDays: 7,
        occurredAt: "2026-11-26T12:00:00.000Z",
      }),
      // Unrelated concept B
      makeEvidence({
        id: "ev-unrelated",
        conceptId: "c-graphs",
        dimension: "application",
        sourceKind: "exam_grade",
        sourceRecordId: "grade-100",
        evidenceGroupId: "grp-grade-100",
        observedScore: 0.85,
        baseWeight: 1.2,
        occurredAt: "2026-11-26T12:00:00.000Z",
      }),
    ];

    const impact = computeInvalidationImpact("grade-99", records, {
      nowIso: NOW_ISO,
    });

    expect(impact.invalidatedEvidenceIds).toEqual(["ev-bad-grade"]);
    expect(impact.affectedConceptIds).toEqual(["c-bst"]);
    expect(impact.affectedPairs).toHaveLength(1);
    expect(impact.untouchedFsrsRecordCount).toBe(1);

    const pair = impact.affectedPairs[0];
    expect(pair.conceptId).toBe("c-bst");
    expect(pair.dimension).toBe("comprehension");
    // Before invalidation, the bad 0.2 grade dragged down the estimate
    expect(pair.previousProjection.estimate).toBeLessThan(0.75);
    // After invalidation, clean recomputation restores demonstrated competency
    expect(pair.recomputedProjection.estimate).toBeGreaterThan(0.9);
    expect(pair.recomputedProjection.status).toBe("demonstrated");
    expect(pair.recomputedProjection.evidenceIds).not.toContain("ev-bad-grade");

    // Verify FSRS record and unrelated concept record remain active & untouched
    const fsrsAfter = impact.updatedEvidenceRecords.find((r) => r.id === "ev-fsrs-1");
    expect(fsrsAfter?.isInvalidated).toBe(false);
    const unrelatedAfter = impact.updatedEvidenceRecords.find(
      (r) => r.id === "ev-unrelated",
    );
    expect(unrelatedAfter?.isInvalidated).toBe(false);
  });
});
