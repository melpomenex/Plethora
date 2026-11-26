import { upsertLanguageAudioAlignment, type LanguageAudioAlignmentRecord } from "../../api/languageEcosystem";
import type { AlignmentResult } from "../../types/alignment";
import type { AlignedWord, PlethoraAlignmentMap } from "../ebookAudiobookAlignment/types";
import { AudioAlignmentRegistry } from "./resolver";
import type { SentenceAudioAlignment } from "./types";

export const sharedAudioAlignmentRegistry = new AudioAlignmentRegistry();

export function toLanguageAudioAlignmentRecord(
  alignment: SentenceAudioAlignment,
  mediaFingerprint = alignment.range.mediaFingerprint,
  now = Date.now(),
): LanguageAudioAlignmentRecord {
  const createdAt = alignment.updatedAt > 0 ? alignment.updatedAt : now;
  return {
    id: alignment.id,
    profileId: alignment.profileId,
    sourceType: alignment.sourceType,
    sourceId: alignment.sourceId,
    sentenceId: alignment.sentenceId,
    mediaId: alignment.range.mediaId,
    sourceFingerprint: alignment.sourceFingerprint,
    mediaFingerprint,
    startMs: alignment.range.startMs,
    endMs: alignment.range.endMs,
    confidence: alignment.confidence,
    method: alignment.method,
    status: alignment.status,
    providerId: alignment.providerId,
    providerVersion: alignment.providerVersion,
    error: alignment.error,
    createdAt,
    updatedAt: now,
  };
}

export function alignmentsFromWorkerResult(
  result: AlignmentResult,
  options: {
    profileId?: string;
    sourceFingerprint?: string;
    mediaFingerprint?: string;
    now?: number;
  } = {},
): SentenceAudioAlignment[] {
  const now = options.now ?? Date.now();
  const sourceFingerprint = options.sourceFingerprint || result.epubDocId;
  const mediaFingerprint = options.mediaFingerprint || result.audioDocId;
  const alignments: SentenceAudioAlignment[] = [];

  for (const mapping of result.segmentMappings) {
    const startMs = Math.max(0, Math.round(mapping.startTime * 1000));
    const endMs = Math.max(0, Math.round(mapping.endTime * 1000));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const sentenceId = mapping.cfi?.trim() || `seg-${mapping.segmentIndex}`;
    alignments.push({
      id: `alignment:${result.epubDocId}:${sentenceId}:${result.audioDocId}:${startMs}`,
      profileId: options.profileId,
      sourceType: "epub",
      sourceId: result.epubDocId,
      sentenceId,
      sourceAnchor: {
        sourceType: "epub",
        documentId: result.epubDocId,
        contentFingerprint: sourceFingerprint,
        locator: {
          cfi: mapping.cfi,
          chapterId: mapping.chapterId,
          segmentIndex: mapping.segmentIndex,
        },
      },
      sourceFingerprint,
      range: {
        mediaId: result.audioDocId,
        startMs,
        endMs,
        mediaFingerprint,
      },
      confidence: Math.max(0, Math.min(1, Number.isFinite(mapping.confidence) ? mapping.confidence : 0.5)),
      method: "audiobook-pair",
      status: "ready",
      providerId: "alignment-worker",
      providerVersion: "1",
      updatedAt: now,
    });
  }

  return alignments;
}

