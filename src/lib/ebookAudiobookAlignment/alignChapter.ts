import type { AlignedWord, AlignChapterInput, AlignedChapter } from "./types";
import { tokenizePlainText } from "./normalize";
import { errorAlignTokens, alignmentMatchRate } from "./errorAlign/errorAlign";
import { enforceMonotonicTimestamps, interpolateWordTimestamps } from "./interpolate";
import { foldForMatch } from "../../utils/readerSpeechIndex";

export function alignChapter(input: AlignChapterInput): AlignedChapter {
  const { chapter, audioChapter, timeline } = input;
  const ebookTokens = tokenizePlainText(chapter.plainText);
  const chapterWords = timeline.words.filter(
    (w) => w.endMs > audioChapter.startMs && w.startMs < audioChapter.endMs,
  );

  const hypTokens = chapterWords.map((w) => w.text);
  const hypNorm = chapterWords.map((w) => foldForMatch(w.text));
  const refTokens = ebookTokens.map((t) => t.text);
  const refNorm = ebookTokens.map((t) => t.norm);

  const alignments = errorAlignTokens(refTokens, hypTokens, refNorm, hypNorm);
  const matchRate = alignmentMatchRate(alignments);

  const words: AlignedWord[] = [];
  let sentenceId = 0;
  let wordsInSentence = 0;

  for (const align of alignments) {
    if (align.refTokenIndex === null) continue;

    const ebookToken = ebookTokens[align.refTokenIndex];
    if (!ebookToken) continue;

    if (wordsInSentence > 12 && align.refText?.match(/[.!?]$/)) {
      sentenceId++;
      wordsInSentence = 0;
    }
    wordsInSentence++;

    const hypIdx = align.hypTokenIndex;
    const hypWord = hypIdx !== null ? chapterWords[hypIdx] : null;
    const interpolated = hypWord === null;

    let startMs = hypWord?.startMs ?? 0;
    let endMs = hypWord?.endMs ?? 0;
    let confidence = hypWord?.confidence ?? 0.5;

    if (align.op === "MATCH") confidence = Math.min(1, (confidence || 0.8) + 0.1);
    if (align.op === "SUBSTITUTE") confidence = Math.min(0.85, confidence || 0.6);
    if (align.op === "DELETE") confidence = 0.2;

    words.push({
      text: ebookToken.text,
      locator: {
        kind: "epub",
        chapterHref: chapter.href,
        charOffset: ebookToken.charStart,
      },
      startMs,
      endMs,
      confidence,
      interpolated,
      op: align.op.toLowerCase() as AlignedWord["op"],
      sentenceId,
    });
  }

  interpolateWordTimestamps(words, audioChapter.startMs, audioChapter.endMs);
  enforceMonotonicTimestamps(words);

  return {
    ebookChapterHref: chapter.href,
    audioChapterIndex: audioChapter.index,
    audioStartMs: audioChapter.startMs,
    audioEndMs: audioChapter.endMs,
    chapterConfidence: matchRate,
    status: matchRate >= 0.3 ? "complete" : "partial",
    words,
  };
}
