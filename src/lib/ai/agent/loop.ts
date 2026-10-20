/**
 * Constrained agent loop (design D25 / ai-learning-agent spec, tasks
 * 8.2–8.3, 8.5).
 *
 * A turn loop over `runTask` with a dedicated `agentRunner` task (full model
 * class, structured `AgentTurn` output):
 *
 *   turn → model proposes ≤ 4 tool calls (or a finalAnswer)
 *        → each call: bounds check → registry allowlist → argument
 *          validation → execute → result wrapped as an UNTRUSTED block and
 *          appended to the transcript (D9: tool results re-enter ONLY as
 *          untrusted data)
 *        → loop until finalAnswer or a bound ends the run GRACEFULLY with a
 *          partial-result explanation.
 *
 * The system instruction (tool contract) is STATIC and defined entirely
 * independently of any source content; nothing a tool returns can change the
 * contract. All writes are impossible by construction — proposal tools only
 * accumulate candidates for the user-approval UIs.
 */

import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../tasks/containment";
import { runTask } from "../tasks/runTask";
import { registerTasks } from "../tasks/registry";
import { isAIError } from "../errors";
import type { AIProvider } from "../providers/types";
import type { AITaskDefinition } from "../tasks/types";
import {
  AGENT_TURN_SCHEMA,
  MAX_TOOL_CALLS_PER_TURN,
  validateAgentTurn,
  type AgentTurn,
} from "../schemas/agentTurn";
import { isValidOutcome } from "../schemas/common";
import { agentToolCatalogText } from "./registry";
import {
  createAgentBounds,
  isAgentBoundsExceeded,
  MAX_AGENT_PROPOSALS,
  MAX_AGENT_TOOL_CALLS,
  type AgentBoundsConfig,
  type AgentBoundsExceeded,
  type AgentBoundsTracker,
} from "./bounds";
import {
  createDefaultAgentEnvironment,
  getAgentSessionContext,
} from "./sessionContext";
import {
  createTraceRecorder,
  keepAgentTrace,
  type AgentRunEndReason,
  type AgentTraceEntry,
} from "./trace";
import { recordTaskDiagnostic } from "../diagnostics";
import type { AgentRunDeadline } from "./deadline";
import { createAgentEvidenceMap } from "./evidence";
import type {
  AgentEnvironment,
  AgentProposal,
  AgentProposalInput,
  AgentSessionRuntime,
  AgentSourceRef,
  AgentToolOutcome,
  AgentToolResult,
} from "./tools/types";
import { getAgentTool } from "./registry";

export const AGENT_RUNNER_TASK_ID = "agent-runner";
export const AGENT_TURN_TIMEOUT_MS = 30_000;
export const AGENT_MAX_OUTPUT_TOKENS = 1400;

/**
 * Transcript budget: keep the wrapped tool-result history under this many
 * characters (oldest blocks dropped) so the loop cannot exhaust the context
 * by accumulating results.
 */
export const AGENT_TRANSCRIPT_CHAR_BUDGET = 12_000;

