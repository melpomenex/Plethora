/**
 * Queue assembly + budget computation hot path — `splitReviewBudget` runs when
 * a scroll session is assembled and gates time-to-first-item. It lives in
 * queueScrollBudget.ts precisely so it can be exercised without mounting the
 * ~4000-line QueueScrollPage component (see that file's header).
 *
 * Determinism: ~500 synthetic budget inputs built once from `seededRandom`;
 * every iteration replays the same 500 splits and folds the results together.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { splitReviewBudget, type ReviewBudgetInput } from "./queueScrollBudget";

const rng = seededRandom(0x51eed);

const INPUT_COUNT = 500;
const inputs: ReviewBudgetInput[] = Array.from({ length: INPUT_COUNT }, (_, i) => ({
  targetFlashcardCount: Math.floor(rng() * 120),
  extractsCountAsFlashcards: rng() > 0.5,
  maxExtractsPerSession: 5 + Math.floor(rng() * 40),
  availableFlashcards: Math.floor(rng() * 1500),
  availableExtracts: Math.floor(rng() * 200),
}));

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the loop).
let sink = 0;

bench("queue/build-500-items", () => {
  let acc = 0;
  for (const input of inputs) {
    const { flashcards, extracts } = splitReviewBudget(input);
    acc = (acc ^ flashcards ^ (extracts << 5)) | 0;
  }
  sink ^= acc;
});
