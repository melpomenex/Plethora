import { afterEach, describe, expect, it } from "vitest";
import { runAgentLoop } from "../loop";
import { createAgentDeadline } from "../deadline";
import { registerAgentTool, resetAgentToolRegistry } from "../registry";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import type { AgentEnvironment, AgentToolDefinition } from "../tools/types";

function emptyEnv(): AgentEnvironment {
  return {
    sourceScope: "global",
    retrieve: async () => ({ results: [], mode: "none" }),
    getDocument: () => ({ id: "doc-1", title: "Doc", fileType: "pdf" }),
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

const slowTool: AgentToolDefinition<Record<string, never>> = {
  name: "test_slow_tool",
  description: "test-only slow tool",
  category: "read",
  parameters: [],
  validate: () => ({ ok: true, value: {} }),
  execute: () => new Promise(() => {}),
};

afterEach(() => {
  resetAgentToolRegistry();
});

describe("one hard run deadline", () => {
  it("interrupts a slow tool and starts no further model turn", async () => {
    registerAgentTool(slowTool);
    const provider = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        {
          requestId: "t1",
          text: JSON.stringify({ toolCalls: [{ tool: "test_slow_tool", input: {} }] }),
        },
        { requestId: "t2", text: JSON.stringify({ finalAnswer: "should never run" }) },
      ],
    });
    const outcome = await runAgentLoop({
      intent: "slow",
      runId: "run-slow",
      env: emptyEnv(),
      provider,
      deadline: createAgentDeadline({ wallClockMs: 30 }),
    });
    expect(outcome.endReason).toBe("timeout");
    expect(outcome.proposals).toHaveLength(0);
    expect(provider.callCount).toBe(1);
  });

  it("does not call the provider when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new FakeAIProvider({ kind: "ondevice", capabilities: { contextTokens: 32000 } });
    const outcome = await runAgentLoop({
      intent: "cancelled",
      runId: "run-cancelled",
      env: emptyEnv(),
      provider,
      signal: controller.signal,
    });
    expect(outcome.endReason).toBe("cancelled");
    expect(provider.callCount).toBe(0);
  });

  it("keeps concurrent runs with the same intent independent (unique target ids)", async () => {
    const provider = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [{ requestId: "r", text: JSON.stringify({ finalAnswer: "done" }) }],
    });
    const [first, second] = await Promise.all([
      runAgentLoop({ intent: "same intent", runId: "run-a", env: emptyEnv(), provider }),
      runAgentLoop({ intent: "same intent", runId: "run-b", env: emptyEnv(), provider }),
    ]);
    expect(first.endReason).toBe("final-answer");
    expect(second.endReason).toBe("final-answer");
    expect(provider.callCount).toBe(2);
  });
});
