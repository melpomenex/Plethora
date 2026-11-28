import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    invokeCommand: vi.fn(),
    listen: vi.fn(async () => () => {}),
  };
});

import {
  DIMENSION_HALF_LIFE_DAYS,
  computeHintDiscount,
  computeRecencyDecay,
  computeRetentionDelayDiscount,
  estimateDimensionCompetency,
  projectConceptProfile,
} from "../competencyEstimator";
import {
  _resetLearnerModelApiFallbackForTests,
  getConceptCompetencyProfile,
  getConceptEvidenceHistory,
  invalidateCompetencyEvidence,
  recordCompetencyEvidence,
  setLearnerCompetencyDeclaration,
} from "../../../api/learner-model";
import { useLearnerModelStore } from "../../../stores/learnerModelStore";
import {
  _resetLearningEventBusForTests,
  emitLearningEvent,
} from "../../learning-events/learningEventBus";
import {
  ALL_COMPETENCY_DIMENSIONS,
  COMPETENCY_POLICY_VERSION,
  type CompetencyEvidenceRecord,
  type LearnerCompetencyDeclaration,
} from "../../../types/learnerModel";

const NOW_ISO = "2026-11-28T12:00:00.000Z";

function makeRecord(
  overrides: Partial<CompetencyEvidenceRecord> = {},
): CompetencyEvidenceRecord {
  return {
    id: "ev-1",
    conceptId: "concept-bayes",
    dimension: "comprehension",
    sourceKind: "exam_grade",
    sourceEventId: "le-1",
    sourceRecordId: "rec-1",
    evidenceGroupId: "group-1",
    cardFamilyId: null,
    sessionId: "sess-1",
    observedScore: 0.9,
    baseWeight: 1.0,
    elapsedDays: null,
    hintLevel: 0,
    isVerified: true,
    isInvalidated: false,
    invalidatedByEventId: null,
    documentId: "doc-1",
    isLocalOnly: false,
    isAiExcluded: false,
    occurredAt: NOW_ISO,
    policyVersion: COMPETENCY_POLICY_VERSION,
    createdAt: NOW_ISO,
    ...overrides,
  };
}

