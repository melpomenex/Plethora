/**
 * Combined-criterion session sort hot path —
 * `orderScrollItemsByCombinedCriterion` runs once per Scroll session build
 * (not per render) and gates time-to-first-item for the priority-ordered
 * session. It lives in queueScrollOrder.ts so it can be exercised without
 * mounting the ~4000-line QueueScrollPage component.
 *
 * This is the combined sort:
 * priority (primary) + topic/item proportion bias + stable per-id jitter. See
 * design.md and algorithms/priority_queue.rs.
 *
 * Determinism: ~300 synthetic items built once from `seededRandom` (a realistic
 * daily session size); every iteration replays the same sort and folds the
 * resulting order together. The sort is O(n²) greedy insertion, but n is a
 * daily session (tens to low hundreds), so this stays fast.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import {
  DEFAULT_COMBINED_SORT_CONFIG,
  orderScrollItemsByCombinedCriterion,
  type PrioritizableScrollItem,
} from "./queueScrollOrder";

const rng = seededRandom(0xc0ffee);

const ITEM_COUNT = 300;
const items: PrioritizableScrollItem[] = Array.from({ length: ITEM_COUNT }, (_, i) => {
  // Mix topics (documents/extracts) and items (flashcards) roughly 50/50.
  const isFlashcard = rng() < 0.5;
  return {
    id: `item-${i}`,
    type: isFlashcard ? "flashcard" : "document",
    // Priority spread across the 0-100 scale.
    engagementScore: Math.floor(rng() * 101),
  };
});

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the loop).
let sink = 0;

bench("queueScrollOrder/combined-sort-300-items", () => {
  const ordered = orderScrollItemsByCombinedCriterion(items, DEFAULT_COMBINED_SORT_CONFIG);
  // Consume the resulting order so the sort is not elided.
  let acc = 0;
  for (let i = 0; i < ordered.length; i++) {
    acc = (acc ^ i ^ (ordered[i].engagementScore ?? 0)) | 0;
  }
  sink ^= acc;
});
