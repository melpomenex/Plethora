import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { AudioAlignmentRegistry } from "./languageAudioAlignment";
import { normalizeAlignmentSegment } from "./languageAudioAlignment";
import type { SentenceAudioAlignment } from "./languageAudioAlignment";

const random = seededRandom(0x5a11);
const SOURCE_ID = "bench-doc";
const SENTENCE_COUNT = 10_000;

// A large aligned transcript: one alignment per sentence with stable media
// fingerprints so every resolve() hits the original-audio fast path.
const registry = new AudioAlignmentRegistry();
const sentences: SentenceAudioAlignment[] = [];
for (let index = 0; index < SENTENCE_COUNT; index += 1) {
  const alignment = normalizeAlignmentSegment({
    sentenceId: `s${index}`,
    sourceId: SOURCE_ID,
    sourceFingerprint: "source-v1",
    mediaId: "audio",
    mediaFingerprint: "audio-v1",
    startMs: index * 1_000,
    endMs: index * 1_000 + 900,
    confidence: 0.9 + random() * 0.09,
    method: "caption",
  }, 10);
  if (alignment) {
    registry.add(alignment);
    sentences.push(alignment);
  }
}

let sink = 0;

bench("language-audio-alignment/lookup-10000-sentence-transcript", () => {
  let fold = 0;
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    const resolution = registry.resolve({
      sourceId: SOURCE_ID,
      sentenceId: sentence.sentenceId,
      sourceFingerprint: "source-v1",
      mediaId: "audio",
      mediaFingerprint: "audio-v1",
    });
    if (resolution.kind === "original") fold ^= resolution.alignment.range.startMs;
  }
  sink ^= fold;
});

bench("language-audio-alignment/stale-miss-over-10000-sentence-transcript", () => {
  let fold = 0;
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index]!;
    const resolution = registry.resolve({
      sourceId: SOURCE_ID,
      sentenceId: sentence.sentenceId,
      // Fingerprint drift forces the stale/fallback path on every row.
      sourceFingerprint: "source-v2",
      mediaId: "audio",
      mediaFingerprint: "audio-v1",
    });
    if (resolution.kind === "tts" || resolution.kind === "fallback") fold += 1;
  }
  sink ^= fold;
});
