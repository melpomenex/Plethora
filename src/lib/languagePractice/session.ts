import { comparePracticeResponse } from "./compare";
import type { PracticeAttempt, PracticeMode, PracticeSource } from "./types";

export function createPracticeAttempt(input: { id: string; profileId: string; mode: PracticeMode; source: PracticeSource; promptText: string; now?: number }): PracticeAttempt {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    profileId: input.profileId,
    mode: input.mode,
    source: input.source,
    promptText: input.promptText,
    status: "prompted",
    recordingPolicy: { allowMicrophone: false, persistRecording: false, privacy: "local-only" },
    activeEvidenceAccepted: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Submission is idempotent: a late duplicate cannot replace an accepted result. */
export function submitPracticeAttempt(attempt: PracticeAttempt, rawResponse: string, now = Date.now()): PracticeAttempt {
  if (attempt.status === "submitted" && attempt.comparison) return attempt;
  const comparison = { ...comparePracticeResponse(attempt.promptText, rawResponse), assisted: Boolean(attempt.revealed) };
  return { ...attempt, rawResponse, normalizedResponse: comparison.normalizedActual, comparison, status: "submitted", updatedAt: now };
}

export function revealPracticeAttempt(attempt: PracticeAttempt, now = Date.now()): PracticeAttempt {
  return { ...attempt, revealed: true, updatedAt: now };
}

export function acceptPracticeEvidence(attempt: PracticeAttempt, now = Date.now()): PracticeAttempt {
  if (attempt.status !== "submitted" || attempt.comparison?.assisted || attempt.comparison?.uncertain) return attempt;
  return { ...attempt, activeEvidenceAccepted: true, updatedAt: now };
}

export function isPracticeAttemptCurrent(attempt: PracticeAttempt, sourceFingerprint?: string): boolean {
  return !sourceFingerprint || attempt.source.sourceFingerprint === sourceFingerprint;
}
