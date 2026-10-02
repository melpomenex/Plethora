/**
 * Queue snapshot projection hot path — runs on the UI thread every time a
 * background re-rank completes and the store adopts the result.
 *
 * This is the part of DAQE the `vitest bench` gate can actually measure. The
 * ranker itself is Rust (see `algorithms/daqe/ranker.rs`), which
 * `npm run bench:check` cannot time; its 150 ms budget is asserted by a Rust
 * latency test instead. What IS measurable here, and genuinely on the critical
 * path, is projecting a wide snapshot onto the items the store holds.
 *
 * Determinism: a 5 000-entry snapshot and pool built once from `seededRandom`;
 * every iteration replays the same projection and folds the result.
 */
import { bench } from "vitest";
import { seededRandom } from "../../test/bench-support";
import type { QueueItem } from "../../types/queue";
import {
  projectSnapshot,
  type DaqeQueueSnapshot,
  type TermBreakdown,
} from "./snapshot";

const rng = seededRandom(0xda9e5);

const POOL = 5_000;
const ITEM_TYPES = ["document", "extract", "learning-item", "playlist-video", "rss-article"];

function makeBreakdown(): TermBreakdown {
  const measured = (value: number) => ({ value, available: true, defaulted: false });
  return {
    srsUrgency: measured(rng()),
    srsWeight: 0.4,
    goalRelevance: { value: rng(), available: rng() > 0.3, defaulted: rng() > 0.7 },
    goalWeight: 0.3,
    energyFit: { value: rng(), available: true, defaulted: true },
    energyWeight: 0.4,
    interleavePenalty: measured(rng() * 0.5),
    interleaveWeight: 0.2,
    frictionPenalty: measured(rng() * 0.4),
    frictionWeight: 0.1,
    effectiveEnergyTarget: 3,
    energyDownshiftReason: undefined,
    interleaveAgainst: [`recent-${Math.floor(rng() * 3)}`],
  };
}

function makeItem(index: number): QueueItem {
  const itemType = ITEM_TYPES[index % ITEM_TYPES.length];
  return {
    id: `item-${String(index).padStart(5, "0")}`,
    documentId: `doc-${Math.floor(index / 3)}`,
    documentTitle: `Document ${index}`,
    extractId: null,
    learningItemId: null,
    question: null,
    answer: null,
    clozeText: null,
    itemType: itemType as QueueItem["itemType"],
    priority: (index % 100) / 10,
    dueDate: new Date(Date.UTC(2026, 5, 1) - (index % 45) * 86_400_000).toISOString(),
    estimatedTime: 2,
    tags: [`topic-${index % 40}`],
    category: null,
    progress: index % 100,
  } as QueueItem;
}

const pool: QueueItem[] = Array.from({ length: POOL }, (_, i) => makeItem(i));

// A realistic ranking: reversed order relative to the pool, so the projection
// genuinely permutes rather than happening to be a no-op.
const ranked = pool
  .map((item, inputIndex) => ({
    item,
    score: rng(),
    breakdown: makeBreakdown(),
    inputIndex,
  }))
  .reverse();

const snapshot: DaqeQueueSnapshot = {
  id: "snap-bench",
  profile: "default",
  knobs: {
    srsDecayWeight: 0.4,
    goalRelevance: 0.3,
    energyTarget: 3,
    interleavingDiversity: 0.2,
    pruningAggressiveness: 0.1,
    afkIdleTimeoutMs: 45_000,
  },
  ranked,
  top10: ranked.slice(0, 10),
  computedAt: "2026-06-01T12:00:00Z",
};

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the loop).
let sink = 0;

bench("daqe/project-snapshot-5000-items", () => {
  const projected = projectSnapshot(pool, snapshot, 50);
  sink += projected.ordered.length;
  sink += projected.orderedIds.length;
  sink += projected.breakdowns.size;
});

bench("daqe/project-snapshot-5000-items-no-snapshot", () => {
  // The fallback path: no snapshot yet, so the previous order stands. This runs on
  // every first paint and on every store reload before a rank completes.
  const projected = projectSnapshot(pool, null, 50);
  sink += projected.ordered.length;
  sink += projected.orderedIds.length;
});