/**
 * Queue assembly + budget computation hot path — `composeSession` runs when
 * a scroll session is assembled and gates time-to-first-item. It lives in
 * queueScrollBudget.ts precisely so it can be exercised without mounting the
 * ~4000-line QueueScrollPage component (see that file's header).
 *
 * Determinism: ~500 synthetic budget inputs built once from `seededRandom`;
 * every iteration replays the same 500 compositions and folds the results
 * together.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { composeSession, type CompositionInput } from "./queueScrollBudget";

const rng = seededRandom(0x51eed);

const INPUT_COUNT = 500;
const inputs: CompositionInput[] = Array.from({ length: INPUT_COUNT }, () => ({
  targets: {
    documents: Math.floor(rng() * 101),
    extracts: Math.floor(rng() * 101),
    flashcards: Math.floor(rng() * 101),
  },
  available: {
    documents: Math.floor(rng() * 500),
    extracts: Math.floor(rng() * 200),
    flashcards: Math.floor(rng() * 1500),
  },
}));

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the loop).
let sink = 0;

bench("queue/build-500-items", () => {
  let acc = 0;
  for (const input of inputs) {
    const { documents, extracts, flashcards } = composeSession(input);
    acc = (acc ^ documents ^ (extracts << 5) ^ (flashcards << 10)) | 0;
  }
  sink ^= acc;
});
