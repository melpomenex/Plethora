import type {
  AlignBookInput,
  PlethoraAlignmentMap,
  AlignProgress,
  AudioChapterInput,
  EbookChapterInput,
} from "./types";
import { ALIGNMENT_MAP_VERSION } from "./types";
import { alignChapter } from "./alignChapter";
import { foldForAlignment, tokenizePlainText } from "./normalize";
import type { AlignedChapter } from "./types";

function similarity(a: string, b: string): number {
  const na = foldForAlignment(a);
  const nb = foldForAlignment(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  return 0;
}

export function matchChapters(
  ebookChapters: EbookChapterInput[],
  audioChapters: AudioChapterInput[],
): Map<number, EbookChapterInput> {
  const map = new Map<number, EbookChapterInput>();
  const usedEpub = new Set<string>();

  for (const ac of audioChapters) {
    let best: { chapter: EbookChapterInput; score: number } | null = null;
    for (const ec of ebookChapters) {
      if (usedEpub.has(ec.href)) continue;
      const score = similarity(ac.title, ec.label);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { chapter: ec, score };
      }
    }
    if (best) {
      map.set(ac.index, best.chapter);
      usedEpub.add(best.chapter.href);
    }
  }

  // Fallback: positional pairing for unmatched
  let epubIdx = 0;
  for (const ac of audioChapters) {
    if (map.has(ac.index)) continue;
    while (epubIdx < ebookChapters.length && usedEpub.has(ebookChapters[epubIdx].href)) {
      epubIdx++;
    }
    if (epubIdx < ebookChapters.length) {
      map.set(ac.index, ebookChapters[epubIdx]);
      usedEpub.add(ebookChapters[epubIdx].href);
      epubIdx++;
    }
  }

  return map;
}

export function computePairId(
  ebookDocId: string,
  audioDocId: string,
  ebookHash: string,
  audioHash: string,
): string {
  return `${ebookDocId}:${audioDocId}:${ebookHash}:${audioHash}`;
}

/**
 * Align a chapterless audiobook section-by-section. Running the edit-distance
 * matrix over an entire book is quadratic in all EPUB and transcript words
 * and can freeze the worker on normal-length books. A proportional word
 * window keeps each comparison bounded while preserving the exact EPUB href
 * and character offsets in the resulting locators.
 */
function alignSingleAudioChapterAcrossEbook(
  chapters: EbookChapterInput[],
  audioChapter: AudioChapterInput,
  timeline: AlignBookInput["timeline"],
): AlignedChapter {
  const refCounts = chapters.map((chapter) => tokenizePlainText(chapter.plainText).length);
  const totalRefCount = refCounts.reduce((sum, count) => sum + count, 0);
  const totalHypCount = timeline.words.length;
  let cumulativeRefCount = 0;
  let previousHypIndex = 0;
  const alignedParts: AlignedChapter[] = [];

  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index];
    cumulativeRefCount += refCounts[index];
    const nextHypIndex = index === chapters.length - 1 || totalRefCount === 0
      ? totalHypCount
      : Math.max(
        previousHypIndex,
        Math.round((cumulativeRefCount / totalRefCount) * totalHypCount),
      );
    const sectionWords = timeline.words.slice(previousHypIndex, nextHypIndex);
    const sectionStartMs = index === 0
      ? audioChapter.startMs
      : sectionWords[0]?.startMs ?? alignedParts[index - 1]?.audioEndMs ?? audioChapter.startMs;
    const sectionEndMs = index === chapters.length - 1
      ? audioChapter.endMs
      : sectionWords.at(-1)?.endMs ?? sectionStartMs;

    alignedParts.push(alignChapter({
      chapter,
      audioChapter: {
        ...audioChapter,
        startMs: sectionStartMs,
        endMs: Math.max(sectionEndMs, sectionStartMs + 1),
      },
      timeline: {
        ...timeline,
        words: sectionWords,
      },
    }));
    previousHypIndex = nextHypIndex;
  }

  const words = alignedParts.flatMap((part) => part.words);
  const confidenceDenominator = refCounts.reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
  const chapterConfidence = confidenceDenominator === 0
    ? 0
    : alignedParts.reduce((sum, part, index) => sum + part.chapterConfidence * refCounts[index], 0) / confidenceDenominator;

  return {
    ebookChapterHref: chapters[0]?.href ?? "",
    audioChapterIndex: audioChapter.index,
    audioStartMs: audioChapter.startMs,
    audioEndMs: audioChapter.endMs,
    chapterConfidence,
    status: words.length === 0 ? "failed" : chapterConfidence >= 0.3 ? "complete" : "partial",
    words,
  };
}

export function alignBook(
  input: AlignBookInput,
  onProgress?: (p: AlignProgress) => void,
  startFromChapter = 0,
  existing?: PlethoraAlignmentMap,
): PlethoraAlignmentMap {
  const chapterMap = matchChapters(input.chapters, input.audioChapters);
  const alignedChapters = existing?.chapters.slice(0, startFromChapter) ?? [];

  const audioByIndex = new Map(input.audioChapters.map((c) => [c.index, c]));
  const total = input.audioChapters.length;

  for (let i = startFromChapter; i < input.audioChapters.length; i++) {
    const ac = input.audioChapters[i];
    const ec = chapterMap.get(ac.index);
    // A chapterless audiobook is exposed by ffmpeg as one synthetic chapter.
    // In that case the entire EPUB spine is the reference passage; pairing it
    // with only the first EPUB section silently drops the rest of the book.
    const sourceChapters = input.audioChapters.length === 1
      ? input.chapters.filter((chapter) => chapter.plainText.trim())
      : ec
        ? [ec]
        : [];
    const primaryChapter = sourceChapters[0] ?? ec;
    onProgress?.({
      phase: "aligning",
      chapterIndex: i + 1,
      chapterTotal: total,
      chapterHref: primaryChapter?.href,
      message: primaryChapter ? `Aligning chapter ${i + 1} of ${total}` : `Skipping chapter ${i + 1}`,
    });

    if (!primaryChapter || !sourceChapters.some((chapter) => chapter.plainText.trim())) {
      alignedChapters.push({
        ebookChapterHref: ec?.href ?? "",
        audioChapterIndex: ac.index,
        audioStartMs: ac.startMs,
        audioEndMs: ac.endMs,
        chapterConfidence: 0,
        status: "failed",
        words: [],
        error: ec ? "empty chapter text" : "no ebook chapter match",
      });
      continue;
    }

    alignedChapters.push(
      sourceChapters.length > 1
        ? alignSingleAudioChapterAcrossEbook(sourceChapters, ac, input.timeline)
        : alignChapter({
          chapter: primaryChapter,
          audioChapter: ac,
          timeline: input.timeline,
        }),
    );
  }

  const confidences = alignedChapters
    .filter((c) => c.words.length > 0)
    .map((c) => c.chapterConfidence);
  const overallConfidence =
    confidences.length === 0
      ? 0
      : confidences.reduce((a, b) => a + b, 0) / confidences.length;

  const now = new Date().toISOString();
  return {
    version: ALIGNMENT_MAP_VERSION,
    pairId: computePairId(
      input.ebookDocId,
      input.audioDocId,
      input.ebookContentHash,
      input.audioContentHash,
    ),
    ebookDocId: input.ebookDocId,
    audioDocId: input.audioDocId,
    ebookContentHash: input.ebookContentHash,
    audioContentHash: input.audioContentHash,
    transcriptFingerprint: input.timeline.fingerprint,
    granularity: "word",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    chapters: alignedChapters,
    overallConfidence,
  };
}
