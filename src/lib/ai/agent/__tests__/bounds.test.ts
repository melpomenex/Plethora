/**
 * Exhaustive bounds tests (task 8.2): every bound, its boundary value, and
 * the graceful typed ending it produces.
 */

import { describe, expect, it } from "vitest";
import {
  AGENT_LOOP_REPEAT_LIMIT,
  MAX_AGENT_RETRIEVAL_HOPS,
  MAX_AGENT_TOOL_CALLS,
  createAgentBounds,
  isAgentBoundsExceeded,
  normalizeToolCallKey,
} from "../bounds";

describe("normalizeToolCallKey (loop-detection identity)", () => {
  it("treats key order as insignificant", () => {
    expect(normalizeToolCallKey("t", { a: 1, b: 2 })).toBe(normalizeToolCallKey("t", { b: 2, a: 1 }));
  });

  it("treats undefined-valued keys as absent", () => {
    expect(normalizeToolCallKey("t", { a: 1, b: undefined })).toBe(normalizeToolCallKey("t", { a: 1 }));
  });

  it("distinguishes tools, args, and nesting", () => {
    const key = normalizeToolCallKey("t", { a: { b: 1 } });
    expect(key).not.toBe(normalizeToolCallKey("u", { a: { b: 1 } }));
    expect(key).not.toBe(normalizeToolCallKey("t", { a: { b: 2 } }));
    expect(key).not.toBe(normalizeToolCallKey("t", { a: [1] }));
  });
});

describe("tool-call budget", () => {
  it("allows exactly MAX_AGENT_TOOL_CALLS calls then rejects with tool-budget", () => {
    const bounds = createAgentBounds();
    for (let i = 0; i < MAX_AGENT_TOOL_CALLS; i++) {
      expect(bounds.consume(`tool-${i}`, { i }, false)).toEqual({ ok: true });
    }
    expect(bounds.toolCallsRemaining).toBe(0);
    const check = bounds.consume("one-more", {}, false);
    expect(check.ok).toBe(false);
    if (isAgentBoundsExceeded(check)) {
      expect(check.reason).toBe("tool-budget");
      expect(check.explanation).toContain("8 tool calls");
    }
    // The rejected call is not counted.
    expect(bounds.toolCallsUsed).toBe(MAX_AGENT_TOOL_CALLS);
  });

  it("respects a reduced maxToolCalls override", () => {
    const bounds = createAgentBounds({ maxToolCalls: 2 });
    expect(bounds.consume("a", {}, false).ok).toBe(true);
    expect(bounds.consume("b", {}, false).ok).toBe(true);
    const check = bounds.consume("c", {}, false);
    expect(check.ok).toBe(false);
    if (isAgentBoundsExceeded(check)) expect(check.reason).toBe("tool-budget");
  });
});

describe("wall-clock budget", () => {
  it("ends with timeout once the deadline passes (checked before anything else)", () => {
    let clock = 1_000;
    const bounds = createAgentBounds({ wallClockMs: 5_000, now: () => clock });
    expect(bounds.consume("a", {}, false).ok).toBe(true);
    clock += 5_001;
    expect(bounds.timedOut()).toBe(true);
    const check = bounds.consume("b", {}, false);
    expect(check.ok).toBe(false);
    if (isAgentBoundsExceeded(check)) expect(check.reason).toBe("timeout");
    // Even a loop-shaped or over-budget call reports timeout first.
    expect(bounds.exhausted).toBe(true);
  });

  it("allows calls at the exact deadline boundary", () => {
    let clock = 0;
    const bounds = createAgentBounds({ wallClockMs: 100, now: () => clock });
    clock = 100; // deadline == now → not past it
    expect(bounds.consume("a", {}, false).ok).toBe(true);
  });
});

describe("retrieval-hop budget", () => {
  it("allows the first retrieval plus MAX_AGENT_RETRIEVAL_HOPS chained ones", () => {
    const bounds = createAgentBounds();
    expect(bounds.consume("search_library", { query: "a" }, true).ok).toBe(true);
    expect(bounds.consume("search_library", { query: "b" }, true).ok).toBe(true);
    expect(bounds.consume("get_related_material", { topic: "c" }, true).ok).toBe(true);
    const check = bounds.consume("search_library", { query: "d" }, true);
    expect(check.ok).toBe(false);
    if (isAgentBoundsExceeded(check)) expect(check.reason).toBe("retrieval-hops");
  });

  it("does not count non-retrieval tools against the hop budget", () => {
    const bounds = createAgentBounds();
    for (let i = 0; i < 5; i++) {
      expect(bounds.consume("get_existing_cards", { limit: i }, false).ok).toBe(true);
    }
    expect(bounds.consume("search_library", { query: "x" }, true).ok).toBe(true);
  });
});

describe("loop detection", () => {
  it("terminates on the 3rd identical tool+input pair", () => {
    const bounds = createAgentBounds();
    const input = { query: "entropy" };
    expect(bounds.consume("search_library", input, true).ok).toBe(true);
    expect(bounds.consume("search_library", input, true).ok).toBe(true);
    const check = bounds.consume("search_library", input, true);
    expect(check.ok).toBe(false);
    if (isAgentBoundsExceeded(check)) {
      expect(check.reason).toBe("loop-detected");
      expect(check.explanation).toContain("search_library");
    }
  });

  it("does not fire for distinct inputs of the same tool", () => {
    const bounds = createAgentBounds();
    expect(bounds.consume("t", { q: 1 }, false).ok).toBe(true);
    expect(bounds.consume("t", { q: 2 }, false).ok).toBe(true);
    expect(bounds.consume("t", { q: 3 }, false).ok).toBe(true);
  });

  it("fires at the configured repeat limit", () => {
    const bounds = createAgentBounds({ loopRepeatLimit: 2 });
    expect(bounds.consume("t", { q: 1 }, false).ok).toBe(true);
    const check = bounds.consume("t", { q: 1 }, false);
    expect(check.ok).toBe(false);
    if (isAgentBoundsExceeded(check)) expect(check.reason).toBe("loop-detected");
  });

  it("uses the default repeat limit of 3", () => {
    expect(AGENT_LOOP_REPEAT_LIMIT).toBe(3);
  });
});

describe("proposal budget", () => {
  it("accepts up to 20 proposals then rejects additions", () => {
    const bounds = createAgentBounds();
    for (let i = 0; i < 20; i++) expect(bounds.canAddProposal()).toBe(true);
    expect(bounds.canAddProposal()).toBe(false);
    expect(bounds.canAddProposal()).toBe(false);
    expect(bounds.proposalsUsed).toBe(20);
  });

  it("respects the maxProposals override regardless of model output", () => {
    const bounds = createAgentBounds({ maxProposals: 2 });
    expect(bounds.canAddProposal()).toBe(true);
    expect(bounds.canAddProposal()).toBe(true);
    expect(bounds.canAddProposal()).toBe(false);
  });
});

describe("defaults", () => {
  it("matches the design D25 bound table", () => {
    expect(MAX_AGENT_TOOL_CALLS).toBe(8);
    expect(MAX_AGENT_RETRIEVAL_HOPS).toBe(2);
  });
});
