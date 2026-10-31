/**
 * Truthful outcome classification (change 9.1): only final-answer records
 * success; every bounded ending is incomplete; cancelled/blocked/error keep
 * precedence.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import { clearFeatureDiagnostics, getFeatureSummary } from "../../diagnostics";
import { resolveLearningAgentScope, runLearningAgent } from "../learningAgent";
import type { AgentEnvironment } from "../../agent/tools/types";

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

const TURN = (value: unknown): string => JSON.stringify(value);

function provider(responses: Array<string | Error>) {
  return new FakeAIProvider({
    kind: "ondevice",
    capabilities: { contextTokens: 32000 },
    responses: responses.map((response) =>
      typeof response === "string"
        ? { requestId: `r-${Math.random()}`, text: response }
        : response
    ),
  });
}

function preparedRun(scope: "document" | "library" = "document") {
  const prepared = resolveLearningAgentScope({
    conversationId: "conv-1",
    ownerRevision: 1,
    intent: "Cards from this paper",
    scope,
    documents: scope === "document" ? [{ id: "paper-a", title: "Paper A" }] : [],
  });
  expect(prepared.ok).toBe(true);
  return (prepared as { ok: true; run: Parameters<typeof runLearningAgent>[0] }).run;
}

function generationOutcome() {
  const summary = getFeatureSummary("learning-agent", "rev-1");
  return summary?.stages.generation?.outcome;
}

beforeEach(() => {
  clearFeatureDiagnostics();
});

describe("runLearningAgent outcome classification", () => {
  it("final-answer records success", async () => {
    const run = preparedRun();
    const p = provider([TURN({ finalAnswer: "done" })]);
    const outcome = await runLearningAgent(run, { provider: p, env: env(), wallClockMs: 5_000, guard: () => null });
    expect(outcome.result.endReason).toBe("final-answer");
    expect(generationOutcome()).toBe("success");
  });

  it("no-progress records incomplete, never success", async () => {
    const run = preparedRun();
    const p = provider([
      TURN({ toolCalls: [{ tool: "nope", input: {} }] }),
      TURN({ toolCalls: [{ tool: "nope2", input: {} }] }),
      TURN({ toolCalls: [{ tool: "nope3", input: {} }] }),
    ]);
    const outcome = await runLearningAgent(run, { provider: p, env: env(), wallClockMs: 5_000, guard: () => null });
    expect(outcome.result.endReason).toBe("no-progress");
    expect(generationOutcome()).toBe("incomplete");
  });

  it("tool-budget records incomplete", async () => {
    const run = preparedRun();
    const p = provider([
      TURN({
        toolCalls: [
          { tool: "search_library", input: { query: "a" } },
          { tool: "search_library", input: { query: "b" } },
        ],
      }),
      TURN({ finalAnswer: "forced" }),
    ]);
    const outcome = await runLearningAgent(run, {
      provider: p,
      env: env(),
      wallClockMs: 5_000,
      guard: () => null,
      bounds: { maxToolCalls: 1 },
    });
    expect(outcome.result.endReason).toBe("tool-budget");
    expect(generationOutcome()).toBe("incomplete");
  });

  it("agent-protocol records incomplete", async () => {
    const run = preparedRun();
    const p = provider([TURN({ toolCalls: [] }), TURN({ toolCalls: [] })]);
    const outcome = await runLearningAgent(run, { provider: p, env: env(), wallClockMs: 5_000, guard: () => null });
    expect(outcome.result.endReason).toBe("agent-protocol");
    expect(generationOutcome()).toBe("incomplete");
  });

  it("timeout records incomplete", async () => {
    const run = preparedRun();
    let calls = 0;
    const p = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 120));
          return { requestId: `t${calls}`, text: TURN({ finalAnswer: "late" }) };
        },
      ],
    });
    const outcome = await runLearningAgent(run, { provider: p, env: env(), wallClockMs: 30, guard: () => null });
    expect(outcome.result.endReason).toBe("timeout");
    expect(generationOutcome()).toBe("incomplete");
  });

  it("provider error records failed", async () => {
    const run = preparedRun();
    const p = provider([new Error("boom")]);
    const outcome = await runLearningAgent(run, { provider: p, env: env(), wallClockMs: 5_000, guard: () => null });
    expect(outcome.result.endReason).toBe("error");
    expect(generationOutcome()).toBe("failed");
  });

  it("cancelled keeps its precedence", async () => {
    const run = preparedRun();
    const controller = new AbortController();
    const p = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { contextTokens: 32000 },
      responses: [
        async () => {
          controller.abort();
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { requestId: "t", text: TURN({ finalAnswer: "x" }) };
        },
      ],
    });
    const outcome = await runLearningAgent(run, { provider: p, env: env(), signal: controller.signal, wallClockMs: 5_000, guard: () => null });
    expect(outcome.result.endReason).toBe("cancelled");
    expect(generationOutcome()).toBe("cancelled");
  });

  it("blocked keeps its precedence (cancelled)", async () => {
    const run = preparedRun();
    const p = provider([TURN({ finalAnswer: "done" })]);
    const outcome = await runLearningAgent(run, {
      provider: p,
      env: env(),
      wallClockMs: 5_000,
      guard: () => ({ reason: "source-changed" }),
    });
    expect(outcome.result.endReason).toBe("blocked");
    expect(generationOutcome()).toBe("cancelled");
  });
});
