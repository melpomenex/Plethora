import { bench } from "vitest";
import { seededRandom } from "../../../test/bench-support";
import { assistantSheetGeometry, beginInvocation, endInvocation, moveInvocation } from "./gesture";
const random = seededRandom(0x41535354);
const paths = Array.from({ length: 128 }, (_, i) => ({
  geometry: assistantSheetGeometry(350 + Math.floor(random() * 850)),
  id: `gesture-${i}`,
  points: Array.from({ length: 32 }, (_, step) => ({ x: 150 + random() * 12, y: 500 - step * (3 + random() * 2) })),
}));
let sink = 0;
bench("assistant invocation seeded trajectories", () => {
  let fold = sink;
  for (const path of paths) {
    let state = beginInvocation(path.id, 150, 500, path.geometry);
    for (const point of path.points) state = moveInvocation(state, point.x, point.y);
    fold += state.reveal + (endInvocation(state).outcome === "open" ? 1 : 0);
  }
  sink = fold % 1_000_000;
});
