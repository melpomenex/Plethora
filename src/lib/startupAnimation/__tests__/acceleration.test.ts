/**
 * Acceleration-plan unit tests (design D4, amended: complete-metaphor
 * playback). A fast start compresses the remaining choreography at a higher
 * tempo — never skipping beats — inside the 900/1150 ms budgets; a slow
 * start that already idled resolves at 1×.
 */
import { describe, expect, it } from "vitest";
import {
  FAST_PLAY_BUDGET_MS,
  FAST_PLAY_BUDGET_PHONE_MS,
  REVEAL_FADE_MS,
  REVEAL_START_BUDGET_MS,
  UNMOUNT_BUDGET_MS,
  accelerationPlan,
  buildTimeline,
} from "../timeline";

const desktop = buildTimeline("knowledge-peck", "desktop");
const phone = buildTimeline("knowledge-peck", "phone");

const SCENARIOS = [
  { label: "ready at 200 ms (during fragments)", elapsed: 200 },
  { label: "ready mid-peck (800 ms)", elapsed: 800 },
  { label: "ready during consolidate (1150 ms)", elapsed: 1150 },
  { label: "ready during wordmark (1450 ms)", elapsed: 1450 },
  { label: "ready at idle (1300 ms desktop)", elapsed: 1300 },
  { label: "ready long after idle (5000 ms)", elapsed: 5000 },
  { label: "ready before mount (0 ms)", elapsed: 0 },
] as const;

describe("accelerationPlan budgets", () => {
  it.each(SCENARIOS)("desktop — %s", ({ elapsed }) => {
    const plan = accelerationPlan(elapsed, desktop);
    expect(plan.timeScale).toBeGreaterThanOrEqual(1);
    expect(plan.revealStartInMs).toBeLessThanOrEqual(REVEAL_START_BUDGET_MS);
    expect(plan.unmountInMs).toBeLessThanOrEqual(UNMOUNT_BUDGET_MS);
    expect(plan.unmountInMs).toBeGreaterThanOrEqual(plan.revealStartInMs);
  });

  it.each(SCENARIOS)("phone — %s", ({ elapsed }) => {
    const plan = accelerationPlan(elapsed, phone);
    expect(plan.revealStartInMs).toBeLessThanOrEqual(REVEAL_START_BUDGET_MS);
    expect(plan.unmountInMs).toBeLessThanOrEqual(UNMOUNT_BUDGET_MS);
  });
});

describe("complete-metaphor semantics (fast start compresses, never skips)", () => {
  it("ready before anything plays: the WHOLE choreography plays at compressed tempo", () => {
    const plan = accelerationPlan(0, desktop);
    expect(plan.kind).toBe("accelerate");
    // 1520 virtual ms folded into the 900 ms budget → ~1.69×.
    expect(plan.startVirtualMs).toBe(0);
    expect(plan.timeScale).toBeCloseTo(1520 / FAST_PLAY_BUDGET_MS, 1);
    expect(plan.revealStartInMs).toBe(FAST_PLAY_BUDGET_MS);
    expect(plan.unmountInMs).toBe(FAST_PLAY_BUDGET_MS + REVEAL_FADE_MS);
    // Every peck window (520–700, 720–880, 900–1160 virtual) is on the
    // compressed playback path: wall(v) = v / timeScale, all ≤ budget.
    const wallOf = (v: number) => v / plan.timeScale;
    expect(wallOf(1160)).toBeLessThanOrEqual(plan.revealStartInMs);
  });

  it("ready at 200 ms: remaining 1320 ms compresses into the budget at ~1.47×", () => {
    const plan = accelerationPlan(200, desktop);
    expect(plan.kind).toBe("accelerate");
    expect(plan.timeScale).toBeCloseTo(1320 / FAST_PLAY_BUDGET_MS, 1);
    expect(plan.revealStartInMs).toBe(FAST_PLAY_BUDGET_MS);
    // Un-played pecks (from 200 virtual on) still lie ahead on the path.
    expect(200 / 1 + (720 - 200) / plan.timeScale).toBeLessThan(plan.revealStartInMs);
  });

  it("late fast start whose remainder already fits: plays at 1×, reveal = remainder", () => {
    // 1150 ms lands in consolidate; remaining 370 ≤ 900 → no compression.
    const plan = accelerationPlan(1150, desktop);
    expect(plan.kind).toBe("accelerate");
    expect(plan.timeScale).toBe(1);
    expect(plan.revealStartInMs).toBe(370);
    expect(plan.unmountInMs).toBe(370 + REVEAL_FADE_MS);
  });

  it("at/after idle: resolve plays at 1× from the start of converge", () => {
    const plan = accelerationPlan(1600, desktop);
    expect(plan.kind).toBe("resolve");
    expect(plan.timeScale).toBe(1);
    expect(plan.startVirtualMs).toBe(1260); // converge.start restart
    expect(plan.revealStartInMs).toBe(260); // 1520 − 1260
    expect(plan.unmountInMs).toBe(260 + REVEAL_FADE_MS);
  });

  it("phone uses the tighter fast-play budget", () => {
    const plan = accelerationPlan(0, phone);
    expect(plan.timeScale).toBeCloseTo(1080 / FAST_PLAY_BUDGET_PHONE_MS, 1);
    expect(plan.revealStartInMs).toBe(FAST_PLAY_BUDGET_PHONE_MS);
  });

  it("the wall→virtual mapping is monotonic and jump-free for every arrival point", () => {
    for (let elapsed = 0; elapsed <= 6000; elapsed += 13) {
      for (const tl of [desktop, phone]) {
        const plan = accelerationPlan(elapsed, tl);
        expect(plan.timeScale).toBeGreaterThanOrEqual(1);
        // virtual(w) = elapsed + w·scale is strictly increasing in w, and at
        // w = 0 it equals the current position — no backwards clock, no skip.
        expect(plan.revealStartInMs).toBeGreaterThanOrEqual(0);
        expect(plan.unmountInMs).toBeGreaterThanOrEqual(plan.revealStartInMs);
      }
    }
  });

  it("budget constants match the amended spec (900 / 1150)", () => {
    expect(REVEAL_START_BUDGET_MS).toBe(900);
    expect(UNMOUNT_BUDGET_MS).toBe(1150);
    expect(FAST_PLAY_BUDGET_MS).toBe(900);
    expect(FAST_PLAY_BUDGET_PHONE_MS).toBe(700);
  });
});
