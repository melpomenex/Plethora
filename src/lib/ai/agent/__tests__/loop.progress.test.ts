/**
 * Progress semantics ledger (change 7.1): every run's story must be
 * reconstructible from counters. Executed progress = ≥1 registered +
 * bounds-accepted tool call executed to any typed outcome that turn;
 * unregistered-only and off-contract turns are no-progress; the seat counts
 * as evidence.
 */

import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import { runAgentLoop } from "../loop";
import { wrapUntrustedBlock } from "../../tasks/containment";
import type { AgentEnvironment } from "../tools/types";

function env(overrides: Partial<AgentEnvironment> = {}): AgentEnvironment {
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
    ...overrides,
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

describe("agent loop progress ledger", () => {
  it("valid retrieval counts as executed progress", async () => {
    const p = provider([
      TURN({ toolCalls: [{ tool: "search_library", input: { query: "entropy" } }] }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.diagnostics?.turns.executed).toBe(1);
    expect(outcome.diagnostics?.tools.ok).toBe(1);
  });

  it("invalid-input is executed progress (typed outcome)", async () => {
    const p = provider([
      TURN({
        toolCalls: [
          { tool: "propose_flashcard", input: { question: "Q", answer: "A" } },
          { tool: "propose_flashcard", input: { question: "Q2" } },
        ],
      }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.diagnostics?.tools.invalidInput).toBe(1);
    expect(outcome.diagnostics?.turns.executed).toBe(1);
  });

  it("not-found tool outcome is executed progress", async () => {
    const p = provider([
      TURN({ toolCalls: [{ tool: "propose_tag", input: { cardQuery: "zzz-missing", tag: "t" } }] }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.diagnostics?.tools.notFound).toBe(1);
  });

  it("not-available outcome is executed progress", async () => {
    const p = provider([
      TURN({ toolCalls: [{ tool: "get_current_document", input: {} }] }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({
      intent: "i",
      runId: "r",
      env: env({ getDocument: () => null }),
      provider: p,
      guard: () => null,
    });
    expect(outcome.diagnostics?.tools.notAvailable).toBe(1);
  });

  it("rejected unregistered tools are no-progress until the note is used", async () => {
    const p = provider([
      TURN({ toolCalls: [{ tool: "not_a_tool", input: {} }] }),
      TURN({ toolCalls: [{ tool: "search_library", input: { query: "entropy" } }] }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.diagnostics?.tools.rejected).toBe(1);
    expect(outcome.diagnostics?.turns.recoveryNotes).toBe(1);
  });

  it("bounds-rejected calls are no-progress and end via the bound", async () => {
    const p = provider([
      TURN({
        toolCalls: [
          { tool: "search_library", input: { query: "a" } },
          { tool: "search_library", input: { query: "b" } },
        ],
      }),
      TURN({ finalAnswer: "forced" }),
    ]);
    const outcome = await runAgentLoop({
      intent: "i",
      runId: "r",
      env: env(),
      provider: p,
      guard: () => null,
      bounds: { maxToolCalls: 1 },
    });
    expect(outcome.endReason).toBe("tool-budget");
    expect(outcome.diagnostics?.tools.rejected).toBe(1);
  });

  it("settings protocol-turn failures are counted distinctly", async () => {
    const p = provider([TURN({ toolCalls: [] }), TURN({ toolCalls: [] })]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("agent-protocol");
    expect(outcome.diagnostics?.turns.empty).toBe(2);
  });

  it("malformed-body off-contract turns are counted distinctly", async () => {
    const p = provider(["this is not json", "still not json"]);
    const outcome = await runAgentLoop({ intent: "i", runId: "r", env: env(), provider: p, guard: () => null });
    expect(outcome.endReason).toBe("agent-protocol");
    expect(outcome.diagnostics?.turns.offContract).toBeGreaterThanOrEqual(2);
  });

  it("a seeded start registers evidence and counts it", async () => {
    const p = provider([
      TURN({
        toolCalls: [
          {
            tool: "propose_flashcard",
            input: { question: "Q?", answer: "A.", sourceHandle: "s1" },
          },
        ],
      }),
      TURN({ finalAnswer: "done" }),
    ]);
    const outcome = await runAgentLoop({
      intent: "i",
      runId: "r",
      env: env(),
      provider: p,
      guard: () => null,
      initialTranscript: [wrapUntrustedBlock("frozen-section-s1", "Seeded section text.")],
      evidenceSeeds: [
        {
          kind: "selection",
          recordId: "section:ch1",
          documentId: "d1",
          text: "Seeded section text.",
        },
      ],
      seed: { sectionChars: 19, truncated: false },
    });
    expect(outcome.endReason).toBe("final-answer");
    expect(outcome.proposals).toHaveLength(1);
    expect(outcome.diagnostics?.evidence.handleCount).toBeGreaterThanOrEqual(1);
    expect(outcome.diagnostics?.evidence.seededSectionChars).toBe(19);
    expect(outcome.diagnostics?.evidence.seededTruncated).toBe(false);
  });
});
