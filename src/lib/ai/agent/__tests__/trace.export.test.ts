/**
 * Developer trace export (change 9.3): the export carries the diagnostics
 * ledger + route facts (served model, outcome, counters) and never any
 * prompt/completion text.
 */

import { afterEach, describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import { runAgentLoop } from "../loop";
import { clearAgentTraces, exportAgentTrace, getRecentAgentTraces } from "../trace";
import type { AgentEnvironment } from "../tools/types";

function env(): AgentEnvironment {
  return {
    sourceScope: "global",
    retrieve: async () => ({ results: [], mode: "none" }),
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

afterEach(() => clearAgentTraces());

describe("agent trace export", () => {
  it("includes served model, outcome, and counters; no prompt/completion text", async () => {
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        {
          requestId: "t1",
          text: JSON.stringify({ toolCalls: [{ tool: "search_library", input: { query: "x" } }] }),
          baseModelName: "llama3",
        },
        { requestId: "t2", text: JSON.stringify({ finalAnswer: "done" }), baseModelName: "llama3" },
      ],
    });
    const outcome = await runAgentLoop({
      intent: "user intent text",
      runId: "run-trace",
      env: env(),
      provider: p,
      guard: () => null,
    });
    expect(outcome.endReason).toBe("final-answer");

    expect(getRecentAgentTraces()).toHaveLength(1);
    const exported = exportAgentTrace();
    const parsed = JSON.parse(exported);
    const run = parsed.runs[0];
    expect(run.endReason).toBe("final-answer");
    expect(run.diagnostics.route.servedModel).toBe("llama3");
    expect(run.diagnostics.tools.ok).toBe(1);
    expect(run.diagnostics.turns.executed).toBe(1);
    // Never any prompt/completion content.
    expect(exported).not.toContain("user intent text");
    expect(exported).not.toContain("untrusted_source");
  });
});
