import { describe, expect, it } from "vitest";
import { assistantDetentHeight, assistantHandleReveal, assistantSheetGeometry, beginInvocation, endInvocation, initialAssistantDetent, moveInvocation, releaseAssistantHandle } from "../gesture";

const start = (height = 800) => beginInvocation("opaque", 100, 500, assistantSheetGeometry(height));

describe("Assistant invocation geometry and recognition", () => {
  it.each([[400, 64], [600, 72], [1000, 96]])("freezes height %s threshold %s", (height, threshold) => {
    for (const offset of [-1, 0, 1]) {
      const state = moveInvocation(start(height), 100, 500 - threshold - offset);
      expect(state.armed).toBe(offset >= 0);
      expect(endInvocation(state).outcome).toBe(offset >= 0 ? "open" : "cancel");
    }
  });
  it("copies geometry so layout changes cannot alter a live threshold", () => {
    const geometry = assistantSheetGeometry(600);
    const state = beginInvocation("a", 0, 100, geometry);
    geometry.threshold = 2;
    expect(state.geometry.threshold).toBe(72);
  });
  it.each([[7, 7, "tap"], [0, -8, "cancel"], [12, 4, "cancel"], [9, 10, "cancel"], [15, 16, "cancel"]] as const)("travel %s,%s ends as %s", (dx, up, outcome) => {
    expect(endInvocation(moveInvocation(start(), 100 + dx, 500 - up)).outcome).toBe(outcome);
  });
  it("keeps a directional rejection terminal", () => {
    const rejected = moveInvocation(start(), 130, 500);
    expect(moveInvocation(rejected, 100, 300)).toBe(rejected);
    expect(endInvocation(rejected).outcome).toBe("cancel");
  });
  it("accepts exactly the upward directional ratio and 8px slop", () => {
    expect(moveInvocation(beginInvocation("a", 0, 500, assistantSheetGeometry(800)), 6.4, 492).phase).toBe("dragging");
    expect(moveInvocation(start(), 107, 492).phase).toBe("contact");
  });
  it("latches once while arming follows current displacement", () => {
    let state = start();
    let crossings = 0;
    for (const d of [8, 95, 96, 120, 60, 96, 150, 40]) {
      const next = moveInvocation(state, 100, 500 - d);
      if (next.thresholdAnnounced && !state.thresholdAnnounced) crossings++;
      state = next;
    }
    expect(crossings).toBe(1);
    expect(state.armed).toBe(false);
    expect(state.thresholdAnnounced).toBe(true);
    expect(endInvocation(state).outcome).toBe("cancel");
  });
  it("resists beyond threshold without a velocity bypass", () => {
    const state = moveInvocation(start(), 100, 300);
    expect(state.reveal).toBeCloseTo(96 + 0.35 * 104);
    expect(endInvocation(moveInvocation(start(), 100, 405)).outcome).toBe("cancel");
  });
  it("cancellation and duplicate releases cannot open", () => {
    const crossed = moveInvocation(start(), 100, 300);
    const cancelled = endInvocation(crossed, true);
    expect(cancelled.outcome).toBe("cancel");
    expect(moveInvocation(cancelled.state, 100, 200)).toBe(cancelled.state);
    expect(endInvocation(cancelled.state).outcome).toBe("cancel");
    expect(endInvocation(endInvocation(crossed).state).outcome).toBe("cancel");
  });
});

describe("Assistant handle detents", () => {
  const geometry = assistantSheetGeometry(800);
  it.each([
    ["partial", 79, "partial"], ["partial", 80, "expanded"],
    ["partial", -79, "partial"], ["partial", -80, "closed"],
    ["expanded", -80, "partial"], ["expanded", -1000, "partial"],
    ["expanded", 1000, "expanded"], ["closed", 1000, "closed"],
  ] as const)("%s with %s travels to %s", (from, travel, to) => {
    expect(releaseAssistantHandle(from, travel, geometry)).toBe(to);
  });
  it("uses a single expanded stop for short viewports or enlarged chrome", () => {
    const short = assistantSheetGeometry(350);
    expect(short.hasPartial).toBe(false);
    expect(initialAssistantDetent(short)).toBe("expanded");
    expect(releaseAssistantHandle("expanded", -short.detentTravel, short)).toBe("closed");
    expect(assistantSheetGeometry(800, 700).hasPartial).toBe(false);
  });
  it("resists overscroll beyond the next stop", () => {
    expect(assistantHandleReveal("expanded", 100, geometry)).toBe(geometry.expanded + 20);
    expect(assistantHandleReveal("partial", -geometry.partial - 100, geometry)).toBe(-20);
    expect(assistantHandleReveal("expanded", -geometry.expanded, geometry)).toBeCloseTo(geometry.partial * 0.8);
    expect(assistantDetentHeight("closed", geometry)).toBe(0);
  });
  it.each([0, -30, NaN, Infinity])("keeps invalid height %s finite", height => {
    expect(assistantSheetGeometry(height).expanded).toBe(0);
  });
});
