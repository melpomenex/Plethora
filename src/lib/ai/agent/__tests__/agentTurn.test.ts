/**
 * `AgentTurn` structured-output validator tests (task 8.2).
 */

import { describe, expect, it } from "vitest";
import { isFailedOutcome, isValidOutcome } from "../../schemas/common";
import {
  AGENT_TURN_SCHEMA,
  MAX_TOOL_CALLS_PER_TURN,
  validateAgentTurn,
} from "../../schemas/agentTurn";

describe("validateAgentTurn", () => {
  it("accepts a tool-call turn", () => {
    const outcome = validateAgentTurn({
      toolCalls: [{ tool: "search_library", input: { query: "entropy" } }],
    });
    expect(outcome.ok).toBe(true);
    if (isValidOutcome(outcome)) {
      expect(outcome.value.toolCalls).toHaveLength(1);
      expect(outcome.value.finalAnswer).toBeUndefined();
    }
  });

  it("accepts a final-answer turn and normalizes omission", () => {
    const outcome = validateAgentTurn({ toolCalls: [], finalAnswer: "Done." });
    expect(outcome.ok).toBe(true);
    if (isValidOutcome(outcome)) expect(outcome.value.finalAnswer).toBe("Done.");
  });

  it("defaults missing toolCalls to an empty list", () => {
    const outcome = validateAgentTurn({ finalAnswer: "All set." });
    expect(outcome.ok).toBe(true);
    if (isValidOutcome(outcome)) expect(outcome.value.toolCalls).toEqual([]);
  });

  it("accepts a no-progress turn as shape-valid (the loop guards progress)", () => {
    const outcome = validateAgentTurn({});
    expect(outcome.ok).toBe(true);
    if (isValidOutcome(outcome)) expect(outcome.value.toolCalls).toEqual([]);
  });

  it("accepts unknown tool names (the registry answers them in-contract)", () => {
    const outcome = validateAgentTurn({
      toolCalls: [{ tool: "delete_all_cards", input: {} }],
    });
    expect(outcome.ok).toBe(true);
  });

  it("defaults input to an empty object when omitted", () => {
    const outcome = validateAgentTurn({ toolCalls: [{ tool: "get_due_cards" }] });
    expect(outcome.ok).toBe(true);
    if (isValidOutcome(outcome)) expect(outcome.value.toolCalls[0].input).toEqual({});
  });

  it("rejects more than 4 tool calls in one turn", () => {
    const calls = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, (_, i) => ({
      tool: `t${i}`,
      input: {},
    }));
    const outcome = validateAgentTurn({ toolCalls: calls });
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) expect(outcome.errors[0]).toContain("more than 4");
  });

  it("rejects non-string tool names and non-object inputs", () => {
    const outcome = validateAgentTurn({
      toolCalls: [
        { tool: 42, input: {} },
        { tool: "ok", input: "not-an-object" },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) {
      expect(outcome.errors.join(" ")).toContain("expected string");
      expect(outcome.errors.join(" ")).toContain("expected object");
    }
  });

  it("rejects non-array toolCalls", () => {
    const outcome = validateAgentTurn({ toolCalls: "search" });
    expect(outcome.ok).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(validateAgentTurn("turn").ok).toBe(false);
    expect(validateAgentTurn([1, 2]).ok).toBe(false);
    expect(validateAgentTurn(null).ok).toBe(false);
  });

  it("bounds the final answer and validates proposalsEmitted as an integer", () => {
    expect(validateAgentTurn({ finalAnswer: "x".repeat(4001) }).ok).toBe(false);
    expect(validateAgentTurn({ finalAnswer: "ok", proposalsEmitted: 1.5 }).ok).toBe(false);
    expect(validateAgentTurn({ finalAnswer: "ok", proposalsEmitted: -1 }).ok).toBe(false);
    const ok = validateAgentTurn({ finalAnswer: "ok", proposalsEmitted: 2 });
    expect(ok.ok).toBe(true);
  });

  it("exposes the strict-JSON shape descriptor for prompt mode", () => {
    expect(AGENT_TURN_SCHEMA.name).toBe("AgentTurn");
    expect(AGENT_TURN_SCHEMA.json).toContain("toolCalls");
    expect(AGENT_TURN_SCHEMA.json).toContain("finalAnswer");
  });
});
