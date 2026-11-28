/**
 * Large-library benchmark for the heterogeneous DAQE learning orchestrator.
 *
 * Exercises deduplication, normalized factor scoring, deterministic sorting,
 * time-budget packing, interleaving, and overload analysis over 2,000 candidates
 * spanning 5 active learning goals and all 8 provider kinds.
 *
 * Determinism: built once from `seededRandom(42)`, never `Math.random()`, never
 * sized from the clock, and folds results into a module-level `sink`.
 */
import { bench } from "vitest";
import { seededRandom } from "../../test/bench-support";
import {
  CANDIDATE_PROVIDER_KINDS,
  orchestrateLearningSession,
  type CandidateProviderKind,
  type DaqeActivityCandidate,
  type GoalDeadlineContext,
  type LearningActivityKind,
} from "./orchestrator";

const rng = seededRandom(42);

const CANDIDATE_COUNT = 2_000;
const GOAL_COUNT = 5;

const PROVIDER_TO_ACTIVITY: Record<CandidateProviderKind, LearningActivityKind> = {
  srs_due_pool: "srs_review",
  learning_goals: "study_workspace",
  guided_trails: "guided_reading",
  remediation: "remediation",
  exam_prep: "exam_attempt",
  smart_feeds: "exploration_feed",
  pinned: "pinned_item",
  continue_reading: "continue_reading",
};

const goals: GoalDeadlineContext[] = Array.from({ length: GOAL_COUNT }, (_, idx) => ({
  goalId: `goal-${idx + 1}`,
  title: `Learning Goal ${idx + 1}`,
  feasibilityStatus: idx === 0 ? "at_risk" : idx === 1 ? "tight" : "on_track",
  requiredDailyMinutes: 20 + idx * 10,
  remainingMinutes: 300 + idx * 120,
  daysRemaining: 14 + idx * 14,
}));

const candidates: DaqeActivityCandidate[] = Array.from({ length: CANDIDATE_COUNT }, (_, i) => {
  const providerKind = CANDIDATE_PROVIDER_KINDS[i % CANDIDATE_PROVIDER_KINDS.length];
  const activityKind = PROVIDER_TO_ACTIVITY[providerKind];
  const goalIndex = i % GOAL_COUNT;
  // Introduce ~10% multi-goal duplicate dedupeKeys to exercise canonical merging.
  const dedupeIndex = i % 10 === 0 && i > 0 ? i - 1 : i;
  const isSrs = providerKind === "srs_due_pool";
  const hasDue = isSrs || rng() > 0.7;

  return {
    id: `cand-${String(i).padStart(4, "0")}`,
    dedupeKey: `entity:${dedupeIndex}`,
    title: `Activity ${i}`,
    providerKind,
    activityKind,
    estimatedMinutes: 2 + Math.floor(rng() * 18),
    manualPriority: Math.round(rng() * 100) / 10,
    dueAt: hasDue
      ? new Date(Date.UTC(2026, 10, 28) - Math.floor(rng() * 10) * 86_400_000).toISOString()
      : null,
    retrievability: isSrs ? 0.3 + rng() * 0.65 : null,
    topicKey: `topic-${i % 32}`,
    goalReferences: [
      {
        goalId: goals[goalIndex].goalId,
        goalTitle: goals[goalIndex].title,
        feasibilityStatus: goals[goalIndex].feasibilityStatus,
      },
    ],
    isPinned: providerKind === "pinned",
    isNewMaterial: providerKind === "smart_feeds",
    isLocalOnly: i % 25 === 0,
    isAiExcluded: i % 40 === 0,
    signals: {
      srsUrgency: isSrs ? rng() : null,
      goalAlignment: rng() > 0.15 ? rng() : null,
      deadlinePressure: goalIndex < 2 ? rng() : null,
      knowledgeGap: rng() > 0.3 ? rng() : null,
      prerequisiteReadiness: rng() > 0.4 ? rng() : null,
      userPriority: rng(),
      interest: rng() > 0.2 ? rng() : null,
      durationFit: null,
      interleavePenalty: rng() > 0.5 ? rng() * 0.4 : null,
      frictionPenalty: rng() > 0.6 ? rng() * 0.3 : null,
    },
  };
});

let sink = 0;

/** The accumulated fold, readable so the benchmark work is provably not elided. */
export const readSink = () => sink;

bench("daqe/orchestrate-2000-candidates-balanced-30m", () => {
  const plan = orchestrateLearningSession({
    candidates,
    focusProfile: "balanced",
    timeBudgetMinutes: 30,
    rollingDailyStudyMinutes: 45,
    goals,
  });
  sink += plan.selected.length + plan.ranked.length + plan.packedMinutes;
});

bench("daqe/orchestrate-2000-candidates-exam-prep-60m", () => {
  const plan = orchestrateLearningSession({
    candidates,
    focusProfile: "exam_prep",
    timeBudgetMinutes: 60,
    rollingDailyStudyMinutes: 60,
    goals,
  });
  sink += plan.selected.length + plan.deferred.length + plan.deduplicatedCount;
});
