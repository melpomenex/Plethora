/**
 * Passage-scoring hot-path benchmarks (task 5.2).
 *
 * Pure, seeded inputs only: identity digest/normalization and the bounded
 * candidate queue. No React, Tauri, timers, network or filesystem is touched.
 */

import { bench } from "vitest";
import { seededRandom } from "../../../test/bench-support";
import { computePassageDigest, normalizePassageText } from "./identity";
import { sha256Hex } from "./hash";
import { PassageCandidateQueue } from "./queue";

const policy = {
  classifierVersion: "passage-classifier-bench",
  servingRevision: "bench-provider\u0000bench-model",
};

function makeText(random: () => number, length: number): string {
  const words = [
    "definition",
    "argument",
    "mechanism",
    "evidence",
    "comparison",
    "process",
    "claim",
    "example",
    "concept",
    "observation",
  ];
  let text = "";
  while (text.length < length) {
    text += `${words[Math.floor(random() * words.length)]} `;
  }
  return text.slice(0, length);
}

const random = seededRandom(0x5eed_2026);
const passages = Array.from({ length: 16 }, () => makeText(random, 2_400));
const wrapped = passages.map((text) =>
  text
    .split(" ")
    .reduce<string[]>((lines, word, index) => {
      const line = Math.floor(index / 8);
      lines[line] = `${lines[line] ?? ""}${lines[line] ? " " : ""}${word}`;
      return lines;
    }, [])
    .join("\n  ")
);

let sink = 0;

bench("passageScoring/digest-2400-chars", () => {
  for (const text of passages) {
    const digest = computePassageDigest({ text, policy });
    sink = (sink + digest.charCodeAt(0)) | 0;
  }
});

bench("passageScoring/normalize-1200-chars", () => {
  for (const text of wrapped) {
    const normalized = normalizePassageText(text).slice(0, 1_200);
    sink = (sink + normalized.length) | 0;
  }
});

bench("passageScoring/queue-8-push-pop", () => {
  const queue = new PassageCandidateQueue(8);
  for (let round = 0; round < 8; round += 1) {
    for (let index = 0; index < 8; index += 1) {
      queue.push(`p${round}-${index}`);
    }
    let popped = queue.pop();
    while (popped) {
      sink = (sink + popped.sequence) | 0;
      popped = queue.pop();
    }
  }
  sink = (sink + queue.size) | 0;
});

bench("passageScoring/sha256-2400-chars", () => {
  for (const text of passages) {
    const hash = sha256Hex(text);
    sink = (sink + hash.charCodeAt(0)) | 0;
  }
});

// Ensure the consumed value is observable to the runtime.
export const passageScoringBenchSink = () => sink;
