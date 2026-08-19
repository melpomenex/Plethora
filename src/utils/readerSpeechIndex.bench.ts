/**
 * Speech-index benchmarks: building the anchored index over seeded synthetic
 * sections and resolving `locate()` lookups. Both are Play/retarget-time costs
 * for document-reader TTS; `locate` in particular must stay cheap enough to
 * run per navigation without jank.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { ReaderSpeechIndex, type SpeechSectionInput } from "./readerSpeechIndex";

// Deterministic synthetic sections: multi-paragraph "chapters" of vocabulary
// words with terminal punctuation, page markers on PDF-ish sections.
const VOCAB = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi",
];

function buildSections(sectionCount: number, paragraphsPerSection: number): SpeechSectionInput[] {
  const rand = seededRandom(0x5eed);
  const sections: SpeechSectionInput[] = [];
  for (let s = 0; s < sectionCount; s += 1) {
    const parts: string[] = [];
    for (let p = 0; p < paragraphsPerSection; p += 1) {
      const words = 12 + Math.floor(rand() * 18);
      const sentence: string[] = [];
      for (let w = 0; w < words; w += 1) {
        sentence.push(VOCAB[Math.floor(rand() * VOCAB.length)]);
      }
      parts.push(`${sentence.join(" ")}.`);
    }
    const text = s % 3 === 0 ? `<page number="${s + 1}"/>${parts.join(" ")}` : parts.join(" ");
    sections.push({
      key: `sec-${s}`,
      text,
      anchorAt: (offset) => ({ kind: "epub", spineIndex: s, sectionOffset: offset }),
      offsetForAnchor: (a) => (a.kind === "epub" && a.spineIndex === s ? a.sectionOffset : null),
    });
  }
  return sections;
}

const sections = buildSections(24, 30);

let sink: unknown = null;

bench("reader-speech-index/build", () => {
  const index = new ReaderSpeechIndex(sections, 700);
  sink = index.chunks.length;
});

bench("reader-speech-index/locate", () => {
  const index = new ReaderSpeechIndex(sections, 700);
  const rand = seededRandom(0x10007);
  let found = 0;
  for (let i = 0; i < 2_000; i += 1) {
    const spine = Math.floor(rand() * 24);
    const offset = Math.floor(rand() * 4_000);
    const pos = index.locate({ kind: "epub", spineIndex: spine, sectionOffset: offset });
    if (pos) found += 1;
  }
  sink = found;
});
