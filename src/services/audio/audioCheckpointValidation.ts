import type { AudioCheckpoint, AudioSourceKey, SavedAudioSession } from "../../types/audioEdition";

const opaqueId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !value.includes("\0");
function fieldsOnly(value: object, fields: string[]): boolean { return Object.keys(value).every(key => fields.includes(key)); }

export function validateAudioSourceKey(key: AudioSourceKey): void {
  if (!key || !fieldsOnly(key, ["profileKey", "kind", "sourceId"]) || !opaqueId(key.profileKey) || !opaqueId(key.sourceId) || !["audiobook", "podcast", "audio_edition", "recording"].includes(key.kind)) throw new Error("Invalid audio source identity");
}

export function validateAudioCheckpoint(value: AudioCheckpoint): void {
  if (!value || typeof value !== "object") throw new Error("Malformed audio checkpoint");
  if (!fieldsOnly(value, ["schemaVersion", "sourceKey", "ownerEpoch", "checkpointSequence", "sessionId", "mediaRevision", "partIndex", "timeInPart", "positionSec", "durationSec", "playbackRate", "updatedAt"])) throw new Error("Unexpected audio checkpoint fields");
  validateAudioSourceKey(value.sourceKey);
  const time = (number: unknown): boolean => typeof number === "number" && Number.isFinite(number) && number >= 0;
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.checkpointSequence) || value.checkpointSequence < 0 || !Number.isInteger(value.partIndex) || value.partIndex < 0 || value.partIndex > 100_000 || !time(value.timeInPart) || (value.positionSec !== null && !time(value.positionSec)) || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 || (value.durationSec !== null && (!time(value.durationSec) || (value.positionSec !== null && value.positionSec > value.durationSec))) || !Number.isFinite(value.playbackRate) || value.playbackRate < 0.5 || value.playbackRate > 3 || !opaqueId(value.ownerEpoch) || !opaqueId(value.sessionId) || typeof value.mediaRevision !== "string" || value.mediaRevision.length > 4096) throw new Error("Malformed audio checkpoint");
}

export function validateSavedAudioSession(value: SavedAudioSession, profileKey: string): void {
  if (!value || !fieldsOnly(value, ["schemaVersion", "current", "queue", "playbackRate", "volume", "sleepDeadlineMs", "updatedAt"]) || value.schemaVersion !== 1 || !Array.isArray(value.queue) || value.queue.length > 256 || !Number.isFinite(value.playbackRate) || value.playbackRate < 0.5 || value.playbackRate > 3 || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1 || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 || (value.sleepDeadlineMs !== null && (!Number.isSafeInteger(value.sleepDeadlineMs) || value.sleepDeadlineMs < 0))) throw new Error("Malformed audio recovery session");
  for (const key of [...value.queue, ...(value.current ? [value.current] : [])]) {
    validateAudioSourceKey(key);
    if (key.profileKey !== profileKey) throw new Error("Audio recovery profile mismatch");
  }
}
