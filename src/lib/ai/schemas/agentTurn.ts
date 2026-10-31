/**
 * `AgentTurn` — structured envelope of the constrained learning agent's
 * per-turn model output (design D25 / ai-learning-agent spec, tasks 8.1–8.2,
 * change fix-learning-agent-model-routing-and-tool-orchestration §4).
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
 * Classification: every turn is `kind: "tools" | "final-answer"`. A turn
 * with NEITHER tool calls NOR a final answer (and nothing else) is a TYPED
 * protocol failure (`turn: empty protocol turn`) — it must not be silently
 * accepted as a no-op; the loop applies bounded recovery. Literal placeholder
 * echoes from legacy schema examples (`tool: "tool_name"`, final answers
 * equal to the old placeholder text) are rejected with errors that name the
 * echo.
 *
 * The strict-JSON descriptor is GENERATED from the registry (tool-name enum
 * + rules + a validator-asserted realistic example) — never hand-written
 * prose, so the model-facing contract cannot drift from the allowlist.
 */

import {
  checkNumber,
  checkString,
  isRecord,
  valid,
  type AISchemaNames,
  type ValidationOutcome,
} from "./common";
import { getAgentTool, listAgentToolNames } from "../agent/registry";

/** Hard cap on tool calls accepted in a single model turn. */
export const MAX_TOOL_CALLS_PER_TURN = 4;

/** Hard cap on the final answer length (display-sized, not chunk-sized). */
export const MAX_FINAL_ANSWER_CHARS = 4_000;

/** Legacy placeholder literals that must never be accepted as real output. */
const LEGACY_PLACEHOLDER_TOOL = "tool_name";
const LEGACY_PLACEHOLDER_FINAL_ANSWER = "string (omit while still calling tools)";

export interface AgentToolCall {
  /** Tool name; existence is enforced by the registry at execution time. */
  tool: string;
  /** Raw tool arguments; validated per-tool before execution. */
  input: Record<string, unknown>;
}

export interface AgentTurn {
  /** Classified by the validator, not emitted by the model. */
  kind: "tools" | "final-answer";
  toolCalls: AgentToolCall[];
  /** Present when the model is done — the loop ends with it. */
  finalAnswer?: string;
  /**
   * Informational count of proposals the model believes it emitted; the
   * session's accumulated proposals are the authoritative count for caps.
   */
  proposalsEmitted?: number;
}

/**
 * Build a realistic, validator-passing example turn from the CURRENT
 * registry (first registered propose tool, descriptor-derived values). This
 * is the example embedded in the prompt descriptor — it can never drift from
 * the validatelist because it is produced from it.
 */
function buildAgentTurnExample(): string {
  const names = listAgentToolNames();
  const flashcard = names.includes("propose_flashcard") ? "propose_flashcard" : undefined;
  const toolName =
    flashcard ?? names.find((name) => name.startsWith("propose_")) ?? names[0] ?? "propose_flashcard";
  const tool = getAgentTool(toolName);

  const input: Record<string, unknown> = {};
  if (tool) {
    for (const arg of tool.parameters) {
      if (!arg.required) continue;
      if (arg.example !== undefined) {
        input[arg.name] = arg.example;
      } else if (arg.type === "enum" && arg.enum?.length) {
        input[arg.name] = arg.enum[0];
      } else if (arg.type === "number") {
        input[arg.name] = arg.min ?? 0;
      } else if (arg.type === "boolean") {
        input[arg.name] = true;
      } else if (arg.type === "string[]") {
        input[arg.name] = ["key"];
      } else {
        input[arg.name] = "value";
      }
    }
  }
  return JSON.stringify({ toolCalls: [{ tool: toolName, input }] });
}

const EXAMPLE_TURN = buildAgentTurnExample();
const FINAL_ANSWER_EXAMPLE = JSON.stringify({
  toolCalls: [],
  finalAnswer: "Proposed 5 cards from Chapter 1.",
});

/** Generated, bounded, drift-free strict-JSON descriptor (design §4). */
export const AGENT_TURN_SCHEMA: AISchemaNames = {
  name: "AgentTurn",
  nativeName: "agentTurn",
  json:   [
    "AgentTurn — respond with ONE JSON object, one line, no prose or fences.",
    "Rules: EITHER toolCalls OR finalAnswer; never both placeholder text and calls.",
    `tool must be one of the registered names: ${listAgentToolNames().join(", ")}.`,
    "input parameters are documented in the tool list above; omit unknown BEHAVIOR fields; compact JSON only.",
    "If you cannot act, finish with a short finalAnswer.",
    "",
    `Valid example: ${EXAMPLE_TURN}`,
    "",
    `Final-answer example: ${FINAL_ANSWER_EXAMPLE}`,
    "Do not copy placeholder example strings from older schema versions.",
  ].join("\n"),
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
      if (tool === LEGACY_PLACEHOLDER_TOOL) {
        errors.push(
          `toolCalls[${i}].tool: "tool_name" is a legacy placeholder from an old schema example — use a real registered tool name`
        );
        continue;
      }
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
    if (finalAnswer === LEGACY_PLACEHOLDER_FINAL_ANSWER) {
      errors.push(
        'finalAnswer: "string (omit while still calling tools)" is a legacy placeholder from an old schema example — write a real answer'
      );
    }
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
  if (
    toolCalls.length === 0 &&
    finalAnswer === undefined &&
    (proposalsEmitted === undefined || proposalsEmitted === 0)
  ) {
    // Shape is valid but empty: a typed protocol failure, not a valid no-op.
    return { ok: false, errors: ["turn: empty protocol turn (no tool calls, no finalAnswer)"] };
  }

  const turn: AgentTurn = {
    kind: finalAnswer !== undefined && toolCalls.length === 0 ? "final-answer" : "tools",
    toolCalls,
  };
  if (finalAnswer !== undefined) turn.finalAnswer = finalAnswer;
  if (proposalsEmitted !== undefined) turn.proposalsEmitted = proposalsEmitted;
  return valid(turn);
}
