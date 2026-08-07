#!/usr/bin/env node
/**
 * Performance budget check — fails when a benchmarked hot path regresses past
 * its recorded baseline, in a way that is portable across machines.
 *
 * Run after `npm run bench` (which writes .bench/results.json):
 *   node scripts/check-perf-budget.mjs [resultsJson] [--warn-only]
 * Wired into `npm run bench:check` and CI.
 *
 * HOW IT NORMALIZES (the core idea):
 * Raw wall-clock milliseconds are not comparable — a shared CI runner can be
 * 2-3x slower than a laptop on identical code, so any absolute threshold is
 * either so loose it catches nothing or so tight it flakes. Instead, every
 * benchmark run includes a fixed synthetic workload, the `noise-anchor`
 * (src/anchor.bench.ts), whose cost is a proxy for "how fast is this machine
 * right now". Each benchmark is reduced to a dimensionless cost ratio:
 *
 *     cost = anchorHz / benchHz      // "this benchmark costs N anchor-ops"
 *
 * A runner that is 2x slower makes both hz values 2x smaller, so `cost` is
 * unchanged; a genuine regression slows only `benchHz`, so `cost` rises.
 * Baselines (scripts/perf-baselines.json) record `cost`, never milliseconds,
 * which is what lets a tight 1.25x default tolerance survive shared runners.
 *
 * OUTCOMES:
 *   - measured cost > baseline × tolerance  -> FAIL (exit 1)
 *   - baselined benchmark missing from run  -> FAIL (exit 1)
 *   - result with no baseline entry         -> WARN + exact JSON line to paste
 *   - measured cost < 75% of baseline       -> WARN (stale baseline; re-record)
 *   - no `noise-anchor` in results          -> exit 2 (normalization impossible)
 *
 * If you intentionally change a hot path, update scripts/perf-baselines.json in
 * the same PR and say why in the PR description (same protocol as
 * scripts/bundle-budgets.json).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** The in-process yardstick every run must contain (see src/anchor.bench.ts). */
export const ANCHOR_NAME = "noise-anchor";
/** Warn (not fail) when measured cost is more than 25% below baseline. */
const STALE_BASELINE_FACTOR = 0.75;

/**
 * Format a cost ratio for display and for the paste-into-baselines line.
 * Costs range from ~0.001 (cheap benches) to thousands (heavy ones), so a
 * fixed number of decimals would round tiny costs to 0.0 and lose the signal.
 * Four significant digits keep both ends meaningful.
 */
function formatCost(c) {
  return Number(c.toPrecision(4)).toString();
}

/**
 * Compare measured benchmark results against recorded baselines. Pure function
 * so it is unit-testable without shelling out (see scripts/__tests__/).
 *
 * @param {object} args
 * @param {Array<{name: string, hz: number}>} args.results  measured benchmarks
 * @param {object} args.baselines  contents of scripts/perf-baselines.json
 * @returns {{ anchor: ({name: string, hz: number}|null),
 *             rows: Array<{name: string, baselineCost: number|null,
 *                          measuredCost: number|null, ratio: number|null,
 *                          verdict: string}>,
 *             failures: string[], warnings: string[] }}
 */
export function comparePerfResults({ results, baselines }) {
  const byName = new Map(results.map((r) => [r.name, r]));
  const anchor = byName.get(ANCHOR_NAME) ?? null;

  const failures = [];
  const warnings = [];
  const rows = [];

  // Without the anchor, normalization is impossible and nothing can be
  // compared. Return the null anchor and let the caller decide how to report
  // it (the CLI exits 2); the comparison loop below is only reachable when
  // the anchor exists.
  if (!anchor) {
    return { anchor, rows, failures, warnings };
  }

  // Benchmark names in the baseline file but absent from this run: someone
  // deleted coverage or a suite failed to run. Fail loudly either way.
  for (const name of Object.keys(baselines.benchmarks ?? {})) {
    if (!byName.has(name)) {
      failures.push(
        `baseline entry "${name}" not found in results — the benchmark was deleted or failed to run`
      );
      rows.push({ name, baselineCost: baselines.benchmarks[name].cost, measuredCost: null, ratio: null, verdict: "FAIL" });
    }
  }

  for (const bench of results) {
    if (bench.name === ANCHOR_NAME) continue;
    if (bench.hz <= 0) {
      failures.push(`benchmark "${bench.name}" reported hz <= 0 (${bench.hz}) — measurement broken`);
      rows.push({ name: bench.name, baselineCost: null, measuredCost: null, ratio: null, verdict: "FAIL" });
      continue;
    }
    const measuredCost = anchor.hz / bench.hz;
    const baseline = baselines.benchmarks?.[bench.name];

    if (!baseline) {
      // New benchmark, not yet baselined: warn and hand the author the exact
      // JSON line to paste, so recording a baseline is a copy-paste job.
      warnings.push(
        `benchmark "${bench.name}" has no baseline — paste this into scripts/perf-baselines.json:\n      "${bench.name}": { "cost": ${formatCost(measuredCost)} }`
      );
      rows.push({ name: bench.name, baselineCost: null, measuredCost, ratio: null, verdict: "WARN" });
      continue;
    }

    const tolerance = baseline.tolerance ?? baselines.defaultTolerance ?? 1.25;
    const limit = baseline.cost * tolerance;
    const ratio = measuredCost / baseline.cost;
    if (measuredCost > limit) {
      failures.push(
        `benchmark "${bench.name}": measured cost ${formatCost(measuredCost)} exceeds baseline ${formatCost(baseline.cost)} × tolerance ${tolerance} (limit ${formatCost(limit)})`
      );
      rows.push({ name: bench.name, baselineCost: baseline.cost, measuredCost, ratio, verdict: "FAIL" });
    } else if (measuredCost < baseline.cost * STALE_BASELINE_FACTOR) {
      warnings.push(
        `benchmark "${bench.name}": measured cost ${formatCost(measuredCost)} is more than 25% below baseline ${formatCost(baseline.cost)} — the baseline is stale, re-record it`
      );
      rows.push({ name: bench.name, baselineCost: baseline.cost, measuredCost, ratio, verdict: "WARN" });
    } else {
      rows.push({ name: bench.name, baselineCost: baseline.cost, measuredCost, ratio, verdict: "PASS" });
    }
  }

  return { anchor, rows, failures, warnings };
}

