/**
 * Unit tests for scripts/check-memory-budget.mjs — run with
 * `npm run test:scripts` (`node --test`). Covers tasks 11.2-11.8, 11.10, 11.11.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareMemoryResults,
  extractMetrics,
  allowedGrowth,
  evaluateRatchet,
  olsSlope,
  profileMismatch,
  DEFAULT_RESULT_PATH,
  DEFAULT_BASELINES_PATH,
} from "../check-memory-budget.mjs";

const MiB = 1024 * 1024;
const KiB = 1024;

function profile(overrides = {}) {
  return {
    platform: "linux",
    osRelease: "Ubuntu 26.04 LTS",
    kernel: "7.0.0-29-generic",
    webkitGtkVersion: "2.52.3",
    cpuModel: "Test CPU",
    totalRamBytes: 16 * 1024 * 1024 * 1024,
    appVersion: "2.3.0",
    buildProfile: "debug",
    corpusHashes: { "pdf-1.pdf": "abc" },
    ...overrides,
  };
}

function baselines(overrides = {}) {
  return {
    machineProfile: profile(),
    ratchet: {
      warmUpCycles: 2,
      referenceWindow: 3,
      finalVsReferenceAllowanceBytes: 64 * MiB,
      slopePerCycleAllowanceBytes: 8 * MiB,
      cycleCount: 8,
    },
    metrics: {
      "idle-total": { baseline: 300 * MiB, kind: "gated", relativeAllowance: 0.15, absoluteFloorBytes: 32 * MiB, absoluteCeilingBytes: 128 * MiB, observedVarianceBytes: 8 * MiB, samples: 5 },
      "four-tabs-total": { baseline: 600 * MiB, kind: "gated", relativeAllowance: 0.15, absoluteFloorBytes: 32 * MiB, absoluteCeilingBytes: 128 * MiB, observedVarianceBytes: 12 * MiB, samples: 5 },
      "web-content-pss": { baseline: 400 * MiB, kind: "diagnostic", relativeAllowance: 0.15, absoluteFloorBytes: 32 * MiB, absoluteCeilingBytes: 128 * MiB, observedVarianceBytes: 10 * MiB, samples: 5 },
    },
    ...overrides,
  };
}

function sample(key, pss, cycle = null, processes = []) {
  return {
    key,
    stage: key.split("/")[0],
    cycle,
    total: { Pss: pss, Pss_Anon: pss },
    processes: processes.length
      ? processes
      : [{ pid: 1, present: true, role: "native", values: { Pss: pss } }],
  };
}

function result(overrides = {}) {
  return {
    schema: "incrementum-memory-benchmark-v1",
    reliable: true,
    cycleCount: 8,
    environment: profile(),
    corpus: { itemHashes: { "pdf-1.pdf": "abc" }, corpusDir: ".bench/corpus" },
    samples: [
      sample("idle-fresh", 300 * MiB),
      sample("one-doc", 400 * MiB),
      sample("two-tabs", 500 * MiB),
      sample("four-tabs", 600 * MiB, null, [
        { pid: 1, present: true, role: "native", values: { Pss: 200 * MiB } },
        { pid: 2, present: true, role: "web-content", values: { Pss: 400 * MiB } },
      ]),
      sample("all-closed", 320 * MiB),
      ...Array.from({ length: 8 }, (_, i) =>
        sample(`single-cycles/${i}`, 330 * MiB + i * MiB, i),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        sample(`multi-cycles/${i}`, 340 * MiB + i * MiB, i),
      ),
      sample("idle-final", 310 * MiB),
    ],
    ...overrides,
  };
}

test("ordinary variance passes every gated metric", () => {
  const out = compareMemoryResults({ result: result(), baselines: baselines() });
  assert.equal(out.usable, true);
  assert.deepEqual(out.failures, []);
  assert.ok(out.rows.every((r) => r.verdict === "PASS" || r.verdict === "WARN"));
});

test("a doubling of a gated metric fails and names it", () => {
  const samples = result().samples.map((s) =>
    s.key === "four-tabs" ? { ...s, total: { Pss: 1200 * MiB } } : s,
  );
  const out = compareMemoryResults({ result: result({ samples }), baselines: baselines() });
  assert.equal(out.usable, true);
  assert.ok(out.failures.some((f) => f.includes('"four-tabs-total"')));
  const row = out.rows.find((r) => r.name === "four-tabs-total");
  assert.equal(row.verdict, "FAIL");
});

test("a small metric's percentage jitter passes on the absolute floor", () => {
  // A small baseline (2 MiB) with +2 MiB (+100%) growth: the proportional
  // allowance (0.15) would give 0.3 MiB, but the absolute floor (32 MiB)
  // dominates, so +2 MiB passes.
  const b = baselines({
    metrics: {
      "idle-total": { baseline: 2 * MiB, kind: "gated", relativeAllowance: 0.15, absoluteFloorBytes: 32 * MiB, absoluteCeilingBytes: 128 * MiB, observedVarianceBytes: 1 * MiB, samples: 5 },
    },
  });
  const samples = result().samples.map((s) =>
    s.key === "idle-fresh" ? { ...s, total: { Pss: 4 * MiB } } : s,
  );
  const out = compareMemoryResults({ result: result({ samples }), baselines: b });
  assert.equal(out.usable, true);
  assert.deepEqual(out.failures, []);
  assert.equal(out.rows.find((r) => r.name === "idle-total").verdict, "PASS");
});

test("a large metric cannot hide a large regression behind the ceiling", () => {
  // 1 GiB baseline, +200 MiB growth: proportional (0.15 = 153 MiB) is above
  // the floor but the ceiling (128 MiB) clamps it down -> 200 MiB fails.
  const b = baselines({
    metrics: {
      "four-tabs-total": { baseline: 1024 * MiB, kind: "gated", relativeAllowance: 0.15, absoluteFloorBytes: 32 * MiB, absoluteCeilingBytes: 128 * MiB, observedVarianceBytes: 10 * MiB, samples: 5 },
    },
  });
  const samples = result().samples.map((s) =>
    s.key === "four-tabs" ? { ...s, total: { Pss: 1224 * MiB } } : s,
  );
  const out = compareMemoryResults({ result: result({ samples }), baselines: b });
  assert.equal(out.usable, true);
  assert.ok(out.failures.some((f) => f.includes('"four-tabs-total"')));
});

test("allowedGrowth clamps between floor and ceiling", () => {
  const metric = { relativeAllowance: 0.5, absoluteFloorBytes: 10 * MiB, absoluteCeilingBytes: 100 * MiB };
  assert.equal(allowedGrowth(10 * MiB, metric), 10 * MiB); // floor dominates
  assert.equal(allowedGrowth(100 * MiB, metric), 50 * MiB); // proportional
  assert.equal(allowedGrowth(1000 * MiB, metric), 100 * MiB); // ceiling dominates
});

test("a per-cycle leak fails the ratchet while every peak metric passes", () => {
  // Each cycle retains +12 MiB: slope 12 MiB/cycle > allowance 8 MiB/cycle.
  const samples = [
    sample("idle-fresh", 300 * MiB),
    sample("one-doc", 400 * MiB),
    sample("two-tabs", 500 * MiB),
    sample("four-tabs", 600 * MiB),
    sample("all-closed", 320 * MiB),
    ...Array.from({ length: 8 }, (_, i) => sample(`single-cycles/${i}`, 330 * MiB + i * 12 * MiB, i)),
    sample("idle-final", 310 * MiB),
  ];
  const out = compareMemoryResults({ result: result({ samples }), baselines: baselines() });
  assert.equal(out.usable, true);
  // Peak metrics stay within their thresholds…
  assert.ok(!out.failures.some((f) => f.includes('"four-tabs-total"')));
  // …but the ratchet catches the per-cycle leak.
  assert.ok(out.failures.some((f) => f.includes("[single-cycles] ratchet")));
});

test("a bounded high-water mark passes the ratchet", () => {
  // Memory rises during warm-up then holds steady.
  const samples = [
    sample("idle-fresh", 300 * MiB),
    sample("one-doc", 400 * MiB),
    sample("two-tabs", 500 * MiB),
    sample("four-tabs", 600 * MiB),
    sample("all-closed", 320 * MiB),
    ...Array.from({ length: 8 }, (_, i) => sample(`single-cycles/${i}`, 350 * MiB + (i < 3 ? i * 5 * MiB : 15 * MiB), i)),
    sample("idle-final", 310 * MiB),
  ];
  const out = compareMemoryResults({ result: result({ samples }), baselines: baselines() });
  assert.equal(out.usable, true);
  assert.ok(!out.failures.some((f) => f.includes("ratchet")));
});

test("unreliable runs get no verdict", () => {
  const out = compareMemoryResults({
    result: result({ reliable: false, unreliableReason: "settle timeout" }),
    baselines: baselines(),
  });
  assert.equal(out.usable, false);
  assert.match(out.reason, /unreliable/);
});

test("machine-profile mismatch refuses a verdict and names the differing fields", () => {
  const out = compareMemoryResults({
    result: result({ environment: { ...profile(), kernel: "6.8.0-45-generic", cpuModel: "Other CPU" } }),
    baselines: baselines(),
  });
  assert.equal(out.usable, false);
  assert.match(out.reason, /kernel/);
  assert.match(out.reason, /cpuModel/);
});

test("a metric in the baseline but absent from the result is a failure", () => {
  const samples = result().samples.filter((s) => s.key !== "four-tabs");
  const out = compareMemoryResults({ result: result({ samples }), baselines: baselines() });
  assert.equal(out.usable, true);
  assert.ok(out.failures.some((f) => f.includes('"four-tabs-total"')));
});

test("a metric in the result with no baseline warns with the exact entry to paste", () => {
  const samples = result().samples;
  samples.push(sample("two-tabs", 500 * MiB)); // ensure present
  const out = compareMemoryResults({ result: result({ samples }), baselines: baselines() });
  // two-tabs-total is extracted but has no baseline entry.
  assert.ok(out.warnings.some((w) => w.includes('"two-tabs-total"') && w.includes('"baseline"')));
});

test("diagnostic regressions are reported but never fail the run", () => {
  const samples = result().samples.map((s) =>
    s.key === "four-tabs"
      ? { ...s, total: { Pss: 600 * MiB }, processes: [
          { pid: 1, present: true, role: "native", values: { Pss: 200 * MiB } },
          { pid: 2, present: true, role: "web-content", values: { Pss: 900 * MiB } }, // diagnostic metric regresses
        ] }
      : s,
  );
  const out = compareMemoryResults({ result: result({ samples }), baselines: baselines() });
  assert.equal(out.usable, true);
  assert.ok(out.warnings.some((w) => w.includes("DIAGNOSTIC REGRESSION") && w.includes("web-content-pss")));
  assert.ok(!out.failures.some((f) => f.includes("web-content-pss")));
});

test("extractMetrics derives the documented metrics from samples", () => {
  const metrics = extractMetrics(result());
  assert.equal(metrics["idle-total"], 300 * MiB);
  assert.equal(metrics["four-tabs-total"], 600 * MiB);
  assert.equal(metrics["post-close-total"], 320 * MiB);
  assert.equal(metrics["cycles-final-total"], 340 * MiB + 7 * MiB);
  assert.equal(metrics["peak-total"], 600 * MiB);
  assert.equal(metrics["native-pss"], 500 * MiB); // two-tabs sample's native process
  assert.equal(metrics["web-content-pss"], 400 * MiB); // only four-tabs has a web process
});

test("olsSlope computes the per-cycle trend", () => {
  assert.equal(olsSlope([0, 1, 2, 3], [0, 10, 20, 30]), 10);
  assert.equal(olsSlope([0, 1, 2, 3], [10, 10, 10, 10]), 0);
});

test("evaluateRatchet catches final-vs-reference growth", () => {
  const cycles = Array.from({ length: 8 }, (_, i) => ({ cycle: i, totalPss: 100 * MiB + (i >= 5 ? 100 * MiB : 0) }));
  const out = evaluateRatchet(cycles, { warmUpCycles: 2, referenceWindow: 3, finalVsReferenceAllowanceBytes: 64 * MiB, slopePerCycleAllowanceBytes: 8 * MiB });
  assert.ok(out.failures.length > 0);
  assert.ok(out.reference != null);
  assert.equal(out.final, 200 * MiB);
});

test("running the gate never modifies the baselines file (task 11.11)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "membench-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // The committed baselines file (or its absence) is snapshotted, the CLI is
  // run against a synthetic result, and the file must be unchanged afterwards.
  const baselinePath = DEFAULT_BASELINES_PATH;
  let before = null;
  try {
    before = readFileSync(baselinePath, "utf8");
  } catch {
    before = null; // baselines not recorded yet (Phase 10) — absence must persist
  }

  const resultPath = join(dir, "result.json");
  writeFileSync(resultPath, JSON.stringify(result()));

  const { execFileSync } = await import("node:child_process");
  let exitCode = null;
  try {
    execFileSync(process.execPath, ["scripts/check-memory-budget.mjs", resultPath], {
      cwd: join(dirname(DEFAULT_BASELINES_PATH), ".."),
      stdio: "pipe",
    });
    exitCode = 0;
  } catch (error) {
    exitCode = error.status;
  }
  // No baselines recorded yet -> the gate must refuse (exit 2) rather than
  // invent numbers, and it must not have created/modified the baselines file.
  assert.equal(exitCode, 2);

  let after = null;
  try {
    after = readFileSync(baselinePath, "utf8");
  } catch {
    after = null;
  }
  assert.equal(after, before);
});

import { dirname } from "node:path";
