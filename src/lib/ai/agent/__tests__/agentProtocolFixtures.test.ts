/**
 * Agent protocol failure fixtures (change 1.1): drive the REAL loop/runTask
 * with the failure-class scripts from `agentProtocolFixtures.ts` and assert
 * the post-change, accurate outcomes. The baseline (pre-change) behaviors are
 * documented in the fixture module; these tests assert the flipped contract.
 */

import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import { agentFailureScript, SYNTHETIC_CHAPTER_TEXT } from "../../__fixtures__/agentProtocolFixtures";
import { runAgentLoop } from "../loop";
import type { AgentEnvironment } from "../tools/types";

function testEnv(): AgentEnvironment {
  return {
    sourceScope: "global",
    retrieve: async () => ({
      mode: "semantic",
      results: [
        {
          chunkId: "chunk-entropy",
          documentId: "paper-entropy",
          documentTitle: "Paper A",
          sourceType: "document",
          text: "Entropy is a measure of disorder in a closed system.",
          headingPath: ["Chapter 1"],
          score: 0.9,
          mode: "semantic",
        },
      ],
    }),
    getDocument: () => ({ id: "paper-entropy", title: "Paper A", fileType: "pdf" }),
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

function providerFor(script: string[]) {
  return new FakeAIProvider({
    kind: "ondevice",
    capabilities: { contextTokens: 32000 },
    responses: script.map((text) => ({ requestId: `r-${Math.random()}`, text })),
  });
}

describe("agent protocol failure classes (real loop/runTask)", () => {
  it("empty body twice ends as agent-protocol after bounded recovery", async () => {
    const provider = providerFor(agentFailureScript("empty-body"));
    const outcome = await runAgentLoop({
      intent: "Cards from this section",
      runId: "run-empty",
      env: testEnv(),
      provider,
      guard: () => null,
    });
    // The second empty body arrives after the one recovery note → typed stop.
    expect(outcome.endReason).toBe("agent-protocol");
    expect(outcome.proposals).toHaveLength(0);
    expect(provider.callCount).toBeGreaterThanOrEqual(3);
  });

  it("empty body then a valid final answer completes via repair", async () => {
    const provider = providerFor([
      "",
      JSON.stringify({ finalAnswer: "No cards; the section is short." }),
    ]);
    const outcome = await runAgentLoop({
      intent: "Cards from this section",
      runId: "run-empty-repair",
      env: testEnv(),
      provider,
      guard: () => null,
    });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.answer).toContain("No cards");
  });

  it("placeholder echo cannot end a run (rejected, recovery, then agent-protocol)", async () => {
    const provider = providerFor([agentFailureScript("placeholder-echo")[0]]);
    const outcome = await runAgentLoop({
      intent: "Cards from this paper",
      runId: "run-echo",
      env: testEnv(),
      provider,
      guard: () => null,
    });
    expect(outcome.endReason).toBe("agent-protocol");
    expect(outcome.answer).not.toContain("omit while still calling tools");
  });

  it("unknown-tool-only turns get one corrective note, then a valid answer completes", async () => {
    const provider = providerFor(agentFailureScript("unknown-tool-only"));
    const outcome = await runAgentLoop({
      intent: "Cards from this paper",
      runId: "run-unknown",
      env: testEnv(),
      provider,
      guard: () => null,
    });
    expect(outcome.endReason).toBe("final-answer");
    const joined = provider.requests.map((r) => r.text).join("\n");
    expect(joined).toContain("not registered");
  });

  it("valid tool then final answer completes normally", async () => {
    const provider = providerFor(agentFailureScript("valid-tool-then-answer"));
    const outcome = await runAgentLoop({
      intent: "Cards from this paper",
      runId: "run-valid",
      env: testEnv(),
      provider,
      guard: () => null,
    });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.toolCalls).toBe(1);
    expect(outcome.diagnostics?.tools.attempted).toBe(1);
    expect(outcome.diagnostics?.tools.ok).toBe(1);
  });

  it("the synthetic section is a realistic ~1,000-token fixture", () => {
    expect(SYNTHETIC_CHAPTER_TEXT.length).toBeGreaterThan(3000);
    expect(SYNTHETIC_CHAPTER_TEXT.length / 4).toBeGreaterThanOrEqual(900);
    expect(SYNTHETIC_CHAPTER_TEXT.length / 4).toBeLessThanOrEqual(1200);
  });
});
