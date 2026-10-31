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
import { estimateTokens } from "../chunkTextByTokens";
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
import {
  createDiagnosticsLedger,
  recordToolOutcome,
  type AgentRunDiagnostics,
} from "./diagnostics";
import { recordTaskDiagnostic } from "../diagnostics";
import type { AgentRunDeadline } from "./deadline";
import { createAgentEvidenceMap, type RegisterEvidenceInput } from "./evidence";
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
/**
 * Response budget for one agent turn. Raised 1400 → 2048 (change §14):
 * per-item proposal costs (question ≤600 + answer ≤2000 + handle/evidence)
 * plus the batch envelope (up to 6 drafts per call) no longer fit in 1400
 * tokens without frequent truncation; the truncation signal (finishReason
 * "length") now feeds repair guidance instead of blind re-emission. Measured
 * truncation share must inform the next adjustment.
 */
export const AGENT_MAX_OUTPUT_TOKENS = 2048;

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
  "- Propose about 5 high-value cards per run by default (3–6); honor an explicit user count up to the run's proposal limit; never mass-create. Everything you propose is only a suggestion the user reviews.",
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
  /** Corrective protocol note injected after an off-contract turn. */
  recoveryNote?: string;
}

export const agentRunnerTask: AITaskDefinition<AgentRunnerInput, AgentTurn> = {
  id: AGENT_RUNNER_TASK_ID,
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${AGENT_CORE_INSTRUCTION}`,
  buildInput: ({ intent, transcript, remainingToolCalls, remainingProposals, forcedFinalNote, recoveryNote }) => ({
    text: [
      `Turn context — remaining tool calls: ${remainingToolCalls}, remaining proposals: ${remainingProposals}.`,
      ...(transcript.length > 0 ? ["Tool results so far (untrusted data):", ...transcript] : []),
      ...(recoveryNote ? [recoveryNote] : []),
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
  /**
   * Initial transcript blocks (deterministic seat): already untrusted-wrapped
   * source text seeded before the first model turn.
   */
  initialTranscript?: string[];
  /** Evidence records to register at session creation (e.g. the seat). */
  evidenceSeeds?: RegisterEvidenceInput[];
  /** Seat facts for diagnostics (lengths only, never content). */
  seed?: { sectionChars: number; truncated: boolean };
  /** Selection facts (selected provider/model) for route disclosure. */
  selection?: { providerId?: string; model?: string };
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
  /** Model that actually served the turns (AIResponse.baseModelName). */
  servedModel?: string;
  /** Selection facts (the provider/model the user picked at submit). */
  selectedProviderId?: string;
  selectedModel?: string;
  /** Counter-only run ledger (route facts + outcomes). */
  diagnostics?: AgentRunDiagnostics;
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
  sourceRevision?: string,
  evidenceSeeds: RegisterEvidenceInput[] = [],
  ledger?: AgentRunDiagnostics
): AgentSessionRuntime {
  const evidence = createAgentEvidenceMap(sourceRevision);
  for (const seed of evidenceSeeds) {
    evidence.register(seed);
  }
  const session: AgentSessionRuntime = {
    runId,
    proposals,
    proposalCapHit: false,
    evidence,
    sourceRevision,
    closed: false,
    addProposal(input: AgentProposalInput) {
      if (session.closed) return null;
      if (!bounds.canAddProposal()) {
        session.proposalCapHit = true;
        if (ledger) ledger.proposals.capRejected += 1;
        return null;
      }
      const proposal = {
        ...input,
        proposalId: `${runId}:p${proposals.length + 1}`,
        createdAt: Date.now(),
      } as AgentProposal;
      proposals.push(proposal);
      if (ledger) ledger.proposals.added += 1;
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
 *
 * Recovery (design §8.2): one corrective recovery turn per run after an
 * off-contract turn (empty/malformed/truncated), then `agent-protocol` on a
 * second failure; unregistered-tool-only turns get one note; the no-progress
 * counter may reset at most twice run-wide.
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
  const ledger = createDiagnosticsLedger();
  const proposals: AgentProposal[] = [];
  const session = createSession(
    runId,
    bounds,
    proposals,
    options.onEvent,
    env.sourceRevision,
    options.evidenceSeeds,
    ledger
  );
  const sources: AgentSourceRef[] = [];
  const transcript: string[] = [...(options.initialTranscript ?? [])];

  let turns = 0;
  let toolCalls = 0;
  let providerId: string | undefined;
  let providerKind: "ondevice" | "cloud" | undefined;
  let servedModel: string | undefined;
  let lastAnswer: string | undefined;
  const maxTurns = (options.bounds?.maxToolCalls ?? MAX_AGENT_TOOL_CALLS) + MAX_TURNS_FACTOR;
  let terminal = false;

  let protocolRecoveryUsed = false;
  let pendingRecoveryNote: string | undefined;
  let unregisteredNoteUsed = false;
  let noProgressResets = 0;

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
    ledger.bounds.endReason = endReason;
    ledger.bounds.explanationKey = endReason;
    ledger.route.servedProviderId = providerId;
    ledger.route.servedModel = servedModel;
    ledger.route.selectedProviderId = options.selection?.providerId;
    ledger.route.selectedModel = options.selection?.model;
    ledger.evidence.handleCount = session.evidence.size();
    if (options.seed) {
      ledger.evidence.seededSectionChars = options.seed.sectionChars;
      ledger.evidence.seededTruncated = options.seed.truncated;
    }
    keepAgentTrace({
      startedAt,
      durationMs,
      turns,
      entries: runTrace,
      proposals: proposals.length,
      endReason,
      providerId,
      diagnostics: ledger,
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
      agentSelectedProviderId: options.selection?.providerId,
      agentSelectedModel: options.selection?.model,
      agentServedProviderId: providerId,
      agentServedModel: servedModel,
      agentEmptyTurns: ledger.turns.empty,
      agentOffContractTurns: ledger.turns.offContract,
      agentRecoveryNotes: ledger.turns.recoveryNotes,
      agentRepairAttempted: ledger.repair.attempted,
      agentRepairSucceeded: ledger.repair.succeeded,
      agentToolOutcomeCounts: { ...ledger.tools },
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
      servedModel,
      selectedProviderId: options.selection?.providerId,
      selectedModel: options.selection?.model,
      diagnostics: ledger,
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

  /**
   * Loop-level token fit check (design §14): estimate the prompt (system +
   * contract + seat + transcript + intent) plus the output reserve against
   * the provider's declared context. Over-budget ends typed before any
   * generateStream — silent provider-side overflow becomes diagnosable.
   */
  const fitCheck = async (): Promise<AgentRunResult | null> => {
    if (!options.provider) return null;
    const caps = await options.provider.getCapabilities().catch(() => undefined);
    if (!caps || !caps.contextTokens || caps.contextTokens <= 0) return null;
    const promptText =
      agentRunnerTask.systemInstruction +
      "\n" +
      AGENT_TURN_SCHEMA.json +
      "\n" +
      options.intent +
      "\n" +
      transcript.join("\n");
    const estimate = estimateTokens(promptText) + AGENT_MAX_OUTPUT_TOKENS;
    if (estimate <= caps.contextTokens) return null;
    return finish(
      "error",
      lastAnswer ?? "",
      options.seed
        ? "The selected model's context is too small for the chosen section; shorten the scope or select a smaller section."
        : "The selected model's context is too small for this run.",
      {
        category: "InputTooLarge",
        message: `Estimated ${estimate} tokens exceeds the provider context of ${caps.contextTokens}.`,
      }
    );
  };

  const initialFit = await fitCheck();
  if (initialFit) return initialFit;

  let noProgressTurns = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const preTurn = checkBeforeStage("turn");
    if (preTurn) return preTurn;

    turns = turn;
    ledger.turns.requested += 1;
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
          ...(pendingRecoveryNote !== undefined ? { recoveryNote: pendingRecoveryNote } : {}),
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
      pendingRecoveryNote = undefined;
      providerId = run.providerId;
      providerKind = run.providerKind;
      servedModel = run.baseModelName ?? servedModel;
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
        const detailErrors = ((error as { details?: unknown }).details ?? []) as string[];
        const empty = detailErrors.some(
          (d) => typeof d === "string" && d.includes("empty protocol turn")
        );
        if (empty) ledger.turns.empty += 1;
        else ledger.turns.offContract += 1;
        ledger.repair.attempted += 1;
        if (!protocolRecoveryUsed) {
          protocolRecoveryUsed = true;
          ledger.turns.recoveryNotes += 1;
          pendingRecoveryNote =
            "That turn was off-contract (malformed, truncated, or empty). Respond again per the contract with tool calls, or finish with a short finalAnswer.";
          continue;
        }
        return finish(
          "agent-protocol",
          lastAnswer ?? "",
          "The model could not produce a valid turn after bounded recovery; stopping safely."
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
    let sawRegisteredTool = false;

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
        recordToolOutcome(ledger.tools, "rejected");
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
        recordToolOutcome(ledger.tools, "rejected");
        options.onEvent?.({
          type: "tool-result",
          tool: call.tool,
          outcome: "rejected",
          displayDigest: rejection.displayDigest,
        });
        toolCalls += 1;
        continue;
      }
      sawRegisteredTool = true;

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
        recordToolOutcome(ledger.tools, "invalid-input");
        if (tool.category === "propose") ledger.proposals.groundingRejected += 1;
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
            recordToolOutcome(ledger.tools, "error");
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
          recordToolOutcome(ledger.tools, result.outcome);
          if (result.outcome === "invalid-input" && tool.category === "propose") {
            ledger.proposals.groundingRejected += 1;
          }
        } catch (error) {
          result = {
            ok: false,
            outcome: "error",
            result: { error: "error", problem: (error as Error).message },
            displayDigest: `${call.tool} failed`,
          };
          recordToolOutcome(ledger.tools, "error");
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

    // Progress semantics (design §7): executed progress = ≥1 registered +
    // bounds-accepted tool call executed to a typed outcome this turn.
    if (executedThisTurn === 0) {
      const unregisteredOnly = !sawRegisteredTool;
      if (unregisteredOnly && !unregisteredNoteUsed && noProgressResets < 2) {
        // One deterministic corrective note for hallucinated tool names.
        unregisteredNoteUsed = true;
        noProgressResets += 1;
        ledger.turns.recoveryNotes += 1;
        pendingRecoveryNote =
          "Those tool names are not registered; use only the names in the tool list. No calls were executed.";
        ledger.turns.offContract += 1;
        noProgressTurns = 0;
      } else {
        noProgressTurns += 1;
        if (noProgressTurns >= 2) {
          return finish(
            "no-progress",
            lastAnswer ?? "",
            "Stopped: repeated turns made no usable tool calls."
          );
        }
      }
    } else {
      noProgressTurns = 0;
      ledger.turns.executed += 1;
    }

    // Re-check token fit after tool results accumulated into the transcript.
    const postFit = await fitCheck();
    if (postFit) return postFit;
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
