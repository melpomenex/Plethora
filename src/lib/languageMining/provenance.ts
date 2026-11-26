/**
 * Mining → Flashcard Studio provenance mapping (change:
 * add-language-sentence-audio-alignment, task 2.3).
 *
 * Turns a language-mining draft payload into the language provenance shape
 * Flashcard Studio persists with the created card. The original-media range
 * is carried explicitly (mediaRange) or reconstructed from the payload's
 * mediaId/mediaStartMs/mediaEndMs fields so audio/video-anchored cards keep
 * their media reference.
 */

export interface MiningProvenanceForFlashcard {
  sourceAnchor?: unknown;
  sourceFingerprint?: string;
  origin?: string;
  mediaId?: string;
  mediaStartMs?: number;
  mediaEndMs?: number;
  mediaRange?: { mediaId: string; startMs: number; endMs: number };
}

export interface MiningDraftPayloadLike {
  sourceAnchor?: unknown;
  sourceFingerprint?: string;
  mediaId?: string;
  mediaStartMs?: number;
  mediaEndMs?: number;
  mediaRange?: { mediaId: string; startMs: number; endMs: number };
}

export function miningPayloadToFlashcardProvenance(
  payload: MiningDraftPayloadLike
): MiningProvenanceForFlashcard {
  const mediaRange =
    payload.mediaRange
    ?? (payload.mediaId
      && typeof payload.mediaStartMs === "number"
      && typeof payload.mediaEndMs === "number"
      ? {
          mediaId: payload.mediaId,
          startMs: payload.mediaStartMs,
          endMs: payload.mediaEndMs,
        }
      : undefined);
  return {
    sourceAnchor: payload.sourceAnchor,
    sourceFingerprint: payload.sourceFingerprint,
    origin: "mining",
    ...(payload.mediaId ? { mediaId: payload.mediaId } : {}),
    ...(typeof payload.mediaStartMs === "number" ? { mediaStartMs: payload.mediaStartMs } : {}),
    ...(typeof payload.mediaEndMs === "number" ? { mediaEndMs: payload.mediaEndMs } : {}),
    ...(mediaRange ? { mediaRange } : {}),
  };
}
