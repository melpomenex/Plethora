/**
 * Bounded recovery (change 7.2): one corrective recovery turn per run after
 * an off-contract turn; second failure → agent-protocol; unregistered-tool-
 * only turns get one note; the no-progress counter resets at most twice
 * run-wide; all under the existing limits/deadline/guard checks.
 */

import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import { runAgentLoop } from "../loop";
import type { AgentEnvironment } from "../tools/types";

function env(): AgentEnvironment {
  return {
    sourceScope: "global",
    retrieve: async () => ({
      mode: "semantic",
      results: [
        {
          chunkId: "c1",
          documentId: "d1",
          documentTitle: "Doc",
          sourceType: "document",
          text: "Ground truth passage.",
          headingPath: ["Ch 1"],
          score: 0.9,
          mode: "semantic",
        },
      ],
    }),
    getDocument: () => ({ id: "d1", title: "Doc", fileType: "pdf" }),
    getSelection: () => null,
    getRecentExtracts: async () => [],
    getCards: async () => [],
    getDueCards: async () => [],
    getReviewStats: async () => ({
      totalItems: 0,
      totalReviews: 0,
      totalLapses: 0,
      avgInterval: 0,
      retentionEstimate: 0,
      dueToday: 0,
      dueWeek: 0,
      dueMonth: 0,
    }),
    getImageAsset: async () => null,
  };
}

function provider(responses: string[]) {
  return new FakeAIProvider({
    kind: "ondevice",
    capabilities: { contextTokens: 32000 },
    responses: responses.map((text) => ({ requestId: `r-${Math.random()}`, text })),
  });
}

const TURN = (value: unknown): string => JSON.stringify(value);

describe("agent loop bounded recovery", () => {
  it("empty → recovery note → tools completes", async () => {
    const p = provider([
      TURN({ toolCalls: [] }),
      TURN({ toolCalls: [] }),
      TURN({ toolCalls: [{ tool: "search_library", input: { query: "entropy" } }] }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    // The recovery note was injected before the third request.
    expect(p.requests[2].text).toContain("off-contract");
    expect(outcome.diagnostics?.turns.recoveryNotes).toBe(1);
  });

  it("invalid ×2 → agent-protocol", async () => {
    const p = provider(["not json", "not json", "not json", "not json"]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("agent-protocol");
    expect(outcome.diagnostics?.repair.attempted).toBe(2);
  });

  it("unregistered-only → one note, then registered calls", async () => {
    const p = provider([
      TURN({ toolCalls: [{ tool: "nope", input: {} }] }),
      TURN({ toolCalls: [{ tool: "search_library", input: { query: "entropy" } }] }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(p.requests[1].text).toContain("not registered");
    expect(outcome.diagnostics?.turns.recoveryNotes).toBe(1);
  });

  it("repeated unregistered-only turns end as no-progress (reset budget bounded)", async () => {
    const p = provider([
      TURN({ toolCalls: [{ tool: "nope", input: {} }] }),
      TURN({ toolCalls: [{ tool: "nope2", input: {} }] }),
      TURN({ toolCalls: [{ tool: "nope3", input: {} }] }),
      TURN({ toolCalls: [{ tool: "nope4", input: {} }] }),
    ]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("no-progress");
    expect(outcome.diagnostics?.turns.recoveryNotes).toBe(1);
  });

  it("recovery stays inside the run deadline and signal", async () => {
    const controller = new AbortController();
    const p = provider([TURN({ toolCalls: [] }), TURN({ toolCalls: [] }), TURN({ finalAnswer: "x" })]);
    setTimeout(() => controller.abort(), 5);
    const outcome = await runAgentLoop({
      intent: "i",
      runId: "r",
      env: env(),
      provider: p,
      signal: controller.signal,
      guard: () => null,
    });
    expect(["cancelled", "agent-protocol", "final-answer"]).toContain(outcome.endReason);
  });

  it("no unbounded turn escalation on a fully empty sequence", async () => {
    const p = provider([TURN({ toolCalls: [] }), TURN({ toolCalls: [] }), TURN({ toolCalls: [] }), TURN({ toolCalls: [] })]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("agent-protocol");
    expect(outcome.turns).toBeLessThanOrEqual(4);
  });
});