const AGENT_CORE_INSTRUCTION = [
  "You are the user's learning agent. You help with their personal library: finding material, answering from it, and PROPOSING learning items (cards, clozes, extracts, tags) for the user to approve.",
  "Each turn you may EITHER make tool calls OR give a finalAnswer. Rules:",
  `- At most ${MAX_TOOL_CALLS_PER_TURN} tool calls per turn; use the fewest that answer the intent.`,
  "- Tool input must match the documented parameters exactly; unknown parameters are rejected.",
  "- Propose at most a few (typically ≤ 3) high-value items per run — never mass-create; everything you propose is only a suggestion the user reviews.",
  "- Never invent record ids: resolve items by query (tools verify and report not-found).",
  "- Cite the sources you used by naming their document titles / headings in the finalAnswer.",
  "- When the intent is a quiz ('quiz me on this section'), gather the section with tools and ask the questions yourself in the finalAnswer (a separate tutor feature exists for guided tutoring).",
  "- Finish with a concise finalAnswer as soon as you can; do not call tools you do not need.",
  "",
  "Registered tools (calling anything else is rejected):",
  agentToolCatalogText(),
  "",
  "Respond ONLY with the JSON object.",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Task input / definition
// ──────────────────────────────────────────────────────────────────────────

export interface AgentRunnerInput {
  /** The user's intent (their own words — trusted, like a search query). */
  intent: string;
  /** Tool-result blocks, ALREADY untrusted-wrapped by the loop. */
  transcript: string[];
  /** Remaining budgets the model should see (plain numbers, no content). */
  remainingToolCalls: number;
  remainingProposals: number;
  /** Appended on the forced final turn after a bound was hit. */
  forcedFinalNote?: string;
}

export const agentRunnerTask: AITaskDefinition<AgentRunnerInput, AgentTurn> = {
  id: AGENT_RUNNER_TASK_ID,
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${AGENT_CORE_INSTRUCTION}`,
  buildInput: ({ intent, transcript, remainingToolCalls, remainingProposals, forcedFinalNote }) => ({
    text: [
      `Turn context — remaining tool calls: ${remainingToolCalls}, remaining proposals: ${remainingProposals}.`,
      ...(transcript.length > 0 ? ["Tool results so far (untrusted data):", ...transcript] : []),
      ...(forcedFinalNote ? [forcedFinalNote] : []),
      "",
      "User intent:",
      intent,
    ].join("\n"),
  }),
  outputKind: "structured",
  schema: AGENT_TURN_SCHEMA,
  validate: (output) => validateAgentTurn(output),
  maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
  timeoutMs: AGENT_TURN_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
  budgetPolicy: "pre-budgeted",
};

// ──────────────────────────────────────────────────────────────────────────
// Run events (UI progress stream) + result
// ──────────────────────────────────────────────────────────────────────────

export type AgentRunEvent =
  | { type: "turn-start"; turn: number }
  | { type: "tool-result"; tool: string; outcome: AgentToolOutcome; displayDigest: string }
  | { type: "proposal-added"; kind: AgentProposal["kind"]; total: number }
  | { type: "turn-end"; turn: number };

export interface AgentRunGuardViolation {
  /** Stable reason key for the UI (`source-changed`, `destination-changed`, …). */
  reason: string;
  explanation?: string;
}

export interface AgentRunObservation {
  /** Safe capability/config revision recorded on generation observations. */
  capabilityRevision: string;
  /** True for an explicit fixture smoke run. */
  smoke?: boolean;
}

export interface AgentRunOptions {
  intent: string;
  /** Stable run identity; prefixes proposal ids and task target ids. */
  runId?: string;
  /** Environment injection (tests); defaults to the real API wiring. */
  env?: AgentEnvironment;
  /** Provider injection (tests / FakeAIProvider eval runs). */
  provider?: AIProvider;
  kind?: "ondevice" | "cloud";
  signal?: AbortSignal;
  /** Single absolute run deadline (preferred over the per-turn timeout). */
  deadline?: AgentRunDeadline;
  /** Called between turns/tools to stop on a changed source/destination. */
  guard?: (phase: "turn" | "tool" | "final") => AgentRunGuardViolation | null;
  /** D0 generation observations (adapter supplies the feature identity). */
  observation?: AgentRunObservation;
  /** Progress stream for the Assistant. */
  onEvent?: (event: AgentRunEvent) => void;
  /** Bounds overrides (tests). */
  bounds?: AgentBoundsConfig;
}

export interface AgentRunResult {
  /** Final answer (model) or synthesized partial-result answer. */
  answer: string;
  endReason: AgentRunEndReason;
  /** Human explanation for non-final endings (bounds/cancel/errors). */
  explanation?: string;
  sources: AgentSourceRef[];
  proposals: AgentProposal[];
  trace: AgentTraceEntry[];
  turns: number;
  toolCalls: number;
  providerId?: string;
  providerKind?: "ondevice" | "cloud";
  /** Present when the run failed with a typed AIError (endReason "error"). */
  error?: { category: string; message: string };
}

/** Keep the wrapped transcript under the char budget (drop oldest). */
export function boundTranscript(
  blocks: string[],
  budget = AGENT_TRANSCRIPT_CHAR_BUDGET
): string[] {
  const kept: string[] = [];
  let used = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (used + blocks[i].length > budget) break;
    used += blocks[i].length;
    kept.unshift(blocks[i]);
  }
  return kept;
}

function createSession(
  runId: string,
  bounds: AgentBoundsTracker,
  proposals: AgentProposal[],
  onEvent?: (event: AgentRunEvent) => void,
  sourceRevision?: string
): AgentSessionRuntime {
  const session: AgentSessionRuntime = {
    runId,
    proposals,
    proposalCapHit: false,
    evidence: createAgentEvidenceMap(sourceRevision),
    sourceRevision,
    closed: false,
    addProposal(input: AgentProposalInput) {
      if (session.closed) return null;
      if (!bounds.canAddProposal()) {
        session.proposalCapHit = true;
        return null;
      }
      const proposal = {
        ...input,
        proposalId: `${runId}:p${proposals.length + 1}`,
        createdAt: Date.now(),
      } as AgentProposal;
      proposals.push(proposal);
      onEvent?.({ type: "proposal-added", kind: proposal.kind, total: proposals.length });
      return proposal;
    },
    close() {
      session.closed = true;
    },
  };
  return session;
}

/** Resolve after the run's remaining budget, for slow-tool interruption. */
function deadlineRace<T>(
  promise: Promise<T>,
  deadline: AgentRunDeadline
): Promise<
  | { kind: "value"; value: T }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown }
> {
  const remaining = deadline.remainingMs();
  if (remaining <= 0) return Promise.resolve({ kind: "timeout" });
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "timeout" });
    }, remaining);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "value", value });
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ kind: "error", error });
      }
    );
  });
}

function toolResultBlock(name: string, index: number, result: AgentToolResult): string {
  return wrapUntrustedBlock(
    `tool-${name}-${index}`,
    JSON.stringify(result.ok ? result.result : result)
  );
}

const MAX_TURNS_FACTOR = 2;

/**
 * Run the constrained agent loop. NEVER throws for bounds/cancellation —
 * those end the run gracefully. Model/provider failures surface as
 * `endReason: "error"` with a typed `error` payload (the sheet renders it).
 */
export async function runAgentLoop(options: AgentRunOptions): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const runId = options.runId ?? `agent-${startedAt}`;
  const env = options.env ?? createDefaultAgentEnvironment();
  const targetBase = `${runId}:${env.sourceRevision ?? "nosrc"}`;
  const deadline = options.deadline;
  const effectiveSignal = deadline?.signal ?? options.signal;
  const bounds = createAgentBounds({
    ...options.bounds,
    ...(deadline
      ? {
          wallClockMs: Math.max(1, deadline.remainingMs()),
          now: options.bounds?.now,
        }
      : {}),
  });
  const trace = createTraceRecorder();
  const proposals: AgentProposal[] = [];
  const session = createSession(runId, bounds, proposals, options.onEvent, env.sourceRevision);
  const sources: AgentSourceRef[] = [];
  const transcript: string[] = [];

  let turns = 0;
  let toolCalls = 0;
  let providerId: string | undefined;
  let providerKind: "ondevice" | "cloud" | undefined;
  let lastAnswer: string | undefined;
  const maxTurns = (options.bounds?.maxToolCalls ?? MAX_AGENT_TOOL_CALLS) + MAX_TURNS_FACTOR;
  let terminal = false;

  const finish = (
    endReason: AgentRunEndReason,
    answer: string,
    explanation?: string,
    error?: { category: string; message: string }
  ): AgentRunResult => {
    if (!terminal) {
      terminal = true;
      // Late async tools/proposals can never mutate the completed run.
      session.close();
    }
    const runTrace: AgentTraceEntry[] = [...trace.entries()];
    const durationMs = Date.now() - startedAt;
    keepAgentTrace({
      startedAt,
      durationMs,
      turns,
      entries: runTrace,
      proposals: proposals.length,
      endReason,
      providerId,
    });
    recordTaskDiagnostic({
      taskId: AGENT_RUNNER_TASK_ID,
      taskType: "prompt",
      modelClass: "full",
      providerId,
      providerKind,
      agentTurns: turns,
      agentToolCalls: toolCalls,
      agentProposals: proposals.length,
      agentEndReason: endReason,
      totalLatencyMs: durationMs,
      errorCategory: error?.category,
    });
    return {
      answer,
      endReason,
      explanation,
      sources: [...sources],
      proposals: [...proposals],
      trace: runTrace,
      turns,
      toolCalls,
      providerId,
      providerKind,
      error,
    };
  };

  const timeoutResult = (): AgentRunResult =>
    finish(
      "timeout",
      lastAnswer ?? "",
      "Stopped: the run reached its hard deadline. No further model turn was started."
    );

  const guardBlocked = (violation: AgentRunGuardViolation): AgentRunResult =>
    finish(
      "blocked",
      lastAnswer ?? "",
      violation.explanation ??
        "Stopped: the run's frozen sources or destination changed. Revalidate and start a new run."
    );

  const checkBeforeStage = (phase: "turn" | "tool" | "final"): AgentRunResult | null => {
    if (deadline?.expired()) return timeoutResult();
    if (effectiveSignal?.aborted) {
      return finish("cancelled", lastAnswer ?? "", "The run was cancelled.");
    }
    const violation = options.guard?.(phase);
    if (violation) return guardBlocked(violation);
    return null;
  };

  const taskTimeout = (): number | undefined => {
    if (!deadline) return undefined;
    return Math.max(1, Math.min(AGENT_TURN_TIMEOUT_MS, deadline.remainingMs()));
  };

  const observation = options.observation
    ? {
        featureId: "learning-agent" as const,
        runId,
        capabilityRevision: options.observation.capabilityRevision,
        smoke: options.observation.smoke,
      }
    : undefined;

  const forcedFinal = async (note: string): Promise<string | undefined> => {
    const blocked = checkBeforeStage("final");
    if (blocked) return undefined;
    try {
      const run = await runTask(
        agentRunnerTask,
        {
          intent: options.intent,
          transcript: boundTranscript(transcript),
          remainingToolCalls: 0,
          remainingProposals: 0,
          forcedFinalNote: note,
        },
        {
          provider: options.provider,
          kind: options.kind,
          signal: effectiveSignal,
          timeoutMs: taskTimeout(),
          targetId: `agent:${targetBase}:final`,
          observation,
        }
      );
      return run.output.finalAnswer;
    } catch {
      return undefined;
    }
  };

  let noProgressTurns = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const preTurn = checkBeforeStage("turn");
    if (preTurn) return preTurn;

    turns = turn;
    options.onEvent?.({ type: "turn-start", turn });

    let model: AgentTurn;
    try {
      const run = await runTask(
        agentRunnerTask,
        {
          intent: options.intent,
          transcript: boundTranscript(transcript),
          remainingToolCalls: bounds.toolCallsRemaining,
          remainingProposals: Math.max(
            0,
            (options.bounds?.maxProposals ?? MAX_AGENT_PROPOSALS) - bounds.proposalsUsed
          ),
        },
        {
          provider: options.provider,
          kind: options.kind,
          signal: effectiveSignal,
          timeoutMs: taskTimeout(),
          targetId: `agent:${targetBase}:turn:${turn}`,
          observation,
        }
      );
      providerId = run.providerId;
      providerKind = run.providerKind;
      model = run.output;
    } catch (error) {
      if (deadline?.expired()) return timeoutResult();
      if (isAIError(error) && error.category === "Cancelled") {
        return finish(
          deadline?.expiredByDeadline() ? "timeout" : "cancelled",
          lastAnswer ?? "",
          deadline?.expiredByDeadline()
            ? "Stopped: the run reached its hard deadline."
            : "The run was cancelled."
        );
      }
      if (isAIError(error) && error.category === "InvalidStructuredOutput") {
        return finish(
          "invalid-turn",
          lastAnswer ?? "",
          "The model could not produce a valid turn after repair; stopping safely."
        );
      }
      return finish("error", lastAnswer ?? "", "The model request failed.", {
        category: isAIError(error) ? error.category : "GenerationFailed",
        message: (error as Error).message,
      });
    }

    // Execute the validated tool calls under bounds.
    let executedThisTurn = 0;
    let boundHit: AgentBoundsExceeded | undefined;
    let deadlineDuringTool = false;
    let guardDuringTool: AgentRunGuardViolation | null = null;

    for (let i = 0; i < model.toolCalls.length; i++) {
      if (deadline?.expired()) {
        deadlineDuringTool = true;
        break;
      }
      if (effectiveSignal?.aborted) {
        return finish("cancelled", lastAnswer ?? "", "The run was cancelled.");
      }
      const violation = options.guard?.("tool");
      if (violation) {
        guardDuringTool = violation;
        break;
      }

      const call = model.toolCalls[i];
      trace.begin(call.tool, call.input);

      const check = bounds.consume(call.tool, call.input, isRetrievalTool(call.tool));
      if (isAgentBoundsExceeded(check)) {
        trace.end("rejected");
        boundHit = check;
        break;
      }

      const tool = getAgentTool(call.tool);
      if (!tool) {
        // Allowlist: hallucinated / unregistered tools never execute.
        const rejection: AgentToolResult = {
          ok: false,
          outcome: "rejected",
          result: {
            error: "rejected",
            problem: `"${call.tool}" is not a registered tool. Registered tools are fixed; the request was not executed.`,
          },
          displayDigest: `rejected unregistered tool "${call.tool}"`,
        };
        transcript.push(toolResultBlock(call.tool, toolCalls, rejection));
        trace.end("rejected");
        options.onEvent?.({
          type: "tool-result",
          tool: call.tool,
          outcome: "rejected",
          displayDigest: rejection.displayDigest,
        });
        toolCalls += 1;
        continue;
      }

      const validated = tool.validate(call.input);
      let result: AgentToolResult;
      const proposalCountBefore = proposals.length;
      if (!isValidOutcome(validated)) {
        result = {
          ok: false,
          outcome: "invalid-input",
          result: { error: "invalid-input", problems: validated.errors },
          displayDigest: `${call.tool}: invalid arguments (${validated.errors[0]})`,
        };
      } else {
        try {
          const executed = deadline
            ? await deadlineRace(
                tool.execute(validated.value as never, {
                  session,
                  env,
                  signal: effectiveSignal,
                }),
                deadline
              )
            : {
                kind: "value" as const,
                value: await tool.execute(validated.value as never, {
                  session,
                  env,
                  signal: effectiveSignal,
                }),
              };
          if (executed.kind === "timeout") {
            trace.end("error");
            // Close immediately so a late tool callback cannot register a
            // proposal after the deadline, and discard anything it added.
            proposals.length = proposalCountBefore;
            session.close();
            deadlineDuringTool = true;
            break;
          }
          if (executed.kind === "error") {
            throw executed.error;
          }
          result = executed.value;
        } catch (error) {
          result = {
            ok: false,
            outcome: "error",
            result: { error: "error", problem: (error as Error).message },
            displayDigest: `${call.tool} failed`,
          };
        }
      }

      if (deadline?.expired()) {
        // The tool may have completed after the deadline: discard its output
        // and never expose late proposals.
        proposals.length = proposalCountBefore;
        session.close();
        deadlineDuringTool = true;
        break;
      }

      transcript.push(toolResultBlock(call.tool, toolCalls, result));
      if (result.sources) sources.push(...result.sources);
      trace.end(result.outcome);
      options.onEvent?.({
        type: "tool-result",
        tool: call.tool,
        outcome: result.outcome,
        displayDigest: result.displayDigest,
      });
      toolCalls += 1;
      executedThisTurn += 1;
    }

    options.onEvent?.({ type: "turn-end", turn });

    if (deadlineDuringTool) return timeoutResult();
    if (guardDuringTool) return guardBlocked(guardDuringTool);

    if (model.finalAnswer !== undefined) {
      lastAnswer = model.finalAnswer;
    }

    // A bound was hit mid-turn: one forced final answer, then end gracefully.
    if (boundHit) {
      const forced =
        (await forcedFinal(
          "A run limit was reached. Answer now from what you have — no further tool calls."
        )) ?? lastAnswer;
      if (deadline?.expired()) return timeoutResult();
      return finish(boundHit.reason, forced ?? "", boundHit.explanation);
    }

    if (model.finalAnswer !== undefined) {
      return finish("final-answer", model.finalAnswer);
    }

    if (executedThisTurn === 0) {
      noProgressTurns += 1;
      if (noProgressTurns >= 2) {
        return finish(
          "turn-budget",
          lastAnswer ?? "",
          "Stopped: repeated turns made no usable tool calls."
        );
      }
    } else {
      noProgressTurns = 0;
    }
  }

  return finish(
    "turn-budget",
    lastAnswer ?? "",
    "Stopped: the run reached its turn limit."
  );
}

function isRetrievalTool(name: string): boolean {
  return getAgentTool(name)?.category === "retrieval";
}

registerTasks(agentRunnerTask);

/** Session-context read access for the sheet (display only). */
export function currentAgentDocument(): ReturnType<
  ReturnType<typeof getAgentSessionContext>["getDocument"]
> {
  return getAgentSessionContext().getDocument();
}
