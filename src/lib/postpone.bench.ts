/**
 * Postpone planning hot path — `postponeAll` plans a postpone pass over the
 * whole review collection, which runs per item (see src/lib/postpone.ts).
 *
 * Determinism: inputs are built once from `seededRandom` (~1000 items) and the
 * config runs with `randomize: false`, so the workload is identical every run.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { computePriority, defaultPostponeConfig, postponeAll, type PostponeConfig, type PostponeInput } from "./postpone";

const rng = seededRandom(0xdecaf);
// randomize: false — postponeElement's only Math.random site (randomizeInterval)
const config: PostponeConfig = { ...defaultPostponeConfig, randomize: false };

const ITEM_COUNT = 1000;
const items: PostponeInput[] = Array.from({ length: ITEM_COUNT }, (_, i) => {
  const stability = 1 + rng() * 50;
  const difficulty = 1 + rng() * 4;
  const lapses = Math.floor(rng() * 5);
  return {
    id: `item-${i}`,
    // A few topics mixed in so both eligibility paths are exercised.
    type: i % 5 === 0 ? "topic" : "item",
    interval: 1 + Math.floor(rng() * 300),
    priority: computePriority(stability, difficulty, lapses),
    stability,
    difficulty,
    reviewCount: Math.floor(rng() * 30),
    lapses,
    daysSinceReview: Math.floor(rng() * 120),
  };
});

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the loop).
let sink = 0;

bench("postpone/plan-1000-items", () => {
  const { results, stats } = postponeAll(items, config);
  // Consume both the stats and every result so nothing is elided.
  let acc = stats.totalIncrease ^ stats.postponedCount ^ stats.skippedCount;
  for (const r of results) acc = (acc ^ r.newInterval ^ r.increase ^ r.ratio) | 0;
  sink ^= acc;
});
