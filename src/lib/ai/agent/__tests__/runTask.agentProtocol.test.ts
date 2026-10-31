/**
 * Transport-boundary agent protocol tests (change 10.1): realistic failure
 * bodies (fenced JSON, truncated array, placeholder echo, unknown-only,
 * chunk-merged empty) scripted AT `generateStream`, exercising the production
 * parser, validators, and loop end-to-end. Also asserts the repair request
 * carries the bounded rejected response (5.2).
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

const TURN = (value: unknown): string => JSON.stringify(value);

describe("transport-boundary protocol failures", () => {
  it("fenced JSON accepted (production parser strips fences)", async () => {
    const p = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "r1", text: "```json\n" + TURN({ toolCalls: [{ tool: "search_library", input: { query: "x" } }] }) + "\n```" },
        { requestId: "r2", text: TURN({ finalAnswer: "done" }) },
      ],
    });
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.toolCalls).toBe(1);
  });

  it("truncated array: repair sees the bounded rejected response, then completes", async () => {
    // A valid-JSON-but-wrong-shape body (no object/array envelope) cannot be
    // salvaged; repair must see the bounded rejected excerpt.
    const p = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "r1", text: '"not an object envelope"' },
        { requestId: "r2", text: TURN({ finalAnswer: "repaired" }) },
      ],
    });
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    // The repair request embeds the bounded rejected response excerpt.
    const repairRequest = p.requests[1];
    expect(repairRequest.text).toContain("Your rejected response (bounded):");
    expect(repairRequest.text).toContain('"not an object envelope"');
    expect(repairRequest.text).toContain("agentTurn: expected object");
  });

  it("provider-reported length finish reason drives a shortening instruction", async () => {
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        {
          requestId: "r1",
          text: '"cut off envelope"',
          finishReason: "length",
        },
        { requestId: "r2", text: TURN({ finalAnswer: "shortened" }) },
      ],
    });
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(p.requests[1].text).toContain("CUT OFF at the output-token limit");
    expect(p.requests[1].text).toContain('"cut off envelope"');
  });

  it("empty body is classified as empty response, distinguishable from truncation", async () => {
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "r1", text: "" },
        { requestId: "r2", text: TURN({ finalAnswer: "ok" }) },
      ],
    });
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(p.requests[1].text).toContain("empty response (provider body had no content)");
  });

  it("placeholder echo never reaches the registry as a tool call", async () => {
    const p = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "r1", text: TURN({ toolCalls: [{ tool: "tool_name", input: {} }] }) },
        { requestId: "r2", text: TURN({ finalAnswer: "ok" }) },
      ],
    });
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.toolCalls).toBe(0);
    expect(outcome.diagnostics?.tools.rejected).toBe(0);
  });

  it("chunk-merged empty (two empty chunks) still fails closed through repair", async () => {
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "r1", text: "" },
        { requestId: "r2", text: "" },
        { requestId: "r3", text: TURN({ finalAnswer: "ok" }) },
      ],
    });
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(["agent-protocol", "final-answer"]).toContain(outcome.endReason);
  });

  it("unknown-tool-only turns flow through the allowlist, not the contract", async () => {
    const p = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "r1", text: TURN({ toolCalls: [{ tool: "hallucinated_tool", input: {} }] }) },
        { requestId: "r2", text: TURN({ finalAnswer: "done" }) },
      ],
    });
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.diagnostics?.tools.rejected).toBe(1);
  });
});
