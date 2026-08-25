/**
 * Driver failure-path tests (task 3.9).
 *
 * Runs `runScenario` against the real control server with a FAKE app HTTP
 * client and an injectable sampler, covering:
 *   - a stage whose document fails to open  -> exit non-zero, no result file
 *   - an application that exits mid-scenario -> exit non-zero, no result file
 *   - a settle timeout -> sample still taken, run marked unreliable
 * plus a happy path (result written, one sample per phase).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScenario, DEFAULT_OUTPUT } from "../memory-bench/driver.js";
import { buildScenarioStages } from "../memory-bench/scenario.js";

const KiB = 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fake app HTTP client speaking the control protocol. */
function makeFakeApp({ onOpen, hangAfterSteps = Infinity } = {}) {
  const handlers = {
    open: async (step) =>
      onOpen ? onOpen(step) : { step: step.step, status: "done", tabId: `tab-${step.step}` },
    closeTab: async (step) => ({ step: step.step, status: "done" }),
    closeAll: async (step) => ({ step: step.step, status: "done" }),
    settle: async (step) => ({ step: step.step, status: "done", quiescent: true }),
    quit: async (step) => ({ step: step.step, status: "done" }),
    ttsCycle: async (step) => ({ step: step.step, status: "done" }),
    editionCycle: async (step) => ({ step: step.step, status: "done" }),
    diagnostics: async (step) => ({
      step: step.step,
      status: "done",
      diagnostics: { takenAt: 0, ownedObjectUrls: { total: { count: 0, bytes: 0 }, byOwner: {} } },
    }),
  };

  return async (url, runId) => {
    let handled = 0;
    for (;;) {
      let res;
      try {
        res = await fetch(`${url}/step?run=${encodeURIComponent(runId)}`);
      } catch {
        return; // driver closed the server
      }
      if (res.status === 204) {
        await sleep(20);
        continue;
      }
      const body = await res.json();
      if (body.done) return;
      // Steps are delivered FLAT ({step: <number>, op, ...}); `done`
      // terminators are the only nested shape. body.step is a number for
      // flat steps, so fall back to the body itself.
      const step = body.step && typeof body.step === "object" ? body.step : body;
      const handler = handlers[step.op];
      const report = handler ? await handler(step) : { step: step.step, status: "error", error: `unknown op ${step.op}` };
      try {
        await fetch(`${url}/report?run=${encodeURIComponent(runId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(report),
        });
      } catch {
        return;
      }
      handled += 1;
      if (step.op === "quit") return;
      if (handled >= hangAfterSteps) {
        // Simulate the app vanishing mid-scenario: stop polling.
        return;
      }
    }
  };
}

function makeFakeSpawn() {
  const calls = [];
  const fake = {
    pid: 424242,
    killGroup: () => {},
    stop: () => {},
    exited: new Promise(() => {}),
  };
  return {
    calls,
    spawnApp: async (env) => {
      calls.push(env);
      return fake;
    },
  };
}

function makeStableSampler(pss = 1_000 * KiB) {
  return async () => ({
    processes: [{ pid: 1, present: true, values: { Pss: pss } }],
    total: { Pss: pss },
    complete: true,
  });
}

function makeGrowingSampler(start = 1_000 * KiB, growthPerRead = 0.1) {
  let current = start;
  return async () => {
    const pss = current;
    current = Math.round(current * (1 + growthPerRead));
    return { processes: [{ pid: 1, present: true, values: { Pss: pss } }], total: { Pss: pss }, complete: true };
  };
}

function freshOutDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "membench-driver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "result.json");
}

const baseOptions = {
  cycleCount: 2,
  corpusDir: mkdtempSync(join(tmpdir(), "membench-corpus-")),
  settle: { intervalMs: 10, timeoutMs: 5_000 },
};

test("happy path: every phase sampled, result written, reliable", async (t) => {
  const fakeSpawn = makeFakeSpawn();
  const outputPath = freshOutDir(t);
  const outcome = await runScenario({
    spawnApp: fakeSpawn.spawnApp,
    appClient: makeFakeApp(),
    sampleTree: makeStableSampler(),
    // The sampler is injected, so only the protocol matters here — bypass the
    // Linux-only platform gate so these tests run on any host (debug-only flag
    // added for exactly this).
    options: { ...baseOptions, outputPath, allowUnsupportedPlatform: true },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.reliable, true);
  assert.equal(outcome.resultWritten, true);
  const payload = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(payload.schema, "incrementum-memory-benchmark-v1");
  assert.equal(payload.reliable, true);
  const expectedPhases = buildScenarioStages({ cycleCount: 2 }).length;
  assert.equal(payload.samples.length, expectedPhases);
  assert.equal(payload.cycleCount, 2);
  assert.ok(payload.environment.platform, "environment block present");
  assert.ok(payload.settleParams.intervalMs, "settle params recorded");
  // The launched app received the harness env.
  assert.equal(fakeSpawn.calls[0].PLETHORA_MEMORY_SCENARIO, "1");
  assert.ok(fakeSpawn.calls[0].PLETHORA_MEMORY_CONTROL.startsWith("http://127.0.0.1:"));
  assert.ok(fakeSpawn.calls[0].PLETHORA_MEMORY_RUN_ID);
});

test("a document that fails to open exits non-zero with no result file", async (t) => {
  const fakeSpawn = makeFakeSpawn();
  const outputPath = freshOutDir(t);
  const outcome = await runScenario({
    spawnApp: fakeSpawn.spawnApp,
    appClient: makeFakeApp({
      onOpen: async (step) => ({ step: step.step, status: "error", error: "document failed to open (fixture)" }),
    }),
    sampleTree: makeStableSampler(),
    options: { ...baseOptions, outputPath, stepTimeoutMs: 2_000, allowUnsupportedPlatform: true },
  });

  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /app reported error/);
  assert.match(outcome.reason, /document failed to open/);
  assert.equal(outcome.resultWritten, false);
  assert.equal(existsSync(outputPath), false);
});

test("an application that exits mid-scenario exits non-zero with no result file", async (t) => {
  const fakeSpawn = makeFakeSpawn();
  const outputPath = freshOutDir(t);
  const outcome = await runScenario({
    spawnApp: fakeSpawn.spawnApp,
    appClient: makeFakeApp({ hangAfterSteps: 1 }),
    sampleTree: makeStableSampler(),
    options: { ...baseOptions, outputPath, stepTimeoutMs: 400, allowUnsupportedPlatform: true },
  });

  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /did not pick up step|no report for step/);
  assert.equal(outcome.resultWritten, false);
  assert.equal(existsSync(outputPath), false);
});

test("a settle timeout samples anyway and marks the run unreliable", async (t) => {
  const fakeSpawn = makeFakeSpawn();
  const outputPath = freshOutDir(t);
  const outcome = await runScenario({
    spawnApp: fakeSpawn.spawnApp,
    appClient: makeFakeApp(),
    sampleTree: makeGrowingSampler(), // never stabilizes
    options: {
      ...baseOptions,
      outputPath,
      settle: { intervalMs: 10, timeoutMs: 250 },
      allowUnsupportedPlatform: true,
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.reliable, false);
  assert.match(outcome.unreliableReason, /did not stabilize/);
  const payload = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(payload.reliable, false);
  assert.match(payload.unreliableReason, /did not stabilize/);
  assert.ok(payload.samples.length > 0, "samples were still taken");
});

test("an unsupported platform produces no result file", async (t) => {
  const fakeSpawn = makeFakeSpawn();
  const outputPath = freshOutDir(t);
  const outcome = await runScenario({
    spawnApp: fakeSpawn.spawnApp,
    appClient: makeFakeApp(),
    sampleTree: makeStableSampler(),
    options: { ...baseOptions, outputPath, platform: "linux", procRoot: "/nonexistent-proc" },
  });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /unsupported environment/);
  assert.equal(outcome.resultWritten, false);
  assert.equal(existsSync(outputPath), false);
});
