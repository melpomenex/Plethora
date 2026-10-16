import { bench, describe } from "vitest";
import { seededRandom } from "../../../test/bench-support";
import { planVideoContext } from "./videoContextPlanner";
const random = seededRandom(4821);
const topics = ["attention", "biology", "entropy", "quantum", "mechanics"];
const segments = Array.from({ length: 3600 }, (_, index) => ({ start: index * 2, duration: 2,
  text: `${topics[Math.floor(random() * topics.length)]} ${"A deterministic lecture passage about the experimental result. ".repeat(2)}` }));
let sink = 0;
planVideoContext({ segments, query: "quantum", sourceBudgetTokens: 2400 });
describe("assistant video context", () => {
  bench("assistant-video/topical-2h-cached", () => {
    const plan = planVideoContext({ segments, query: "quantum experimental result", sourceBudgetTokens: 2400 });
    sink ^= plan.content.length;
  });
  bench("assistant-video/playback-2h-cached", () => {
    const plan = planVideoContext({ segments, query: "Explain this part", currentTime: 6880, sourceBudgetTokens: 2400 });
    sink ^= plan.chunkCount;
  });
});
export function consumeVideoPlannerBenchmark(): number { return sink; }
