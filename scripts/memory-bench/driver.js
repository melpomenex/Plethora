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
import { aggregateSample, readProcessSample, treeHeadlineBytes } from "./sample.js";
import { sampleMacOsTree, ensureHelperBuilt } from "./macos-footprint.js";
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

/** macOS sampler: native helper → normalized shared sample shape (task 2.7). */
async function darwinSampleTree({ launchedPid, runId }) {
  return sampleMacOsTree({ launchedPid, runId });
}

/** Platform dispatch: collector selection only — scenarios are shared (D2). */
function platformSampleTree(platform) {
  return platform === "darwin" ? darwinSampleTree : defaultSampleTree;
}

/** Sample one headline tree value (Pss on Linux, footprint on macOS). */
async function readTreePssVia(sampler, { procRoot, launchedPid, runId }, platform = process.platform) {
  const sample = await sampler({ procRoot, launchedPid, runId });
  return treeHeadlineBytes(sample, platform);
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
    sampleTree = null,
    options,
  } = deps;
  const tree = sampleTree ?? platformSampleTree(options.platform ?? process.platform);
  const {
    runId = randomUUID(),
    cycleCount,
    ttsCycles,
    editionCycles,
    editionSections,
    soak = null,
    corpusDir,
    outputPath,
    procRoot = "/proc",
    settle = {},
    stepTimeoutMs = 60_000,
    syntheticLeakMbPerCycle = 0,
  } = options;

  // 1. Platform gate: unsupported -> no result file. (`platform` is
  // overridable for tests; production runs use process.platform.)
  const platform = options.platform ?? process.platform;
  const gate = checkMemoryCollectionSupported({ platform, procRoot });
  if (!gate.supported) {
    if (options.allowUnsupportedPlatform) {
      log(`WARNING: platform not supported for measurement (${gate.reason}); running anyway (debug-only, numbers are NOT comparable)`);
    } else {
      return {
        ok: false,
        reliable: false,
        reason: `unsupported environment: ${gate.reason}`,
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
    // Gate self-test (D11): retain N MB per cycle step in the scenario host.
    ...(syntheticLeakMbPerCycle > 0
      ? { PLETHORA_MEMORY_SYNTHETIC_LEAK_MB_PER_CYCLE: String(syntheticLeakMbPerCycle) }
      : {}),
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
  const phases = buildScenarioStages({
    cycleCount,
    ...(ttsCycles != null ? { ttsCycles } : {}),
    ...(editionCycles != null ? { editionCycles } : {}),
    ...(editionSections != null ? { editionSections } : {}),
    ...(soak ? { soak } : {}),
  });
  const samples = [];
  let reliable = true;
  let unreliableReason = null;
  let hardFailure = null;
  /** Whether the app supports the `diagnostics` op (disabled on first error). */
  let diagnosticsSupported = true;

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
          // WKWebView can swallow a delivered step's response (the client
          // aborts its poll and the step dies with the aborted request).
          // Re-push the SAME step number once before failing: the app either
          // never saw it (re-executes cleanly; open steps dedupe tabs) or it
          // did and the report was lost (idempotent re-report).
          log(`no report for step ${step.step} (${error.message}); re-pushing once`);
          try {
            await pushWithTimeout(control, step, stepTimeoutMs);
            report = await control.waitForReport(step.step, 30_000);
            log(`retry report for step ${step.step}: status=${report.status}`);
          } catch (retryError) {
            hardFailure = `phase "${phase.key}": ${error.message} (retry: ${retryError.message})`;
            break;
          }
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

      // Idle-soak phase (task 4.2): hold the app idle, sampling the tree
      // periodically; every sample is keyed by elapsed seconds so the
      // comparator can compute a post-warmup slope over the soak series.
      if (phase.soak) {
        const soakStart = Date.now();
        log(`soak phase "${phase.key}" for ${Math.round(phase.soak.durationMs / 60000)} min (sample every ${phase.soak.sampleIntervalMs / 1000}s)`);
        while (Date.now() - soakStart < phase.soak.durationMs) {
          await sleep(phase.soak.sampleIntervalMs);
          const elapsedSec = Math.round((Date.now() - soakStart) / 1000);
          const sample = await tree({ procRoot, launchedPid: child.pid, runId });
          samples.push({
            key: `${phase.key}/${elapsedSec}`,
            stage: phase.key,
            cycle: elapsedSec,
            soakElapsedSec: elapsedSec,
            settled: true,
            settleReadings: [],
            processes: sample.processes,
            total: sample.total,
          });
          log(`soak sample at +${elapsedSec}s: ${Math.round((sample.total?.Pss ?? 0) / 1024 / 1024)} MB`);
        }
        continue;
      }

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
        readTreePss: () =>
          readTreePssVia(tree, { procRoot, launchedPid: child.pid, runId }, platform),
        appQuiescent: async () => appQuiescent,
        settle,
      });

      if (!settleOutcome.settled) {
        reliable = false;
        unreliableReason = `phase "${phase.key}": ${settleOutcome.reason}`;
      }

      // Resource-lifetime diagnostics (task 3.6): ask the app for its
      // snapshot right before the sample is taken, and record it alongside
      // the stage's process-memory sample. First failure (e.g. an older
      // frontend without the op) disables further requests.
      let diagnostics = undefined;
      if (diagnosticsSupported) {
        try {
          const diagStep = { step: nextStepNumber(), op: "diagnostics" };
          await pushWithTimeout(control, diagStep, Math.min(stepTimeoutMs, 30_000));
          const report = await control.waitForReport(diagStep.step, Math.min(stepTimeoutMs, 30_000));
          if (report.status === "error") {
            diagnosticsSupported = false;
            log(`diagnostics op unsupported (${report.error ?? "error"}); disabling for this run`);
          } else if (report.diagnostics != null) {
            diagnostics = report.diagnostics;
          }
        } catch {
          diagnosticsSupported = false;
        }
      }

      const sample = await tree({ procRoot, launchedPid: child.pid, runId });
      samples.push({
        key: phase.key,
        stage: phase.key.split("/")[0],
        cycle: phase.key.includes("/") ? Number(phase.key.split("/").pop()) : null,
        settled: settleOutcome.settled,
        settleReadings: settleOutcome.readings,
        ...(diagnostics !== undefined ? { diagnostics } : {}),
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
  const environment = collectEnvironment({ platform: options.platform ?? process.platform });
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
    ttsCycles: undefined,
    editionCycles: undefined,
    editionSections: undefined,
    soak: null,
    syntheticLeakMb: 0,
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
      case "--tts-cycles": options.ttsCycles = Number(next()); break;
      case "--edition-cycles": options.editionCycles = Number(next()); break;
      case "--edition-sections": options.editionSections = Number(next()); break;
      case "--soak": options.soak = next(); break;
      case "--synthetic-leak-mb": options.syntheticLeakMb = Number(next()); break;
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
  --tts-cycles <n>          TTS synthesize/play/dispose cycles (default 12; alternating
                            persistent-cache hit/miss variants — task 4.1)
  --edition-cycles <n>      audio-edition generate/cancel/retry/delete cycles (default 6)
  --edition-sections <k>    sections per edition cycle (default 4)
  --soak <tier>             append an idle-soak stage sampled periodically:
                            quick (5 min), dev (30 min), nightly (4 h), extended (11 h)
  --synthetic-leak-mb <n>   gate self-test: app retains n MB per cycle step (D11)
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

  // macOS: the collector needs the native helper — build it if missing
  // (task 2.7). Failure falls through to the platform gate's refusal below.
  if (process.platform === "darwin" && !ensureHelperBuilt()) {
    console.error(
      "macOS memory collection requires the native helper; build failed — see errors above",
    );
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
      ...(options.ttsCycles != null ? { ttsCycles: options.ttsCycles } : {}),
      ...(options.editionCycles != null ? { editionCycles: options.editionCycles } : {}),
      ...(options.editionSections != null ? { editionSections: options.editionSections } : {}),
      ...(options.soak ? { soak: options.soak } : {}),
      syntheticLeakMbPerCycle: options.syntheticLeakMb || 0,
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
