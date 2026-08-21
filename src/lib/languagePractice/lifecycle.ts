import type { PracticeAttempt, PracticeRecommendationPreview } from "./types";

/** A saved attempt can resume only when it still refers to the same occurrence. */
export function resumePracticeAttempt(
  attempt: PracticeAttempt | null | undefined,
  input: { sourceFingerprint?: string; promptText: string },
): PracticeAttempt | null {
  if (!attempt || attempt.promptText !== input.promptText) return null;
  if (input.sourceFingerprint && attempt.source.sourceFingerprint !== input.sourceFingerprint) return null;
  return attempt;
}

/** Exiting a dirty practice surface requires an explicit discard decision. */
export function shouldConfirmPracticeDiscard(attempt: PracticeAttempt | null): boolean {
  return Boolean(attempt && (
    attempt.status === "recording" ||
    attempt.status === "submitted" ||
    Boolean(attempt.rawResponse?.trim()) ||
    attempt.activeEvidenceAccepted
  ));
}

export function cancelPracticeAttempt(attempt: PracticeAttempt, now = Date.now()): PracticeAttempt {
  return { ...attempt, status: "cancelled", updatedAt: now };
}

export function recommendationPreview(candidate: {
  id: string;
  title: string;
  sourceType: string;
  sourceId: string;
  sourceFingerprint: string;
  explanation: readonly string[];
  score: number;
}): PracticeRecommendationPreview {
  return {
    candidateId: candidate.id,
    title: candidate.title,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceFingerprint: candidate.sourceFingerprint,
    explanation: [...candidate.explanation],
    score: candidate.score,
  };
}
