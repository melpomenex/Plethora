import type { PracticeAttempt } from "./types";

export function deleteExpiredPracticeAttempts(attempts: readonly PracticeAttempt[], now = Date.now()): PracticeAttempt[] {
  return attempts.filter((attempt) => attempt.recordingPolicy.retentionExpiresAt === undefined || attempt.recordingPolicy.retentionExpiresAt > now);
}

export function exportPracticeAttempts(attempts: readonly PracticeAttempt[], includeRecordings: boolean): PracticeAttempt[] {
  return attempts.map((attempt) => includeRecordings ? { ...attempt } : { ...attempt, rawResponse: undefined });
}
