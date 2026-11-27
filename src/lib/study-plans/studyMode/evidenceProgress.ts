import type {
  ConceptMasterySummary,
  KnowledgeGapView,
  MasteryEvidenceLevel,
  UncertaintyReason,
} from "../../../types/learningEvidence";
import type { StudyModeSessionDuration, StudyModeViewTab } from "../../../types/studyMode";
import type { PracticeEvaluationResult } from "./practiceEngine";

export type ConceptProgressStatus =
  | "not-assessed"
  | "insufficient-evidence"
  | "needs-attention"
  | "developing"
  | "demonstrated-consistently";

export interface ConceptProgressBreakdown {
  conceptId: string;
  conceptLabel: string;
  status: ConceptProgressStatus;
  observedMean: number | null;
  evidenceCount: number;
  uncertaintyReasons: UncertaintyReason[];
  misconceptions: string[];
  hasRetentionData: boolean;
}

export interface RecommendedNextSession {
  title: string;
  reason: string;
  estimatedMinutes: StudyModeSessionDuration;
  targetTab: StudyModeViewTab;
  actionKind: "remediate_misconception" | "assess_untested" | "deepen_practice" | "spaced_review";
  conceptId?: string;
}

export interface StudyProgressSnapshot {
  exposure: {
    supplementsViewed: number;
    conceptsTouched: number;
  };
  understanding: {
    label: string;
    assessedCount: number;
    demonstratedCount: number;
    needsPracticeCount: number;
    insufficientEvidence: boolean;
  };
  retention: {
    label: string;
    trackedConcepts: number;
    hasFsrsEvidence: boolean;
  };
  concepts: ConceptProgressBreakdown[];
  misconceptions: string[];
  recommendedNext: RecommendedNextSession;
}

function mapEvidenceLevel(level: MasteryEvidenceLevel): ConceptProgressStatus {
  return level;
}

/**
 * Computes an honest, evidence-only Study Progress snapshot distinguishing
 * Exposure, Understanding, and Retention. Never fabricates mastery percentages.
 */
