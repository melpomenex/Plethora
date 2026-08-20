import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";
import type { PracticeAttempt } from "../lib/languagePractice";

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: Call = (command, args) => isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

export function upsertLanguagePracticeAttempt(attempt: PracticeAttempt) {
  return call<PracticeAttempt>("upsert_language_practice_attempt", { attempt: {
    id: attempt.id,
    profileId: attempt.profileId,
    mode: attempt.mode,
    sourceType: attempt.source.sourceType,
    sourceId: attempt.source.sourceId,
    sourceAnchor: attempt.source.sourceAnchor,
    sourceFingerprint: attempt.source.sourceFingerprint,
    promptText: attempt.promptText,
    rawResponse: attempt.rawResponse,
    normalizedResponse: attempt.normalizedResponse,
    comparison: attempt.comparison,
    providerId: attempt.providerId,
    providerVersion: attempt.providerVersion,
    privacyMode: attempt.recordingPolicy.privacy,
    retentionExpiresAt: attempt.recordingPolicy.retentionExpiresAt,
    activeEvidenceAccepted: attempt.activeEvidenceAccepted,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  } });
}

export function listLanguagePracticeAttempts(profileId: string, options: { sourceId?: string; limit?: number } = {}) {
  return call<PracticeAttempt[]>("list_language_practice_attempts", { profileId, sourceId: options.sourceId, limit: options.limit ?? 50 });
}

export function deleteLanguagePracticeAttempt(profileId: string, id: string) {
  return call<boolean>("delete_language_practice_attempt", { profileId, id });
}