describe("competencyEstimator (Phase 1B)", () => {
  beforeEach(() => {
    _resetLearnerModelApiFallbackForTests();
    _resetLearningEventBusForTests();
    useLearnerModelStore.getState().reset();
  });

  afterEach(() => {
    _resetLearnerModelApiFallbackForTests();
    _resetLearningEventBusForTests();
    useLearnerModelStore.getState().reset();
  });

  it("returns explicit unknown with estimate=null when a dimension has 0 evidence", () => {
    const profile = projectConceptProfile("concept-empty", [], null, NOW_ISO, {
      conceptName: "Bayes Theorem",
    });

    expect(profile.conceptId).toBe("concept-empty");
    expect(profile.conceptName).toBe("Bayes Theorem");
    expect(profile.selfDeclaration).toBeNull();

    for (const dim of ALL_COMPETENCY_DIMENSIONS) {
      const proj = profile.dimensions[dim];
      expect(proj.dimension).toBe(dim);
      expect(proj.status).toBe("unknown");
      expect(proj.estimate).toBeNull();
      expect(proj.confidence).toBe(0);
      expect(proj.effectiveWeight).toBe(0);
      expect(proj.uncertaintyReasons).toEqual(["no_evidence"]);
    }
  });

  it("distinguishes unknown vs insufficient_evidence with explicit uncertaintyReasons", () => {
    const weakRecord = makeRecord({
      id: "ev-weak",
      dimension: "application",
      sourceKind: "practice_attempt",
      observedScore: 0.85,
      baseWeight: 0.5,
      occurredAt: NOW_ISO,
    });

    const proj = estimateDimensionCompetency([weakRecord], NOW_ISO, {
      dimension: "application",
    });

    expect(proj.status).toBe("insufficient_evidence");
    expect(proj.estimate).toBeCloseTo(0.85, 5);
    expect(proj.effectiveWeight).toBeCloseTo(0.5, 5);
    expect(proj.uncertaintyReasons).toContain("low_effective_weight");
    expect(proj.uncertaintyReasons).toContain("single_evidence_group");
  });

  it("ensures reading_progress and extract_created ONLY update exposure and NEVER inflate comprehension/retention/application/transfer", () => {
    const evidence: CompetencyEvidenceRecord[] = [
      makeRecord({
        id: "exp-1",
        dimension: "exposure",
        sourceKind: "reading_progress",
        observedScore: 1.0,
        baseWeight: 1.0,
      }),
      makeRecord({
        id: "exp-2",
        dimension: "exposure",
        sourceKind: "extract_created",
        evidenceGroupId: "group-2",
        observedScore: 0.9,
        baseWeight: 0.8,
      }),
      // Even if a rogue record attempts to attach reading_progress to comprehension,
      // the estimator strictly ignores it.
      makeRecord({
        id: "rogue-comp",
        dimension: "comprehension",
        sourceKind: "reading_progress",
        observedScore: 1.0,
        baseWeight: 1.5,
      }),
      makeRecord({
        id: "rogue-ret",
        dimension: "retention",
        sourceKind: "extract_created",
        observedScore: 1.0,
        baseWeight: 1.5,
      }),
    ];

    const profile = projectConceptProfile("concept-bayes", evidence, null, NOW_ISO);

    expect(profile.dimensions.exposure.status).not.toBe("unknown");
    expect(profile.dimensions.exposure.estimate).toBeGreaterThan(0.9);
    expect(profile.dimensions.comprehension.status).toBe("unknown");
    expect(profile.dimensions.comprehension.estimate).toBeNull();
    expect(profile.dimensions.retention.status).toBe("unknown");
    expect(profile.dimensions.retention.estimate).toBeNull();
    expect(profile.dimensions.application.status).toBe("unknown");
    expect(profile.dimensions.transfer.status).toBe("unknown");
  });

  it("strictly excludes unverified AI chat / model-only evidence from demonstrated estimates", () => {
    const unverifiedRecords: CompetencyEvidenceRecord[] = [
      makeRecord({
        id: "ai-chat-1",
        dimension: "comprehension",
        sourceKind: "socratic_practice",
        evidenceGroupId: "chat-1",
        observedScore: 1.0,
        baseWeight: 1.5,
        isVerified: false,
        occurredAt: "2026-11-27T12:00:00.000Z",
      }),
      makeRecord({
        id: "ai-chat-2",
        dimension: "comprehension",
        sourceKind: "socratic_practice",
        evidenceGroupId: "chat-2",
        observedScore: 1.0,
        baseWeight: 1.5,
        isVerified: false,
        occurredAt: NOW_ISO,
      }),
    ];

    const proj = estimateDimensionCompetency(unverifiedRecords, NOW_ISO, {
      dimension: "comprehension",
    });

    expect(proj.status).toBe("unknown");
    expect(proj.estimate).toBeNull();
    expect(proj.rawEvidenceCount).toBe(0);
  });

  it("applies correlated-card harmonic damping so 20 cards from 1 family <= 1.5x a single card and cannot reach demonstrated", () => {
    const singleCard = makeRecord({
      id: "card-0",
      dimension: "retention",
      sourceKind: "fsrs_review",
      cardFamilyId: "family-para-1",
      evidenceGroupId: "eg-0",
      observedScore: 1.0,
      baseWeight: 1.0,
      elapsedDays: 5,
      occurredAt: NOW_ISO,
    });

    const singleProj = estimateDimensionCompetency([singleCard], NOW_ISO, {
      dimension: "retention",
    });

    const twentyCorrelatedCards: CompetencyEvidenceRecord[] = Array.from({ length: 20 }, (_, i) =>
      makeRecord({
        id: `card-${i}`,
        dimension: "retention",
        sourceKind: "fsrs_review",
        cardFamilyId: "family-para-1",
        evidenceGroupId: `eg-${i}`,
        observedScore: 1.0,
        baseWeight: 1.0,
        elapsedDays: 5,
        occurredAt: new Date(Date.parse(NOW_ISO) - i * 60_000).toISOString(),
      }),
    );

    const twentyProj = estimateDimensionCompetency(twentyCorrelatedCards, NOW_ISO, {
      dimension: "retention",
    });

    expect(twentyProj.independentGroups).toBe(1);
    expect(twentyProj.effectiveWeight).toBeLessThanOrEqual(
      1.5 * singleProj.effectiveWeight + 1e-9,
    );
    expect(twentyProj.status).not.toBe("demonstrated");
    expect(twentyProj.uncertaintyReasons).toContain("single_evidence_group");
    expect(twentyProj.uncertaintyReasons).toContain("single_day_only");
  });

  it("heavily discounts same-day cramming reviews vs multi-day delayed FSRS retention", () => {
    expect(computeRetentionDelayDiscount("retention", "fsrs_review", 0.0)).toBeCloseTo(0.2, 5);
    expect(computeRetentionDelayDiscount("retention", "fsrs_review", 0.5)).toBeCloseTo(0.6, 5);
    expect(computeRetentionDelayDiscount("retention", "fsrs_review", 1.0)).toBeCloseTo(1.0, 5);
    expect(computeRetentionDelayDiscount("retention", "fsrs_review", 14.0)).toBeCloseTo(1.0, 5);

    const crammed = [
      makeRecord({
        id: "cram-1",
        dimension: "retention",
        sourceKind: "fsrs_review",
        evidenceGroupId: "g-1",
        observedScore: 1.0,
        baseWeight: 1.0,
        elapsedDays: 0.05,
        occurredAt: NOW_ISO,
      }),
      makeRecord({
        id: "cram-2",
        dimension: "retention",
        sourceKind: "fsrs_review",
        evidenceGroupId: "g-2",
        observedScore: 1.0,
        baseWeight: 1.0,
        elapsedDays: 0.1,
        occurredAt: NOW_ISO,
      }),
    ];

    const crammedProj = estimateDimensionCompetency(crammed, NOW_ISO, {
      dimension: "retention",
    });
    expect(crammedProj.status).toBe("insufficient_evidence");
    expect(crammedProj.effectiveWeight).toBeLessThan(0.75);

    // Delayed FSRS reviews across 3 independent groups and 3 distinct days reach demonstrated
    const delayed = [
      makeRecord({
        id: "del-1",
        dimension: "retention",
        sourceKind: "fsrs_review",
        evidenceGroupId: "g-1",
        observedScore: 0.95,
        baseWeight: 1.0,
        elapsedDays: 3,
        occurredAt: "2026-11-20T12:00:00.000Z",
      }),
      makeRecord({
        id: "del-2",
        dimension: "retention",
        sourceKind: "fsrs_review",
        evidenceGroupId: "g-2",
        observedScore: 0.9,
        baseWeight: 1.0,
        elapsedDays: 7,
        occurredAt: "2026-11-24T12:00:00.000Z",
      }),
      makeRecord({
        id: "del-3",
        dimension: "retention",
        sourceKind: "fsrs_review",
        evidenceGroupId: "g-3",
        observedScore: 0.95,
        baseWeight: 1.0,
        elapsedDays: 14,
        occurredAt: NOW_ISO,
      }),
    ];

    const delayedProj = estimateDimensionCompetency(delayed, NOW_ISO, {
      dimension: "retention",
    });
    expect(delayedProj.status).toBe("demonstrated");
    expect(delayedProj.estimate).toBeGreaterThanOrEqual(0.9);
    expect(delayedProj.confidence).toBeGreaterThanOrEqual(0.6);
    expect(delayedProj.independentGroups).toBe(3);
    expect(delayedProj.distinctDays).toBe(3);
  });

  it("applies hint discounting with 0.25 floor and dimension-specific recency decay with 0.15 floor", () => {
    expect(computeHintDiscount(0)).toBe(1.0);
    expect(computeHintDiscount(1)).toBe(0.75);
    expect(computeHintDiscount(2)).toBe(0.5);
    expect(computeHintDiscount(3)).toBe(0.25);
    expect(computeHintDiscount(8)).toBe(0.25);

    expect(computeRecencyDecay("retention", 0)).toBe(1.0);
    expect(computeRecencyDecay("retention", DIMENSION_HALF_LIFE_DAYS.retention)).toBeCloseTo(
      0.5,
      5,
    );
    expect(computeRecencyDecay("transfer", DIMENSION_HALF_LIFE_DAYS.transfer)).toBeCloseTo(
      0.5,
      5,
    );
    expect(computeRecencyDecay("retention", 1_000)).toBe(0.15);

    const staleHinted = makeRecord({
      id: "stale-1",
      dimension: "comprehension",
      sourceKind: "guided_check",
      observedScore: 0.9,
      baseWeight: 1.0,
      hintLevel: 2,
      occurredAt: "2026-01-01T12:00:00.000Z", // > 120d ago
    });

    const proj = estimateDimensionCompetency([staleHinted], NOW_ISO, {
      dimension: "comprehension",
    });
    expect(proj.uncertaintyReasons).toContain("stale_evidence");
    expect(proj.effectiveWeight).toBeLessThan(0.25);
  });

  it("recomputes accurately when evidence is invalidated", async () => {
    const ev1 = await recordCompetencyEvidence({
      conceptId: "c-calc",
      dimension: "application",
      sourceKind: "exam_grade",
      sourceEventId: "le-exam-1",
      sourceRecordId: "grade-1",
      evidenceGroupId: "exam-1",
      observedScore: 0.95,
      baseWeight: 1.5,
      occurredAt: "2026-11-26T12:00:00.000Z",
    });
    await recordCompetencyEvidence({
      conceptId: "c-calc",
      dimension: "application",
      sourceKind: "exam_grade",
      sourceEventId: "le-exam-2",
      sourceRecordId: "grade-2",
      evidenceGroupId: "exam-2",
      observedScore: 0.9,
      baseWeight: 1.5,
      occurredAt: NOW_ISO,
    });

    const before = await getConceptCompetencyProfile("c-calc", { nowIso: NOW_ISO });
    expect(before.dimensions.application.status).toBe("demonstrated");

    const inv = await invalidateCompetencyEvidence({
      evidenceIds: [ev1.id],
      invalidatedByEventId: "le-invalidate-1",
    });
    expect(inv.invalidatedCount).toBe(1);
    expect(inv.affectedConceptIds).toEqual(["c-calc"]);

    const after = await getConceptCompetencyProfile("c-calc", { nowIso: NOW_ISO });
    expect(after.dimensions.application.rawEvidenceCount).toBe(1);
    expect(after.dimensions.application.independentGroups).toBe(1);
    expect(after.dimensions.application.status).not.toBe("demonstrated");

    const historyActive = await getConceptEvidenceHistory("c-calc");
    expect(historyActive).toHaveLength(1);
    const historyAll = await getConceptEvidenceHistory("c-calc", { includeInvalidated: true });
    expect(historyAll).toHaveLength(2);
  });

  it("keeps self-declaration strictly separate from demonstrated projections", async () => {
    const declaration: LearnerCompetencyDeclaration = {
      conceptId: "c-linear",
      declaredLevel: "confident",
      note: "Took this in undergrad",
      updatedAt: NOW_ISO,
    };

    const profile = projectConceptProfile("c-linear", [], declaration, NOW_ISO);

    expect(profile.selfDeclaration?.declaredLevel).toBe("confident");
    expect(profile.selfDeclaration?.note).toBe("Took this in undergrad");
    for (const dim of ALL_COMPETENCY_DIMENSIONS) {
      expect(profile.dimensions[dim].status).toBe("unknown");
      expect(profile.dimensions[dim].estimate).toBeNull();
    }

    await setLearnerCompetencyDeclaration("c-linear", "needs_refresh", "Forgot proofs");
    const apiProfile = await getConceptCompetencyProfile("c-linear", { nowIso: NOW_ISO });
    expect(apiProfile.selfDeclaration?.declaredLevel).toBe("needs_refresh");
    expect(apiProfile.dimensions.comprehension.status).toBe("unknown");
  });

  it("filters out isAiExcluded evidence when excludeAiExcluded / aiContext is enabled", async () => {
    await recordCompetencyEvidence({
      conceptId: "c-privacy",
      dimension: "transfer",
      sourceKind: "exam_grade",
      sourceRecordId: "private-1",
      evidenceGroupId: "priv-g1",
      observedScore: 1.0,
      baseWeight: 1.5,
      isLocalOnly: true,
      isAiExcluded: true,
      occurredAt: "2026-11-25T12:00:00.000Z",
    });
    await recordCompetencyEvidence({
      conceptId: "c-privacy",
      dimension: "transfer",
      sourceKind: "exam_grade",
      sourceRecordId: "public-1",
      evidenceGroupId: "pub-g1",
      observedScore: 0.4,
      baseWeight: 1.0,
      isLocalOnly: false,
      isAiExcluded: false,
      occurredAt: NOW_ISO,
    });

    const localProfile = await getConceptCompetencyProfile("c-privacy", {
      aiContext: false,
      nowIso: NOW_ISO,
    });
    expect(localProfile.containsLocalOnlyEvidence).toBe(true);
    expect(localProfile.containsAiExcludedEvidence).toBe(true);
    expect(localProfile.dimensions.transfer.rawEvidenceCount).toBe(2);
    expect(localProfile.dimensions.transfer.estimate).toBeGreaterThan(0.7);

    const aiProfile = await getConceptCompetencyProfile("c-privacy", {
      aiContext: true,
      nowIso: NOW_ISO,
    });
    expect(aiProfile.containsAiExcludedEvidence).toBe(false);
    expect(aiProfile.containsLocalOnlyEvidence).toBe(false);
    expect(aiProfile.dimensions.transfer.rawEvidenceCount).toBe(1);
    expect(aiProfile.dimensions.transfer.estimate).toBeCloseTo(0.4, 5);
    expect(aiProfile.dimensions.transfer.status).toBe("needs_attention");
  });

  it("invalidates cached profiles in learnerModelStore when learningEventBus emits relevant events", async () => {
    const store = useLearnerModelStore.getState();
    const unsub = store.connectLearningEventBus();

    await store.loadConceptProfile("c-live");
    expect(useLearnerModelStore.getState().profilesByConceptId["c-live"]).toBeDefined();
    expect(useLearnerModelStore.getState().staleConceptIds["c-live"]).toBeUndefined();

    emitLearningEvent({
      idempotencyKey: "grade-live-1",
      eventType: "assessment_graded",
      surface: "exam",
      entityKind: "concept",
      entityId: "c-live",
      payload: { conceptId: "c-live", score: 0.85 },
    });

    // Wait a microtask for async refresh triggered by the bus listener
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(useLearnerModelStore.getState().highWaterSeq).toBeGreaterThanOrEqual(1);

    unsub();
  });
});
