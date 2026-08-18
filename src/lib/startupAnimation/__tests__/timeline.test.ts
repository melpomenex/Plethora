/**
 * Timeline unit tests: canonical phase tables (design D5), sampling purity
 * and stability, and the ≤ 3 opacity transitions/second flashing limit.
 */
import { describe, expect, it } from "vitest";
import { buildTimeline, sampleTimeline } from "../timeline";
import { KP_VARIANTS } from "../variants";
import type { Phase } from "../types";

const desktop = buildTimeline("knowledge-peck", "desktop");
const phone = buildTimeline("knowledge-peck", "phone");

describe("canonical desktop script (D5 table)", () => {
  const script = KP_VARIANTS["knowledge-peck"].desktop;

  it("has 3 fragments and 3 pecks", () => {
    expect(script.fragmentCount).toBe(3);
    expect(script.peckCount).toBe(3);
    const pecks = script.phases.filter((p) => p.name.startsWith("peck-"));
    expect(pecks.map((p) => p.name)).toEqual(["peck-1", "peck-2", "peck-3"]);
  });

  it("places the wordmark resolve (branded span) at 1520 ms, inside 1200–1800", () => {
    expect(script.brandedSpanEnd).toBe(1520);
    expect(script.brandedSpanEnd).toBeGreaterThanOrEqual(1200);
    expect(script.brandedSpanEnd).toBeLessThanOrEqual(1800);
    const wordmark = script.phases.find((p) => p.name === "wordmark")!;
    expect(wordmark.start).toBe(1380);
    expect(wordmark.end).toBe(1520);
  });

  it("matches the D5 phase table exactly (names and ms offsets)", () => {
    const table: Phase[] = [
      { name: "entrance", start: 0, end: 120 },
      { name: "fragments", start: 100, end: 320 },
      { name: "notice", start: 340, end: 500 },
      { name: "peck-1", start: 520, end: 700 },
      { name: "peck-2", start: 720, end: 880 },
      { name: "peck-3", start: 900, end: 1160 },
      { name: "consolidate", start: 1060, end: 1260 },
      { name: "converge", start: 1260, end: 1400 },
      { name: "wordmark", start: 1380, end: 1520 },
      { name: "hold", start: 1520, end: 1640 },
      { name: "reveal", start: 1640, end: 1890 },
    ];
    expect(script.phases).toEqual(table);
  });
});

describe("canonical phone script (D5 table)", () => {
  const script = KP_VARIANTS["knowledge-peck"].phone;

  it("has 2 fragments and 2 pecks — a simpler composition, not shrunken desktop", () => {
    expect(script.fragmentCount).toBe(2);
    expect(script.peckCount).toBe(2);
    expect(script.phases.some((p) => p.name === "peck-3")).toBe(false);
  });

  it("places the branded span at 1080 ms, inside 700–1200", () => {
    expect(script.brandedSpanEnd).toBe(1080);
    expect(script.brandedSpanEnd).toBeGreaterThanOrEqual(700);
    expect(script.brandedSpanEnd).toBeLessThanOrEqual(1200);
  });
});

describe("phase ordering", () => {
  it.each([
    ["desktop", desktop],
    ["phone", phone],
  ] as const)("%s phases are strictly ordered by start", (_label, tl) => {
    for (let i = 1; i < tl.phases.length; i++) {
      expect(tl.phases[i].start).toBeGreaterThan(tl.phases[i - 1].start);
      expect(tl.phases[i].start).toBeLessThan(tl.phases[i].end);
    }
  });
});

describe("sampleTimeline", () => {
  it("returns transform/opacity states only, in a stable order", () => {
    const states = sampleTimeline(desktop, 800);
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) {
      expect(typeof state.id).toBe("string");
      expect(state.opacity).toBeGreaterThanOrEqual(0);
      expect(state.opacity).toBeLessThanOrEqual(1);
      expect(typeof state.transform).toBe("string");
    }
    expect(sampleTimeline(desktop, 800).map((s) => s.id)).toEqual(
      states.map((s) => s.id)
    );
  });

  it("is pure: the same input always yields the same output", () => {
    const a = JSON.stringify(sampleTimeline(desktop, 1234));
    const b = JSON.stringify(sampleTimeline(desktop, 1234));
    expect(a).toBe(b);
  });

  it("is form-factor aware: phone samples a 2-fragment scene", () => {
    const ids = sampleTimeline(phone, 700).map((s) => s.id);
    expect(ids).toContain("fragment-1");
    expect(ids).toContain("fragment-2");
    expect(ids).not.toContain("fragment-3");
    expect(ids).not.toContain("connector-2");
  });

  it("keeps the mascot at opacity 1 from frame one (static-frame parity)", () => {
    for (const t of [0, 1, 50, 100, 800, 1520, 2000]) {
      const bird = sampleTimeline(desktop, t).find((s) => s.id === "bird")!;
      expect(bird.opacity).toBe(1);
    }
  });

  it("animates a pecked fragment into place: card is at its slot after its peck", () => {
    const before = sampleTimeline(desktop, 500).find((s) => s.id === "fragment-1")!;
    const after = sampleTimeline(desktop, 760).find((s) => s.id === "fragment-1")!;
    expect(before.transform).not.toBe(after.transform);
    // After peck-1 (ends 700) the card sits still through peck-2.
    const settled = sampleTimeline(desktop, 760).find((s) => s.id === "fragment-1")!;
    const settledLater = sampleTimeline(desktop, 860).find((s) => s.id === "fragment-1")!;
    expect(settled.transform).toBe(settledLater.transform);
  });

  it("fades fragments out monotonically during converge (no resurrection)", () => {
    const times = [];
    for (let t = 1200; t <= 1500; t += 20) times.push(t);
    for (const id of ["fragment-1", "fragment-2", "fragment-3"]) {
      let prev = 1;
      for (const t of times) {
        const opacity = sampleTimeline(desktop, t).find((s) => s.id === id)!.opacity;
        expect(opacity).toBeLessThanOrEqual(prev + 1e-9);
        prev = opacity;
      }
      expect(prev).toBe(0);
    }
  });
});

describe("flashing limit: no element's opacity oscillates more than 3×/second", () => {
  it.each([
    ["desktop", desktop],
    ["phone", phone],
  ] as const)("%s obeys the limit across sampled frames", (_label, tl) => {
    const fps = 60;
    const windows: [number, number][] = [
      [0, 2000],
      [tl.script.revealAt - 500, tl.script.revealEnd + 500],
    ];
    for (const [from, to] of windows) {
      // Slide 1-second windows across the animation at frame granularity.
      for (let windowStart = from; windowStart < to; windowStart += 250) {
        const ids = sampleTimeline(tl, windowStart).map((s) => s.id);
        for (const id of ids) {
          let directionChanges = 0;
          let lastDelta = 0;
          for (let f = 0; f <= fps; f++) {
            const t = windowStart + (f * 1000) / fps;
            const prevT = t - 1000 / fps;
            if (f === 0) continue;
            const opacity = sampleTimeline(tl, t).find((s) => s.id === id)!.opacity;
            const prev = sampleTimeline(tl, prevT).find((s) => s.id === id)!.opacity;
            const delta = Math.sign(opacity - prev);
            if (delta !== 0 && lastDelta !== 0 && delta !== lastDelta) {
              directionChanges++;
            }
            if (delta !== 0) lastDelta = delta;
          }
          // Each fade in/out contributes one direction change; ≤ 3 allowed.
          expect(
            directionChanges,
            `${id} oscillated ${directionChanges}× in [${windowStart}, ${windowStart + 1000}]`
          ).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});
