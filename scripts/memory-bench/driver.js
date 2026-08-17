#!/usr/bin/env node
/**
 * Memory benchmark driver (tasks 3.4, 3.5, 3.6, 3.8, 3.9).
 *
 * Launches the app in its own process group with the harness environment
 * (PLETHORA_MEMORY_SCENARIO / _CONTROL / _RUN_ID / _CORPUS_DIR), serves the
 * step protocol on a loopback control server, drives the fixed scenario,
 * samples process memory at every settle point, and writes a machine-readable
 * result. Terminates the app at the end of the scenario.
 *
 * Failure semantics (spec "A stage that cannot complete fails the run"):
 *   - a step the app reports as failed  -> exit non-zero, no result file
 *   - the app exits mid-scenario        -> exit non-zero, no result file
 *   - a settle timeout                  -> sample still taken, run marked
 *     `reliable: false` with the reason (design D5)
 *
 * Usage:
 *   node scripts/memory-bench/driver.js [--app <binary>] [--cycles <n>]
 *       [--corpus-dir <path>] [--output <path>] [--provision]
 */

import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkMemoryCollectionSupported } from "./platform.js";
import { provisionCorpus } from "./corpus.js";
import { buildScenarioStages } from "./scenario.js";
import { createControlServer } from "./control.js";
import { waitForSettle } from "./settle.js";
import { discoverProcesses } from "./discovery.js";
import { aggregateSample, readProcessSample } from "./sample.js";
import { writeResult, collectEnvironment } from "./result.js";
import { sleep } from "./util.js";

export const DEFAULT_OUTPUT = join(process.cwd(), ".bench", "memory-result.json");
export const DEFAULT_CORPUS_DIR = join(process.cwd(), ".bench", "corpus");
const DEFAULT_APP = join(process.cwd(), "src-tauri", "target", "debug", "plethora-tauri");

const RUN_ID_ENV = "PLETHORA_MEMORY_RUN_ID";

let sequence = 0;
const nextStepNumber = () => (sequence += 1);

