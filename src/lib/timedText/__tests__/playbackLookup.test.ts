import { describe, expect, it } from "vitest";
import {
  resolveActiveEntryIndex,
  STICKY_TOLERANCE_MS,
  TimedTextPlaybackLookup,
} from "../playbackLookup";
import type { TimedTextEntry } from "../types";

function makeEntries(): TimedTextEntry[] {
  return [
    { startMs: 0, endMs: 200, text: "The", locator: null, granularity: "word", wordIndex: 0 },
    { startMs: 200, endMs: 440, text: "quick", locator: null, granularity: "word", wordIndex: 1 },
    { startMs: 440, endMs: 700, text: "brown", locator: null, granularity: "word", wordIndex: 2 },
    { startMs: 700, endMs: 1000, text: "fox", locator: null, granularity: "word", wordIndex: 3 },
  ];
}

describe("TimedTextPlaybackLookup", () => {
  it("finds word at time via sticky resolve", () => {
    const lookup = new TimedTextPlaybackLookup(makeEntries());
    const result = lookup.findAtTime(250);
    expect(result?.entry.text).toBe("quick");
    expect(result?.index).toBe(1);
  });

  it("advances cursor during forward playback", () => {
    const lookup = new TimedTextPlaybackLookup(makeEntries());
    const first = lookup.advance(50);
    expect(first?.entry.text).toBe("The");
    const second = lookup.advance(250);
    expect(second?.entry.text).toBe("quick");
  });

  it("reseeks after large jump", () => {
    const lookup = new TimedTextPlaybackLookup(makeEntries());
    lookup.advance(50);
    const jumped = lookup.findAtTime(800);
    expect(jumped?.entry.text).toBe("fox");
    expect(lookup.advance(800)?.entry.text).toBe("fox");
  });

  it("returns null for empty map", () => {
    const lookup = new TimedTextPlaybackLookup([]);
    expect(lookup.findAtTime(100)).toBeNull();
  });

  it("holds the previous word through a short inter-word gap", () => {
    const entries: TimedTextEntry[] = [
      { startMs: 0, endMs: 200, text: "a", locator: null, granularity: "word", wordIndex: 0 },
      { startMs: 500, endMs: 800, text: "b", locator: null, granularity: "word", wordIndex: 1 },
    ];
    const lookup = new TimedTextPlaybackLookup(entries, { presorted: true });
    expect(lookup.findAtTime(250)?.entry.text).toBe("a");
    expect(lookup.findAtTime(350)?.entry.text).toBe("a");
  });

  it("does not snap to a future word across a multi-second gap", () => {
    const entries: TimedTextEntry[] = [
      { startMs: 0, endMs: 500, text: "a", locator: null, granularity: "word", wordIndex: 0 },
      { startMs: 5000, endMs: 5500, text: "b", locator: null, granularity: "word", wordIndex: 1 },
    ];
    expect(resolveActiveEntryIndex(entries, 2000)).toBe(-1);
    expect(resolveActiveEntryIndex(entries, 3000)).toBe(-1);
    const lookup = new TimedTextPlaybackLookup(entries, { presorted: true });
    expect(lookup.findAtTime(3000)).toBeNull();
    expect(lookup.findAtTime(5200)?.entry.text).toBe("b");
  });

  it("nextActiveWordIndex only commits on change", () => {
    const lookup = new TimedTextPlaybackLookup(makeEntries(), { presorted: true });
    expect(lookup.nextActiveWordIndex(50, -1)).toBe(0);
    expect(lookup.nextActiveWordIndex(100, 0)).toBeNull();
    expect(lookup.nextActiveWordIndex(250, 0)).toBe(1);
  });

  it("uses sticky tolerance constant aligned with wordTimings", () => {
    expect(STICKY_TOLERANCE_MS).toBe(200);
  });
});