export function alignmentsFromEbookAlignmentMap(
  map: PlethoraAlignmentMap,
  options: {
    profileId?: string;
    now?: number;
  } = {},
): SentenceAudioAlignment[] {
  const now = options.now ?? Date.now();
  const sourceFingerprint = map.ebookContentHash || map.ebookDocId;
  const mediaFingerprint = map.audioContentHash || map.audioDocId;
  const alignments: SentenceAudioAlignment[] = [];

  for (const chapter of map.chapters) {
    const sentenceGroups = new Map<number, AlignedWord[]>();
    let fallbackIndex = 0;
    for (const word of chapter.words) {
      const key = typeof word.sentenceId === "number" ? word.sentenceId : fallbackIndex;
      const group = sentenceGroups.get(key);
      if (group) {
        group.push(word);
      } else {
        sentenceGroups.set(key, [word]);
      }
      if (typeof word.sentenceId !== "number" && /[.!?。！？]$/.test(word.text)) {
        fallbackIndex += 1;
      }
    }

    for (const [sentenceKey, words] of sentenceGroups.entries()) {
      if (words.length === 0) continue;
      let minStartMs = Number.POSITIVE_INFINITY;
      let maxEndMs = 0;
      let confidenceSum = 0;
      for (const word of words) {
        if (Number.isFinite(word.startMs)) minStartMs = Math.min(minStartMs, word.startMs);
        if (Number.isFinite(word.endMs)) maxEndMs = Math.max(maxEndMs, word.endMs);
        confidenceSum += Number.isFinite(word.confidence) ? word.confidence : 0.5;
      }
      const startMs = Math.max(0, Math.round(minStartMs));
      const endMs = Math.max(0, Math.round(maxEndMs));
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

      const firstLocator = words[0]?.locator;
      const sentenceId = `${chapter.ebookChapterHref}:s${sentenceKey}`;
      const avgConfidence = Math.max(0, Math.min(1, confidenceSum / words.length));

      alignments.push({
        id: `alignment:${map.ebookDocId}:${sentenceId}:${map.audioDocId}:${startMs}`,
        profileId: options.profileId,
        sourceType: "epub",
        sourceId: map.ebookDocId,
        sentenceId,
        sourceAnchor: {
          sourceType: "epub",
          documentId: map.ebookDocId,
          contentFingerprint: sourceFingerprint,
          locator: firstLocator?.kind === "epub"
            ? { chapterHref: firstLocator.chapterHref, charOffset: firstLocator.charOffset }
            : { chapterHref: chapter.ebookChapterHref },
        },
        sourceFingerprint,
        range: {
          mediaId: map.audioDocId,
          startMs,
          endMs,
          mediaFingerprint,
        },
        confidence: avgConfidence,
        method: "audiobook-pair",
        status: "ready",
        providerId: "ebook-audiobook-alignment",
        providerVersion: String(map.version),
        updatedAt: now,
      });
    }
  }

  return alignments;
}

export async function bridgeAlignmentToLanguageStore(input: {
  alignments: readonly SentenceAudioAlignment[];
  mediaFingerprint?: string;
  profileId?: string;
  persist?: boolean;
  registry?: AudioAlignmentRegistry;
  persistFn?: (record: LanguageAudioAlignmentRecord) => Promise<unknown>;
  now?: number;
}): Promise<{ registered: number; persisted: number }> {
  const registry = input.registry ?? sharedAudioAlignmentRegistry;
  const now = input.now ?? Date.now();
  let registered = 0;

  for (const alignment of input.alignments) {
    const normalized: SentenceAudioAlignment = input.profileId && !alignment.profileId
      ? { ...alignment, profileId: input.profileId }
      : alignment;
    registry.add(normalized);
    registered += 1;
  }

  if (!input.persist || !input.profileId || input.alignments.length === 0) {
    return { registered, persisted: 0 };
  }

  const persistFn = input.persistFn ?? upsertLanguageAudioAlignment;
  let persisted = 0;
  const batchSize = 20;

  for (let index = 0; index < input.alignments.length; index += batchSize) {
    const batch = input.alignments.slice(index, index + batchSize);
    const settled = await Promise.allSettled(
      batch.map((alignment) => {
        const withProfile: SentenceAudioAlignment = input.profileId
          ? { ...alignment, profileId: input.profileId }
          : alignment;
        return persistFn(
          toLanguageAudioAlignmentRecord(
            withProfile,
            input.mediaFingerprint ?? withProfile.range.mediaFingerprint,
            now,
          ),
        );
      }),
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") persisted += 1;
    }
  }

  return { registered, persisted };
}