/** Driver progress log (timestamped, to stderr). */
function log(message) {
  console.error(`[driver ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

/** Push a step but fail (rather than hang) when the app never picks it up. */
async function pushWithTimeout(control, step, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      control.pushStep(step),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`app did not pick up step ${step.step} within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Default sampler: real /proc discovery + aggregation. */
async function defaultSampleTree({ procRoot, launchedPid, runId }) {
  const processes = discoverProcesses({ procRoot, launchedPid, runId });
  const sample = aggregateSample(processes, (pid) => readProcessSample(procRoot, pid));
  return sample;
}

/** Sample one tree-Pss value from the live app processes. */
async function readTreePssVia(sampler, { procRoot, launchedPid, runId }) {
  const sample = await sampler({ procRoot, launchedPid, runId });
  return sample.total.Pss ?? 0;
}

/**
 * Run the scenario against a launched app.
 *
 * @param {object} deps — injectable for tests:
 *   spawnApp(env) -> { pid, exited: Promise<number|null>, killGroup(), stop() }
 *   startControl() -> control server handle (defaults to a real one)
 *   appClient(url) -> optional fake app-side driver (tests)
 *   sampleTree(launchedPid) -> optional injectable sampler returning
 *     { processes, total, complete } (defaults to the /proc implementation)
 *   options: { runId, cycleCount, corpusDir, outputPath, procRoot, settle,
 *              stepTimeoutMs }
 */
export async function runScenario(deps) {
  const {
    spawnApp,
    startControl = null,
    appClient = null,
    sampleTree = defaultSampleTree,
    options,
  } = deps;
  const {
    runId = randomUUID(),
    cycleCount,
    corpusDir,
    outputPath,
    procRoot = "/proc",
    settle = {},
    stepTimeoutMs = 60_000,
  } = options;

  // 1. Platform gate: unsupported -> no result file.
  const platform = checkMemoryCollectionSupported({ procRoot });
  if (!platform.supported) {
    if (options.allowUnsupportedPlatform) {
      log(`WARNING: platform not supported for measurement (${platform.reason}); running anyway (debug-only, numbers are NOT comparable)`);
    } else {
      return {
        ok: false,
        reliable: false,
        reason: `unsupported environment: ${platform.reason}`,
        resultWritten: false,
      };
    }
  }

  // 2. Corpus (provision + verify).
  let corpus;
  try {
    const provisioned = await provisionCorpus({ corpusDir });
    const itemHashes = {};
    for (const fileName of Object.values(provisioned.items)) {
      itemHashes[fileName] = sha256OfFile(join(corpusDir, fileName));
    }
    corpus = {
      items: provisioned.items,
      corpusDir: provisioned.corpusDir,
      itemHashes,
      manifestSha256: sha256OfFile(join(process.cwd(), "scripts", "memory-bench", "corpus.json")),
    };
  } catch (error) {
    return { ok: false, reliable: false, reason: `corpus: ${error.message}`, resultWritten: false };
  }

  // 3. Control server.
  let control;
  if (startControl) {
    control = await startControl();
  } else {
    const created = createControlServer({
      runId,
      getManifest: () => ({ items: corpus.items, corpusDir: corpus.corpusDir }),
    });
    const { url } = await created.start();
    control = { ...created, url };
  }

  // 4. Launch the app with the harness environment.
  const appEnv = {
    ...process.env,
    PLETHORA_MEMORY_SCENARIO: "1",
    PLETHORA_MEMORY_CONTROL: control.url,
    [RUN_ID_ENV]: runId,
    PLETHORA_MEMORY_CORPUS_DIR: corpus.corpusDir,
    // Deterministic harness runs: never auto-import the demo books into the
    // benchmark data dir.
    SKIP_DEMO_IMPORT: "1",
  };
  let child;
  try {
    child = await spawnApp(appEnv);
  } catch (error) {
    await control.close?.().catch(() => {});
    return { ok: false, reliable: false, reason: `failed to launch app: ${error.message}`, resultWritten: false };
  }

  const startedAtIso = new Date().toISOString();
  const phases = buildScenarioStages({ cycleCount });
  const samples = [];
  let reliable = true;
  let unreliableReason = null;
  let hardFailure = null;

  // A fake app client (tests) may take over the app side of the protocol.
  if (appClient) appClient(control.url, runId);

  try {
    for (const phase of phases) {
      // Resolve tabRef placeholders from this phase's open reports.
      const openedTabIds = [];
      for (const stepSpec of phase.steps) {
        let payload = stepSpec;
        if (stepSpec.op === "closeTab") {
          const idx = Number(/^open:(\d+)$/.exec(stepSpec.tabRef)?.[1]);
          const tabId = Number.isInteger(idx) ? openedTabIds[idx] : undefined;
          if (!tabId) {
            hardFailure = `phase "${phase.key}": closeTab "${stepSpec.tabRef}" has no matching open tab id`;
            break;
          }
          payload = { op: "closeTab", tabId };
        }

        const step = { step: nextStepNumber(), ...payload };
        try {
          await pushWithTimeout(control, step, stepTimeoutMs);
          log(`pushed step ${step.step}: ${step.op}`);
        } catch (error) {
          hardFailure = `phase "${phase.key}": ${error.message}`;
          break;
        }

        let report;
        try {
          report = await control.waitForReport(step.step, stepTimeoutMs);
          log(`report for step ${step.step}: status=${report.status}${report.error ? ` error=${report.error}` : ""}`);
        } catch (error) {
          hardFailure = `phase "${phase.key}": ${error.message}`;
          break;
        }
        if (report.status === "error") {
          hardFailure = `phase "${phase.key}": app reported error: ${report.error ?? "unknown"}`;
          break;
        }
        if (step.op === "open") {
          if (!report.tabId) {
            hardFailure = `phase "${phase.key}": open step returned no tab id`;
            break;
          }
          openedTabIds.push(report.tabId);
        }
        await sleep(250); // a beat for the renderer before settling
      }

      if (hardFailure) break;

      // Settle step: the app waits for its own quiescence and reports it.
      let appQuiescent = false;
      if (phase.steps.length > 0 || phase.key === "idle-fresh" || phase.key === "idle-final") {
        const settleStep = { step: nextStepNumber(), op: "settle" };
        await pushWithTimeout(control, settleStep, stepTimeoutMs).catch(() => {});
        try {
          const report = await control.waitForReport(settleStep.step, stepTimeoutMs);
          appQuiescent = report.quiescent === true;
        } catch {
          appQuiescent = false;
        }
      }

      const settleOutcome = await waitForSettle({
        readTreePss: () => readTreePssVia(sampleTree, { procRoot, launchedPid: child.pid, runId }),
        appQuiescent: async () => appQuiescent,
        settle,
      });

      if (!settleOutcome.settled) {
        reliable = false;
        unreliableReason = `phase "${phase.key}": ${settleOutcome.reason}`;
      }

      const sample = await sampleTree({ procRoot, launchedPid: child.pid, runId });
      samples.push({
        key: phase.key,
        stage: phase.key.split("/")[0],
        cycle: phase.key.includes("/") ? Number(phase.key.split("/").pop()) : null,
        settled: settleOutcome.settled,
        settleReadings: settleOutcome.readings,
        processes: sample.processes,
        total: sample.total,
      });
    }
  } finally {
    // Quit step, then terminate the process group as a backstop.
    try {
      const quitStep = { step: nextStepNumber(), op: "quit" };
      await pushWithTimeout(control, quitStep, 5_000).catch(() => {});
      await control.waitForReport(quitStep.step, 5_000).catch(() => {});
    } catch {
      /* app may already be gone */
    }
    control.finish();
    if (child.killGroup) child.killGroup();
    else if (child.stop) child.stop();
    await control.close?.().catch(() => {});
  }

  if (hardFailure) {
    return { ok: false, reliable: false, reason: hardFailure, resultWritten: false };
  }

  // The result is written even for unreliable runs — the failure is visible in
  // the file and the gate refuses to compare unreliable numbers.
  const environment = collectEnvironment();
  const result = writeResult({
    path: outputPath,
    samples,
    environment,
    reliable,
    ...(unreliableReason ? { unreliableReason } : {}),
    cycleCount,
    corpus,
    settleParams: settle,
    startedAtIso,
  });
  return {
    ok: true,
    reliable,
    resultWritten: true,
    ...(unreliableReason ? { unreliableReason } : {}),
    resultPath: result.path,
    samples,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    app: DEFAULT_APP,
    cycles: 8,
    corpusDir: DEFAULT_CORPUS_DIR,
    output: DEFAULT_OUTPUT,
    settle: {},
    stepTimeoutMs: 120_000,
    provisionOnly: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--app": options.app = next(); break;
      case "--cycles": options.cycles = Number(next()); break;
      case "--corpus-dir": options.corpusDir = resolve(next()); break;
      case "--output": options.output = resolve(next()); break;
      case "--settle-jitter": options.settle.maxRelativeJitter = Number(next()); break;
      case "--settle-interval-ms": options.settle.intervalMs = Number(next()); break;
      case "--settle-timeout-ms": options.settle.timeoutMs = Number(next()); break;
      case "--step-timeout-ms": options.stepTimeoutMs = Number(next()); break;
      case "--provision": options.provisionOnly = true; break;
      case "--allow-unsupported-platform": options.allowUnsupportedPlatform = true; break;
      case "--help": case "-h": options.help = true; break;
      default:
        console.error(`unknown option: ${arg}`);
        options.help = true;
    }
  }
  return options;
}

const USAGE = `Usage: node scripts/memory-bench/driver.js [options]

Options:
  --app <binary>            app binary (default: src-tauri/target/debug/plethora-tauri)
  --cycles <n>              repeated open/close cycle count (default 8)
  --corpus-dir <path>       corpus directory (default .bench/corpus)
  --output <path>           result file (default .bench/memory-result.json)
  --settle-jitter <f>       tree-Pss jitter fraction (default 0.01)
  --settle-interval-ms <n>  interval between settle reads (default 500)
  --settle-timeout-ms <n>   settle timeout (default 30000)
  --step-timeout-ms <n>     per-step report timeout (default 120000)
  --provision               only provision the corpus and exit
  --allow-unsupported-platform  debug-only: run even without a memory collector
`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (options.provisionOnly) {
    try {
      const result = await provisionCorpus({ corpusDir: options.corpusDir });
      console.log(`corpus provisioned into ${result.corpusDir}:`);
      for (const [id, fileName] of Object.entries(result.items)) {
        console.log(`  ${id} -> ${fileName}`);
      }
      return;
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }

  if (!existsSync(options.app)) {
    console.error(`app binary not found: ${options.app} (build it first, or pass --app)`);
    process.exit(2);
  }

  const outcome = await runScenario({
    spawnApp: (env) => {
      const child = spawn(options.app, [], {
        env,
        detached: true, // own process group (design D3)
        stdio: "inherit",
      });
      const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
      return {
        pid: child.pid,
        exited,
        killGroup: () => {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            try {
              child.kill("SIGKILL");
            } catch {
              /* already gone */
            }
          }
        },
        stop: () => child.kill("SIGKILL"),
      };
    },
    options: {
      cycleCount: options.cycles,
      corpusDir: options.corpusDir,
      outputPath: options.output,
      settle: options.settle,
      stepTimeoutMs: options.stepTimeoutMs,
      allowUnsupportedPlatform: options.allowUnsupportedPlatform,
    },
  });

  if (!outcome.ok) {
    console.error(`memory benchmark failed: ${outcome.reason}`);
    process.exit(1);
  }
  console.log(
    `memory benchmark complete: reliable=${outcome.reliable}${outcome.unreliableReason ? ` (${outcome.unreliableReason})` : ""}`,
  );
  console.log(`result: ${outcome.resultPath}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
