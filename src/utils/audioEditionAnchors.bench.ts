/**
 * Hands-free capture hot path (design Decision 13): resolving the anchor at a
 * playback timestamp and expanding the recent window to sentence boundaries
 * run synchronously on every media-button press — per-press cost must stay
 * O(log n) regardless of book size.
 *
 * Determinism: the synthetic 10k-sentence book (≈ 20 h of audio) is built
 * once from `seededRandom`; every iteration resolves identical inputs.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import {
  computeSentenceAnchors,
  resolveRecentPassage,
  resolveAnchorAtTimestamp,
} from "./audioEditionAnchors";

const rng = seededRandom(0xa11ce);

const WORDS = ["quantum", "chapter", "evidence", "passage", "listening", "capture", "anchor", "study"];

const sentences: string[] = [];
for (let i = 0; i < 10_000; i += 1) {
  const n = 8 + Math.floor(rng() * 12);
  const words: string[] = [];
  for (let w = 0; w < n; w += 1) words.push(WORDS[Math.floor(rng() * WORDS.length)]);
  sentences.push(words.join(" ") + ".");
}

const anchors = computeSentenceAnchors("bench-sec", sentences.join(" "), 72_000, "0");
const probes = Array.from({ length: 64 }, () => rng() * 72_000);

let sinkAnchor = "";
let sinkText = "";

bench("audioEdition/anchor-resolve-10k-sentences", () => {
  for (const t of probes) {
    const anchor = resolveAnchorAtTimestamp(anchors, t);
    if (anchor) sinkAnchor = anchor.id;
  }
});

bench("audioEdition/recent-passage-30s-window-10k", () => {
  for (const t of probes) {
    const capture = resolveRecentPassage(anchors, t, 30, "high");
    if (capture.text) sinkText = capture.text;
  }
});
