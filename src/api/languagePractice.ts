import { browserInvoke } from "../lib/browser-backend";
import { invokeCommand, isTauri } from "../lib/tauri";
import type { PracticeAttempt } from "../lib/languagePractice";

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const call: Call = (command, args) => isTauri() ? invokeCommand(command, args) : browserInvoke(command, args);

interface PersistedPracticeAttempt {
  id: string;
  profileId: string;
  mode: PracticeAttempt["mode"];
  status: PracticeAttempt["status"];
  sourceType?: string;
  sourceId?: string;
  sourceAnchor?: PracticeAttempt["source"]["sourceAnchor"];
  sourceFingerprint?: string;
  promptText: string;
  rawResponse?: string;
  normalizedResponse?: string;
  comparison?: PracticeAttempt["comparison"];
  providerId?: string;
  providerVersion?: string;
  privacyMode: PracticeAttempt["recordingPolicy"]["privacy"];
  retentionExpiresAt?: number;
  activeEvidenceAccepted: boolean;
  revealed: boolean;
  mediaId?: string;
  startMs?: number;
  endMs?: number;
  createdAt: number;
  updatedAt: number;
}

function fromPersisted(row: PersistedPracticeAttempt): PracticeAttempt {
  return {
    id: row.id,
    profileId: row.profileId,
    mode: row.mode,
    source: { sourceType: row.sourceType, sourceId: row.sourceId, sourceAnchor: row.sourceAnchor, sourceFingerprint: row.sourceFingerprint, mediaId: row.mediaId, startMs: row.startMs, endMs: row.endMs },
    promptText: row.promptText,
    rawResponse: row.rawResponse,
    normalizedResponse: row.normalizedResponse,
    comparison: row.comparison,
    status: row.status,
    recordingPolicy: { allowMicrophone: false, persistRecording: false, privacy: row.privacyMode, retentionExpiresAt: row.retentionExpiresAt },
    providerId: row.providerId,
    providerVersion: row.providerVersion,
    activeEvidenceAccepted: row.activeEvidenceAccepted,
    revealed: row.revealed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function upsertLanguagePracticeAttempt(attempt: PracticeAttempt) {
  return call<PersistedPracticeAttempt>("upsert_language_practice_attempt", { attempt: {
    id: attempt.id,
    profileId: attempt.profileId,
    mode: attempt.mode,
    status: attempt.status,
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
    revealed: Boolean(attempt.revealed),
    mediaId: attempt.source.mediaId,
    startMs: attempt.source.startMs,
    endMs: attempt.source.endMs,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  } }).then(fromPersisted);
}

export function getLanguagePracticeAttempt(profileId: string, id: string) {
  return call<PersistedPracticeAttempt>("get_language_practice_attempt", { profileId, id }).then(fromPersisted);
}

export function listLanguagePracticeAttempts(
  profileId: string,
  options: { sourceId?: string; mode?: PracticeAttempt["mode"]; status?: PracticeAttempt["status"]; offset?: number; limit?: number } = {},
) {
  return call<PersistedPracticeAttempt[]>("list_language_practice_attempts", {
    profileId,
    sourceId: options.sourceId,
    mode: options.mode,
    status: options.status,
    offset: options.offset ?? 0,
    limit: options.limit ?? 50,
  }).then((rows) => rows.map(fromPersisted));
}

export function importLanguagePracticeAttempts(profileId: string, attempts: PracticeAttempt[]) {
  return call<number>("import_language_practice_attempts", {
    profileId,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      profileId,
      mode: attempt.mode,
      status: attempt.status,
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
      revealed: Boolean(attempt.revealed),
      mediaId: attempt.source.mediaId,
      startMs: attempt.source.startMs,
      endMs: attempt.source.endMs,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    })),
  });
}

export function deleteLanguagePracticeAttempt(profileId: string, id: string) {
  return call<boolean>("delete_language_practice_attempt", { profileId, id });
}

export function purgeExpiredLanguagePracticeAttempts(profileId: string, now = Math.floor(Date.now() / 1000)) {
  const normalizedNow = now > 10_000_000_000 ? Math.floor(now / 1000) : now;
  return call<number>("purge_expired_language_practice_attempts", { profileId, now: normalizedNow });
}

export function exportLanguagePracticeAttempts(profileId: string) {
  return call<PersistedPracticeAttempt[]>("export_language_practice_attempts", { profileId }).then((rows) => rows.map(fromPersisted));
}
