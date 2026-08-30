import type {
  AlignBookInput,
  PlethoraAlignmentMap,
  AlignProgress,
  AudioChapterInput,
  EbookChapterInput,
} from "./types";
import { ALIGNMENT_MAP_VERSION } from "./types";
import { alignChapter } from "./alignChapter";
import { foldForAlignment } from "./normalize";

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
    onProgress?.({
      phase: "aligning",
      chapterIndex: i + 1,
      chapterTotal: total,
      chapterHref: ec?.href,
      message: ec ? `Aligning chapter ${i + 1} of ${total}` : `Skipping chapter ${i + 1}`,
    });

    if (!ec || !ec.plainText.trim()) {
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
      alignChapter({
        chapter: ec,
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
