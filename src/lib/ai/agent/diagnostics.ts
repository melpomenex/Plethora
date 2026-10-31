/**
 * Per-run agent diagnostics ledger (change
 * fix-learning-agent-model-routing-and-tool-orchestration §12, task 7.1).
 *
 * Counter-only by construction: route facts, turn/tool/proposal counts and
 * seed facts — never source text, prompts, completions, or credentials. The
 * loop maintains it; trace persistence and the developer export carry it.
 */

import type { AgentRunEndReason } from "./trace";
import type { AgentToolOutcome } from "./tools/types";

/** Tool-outcome counters (one counter per typed outcome category). */
export interface AgentToolOutcomeCounters {
  attempted: number;
  validated: number;
  executed: number;
  ok: number;
  notFound: number;
  notAvailable: number;
  invalidInput: number;
  rejected: number;
  errored: number;
}

export function emptyToolCounters(): AgentToolOutcomeCounters {
  return {
    attempted: 0,
    validated: 0,
    executed: 0,
    ok: 0,
    notFound: 0,
    notAvailable: 0,
    invalidInput: 0,
    rejected: 0,
    errored: 0,
  };
}

export interface AgentRunDiagnosticsRoute {
  selectedProviderId?: string;
  selectedModel?: string;
  servedProviderId?: string;
  servedModel?: string;
  outputMode: "strict-json" | "native-structured";
}

export interface AgentRunDiagnostics {
  route: AgentRunDiagnosticsRoute;
  turns: {
    requested: number;
    executed: number;
    empty: number;
    offContract: number;
    recoveryNotes: number;
  };
  repair: {
    attempted: number;
    succeeded: number;
  };
  tools: AgentToolOutcomeCounters;
  proposals: {
    added: number;
    capRejected: number;
    groundingRejected: number;
  };
  evidence: {
    handleCount: number;
    seededSectionChars: number | null;
    seededTruncated: boolean;
  };
  bounds: {
    endReason: AgentRunEndReason;
    explanationKey?: string;
  };
}

export function createDiagnosticsLedger(): AgentRunDiagnostics {
  return {
    route: { outputMode: "strict-json" },
    turns: { requested: 0, executed: 0, empty: 0, offContract: 0, recoveryNotes: 0 },
    repair: { attempted: 0, succeeded: 0 },
    tools: emptyToolCounters(),
    proposals: { added: 0, capRejected: 0, groundingRejected: 0 },
    evidence: { handleCount: 0, seededSectionChars: null, seededTruncated: false },
    bounds: { endReason: "final-answer" },
  };
}

/**
 * Record one tool outcome into the counters. Returns the updated counters.
 */
export function recordToolOutcome(
  counters: AgentToolOutcomeCounters,
  outcome: AgentToolOutcome
): void {
  counters.attempted += 1;
  switch (outcome) {
    case "ok":
      counters.ok += 1;
      counters.validated += 1;
      counters.executed += 1;
      break;
    case "not-found":
      counters.notFound += 1;
      counters.validated += 1;
      counters.executed += 1;
      break;
    case "not-available":
      counters.notAvailable += 1;
      counters.validated += 1;
      counters.executed += 1;
      break;
    case "invalid-input":
      counters.invalidInput += 1;
      break;
    case "rejected":
      counters.rejected += 1;
      break;
    case "error":
      counters.errored += 1;
      break;
  }
}
