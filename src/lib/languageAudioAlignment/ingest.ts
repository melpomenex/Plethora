import type { AlignmentMethod, SentenceAudioAlignment } from "./types";

export interface RawAlignmentSegment {
  sentenceId: string;
  sourceId: string;
  sourceFingerprint: string;
  mediaId: string;
  mediaFingerprint: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  method: AlignmentMethod;
  providerId?: string;
  providerVersion?: string;
}

export function normalizeAlignmentSegment(raw: RawAlignmentSegment, now = Date.now()): SentenceAudioAlignment | null {
  if (!raw.sentenceId || !raw.sourceId || !raw.mediaId || !raw.sourceFingerprint || !raw.mediaFingerprint) return null;
  if (!Number.isFinite(raw.startMs) || !Number.isFinite(raw.endMs) || raw.endMs <= raw.startMs) return null;
  return {
    id: `alignment:${raw.sourceId}:${raw.sentenceId}:${raw.mediaId}:${raw.startMs}`,
    sourceType: "audio",
    sourceId: raw.sourceId,
    sentenceId: raw.sentenceId,
    sourceFingerprint: raw.sourceFingerprint,
    range: { mediaId: raw.mediaId, startMs: Math.max(0, Math.round(raw.startMs)), endMs: Math.max(0, Math.round(raw.endMs)), mediaFingerprint: raw.mediaFingerprint },
    confidence: Math.max(0, Math.min(1, raw.confidence ?? 0.5)),
    method: raw.method,
    status: "ready",
    providerId: raw.providerId,
    providerVersion: raw.providerVersion,
    updatedAt: now,
  };
}
