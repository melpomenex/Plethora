import { bench } from "vitest";
import { seededRandom } from "./test/bench-support";
import type { AudioPolicyInterval } from "./types/audioEdition";

const rng = seededRandom(0xad90d);

// 1. Synthetic transcript sentences for cue regex benchmarking
const INTRO_REGEX = /(?:sponsored\s+by|brought\s+to\s+you\s+by|support\s+(?:for|from)\s+this\s+podcast|a\s+word\s+from\s+our\s+sponsors?|today's\s+episode\s+is\s+supported\s+by)/i;
const PROMO_REGEX = /(?:promo\s+code|use\s+(?:the\s+)?code|discount\s+code|for\s+\d+%\s+off|free\s+shipping)/i;
const URL_REGEX = /(?:(?:dot\s+com\s+slash|\.com\/|https?:\/\/[^\s]+)[a-zA-Z0-9_\-]+)/i;

const SAMPLE_SENTENCES = [
  "Welcome back to another deep dive episode on cognitive psychology.",
  "Today's episode is brought to you by BetterHelp online therapy.",
  "Visit betterhelp.com/plethora for 10% off your first month.",
  "Use promo code PLETHORA at checkout to claim your discount.",
  "In today's lecture we explore the neuroscience of spaced repetition.",
  "This podcast is supported by listeners like you on Patreon.",
  "And now let's return to the conversation on distributed systems.",
];

const testCorpus: string[] = [];
for (let i = 0; i < 200; i++) {
  testCorpus.push(SAMPLE_SENTENCES[Math.floor(rng() * SAMPLE_SENTENCES.length)]);
}

// 2. Synthetic intervals for 120ms lookahead search benchmark
const intervals: AudioPolicyInterval[] = [];
let t = 60;
for (let i = 0; i < 20; i++) {
  const dur = 30 + Math.floor(rng() * 90);
  intervals.push({
    id: `ad-${i}`,
    category: "external_ad",
    startSec: t,
    endSec: t + dur,
  });
  t += dur + 300 + Math.floor(rng() * 600);
}

// 3. Probes for 120ms lookahead search
const probes = Array.from({ length: 100 }, () => rng() * t);

// Sinks to prevent elision
let sinkMatches = 0;
let sinkLookahead = 0;
let sinkMerge = 0;

bench("podcastAd/cue-regex-throughput-200-sentences", () => {
  let count = 0;
  for (const sentence of testCorpus) {
    if (INTRO_REGEX.test(sentence)) count++;
    if (PROMO_REGEX.test(sentence)) count++;
    if (URL_REGEX.test(sentence)) count++;
  }
  sinkMatches ^= count;
});

bench("podcastAd/lookahead-120ms-search-100-probes", () => {
  let hits = 0;
  const LOOKAHEAD_SEC = 0.120;
  for (const pos of probes) {
    for (const inv of intervals) {
      if (pos + LOOKAHEAD_SEC >= inv.startSec && pos < inv.endSec) {
        hits++;
        break;
      }
    }
  }
  sinkLookahead ^= hits;
});

bench("podcastAd/interval-merger-synthetic-batch", () => {
  // Merge closely spaced intervals (< 3s gap)
  const sorted = [...intervals];
  const merged: AudioPolicyInterval[] = [];
  for (const inv of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && inv.startSec <= prev.endSec + 3.0) {
      prev.endSec = Math.max(prev.endSec, inv.endSec);
    } else {
      merged.push({ ...inv });
    }
  }
  sinkMerge ^= merged.length;
});
