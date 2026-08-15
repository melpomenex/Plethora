/**
 * `AgentTurn` — structured envelope of the constrained learning agent's
 * per-turn model output (design D25 / ai-learning-agent spec, tasks 8.1–8.2).
 *
 * Each loop turn asks the model for EITHER tool calls (≤ 4) or a final
 * answer (or both — tools first, answer after results come back). The
 * validator enforces:
 *  - shape: `toolCalls` is an array of `{tool, input}` with ≤ 4 entries;
 *  - tool names are non-empty strings — but NOT restricted to the registered
 *    allowlist here: an unregistered/hallucinated name is an in-contract
 *    event the executor answers with a typed `rejected` tool result the
 *    model can see (spec: "the agent is informed within its bounds"), not a
 *    structured-output failure that would burn a repair retry;
 *  - `input` must be a JSON object (unknown params are rejected per-tool by
 *    the tool's own validator, again as visible tool results);
 *  - `finalAnswer` when present is a bounded non-empty string.
 *
 * A turn with NEITHER tool calls nor a final answer still validates (the
 * loop treats it as a no-progress turn and applies its turn/loop guards) —
 * the schema's job is shape, the loop's job is contract.
 */

import { checkNumber, checkString, isRecord, valid, type ValidationOutcome } from "./common";

/** Hard cap on tool calls accepted in a single model turn. */
export const MAX_TOOL_CALLS_PER_TURN = 4;

/** Hard cap on the final answer length (display-sized, not chunk-sized). */
export const MAX_FINAL_ANSWER_CHARS = 4_000;

export interface AgentToolCall {
  /** Tool name; existence is enforced by the registry at execution time. */
  tool: string;
  /** Raw tool arguments; validated per-tool before execution. */
  input: Record<string, unknown>;
}

export interface AgentTurn {
  toolCalls: AgentToolCall[];
  /** Present when the model is done — the loop ends with it. */
  finalAnswer?: string;
  /**
   * Informational count of proposals the model believes it emitted; the
   * session's accumulated proposals are the authoritative count for caps.
   */
  proposalsEmitted?: number;
}

export const AGENT_TURN_SCHEMA = {
  name: "AgentTurn",
  nativeName: "agentTurn",
  json: JSON.stringify({
    toolCalls: [{ tool: "tool_name", input: {} }],
    finalAnswer: "string (omit while still calling tools)",
    proposalsEmitted: 0,
  }),
};

export function validateAgentTurn(output: unknown): ValidationOutcome<AgentTurn> {
  if (!isRecord(output)) {
    return { ok: false, errors: ["agentTurn: expected object"] };
  }

  const errors: string[] = [];

  const rawCalls = output.toolCalls === undefined ? [] : output.toolCalls;
  if (!Array.isArray(rawCalls)) {
    errors.push("toolCalls: expected array");
  } else if (rawCalls.length > MAX_TOOL_CALLS_PER_TURN) {
    errors.push(`toolCalls: more than ${MAX_TOOL_CALLS_PER_TURN} calls in one turn`);
  }

  const toolCalls: AgentToolCall[] = [];
  if (Array.isArray(rawCalls)) {
    for (let i = 0; i < rawCalls.length && i <= MAX_TOOL_CALLS_PER_TURN; i++) {
      const entry = rawCalls[i];
      if (!isRecord(entry)) {
        errors.push(`toolCalls[${i}]: expected object`);
        continue;
      }
      const tool = checkString(entry.tool, `toolCalls[${i}].tool`, errors, { maxLength: 64 });
      if (tool === undefined) continue;
      if (!isRecord(entry.input) && entry.input !== undefined) {
        errors.push(`toolCalls[${i}].input: expected object`);
        continue;
      }
      toolCalls.push({ tool, input: (entry.input ?? {}) as Record<string, unknown> });
    }
  }

  let finalAnswer: string | undefined;
  if (output.finalAnswer !== undefined && output.finalAnswer !== null && output.finalAnswer !== "") {
    finalAnswer = checkString(output.finalAnswer, "finalAnswer", errors, {
      maxLength: MAX_FINAL_ANSWER_CHARS,
    });
  }

  let proposalsEmitted: number | undefined;
  if (output.proposalsEmitted !== undefined && output.proposalsEmitted !== null) {
    proposalsEmitted = checkNumber(output.proposalsEmitted, "proposalsEmitted", errors, {
      min: 0,
      max: 100,
      integer: true,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (toolCalls.length === 0 && finalAnswer === undefined) {
    // Shape is valid; the loop's no-progress guard handles this.
    return valid({ toolCalls: [] });
  }

  const turn: AgentTurn = { toolCalls };
  if (finalAnswer !== undefined) turn.finalAnswer = finalAnswer;
  if (proposalsEmitted !== undefined) turn.proposalsEmitted = proposalsEmitted;
  return valid(turn);
}
