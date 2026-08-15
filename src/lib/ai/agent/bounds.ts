/**
 * Agent execution bounds (design D25 / ai-learning-agent spec, task 8.2).
 *
 * PURE module (injectable clock) so every bound is exhaustively testable:
 *   ≤ 8 tool calls total        (tool budget)
 *   ≤ 20 proposals total        (proposal budget — also enforced in the
 *                                 session regardless of model output)
 *   ≤ 60 s wall clock           (checked every turn and before every tool)
 *   ≤ 2 retrieval hops          (a retrieval call whose input follows earlier
 *                                 tool results; the first retrieval is free,
 *                                 so the cap bounds chained retrieval at 3)
 *   loop detection              (same tool + normalized input 3× → stop)
 *
 * Every bound produces a GRACEFUL ending: the checker returns a typed
 * `exceeded` with a stable reason key + explanation the loop turns into the
 * run's partial-result ending — never a crash, never an unbounded wait.
 */

export const MAX_AGENT_TOOL_CALLS = 8;
export const MAX_AGENT_PROPOSALS = 20;
export const MAX_AGENT_WALL_CLOCK_MS = 60_000;
export const MAX_AGENT_RETRIEVAL_HOPS = 2;
/** Same tool + normalized input seen this many times → loop. */
export const AGENT_LOOP_REPEAT_LIMIT = 3;

export type AgentBoundReason =
  | "tool-budget"
  | "proposal-budget"
  | "timeout"
  | "retrieval-hops"
  | "loop-detected"
  | "turn-budget";

export interface AgentBoundsExceeded {
  ok: false;
  reason: AgentBoundReason;
  explanation: string;
}

export interface AgentBoundsOk {
  ok: true;
}

export type AgentBoundsCheck = AgentBoundsOk | AgentBoundsExceeded;

export function isAgentBoundsExceeded(check: AgentBoundsCheck): check is AgentBoundsExceeded {
  return check.ok === false;
}

/** Normalized tool-call identity for loop detection. */
export function normalizeToolCallKey(tool: string, input: unknown): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return entries.map(([k, v]) => [k, stable(v)]);
    }
    return value;
  };
  return `${tool}::${JSON.stringify(stable(input))}`;
}

export interface AgentBoundsTracker {
  /** Remaining tool-call budget (never negative). */
  readonly toolCallsRemaining: number;
  readonly toolCallsUsed: number;
  readonly proposalsUsed: number;
  readonly retrievalCallsUsed: number;
  /** True once any bound has been exceeded (checked without consuming). */
  readonly exhausted: boolean;
  /**
   * Consume one tool call. Checks (in order): wall clock, tool budget,
   * loop detection (this call would be the 3rd identical), retrieval hops
   * (this call is a retrieval informed by earlier results).
   * On failure the call is NOT executed and NOT counted (except loop
   * detection counts the observation).
   */
  consume(tool: string, input: unknown, isRetrieval: boolean): AgentBoundsCheck;
  /** Observe proposals added; rejects the addition over the cap. */
  canAddProposal(): boolean;
  /** Observe that the proposal cap rejected at least one attempt. */
  noteProposalCapHit(): void;
  /** True when the wall clock has passed the deadline. */
  timedOut(): boolean;
}

export interface AgentBoundsConfig {
  maxToolCalls?: number;
  maxProposals?: number;
  wallClockMs?: number;
  maxRetrievalHops?: number;
  loopRepeatLimit?: number;
  /** Injectable clock (tests); defaults to Date.now. */
  now?: () => number;
}

export function createAgentBounds(config: AgentBoundsConfig = {}): AgentBoundsTracker {
  const maxToolCalls = config.maxToolCalls ?? MAX_AGENT_TOOL_CALLS;
  const maxProposals = config.maxProposals ?? MAX_AGENT_PROPOSALS;
  const wallClockMs = config.wallClockMs ?? MAX_AGENT_WALL_CLOCK_MS;
  const maxRetrievalHops = config.maxRetrievalHops ?? MAX_AGENT_RETRIEVAL_HOPS;
  const loopRepeatLimit = config.loopRepeatLimit ?? AGENT_LOOP_REPEAT_LIMIT;
  const now = config.now ?? Date.now;

  const deadline = now() + wallClockMs;
  let toolCallsUsed = 0;
  let retrievalCallsUsed = 0;
  let proposalsUsed = 0;
  let proposalCapHit = false;
  let exceeded: AgentBoundsExceeded | null = null;
  const callCounts = new Map<string, number>();

  const fail = (reason: AgentBoundReason, explanation: string): AgentBoundsExceeded => {
    const hit: AgentBoundsExceeded = { ok: false, reason, explanation };
    if (!exceeded) exceeded = hit;
    return hit;
  };

  return {
    get toolCallsRemaining() {
      return Math.max(0, maxToolCalls - toolCallsUsed);
    },
    get toolCallsUsed() {
      return toolCallsUsed;
    },
    get proposalsUsed() {
      return proposalsUsed;
    },
    get retrievalCallsUsed() {
      return retrievalCallsUsed;
    },
    get exhausted() {
      return exceeded !== null || now() > deadline;
    },

    consume(tool, input, isRetrieval): AgentBoundsCheck {
      // 1. Wall clock — checked first; a timed-out run grants nothing.
      if (now() > deadline) {
        return fail(
          "timeout",
          `Stopped: the run exceeded its ${(wallClockMs / 1000).toFixed(0)}s time budget.`
        );
      }

      // 2. Loop detection (counting the observation even on rejection).
      const key = normalizeToolCallKey(tool, input);
      const seen = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, seen);
      if (seen >= loopRepeatLimit) {
        return fail(
          "loop-detected",
          `Stopped: "${tool}" was called with the same arguments ${seen} times without progress.`
        );
      }

      // 3. Tool budget.
      if (toolCallsUsed >= maxToolCalls) {
        return fail(
          "tool-budget",
          `Stopped: the run reached its limit of ${maxToolCalls} tool calls.`
        );
      }

      // 4. Retrieval hops: every retrieval AFTER the first is a hop (its
      //    input is by then informed by earlier tool results).
      if (isRetrieval) {
        const hops = retrievalCallsUsed; // calls already made = hops so far
        if (hops >= maxRetrievalHops + 1) {
          return fail(
            "retrieval-hops",
            `Stopped: the run exceeded its limit of ${maxRetrievalHops} chained retrieval steps.`
          );
        }
        retrievalCallsUsed += 1;
      }

      toolCallsUsed += 1;
      return { ok: true };
    },

    canAddProposal(): boolean {
      if (proposalsUsed >= maxProposals) {
        proposalCapHit = true;
        return false;
      }
      proposalsUsed += 1;
      return true;
    },

    noteProposalCapHit() {
      proposalCapHit = true;
    },

    timedOut() {
      return now() > deadline;
    },
  };
}

/**
 * The proposal-cap state the loop reports: bounds consume a proposal slot on
 * `canAddProposal()`, so a rejection is visible via the tracker's
 * `proposalsUsed === max` + the cap-hit flag (exposed on the run result).
 */
export function proposalBudgetExplanation(max = MAX_AGENT_PROPOSALS): string {
  return `Stopped accepting proposals: the run reached its limit of ${max} proposals.`;
}
