/**
 * Bounded error-recorder tests (task 3.2 / D6): 10,000 identical errors →
 * one aggregate; distinct-signature cap evicts lowest-count-oldest;
 * disabled-by-default under a production configuration.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNATURE_CAP,
  getErrorAggregates,
  getErrorRecorderRetainedBytes,
  normalizeMessage,
  recordError,
  resetErrorRecorderForTests,
} from "../errorRecorder";

const setGate = (value: boolean | null) => {
  (window as unknown as { __plethoraDiagnosticsTestOverride?: boolean | null }).__plethoraDiagnosticsTestOverride = value;
};

beforeEach(() => {
  resetErrorRecorderForTests();
  setGate(true);
});

afterEach(() => {
  setGate(null);
});

describe("duplicate aggregation", () => {
  it("ten thousand identical errors produce one aggregate with count 10000", () => {
    for (let i = 0; i < 10_000; i++) {
      recordError({ type: "error", message: "ResizeObserver loop failed at line 42", stack: "Error: boom\n at x" });
    }
    const aggregates = getErrorAggregates();
    expect(aggregates.length).toBe(1);
    expect(aggregates[0].count).toBe(10_000);
    expect(aggregates[0].type).toBe("error");
    expect(aggregates[0].sampleStack).toContain("boom");
  });

  it("retained bytes are independent of the occurrence count", () => {
    recordError({ type: "error", message: "one" });
    const single = getErrorRecorderRetainedBytes();
    for (let i = 0; i < 5_000; i++) {
      recordError({ type: "error", message: "one" });
    }
    expect(getErrorRecorderRetainedBytes()).toBe(single);
  });

  it("messages differing only in numbers share a signature", () => {
    recordError({ type: "unhandledrejection", message: "chunk 12 of 30 failed" });
    recordError({ type: "unhandledrejection", message: "chunk 97 of 104 failed" });
    expect(getErrorAggregates().length).toBe(1);
    expect(getErrorAggregates()[0].count).toBe(2);
  });
});

describe("signature cap", () => {
  it("more distinct signatures than the cap evicts the lowest-count, oldest first", () => {
    const cap = DEFAULT_SIGNATURE_CAP; // 64
    // Number-free distinct messages (digits would normalize into one
    // signature — that behavior is covered in the aggregation tests).
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const name = (i: number) => `distinct-${letters[i % 26]}-${letters[Math.floor(i / 26)]}`;
    // 1. Fill with distinct singles.
    for (let i = 0; i < cap; i++) {
      recordError({ type: "error", message: name(i) });
    }
    // 2. Give the FIRST entries high counts so they survive eviction.
    for (let i = 0; i < 10; i++) {
      for (let r = 0; r < 5; r++) recordError({ type: "error", message: name(i) });
    }
    // 3. Push one more distinct signature -> forces an eviction.
    recordError({ type: "error", message: "the-newcomer" });
    const aggregates = getErrorAggregates();
    expect(aggregates.length).toBe(cap);
    const messages = aggregates.map((a) => a.message);
    expect(messages).toContain("the-newcomer"); // new signature still recorded
    expect(messages).toContain(name(0)); // count-6 survivor
    expect(messages).toContain(name(9)); // count-6 survivor
    // Exactly one pure single from the tail was evicted.
    const tailSingles = Array.from({ length: cap }, (_, i) => name(i)).filter(
      (m) => !messages.includes(m),
    );
    expect(tailSingles.length).toBe(1);
  });
});

describe("normalization", () => {
  it("collapses whitespace, numbers, and truncates", () => {
    expect(normalizeMessage("a   b\t\nc 12dd 34")).toBe("a b c #dd #");
    expect(normalizeMessage("x".repeat(500)).length).toBe(200);
  });
});

describe("production default", () => {
  it("records nothing when the diagnostics gate is off (production config)", () => {
    setGate(false);
    recordError({ type: "error", message: "nope" });
    recordError({ type: "unhandledrejection", message: "also nope" });
    expect(getErrorAggregates().length).toBe(0);
    // Enabling the switch restores recording without a rebuild.
    setGate(true);
    recordError({ type: "error", message: "now recording" });
    expect(getErrorAggregates().length).toBe(1);
  });
});
