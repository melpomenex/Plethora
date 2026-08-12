/**
 * HTTP client for the memory benchmark harness control server.
 *
 * The app connects OUT to the driver's loopback control server (design D2);
 * the driver owns all sampling and timing. This module only: fetches the
 * corpus manifest once, long-polls /step, and POSTs /report.
 */

import type {
  MemoryScenarioManifest,
  MemoryScenarioReport,
  MemoryScenarioStep,
  StepPollResult,
} from "./types";

/** How long the driver holds a /step long-poll before answering 204. */
export const POLL_TIMEOUT_MS = 30_000;

function withRunId(url: string, runId: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}run=${encodeURIComponent(runId)}`;
}

/** Fetch the corpus manifest (corpusId -> fileName). */
export async function fetchManifest(
  controlUrl: string,
  runId: string,
): Promise<MemoryScenarioManifest> {
  const response = await fetch(withRunId(`${controlUrl}/manifest`, runId));
  if (!response.ok) {
    throw new Error(`manifest request failed: HTTP ${response.status}`);
  }
  return (await response.json()) as MemoryScenarioManifest;
}

/**
 * Normalize a driver step body into a MemoryScenarioStep, or null if the body
 * is not a recognized step. The driver is the trusted side; the app still
 * validates rather than executing arbitrary op strings.
 */
export function normalizeStep(body: unknown): MemoryScenarioStep | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as Record<string, unknown>;
  const step = candidate.step;
  const op = candidate.op;
  if (typeof step !== "number" || typeof op !== "string") return null;
  switch (op) {
    case "open":
      if (typeof candidate.corpusId === "string") {
        return { step, op: "open", corpusId: candidate.corpusId };
      }
      return null;
    case "closeTab":
      if (typeof candidate.tabId === "string") {
        return { step, op: "closeTab", tabId: candidate.tabId };
      }
      return null;
    case "closeAll":
    case "settle":
    case "quit":
      return { step, op };
    default:
      return null;
  }
}

/**
 * Long-poll the driver for the next step. Resolves with a step, `idle` (the
 * driver has nothing pending yet), `done` (scenario over), or an error.
 */
export async function pollStep(controlUrl: string, runId: string): Promise<StepPollResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS + 5_000);
  try {
    const response = await fetch(withRunId(`${controlUrl}/step`, runId), {
      signal: controller.signal,
    });
    if (response.status === 204) return { kind: "idle" };
    if (!response.ok) {
      return { kind: "error", message: `step request failed: HTTP ${response.status}` };
    }
    const body = (await response.json()) as { done?: boolean; error?: string };
    if (body.error) return { kind: "error", message: body.error };
    if (body.done) return { kind: "done" };
    const step = normalizeStep(body);
    return step ? { kind: "step", step } : { kind: "idle" };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Report step completion (or failure) to the driver. */
export async function postReport(
  controlUrl: string,
  runId: string,
  report: MemoryScenarioReport,
): Promise<void> {
  try {
    await fetch(withRunId(`${controlUrl}/report`, runId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    });
  } catch (error) {
    // Report loss is not fatal: the driver will notice the missing report and
    // mark the run unreliable.
    console.warn("[memoryScenario] failed to post report:", error);
  }
}
