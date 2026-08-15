/**
 * Agent execution tracing (design D25 / ai-learning-agent spec, task 8.5).
 *
 * Per-run trace: [{tool, argsDigest (fnv1a of the normalized args — NEVER
 * raw content), durationMs, outcome category}] plus bounds consumption and
 * the end reason. Traces are:
 *  - recorded into diagnostics through the privacy-sanitized allowlist
 *    (`recordTaskDiagnostic` additive agent fields — counts and categories
 *    only; the no-user-content rule is enforced by `diagnostics.ts`);
 *  - kept in a small in-memory ring (last 5 runs) for the developer debug
 *    inspection view (`exportAgentTrace()`) — ephemeral by design D22, and
 *    contain no user content by construction.
 */

import { fnv1aHash } from "../providers/types";
import { normalizeToolCallKey } from "./bounds";
import type { AgentToolOutcome } from "./tools/types";
import type { AgentBoundReason } from "./bounds";

export type AgentRunEndReason =
  | "final-answer"
  | AgentBoundReason
  | "cancelled"
  | "invalid-turn"
  | "error";

export interface AgentTraceEntry {
  tool: string;
  /** fnv1a of the normalized (tool, input) pair — content-free identity. */
  argsDigest: string;
  durationMs: number;
  outcome: AgentToolOutcome;
}

export interface AgentRunTrace {
  /** Epoch ms when the run started. */
  startedAt: number;
  /** Total wall-clock duration of the run. */
  durationMs: number;
  turns: number;
  entries: AgentTraceEntry[];
  proposals: number;
  endReason: AgentRunEndReason;
  /** Provider id that served the turns (diagnostics provenance). */
  providerId?: string;
}

export interface AgentTraceRecorder {
  /** Call BEFORE executing a tool; pair with `end()`. */
  begin(tool: string, input: unknown): void;
  end(outcome: AgentToolOutcome): void;
  /** Snapshot for the UI (progress stream) — read-only. */
  entries(): readonly AgentTraceEntry[];
}

export function createTraceRecorder(now: () => number = Date.now): AgentTraceRecorder {
  const entries: AgentTraceEntry[] = [];
  let open: { tool: string; digest: string; at: number } | null = null;

  return {
    begin(tool, input) {
      const key = normalizeToolCallKey(tool, input);
      open = { tool, digest: fnv1aHash(key), at: now() };
    },
    end(outcome) {
      if (!open) return;
      entries.push({
        tool: open.tool,
        argsDigest: open.digest,
        durationMs: Math.max(0, now() - open.at),
        outcome,
      });
      open = null;
    },
    entries: () => entries,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Dev-inspectable ring buffer (last 5 runs; no user content)
// ──────────────────────────────────────────────────────────────────────────

const MAX_KEPT_TRACES = 5;
const recentTraces: AgentRunTrace[] = [];

export function keepAgentTrace(trace: AgentRunTrace): void {
  recentTraces.push(trace);
  if (recentTraces.length > MAX_KEPT_TRACES) recentTraces.shift();
}

export function getRecentAgentTraces(): readonly AgentRunTrace[] {
  return recentTraces;
}

export function clearAgentTraces(): void {
  recentTraces.length = 0;
}

/**
 * Developer debug export (settings → AI → diagnostics): JSON-ready, sorted
 * oldest→newest. Contains tools, digests, durations, outcomes, bounds —
 * never argument or result content.
 */
export function exportAgentTrace(): string {
  return JSON.stringify(
    {
      keptRuns: recentTraces.length,
      runs: recentTraces.map((trace) => ({
        startedAt: trace.startedAt,
        durationMs: trace.durationMs,
        turns: trace.turns,
        proposals: trace.proposals,
        endReason: trace.endReason,
        providerId: trace.providerId,
        toolCalls: trace.entries.map((e) => ({
          tool: e.tool,
          argsDigest: e.argsDigest,
          durationMs: e.durationMs,
          outcome: e.outcome,
        })),
      })),
    },
    null,
    2
  );
}
