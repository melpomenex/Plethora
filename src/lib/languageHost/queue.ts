/**
 * Queue-surface language-host actions (change: add-learner-aware-ai-language-tutor,
 * task 2.3).
 *
 * The Queue scroll view renders documents/videos through `DocumentViewer`
 * (embedded), which mounts a `LanguageLearningHostProvider` with hostId
 * `document-reader:<documentId>`. This module builds the host-action detail for
 * a queue video-extract item so the mounted tutor host can pick it up: the
 * action targets that exact hostId and carries a media-range source anchor
 * covering the extract's clip.
 */

import type { LanguageHostActionDetail } from "./events";

export interface QueueVideoExtractTutorInput {
  extractId: string;
  documentId: string;
  title: string;
  transcriptText?: string;
  /** Clip start in seconds. */
  startTime: number;
  /** Clip end in seconds. */
  endTime: number;
  languageTag?: string;
  profileId?: string;
}

/**
 * Builds a tutor host-action for a queue video-extract clip. Returns null when
 * the item is not actionable (missing document or empty text).
 */
export function queueVideoExtractTutorRequest(
  input: QueueVideoExtractTutorInput,
): LanguageHostActionDetail | null {
  const text = (input.transcriptText ?? input.title).trim();
  if (!input.documentId || !text) return null;
  const startMs = Math.max(0, Math.round(input.startTime * 1000));
  const endMs = Math.max(startMs, Math.round(input.endTime * 1000));
  const sourceId = `video:${input.documentId}:${input.extractId}`;
  const anchor = {
    sourceType: "video" as const,
    mediaId: input.documentId,
    documentId: input.documentId,
    sourceId,
    locator: { segmentId: input.extractId, startMs, endMs },
  };
  return {
    action: "tutor",
    hostId: `document-reader:${input.documentId}`,
    source: {
      source: anchor,
      contentType: "media",
      contentId: input.documentId,
      text,
    },
    sourceAnchor: anchor,
    selectedText: text,
    profileId: input.profileId,
    languageTag: input.languageTag,
    practiceSource: { mediaId: input.documentId, startMs, endMs },
    origin: "queue",
  };
}
