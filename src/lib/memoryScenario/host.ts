/**
 * Memory-scenario host — the app side of the harness control loop.
 *
 * Mounted from main.tsx as a side-effect import. It:
 *   1. asks the backend for the scenario config (present only when the harness
 *      env vars are set — see commands/memory_scenario.rs),
 *   2. if absent, returns immediately: the surface is inert (task 3.3),
 *   3. if present, enables the activity counter, fetches the corpus manifest,
 *      and long-polls the driver for steps, executing each through the store
 *      actions and reporting completion with the quiescence signal.
 *
 * The module renders nothing and owns no UI.
 */

import { getMemoryScenarioConfig } from "./config";
import { fetchManifest, pollStep, postReport } from "./client";
import { executeStep } from "./executor";
import { waitForQuiescence, resetQuiescence } from "./quiescence";
import { markBusy, isBusy } from "./activity";
import type { MemoryScenarioStep } from "./types";

const POLL_RETRY_MS = 1_000;
/** Fail the run after this many consecutive poll errors (the app reports and stops). */
const MAX_CONSECUTIVE_POLL_ERRORS = 10;

let running = false;

/**
 * Start the scenario loop. Resolves when the scenario ends (driver said
 * "done" or the app is quitting). Inert when the harness env is absent.
 */
export async function startMemoryScenario(): Promise<void> {
  if (running) return;
  console.log("[memoryScenario] host starting; fetching scenario config");
  const config = await getMemoryScenarioConfig();
  console.log("[memoryScenario] config:", config ? "present" : "null (inert)");
  if (!config) return; // Inert: no harness environment.

  running = true;
  // Enable the activity counter BEFORE any step can mark busy.
  window.__memoryScenarioEnabled = true;

  let manifest;
  try {
    manifest = await fetchManifest(config.controlUrl, config.runId);
  } catch (error) {
    console.warn("[memoryScenario] cannot fetch manifest:", error);
    postReport(config.controlUrl, config.runId, {
      step: -1,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    running = false;
    return;
  }

  let consecutiveErrors = 0;
  try {
    for (;;) {
      const polled = await pollStep(config.controlUrl, config.runId);
      if (polled.kind === "done") break;
      if (polled.kind === "error") {
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          postReport(config.controlUrl, config.runId, {
            step: -2,
            status: "error",
            error: `app gave up after ${MAX_CONSECUTIVE_POLL_ERRORS} poll errors: ${polled.message}`,
          });
          break;
        }
        await sleep(POLL_RETRY_MS);
        continue;
      }
      if (polled.kind === "idle") {
        await sleep(POLL_RETRY_MS);
        continue;
      }
      consecutiveErrors = 0;
      const step = polled.step;
      if (step.op === "quit") {
        await reportAfterStep(config, step, undefined);
        await requestAppExit();
        break;
      }
      await runStep(config, step, manifest);
    }
  } finally {
    running = false;
    window.__memoryScenarioEnabled = false;
  }
}

async function runStep(
  config: { controlUrl: string; runId: string },
  step: MemoryScenarioStep,
  manifest: Awaited<ReturnType<typeof fetchManifest>>,
): Promise<void> {
  resetQuiescence();
  markBusy(true); // The step itself is in-flight work.
  try {
    const result = await executeStep(step, manifest);
    // Wait for quiescence for settle steps; other steps report promptly but
    // still carry the quiescence state.
    const quiescence =
      step.op === "settle"
        ? await waitForQuiescence()
        : {
            inFlightTask: isBusy(),
            storeLoading: false,
            storeImporting: false,
            pendingTabsSave: false,
            stabilizationElapsedMs: 0,
            quiescent: false,
          };
    await postReport(config.controlUrl, config.runId, {
      step: step.step,
      status: result.ok ? "done" : "error",
      tabId: result.tabId,
      error: result.error,
      quiescent: step.op === "settle" ? quiescence.quiescent : undefined,
      quiescence: step.op === "settle" ? quiescence : undefined,
    });
  } finally {
    markBusy(false);
  }
}

async function reportAfterStep(
  config: { controlUrl: string; runId: string },
  step: MemoryScenarioStep,
  error: string | undefined,
): Promise<void> {
  await postReport(config.controlUrl, config.runId, {
    step: step.step,
    status: error ? "error" : "done",
    error,
  });
}

/** Ask the application to exit (quit step). */
async function requestAppExit(): Promise<void> {
  try {
    // Tauri: request the window to close; the backend teardown owns process exit.
    window.close();
  } catch {
    // Fall through — the driver terminates the app group on timeout anyway.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