/**
 * CLI entry point. Reads .bench/results.json (or argv[2]), compares, prints an
 * aligned summary table, and exits 1 on failure (0 with --warn-only). Exits 2
 * when the results file is unreadable or the noise anchor is missing — either
 * way normalization is impossible, so not even warn-only can proceed.
 */
export function main(argv = process.argv) {
  const warnOnly = argv.includes("--warn-only");
  const positional = argv.slice(2).filter((a) => !a.startsWith("--"));
  const resultsPath = positional[0] ?? join(scriptDir, "..", ".bench", "results.json");

  let resultsJson;
  try {
    resultsJson = JSON.parse(readFileSync(resultsPath, "utf8"));
  } catch (err) {
    console.error(`[perf-budget] Cannot read ${resultsPath} — run \`npm run bench\` first (${err.message})`);
    process.exit(2);
  }

  // vitest --outputJson shape: { files: [{ groups: [{ benchmarks: [{ name, hz }] }] }] }
  const benchmarks = [];
  for (const file of resultsJson.files ?? []) {
    for (const group of file.groups ?? []) {
      for (const bench of group.benchmarks ?? []) {
        benchmarks.push({ name: bench.name, hz: bench.hz });
      }
    }
  }

  let baselines;
  try {
    baselines = JSON.parse(readFileSync(join(scriptDir, "perf-baselines.json"), "utf8"));
  } catch (err) {
    console.error(`[perf-budget] Cannot read scripts/perf-baselines.json (${err.message})`);
    process.exit(2);
  }

  const { anchor, rows, failures, warnings } = comparePerfResults({ results: benchmarks, baselines });

  if (!anchor) {
    console.error(
      `[perf-budget] No "${ANCHOR_NAME}" benchmark in ${resultsPath} — cannot normalize. ` +
        `Run \`npm run bench\` and make sure src/anchor.bench.ts is present.`
    );
    process.exit(2);
  }

  console.log(`[perf-budget] anchor ${anchor.name}: ${anchor.hz.toFixed(1)} hz`);

  // Aligned summary table: benchmark, baseline cost, measured cost, ratio, verdict.
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    pad("benchmark", 34) + pad("baseline", 12) + pad("measured", 12) + pad("ratio", 8) + "verdict"
  );
  for (const row of rows) {
    console.log(
      pad(row.name, 34) +
        pad(row.baselineCost == null ? "—" : formatCost(row.baselineCost), 12) +
        pad(row.measuredCost == null ? "—" : formatCost(row.measuredCost), 12) +
        pad(row.ratio == null ? "—" : `${row.ratio.toFixed(2)}×`, 8) +
        row.verdict
    );
  }

  for (const w of warnings) {
    console.warn(`[perf-budget] WARN:\n  - ${w}`);
  }

  const failed = failures.length > 0;
  if (failed) {
    console.error("[perf-budget] FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "[perf-budget] If this regression is intentional, update scripts/perf-baselines.json in the same PR."
    );
  }

  if (failed && !warnOnly) {
    console.error(`[perf-budget] ${failures.length} failure(s).`);
    process.exit(1);
  }

  const suffix = warnOnly && failed ? ` (warn-only: ${failures.length} failure(s) reported but not enforced)` : "";
  console.log(`[perf-budget] OK${suffix} — ${rows.length} benchmark(s) compared.`);
  process.exit(0);
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
