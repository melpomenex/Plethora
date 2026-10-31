/**
 * Privacy/canary sweep (change 11.2): the new diagnostics ledger, trace
 * export, and bounded repair echo never persist source/credential/prompt/
 * completion text beyond the consented prompt path.
 */

import { afterEach, describe, expect, it } from "vitest";
import { clearTaskDiagnostics, getTaskDiagnostics, recordTaskDiagnostic } from "../../diagnostics";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import { runAgentLoop } from "../loop";
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

afterEach(() => clearTaskDiagnostics());

describe("diagnostics ledger privacy canary", () => {
  it("rejects non-allowlisted fields (counter-only by construction)", () => {
    const entry = recordTaskDiagnostic({
      taskId: "agent-runner",
      taskType: "prompt",
      agentTurns: 3,
      agentToolOutcomeCounts: {
        attempted: 5,
        // A caller bug must not smuggle content through the counters object.
        sourceText: "user document content",
        apiKey: "sk-secret",
      } as never,
    });
    expect(entry.agentToolOutcomeCounts?.attempted).toBe(5);
    expect(entry.agentToolOutcomeCounts as Record<string, unknown>).not.toHaveProperty("sourceText");
    expect(entry.agentToolOutcomeCounts as Record<string, unknown>).not.toHaveProperty("apiKey");
  });

  it("run diagnostics carry counts and route facts only, never transcript text", async () => {
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        {
          requestId: "t1",
          text: JSON.stringify({ toolCalls: [{ tool: "search_library", input: { query: "secret phrase" } }] }),
        },
        { requestId: "t2", text: JSON.stringify({ finalAnswer: "done" }) },
      ],
    });
    const outcome = await runAgentLoop({
      intent: "secret user intent",
      runId: "run-privacy",
      env: env(),
      provider: p,
      guard: () => null,
    });
    expect(outcome.endReason).toBe("final-answer");
    const serialized = JSON.stringify(outcome.diagnostics);
    expect(serialized).not.toContain("secret phrase");
    expect(serialized).not.toContain("secret user intent");
    expect(outcome.diagnostics?.tools.ok).toBe(1);
  });

  it("repair echo is bounded to the fixed character cap with a truncation marker", async () => {
    const huge = `"${"x".repeat(5000)}"`;
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "t1", text: huge },
        { requestId: "t2", text: JSON.stringify({ finalAnswer: "ok" }) },
      ],
    });
    await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    const repairRequest = p.requests[1];
    const excerptLine = repairRequest.text.split("\n").find((l) => l.startsWith('"xxx'));
    expect(excerptLine).toBeDefined();
    expect(excerptLine!.length).toBeLessThanOrEqual(2000 + 40);
    expect(repairRequest.text).toContain("[truncated;");
  });
});