export function computeStudyProgressSnapshot(input: {
  scopeConceptId: string;
  scopeConceptLabel: string;
  supplementsViewed: number;
  masterySummaries: ConceptMasterySummary[];
  gaps: KnowledgeGapView[];
  sessionEvaluations: PracticeEvaluationResult[];
  fsrsReviewedCount?: number;
  preferredDurationMin?: StudyModeSessionDuration;
}): StudyProgressSnapshot {
  const byConcept = new Map<string, ConceptProgressBreakdown>();

  // 1. Seed from unified backend learning_evidence summaries
  for (const summary of Array.isArray(input.masterySummaries) ? input.masterySummaries : []) {
    byConcept.set(summary.conceptId, {
      conceptId: summary.conceptId,
      conceptLabel:
        summary.conceptId === input.scopeConceptId ? input.scopeConceptLabel : summary.conceptId,
      status: mapEvidenceLevel(summary.level),
      observedMean: summary.observedMean,
      evidenceCount: summary.evidenceIds.length,
      uncertaintyReasons: [...summary.uncertainty],
      misconceptions: [],
      hasRetentionData: summary.distinctDays >= 2,
    });
  }

  // 2. Fold in active knowledge gaps & misconceptions
  for (const gap of Array.isArray(input.gaps) ? input.gaps : []) {
    if (gap.status !== "active") continue;
    const existing = byConcept.get(gap.conceptId) ?? {
      conceptId: gap.conceptId,
      conceptLabel: gap.conceptName || gap.conceptId,
      status: "needs-attention" as ConceptProgressStatus,
      observedMean: gap.demonstrated?.observedMean ?? null,
      evidenceCount: gap.evidence.length,
      uncertaintyReasons: gap.demonstrated?.uncertainty ?? [],
      misconceptions: [],
      hasRetentionData: false,
    };
    existing.conceptLabel = gap.conceptName || existing.conceptLabel;
    if (gap.kind === "repeatedly_failed" || gap.kind === "weak_prerequisite") {
      existing.status = "needs-attention";
    }
    for (const ev of gap.evidence) {
      if (ev.description && !existing.misconceptions.includes(ev.description)) {
        existing.misconceptions.push(ev.description);
      }
    }
    byConcept.set(gap.conceptId, existing);
  }

  // 3. Merge current-session formative evaluations (without overwriting richer backend history)
  const sessionByConcept = new Map<string, PracticeEvaluationResult[]>();
  for (const ev of input.sessionEvaluations) {
    const ids = ev.conceptIds.length > 0 ? ev.conceptIds : [input.scopeConceptId];
    for (const cid of ids) {
      const list = sessionByConcept.get(cid) ?? [];
      list.push(ev);
      sessionByConcept.set(cid, list);
    }
  }

  for (const [cid, evals] of sessionByConcept.entries()) {
    const existing = byConcept.get(cid) ?? {
      conceptId: cid,
      conceptLabel: cid === input.scopeConceptId ? input.scopeConceptLabel : cid,
      status: "insufficient-evidence" as ConceptProgressStatus,
      observedMean: null,
      evidenceCount: 0,
      uncertaintyReasons: [] as UncertaintyReason[],
      misconceptions: [] as string[],
      hasRetentionData: false,
    };

    const avg = evals.reduce((sum, e) => sum + e.score, 0) / evals.length;
    existing.evidenceCount += evals.length;
    existing.observedMean =
      existing.observedMean !== null ? (existing.observedMean + avg) / 2 : avg;

    const latest = evals[evals.length - 1];
    if (latest.outcome === "needs_review") {
      existing.status = "needs-attention";
    } else if (evals.length >= 2 && avg >= 0.8 && !latest.usedHint) {
      existing.status = "demonstrated-consistently";
    } else if (avg >= 0.5) {
      existing.status = "developing";
    } else {
      existing.status = "needs-attention";
    }

    if (evals.length === 1 && !existing.uncertaintyReasons.includes("one-independent-session")) {
      existing.uncertaintyReasons.push("one-independent-session");
    }
    if (evals.some((e) => e.usedHint) && !existing.uncertaintyReasons.includes("hints-used")) {
      existing.uncertaintyReasons.push("hints-used");
    }
    for (const e of evals) {
      if (e.misconceptionDetected && !existing.misconceptions.includes(e.misconceptionDetected)) {
        existing.misconceptions.push(e.misconceptionDetected);
      }
    }

    byConcept.set(cid, existing);
  }

  // Ensure current scope concept is represented explicitly as "not-assessed" if no evidence exists
  if (!byConcept.has(input.scopeConceptId)) {
    byConcept.set(input.scopeConceptId, {
      conceptId: input.scopeConceptId,
      conceptLabel: input.scopeConceptLabel,
      status: "not-assessed",
      observedMean: null,
      evidenceCount: 0,
      uncertaintyReasons: ["no-assessment"],
      misconceptions: [],
      hasRetentionData: false,
    });
  }

  const concepts = Array.from(byConcept.values());
  const assessed = concepts.filter(
    (c) => c.status !== "not-assessed" && c.status !== "insufficient-evidence"
  );
  const demonstratedCount = concepts.filter((c) => c.status === "demonstrated-consistently").length;
  const needsPracticeCount = concepts.filter((c) => c.status === "needs-attention").length;
  const allMisconceptions = Array.from(
    new Set(concepts.flatMap((c) => c.misconceptions).filter(Boolean))
  );

  const fsrsCount =
    input.fsrsReviewedCount ?? concepts.filter((c) => c.hasRetentionData).length;
  const hasFsrsEvidence = fsrsCount > 0;

  const preferredDuration: StudyModeSessionDuration = input.preferredDurationMin ?? 15;

  let recommendedNext: RecommendedNextSession;
  const firstWeak = concepts.find((c) => c.status === "needs-attention");
  const firstUnassessed = concepts.find(
    (c) => c.status === "not-assessed" || c.status === "insufficient-evidence"
  );

  if (firstWeak) {
    recommendedNext = {
      title: `Remediate: ${firstWeak.conceptLabel}`,
      reason:
        firstWeak.misconceptions[0] ??
        "Recent evidence indicates this concept needs targeted re-explanation and practice.",
      estimatedMinutes: preferredDuration === 30 ? 15 : 5,
      targetTab: "practice",
      actionKind: "remediate_misconception",
      conceptId: firstWeak.conceptId,
    };
  } else if (firstUnassessed) {
    recommendedNext = {
      title: `Assess understanding: ${firstUnassessed.conceptLabel}`,
      reason:
        "You have exposure to this scope, but no active recall evidence yet. Run a quick check.",
      estimatedMinutes: 5,
      targetTab: "practice",
      actionKind: "assess_untested",
      conceptId: firstUnassessed.conceptId,
    };
  } else if (!hasFsrsEvidence) {
    recommendedNext = {
      title: "Schedule spaced retention checks",
      reason:
        "Understanding was demonstrated in-session, but multi-day FSRS retention has not been verified yet.",
      estimatedMinutes: preferredDuration,
      targetTab: "practice",
      actionKind: "spaced_review",
    };
  } else {
    recommendedNext = {
      title: "Deepen mastery with challenging application",
      reason: "Core concepts look solid—try higher-difficulty scenario or synthesis checks.",
      estimatedMinutes: preferredDuration,
      targetTab: "practice",
      actionKind: "deepen_practice",
    };
  }

  return {
    exposure: {
      supplementsViewed: input.supplementsViewed,
      conceptsTouched: concepts.length,
    },
    understanding: {
      label:
        assessed.length === 0
          ? "Not assessed"
          : `${demonstratedCount}/${assessed.length} demonstrated`,
      assessedCount: assessed.length,
      demonstratedCount,
      needsPracticeCount,
      insufficientEvidence: assessed.length === 0,
    },
    retention: {
      label: hasFsrsEvidence ? `${fsrsCount} tracked` : "Not assessed",
      trackedConcepts: fsrsCount,
      hasFsrsEvidence,
    },
    concepts,
    misconceptions: allMisconceptions,
    recommendedNext,
  };
}
