/**
 * Practice source resolution from language-host actions (change:
 * add-language-sentence-audio-alignment, task 2.3).
 *
 * A practice launch can carry an explicit original-media range
 * (`practiceSource`), derive one from the source anchor's locator
 * (mediaId/startMs/endMs), or fall back to the source's mediaId. This keeps
 * the shadowing/dictation/writing session contract media-aware without
 * requiring callers to know the details.
 */

import type { SourceAnchor } from "../../types/languageLexicon";

export interface PracticeSourceLike {
  sourceType?: string;
  sourceId?: string;
  sourceAnchor?: SourceAnchor;
  sourceFingerprint?: string;
  mediaId?: string;
  startMs?: number;
  endMs?: number;
}

export interface LanguagePracticeActionLike {
  source: { source?: { sourceType?: string; mediaId?: string }; contentId?: string; contentFingerprint?: string };
  sourceAnchor?: SourceAnchor;
  practiceSource?: { mediaId: string; startMs: number; endMs: number };
}

export function languagePracticeSourceFromAction(request: LanguagePracticeActionLike): PracticeSourceLike {
  const locator = request.sourceAnchor?.locator;
  const locatorRecord = locator && typeof locator === "object" ? locator as Record<string, unknown> : null;
  const explicit = request.practiceSource;
  const mediaId = explicit?.mediaId ?? (typeof locatorRecord?.mediaId === "string" ? locatorRecord.mediaId : request.source.source?.mediaId);
  const startMs = explicit?.startMs ?? (typeof locatorRecord?.startMs === "number" ? locatorRecord.startMs : undefined);
  const endMs = explicit?.endMs ?? (typeof locatorRecord?.endMs === "number" ? locatorRecord.endMs : undefined);
  return {
    sourceType: request.source.source?.sourceType,
    sourceId: request.source.contentId,
    sourceAnchor: request.sourceAnchor,
    sourceFingerprint: request.source.contentFingerprint,
    mediaId,
    startMs,
    endMs,
  };
}
