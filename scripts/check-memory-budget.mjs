#!/usr/bin/env node
/**
 * Memory budget check — evaluates a memory benchmark result against the
 * committed memory baselines (design D6-D9, tasks 11.1-11.9).
 *
 * Run after `npm run bench:memory` (which writes .bench/memory-result.json):
 *   node scripts/check-memory-budget.mjs [resultJson] [--warn-only]
 * Wired into `npm run bench:memory:check` and the CI memory job.
 *
 * Semantics, mirroring scripts/check-perf-budget.mjs:
 *   - gated metric regression past its threshold  -> exit 1
 *   - unusable input (missing result/baselines, unreliable run, machine-profile
 *     mismatch)                                    -> exit 2, no verdict
 *   - diagnostic metrics never affect the exit status
 *   - `--warn-only` reports regressions without failing
 *
 * Threshold policy (D6): allowedGrowth = clamp(baseline × relativeAllowance,
 * absoluteFloorBytes, absoluteCeilingBytes); fail when measured >
 * baseline + allowedGrowth.
 *
 * Ratchet criterion (D7): over the post-warm-up open/close cycles, fail when
 * final − reference exceeds finalVsReferenceAllowanceBytes or when the
 * ordinary-least-squares slope exceeds slopePerCycleAllowanceBytes.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSignificant, formatBytes, printAlignedTable } from "./report-helpers.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_RESULT_PATH = join(process.cwd(), ".bench", "memory-result.json");
export const DEFAULT_BASELINES_PATH = join(scriptDir, "memory-baselines.json");
export const DEFAULT_EVALUATION_PATH = join(process.cwd(), ".bench", "memory-evaluation.json");

/** Default allowances, used when a metric entry omits them. */
const DEFAULT_ALLOWANCES = {
  relativeAllowance: 0.15,
  absoluteFloorBytes: 64 * 1024 * 1024,
  absoluteCeilingBytes: 256 * 1024 * 1024,
};

/** Machine-profile fields that materially affect the numbers. */
export const PROFILE_FIELDS = [
  "platform",
  "platformKind",
  "osRelease",
  "kernel",
  "webkitGtkVersion",
  "cpuModel",
  "totalRamBytes",
  "appVersion",
  "buildProfile",
];

// ---------------------------------------------------------------------------
// Metric extraction from the harness result
// ---------------------------------------------------------------------------

function stageRolePss(samples, key, role) {
  const sample = (samples ?? []).find((s) => s.key === key);
  if (!sample) return null;
  const bytes = (sample.processes ?? [])
    .filter((p) => p.present && p.role === role)
    .reduce((sum, p) => sum + (p.values?.Pss ?? 0), 0);
  return bytes > 0 ? bytes : null;
}

/**
 * Select the baseline block for a harness result. Supports a flat legacy file
 * or a multi-profile file keyed by `${platformKind}-${buildProfile}`.
 */
export function resolveBaselinesForResult(baselines, result) {
  if (!baselines?.profiles) return { baselines, profileKey: null, skipGate: false };
  const platformKind = result.environment?.platformKind ?? result.environment?.platform ?? "linux";
  const buildProfile = result.environment?.buildProfile ?? "debug";
  const profileKey = `${platformKind}-${buildProfile}`;
  const selected = baselines.profiles[profileKey];
  if (!selected) {
    return {
      baselines: null,
      profileKey,
      skipGate: true,
      reason: `no committed baseline profile "${profileKey}" (diagnostic-only run)`,
    };
  }
  return { baselines: selected, profileKey, skipGate: false };
}

/**
 * Extract the gated/diagnostic metrics from a harness result.
 *
 * @param {object} result - parsed .bench/memory-result.json
 * @returns {Record<string, number|null>} metric name -> bytes (Pss family)
 */
export function extractMetrics(result) {
  const samples = result.samples ?? [];
  const byKey = new Map(samples.map((s) => [s.key, s]));
  const total = (key) => byKey.get(key)?.total?.Pss ?? null;

  const metrics = {
    "idle-total": total("idle-fresh"),
    "one-doc-total": total("one-doc"),
    "two-tabs-total": total("two-tabs"),
    "four-tabs-total": total("four-tabs"),
    "post-close-total": total("all-closed"),
    "idle-final-total": total("idle-final"),
    "cycles-final-total": lastCycleTotal(samples),
    "peak-total": maxOrNull(samples.map((s) => s.total?.Pss ?? null)),
    "native-pss": peakProcessRole(samples, "native"),
    "web-content-pss": peakProcessRole(samples, "web-content"),
    "post-close-web-content-pss": stageRolePss(samples, "all-closed", "web-content"),
    "idle-final-web-content-pss": stageRolePss(samples, "idle-final", "web-content"),
    "one-document-web-delta": deltaRolePss(samples, "one-doc", "idle-fresh", "web-content"),
  };
  // Soak metrics (task 8.2): present only when the run included an idle-soak
  // stage; baselines decide whether they are gated.
  const soak = extractSoakMetrics(result);
  return { ...metrics, ...soak };
}

/**
 * Soak metrics (task 8.2 / design D11): `idle-growth-per-hour` is the
 * post-warm-up OLS slope over the periodic soak samples (bytes/sec →
 * bytes/hour); `soak-final-vs-reference` is the last sample minus the
 * warmed-up reference window median. A leak that hides under every peak
 * ceiling shows up here as a non-zero slope.
 */
export function extractSoakMetrics(result, params = {}) {
  const soak = (result.samples ?? [])
    .filter((s) => s.stage === "idle-soak" && Number.isFinite(s.total?.Pss ?? NaN))
    .sort((a, b) => (a.cycle ?? 0) - (b.cycle ?? 0));
  if (soak.length < 2) {
    return { "idle-growth-per-hour": null, "soak-final-vs-reference": null };
  }
  const warmUpSamples = params.soakWarmUpSamples ?? 2;
  const referenceWindow = params.referenceWindow ?? 3;
  const warmed = soak.slice(Math.min(warmUpSamples, Math.max(0, soak.length - 2)));
  const xs = warmed.map((s) => s.cycle ?? 0); // elapsed seconds
  const ys = warmed.map((s) => s.total.Pss);
  const slopePerHour = olsSlope(xs, ys) * 3600;
  const reference = median(warmed.slice(0, referenceWindow).map((s) => s.total.Pss));
  const final = warmed[warmed.length - 1].total.Pss;
  return {
    "idle-growth-per-hour": slopePerHour,
    "soak-final-vs-reference": final - reference,
  };
}

function lastCycleTotal(samples) {
  const cycles = samples.filter((s) => s.cycle != null && Number.isFinite(s.total?.Pss ?? NaN));
  return cycles.length > 0 ? cycles[cycles.length - 1].total.Pss : null;
}

function maxOrNull(values) {
  const finite = values.filter((v) => v != null && Number.isFinite(v));
  return finite.length > 0 ? Math.max(...finite) : null;
}

function peakProcessRole(samples, role) {
  let peak = null;
  for (const sample of samples) {
    const processes = sample.processes ?? [];
    const roleBytes = processes
      .filter((p) => p.present && p.role === role)
      .reduce((sum, p) => sum + (p.values?.Pss ?? 0), 0);
    if (roleBytes > 0 && (peak === null || roleBytes > peak)) peak = roleBytes;
  }
  return peak;
}

function deltaRolePss(samples, laterKey, earlierKey, role) {
  const later = stageRolePss(samples, laterKey, role);
  const earlier = stageRolePss(samples, earlierKey, role);
  if (later == null || earlier == null) return null;
  return later - earlier;
}

// ---------------------------------------------------------------------------
// Ratchet criterion (D7 / task 11.3)
// ---------------------------------------------------------------------------

/** Ordinary-least-squares slope of y over x (bytes per cycle). */
export function olsSlope(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Evaluate the ratchet criterion over one cycle stage (task 11.3).
 *
 * @param {Array<{cycle: number, totalPss: number}>} cycles - ordered by cycle
 * @param {object} ratchet - { warmUpCycles, referenceWindow, finalVsReferenceAllowanceBytes, slopePerCycleAllowanceBytes }
 * @returns {{ failures: string[], reference: number|null, final: number|null, slope: number|null }}
 */
export function evaluateRatchet(cycles, ratchet) {
  const failures = [];
  const warmUp = ratchet.warmUpCycles ?? 2;
  const window = ratchet.referenceWindow ?? 3;

  const warmed = cycles.filter((c, i) => i >= warmUp);
  if (warmed.length < 2) {
    return {
      failures: [],
      reference: null,
      final: null,
      slope: null,
      skipped: `fewer than ${Math.max(2, warmUp + 1)} post-warm-up cycles available`,
    };
  }

  const reference = median(warmed.slice(0, window).map((c) => c.totalPss));
  const final = warmed[warmed.length - 1].totalPss;
  const xs = warmed.map((c) => c.cycle);
  const ys = warmed.map((c) => c.totalPss);
  const slope = olsSlope(xs, ys);

  const finalAllowance = ratchet.finalVsReferenceAllowanceBytes ?? 64 * 1024 * 1024;
  const slopeAllowance = ratchet.slopePerCycleAllowanceBytes ?? 8 * 1024 * 1024;

  if (reference != null && final - reference > finalAllowance) {
    failures.push(
      `ratchet: final cycle ${formatBytes(final)} exceeds the warmed-up reference ${formatBytes(reference)} by ${formatBytes(final - reference)} (allowance ${formatBytes(finalAllowance)})`,
    );
  }
  if (slope > slopeAllowance) {
    failures.push(
      `ratchet: cycle-over-cycle slope ${formatBytes(slope)}/cycle exceeds the allowance ${formatBytes(slopeAllowance)}/cycle`,
    );
  }

  return { failures, reference, final, slope };
}

// ---------------------------------------------------------------------------
// Machine profile matching (task 11.5)
// ---------------------------------------------------------------------------

/**
 * Compare the result's environment against the baseline machine profile.
 * Returns the differing fields, or null when they match.
 */
export function profileMismatch(result, baselines) {
  const profile = baselines.machineProfile ?? {};
  const environment = result.environment ?? {};
  const differing = [];

  for (const field of PROFILE_FIELDS) {
    const expected = profile[field] ?? null;
    const actual = environment[field] ?? null;
    // totalRamBytes is a number in both; normalize by String() for comparison.
    if (String(expected) !== String(actual)) differing.push(field);
  }

  // Corpus identity: the baseline records the exact hashes it was measured with.
  const expectedHashes = profile.corpusHashes ?? {};
  const actualHashes = result.corpus?.itemHashes ?? {};
  const hashFields = [...new Set([...Object.keys(expectedHashes), ...Object.keys(actualHashes)])];
  for (const name of hashFields) {
    if (String(expectedHashes[name] ?? null) !== String(actualHashes[name] ?? null)) {
      differing.push(`corpus:${name}`);
    }
  }

  return differing.length > 0 ? differing : null;
}

// ---------------------------------------------------------------------------
// Threshold policy (D6 / task 11.2)
// ---------------------------------------------------------------------------

/** allowedGrowth = clamp(baseline × relative, floor, ceiling) */
export function allowedGrowth(baselineBytes, metric) {
  const { relativeAllowance, absoluteFloorBytes, absoluteCeilingBytes } = {
    ...DEFAULT_ALLOWANCES,
    ...metric,
  };
  const proportional = baselineBytes * relativeAllowance;
  return Math.min(Math.max(proportional, absoluteFloorBytes), absoluteCeilingBytes);
}

// ---------------------------------------------------------------------------
// Comparator (task 11.1)
// ---------------------------------------------------------------------------

/**
 * Compare a memory benchmark result against the committed baselines.
 *
 * @param {object} args
 * @param {object} args.result - parsed harness result (.bench/memory-result.json)
 * @param {object} args.baselines - parsed scripts/memory-baselines.json
 * @returns {{
 *   usable: boolean, reason?: string,
 *   rows: Array<object>, failures: string[], warnings: string[],
 *   ratchet: Array<object>, evaluation: object|null
 * }}
 */
export function compareMemoryResults({ result, baselines: baselinesInput }) {
  const resolved = resolveBaselinesForResult(baselinesInput, result);
  if (resolved.skipGate) {
    return {
      usable: false,
      skipGate: true,
      reason: resolved.reason,
      profileKey: resolved.profileKey,
      rows: [],
      failures: [],
      warnings: [],
      ratchet: [],
      evaluation: null,
    };
  }
  const baselines = resolved.baselines;
  // Unusable inputs get no verdict at all (exit 2 in the CLI).
  if (!baselines || typeof baselines !== "object" || !baselines.metrics || !baselines.machineProfile) {
    return { usable: false, reason: "baselines file has no metrics/machineProfile block", rows: [], failures: [], warnings: [], ratchet: [], evaluation: null };
  }
  if (!result || typeof result !== "object" || !Array.isArray(result.samples)) {
    return { usable: false, reason: "result has no samples array", rows: [], failures: [], warnings: [], ratchet: [], evaluation: null };
  }
  if (result.reliable === false) {
    return { usable: false, reason: `run marked unreliable: ${result.unreliableReason ?? "no reason recorded"}`, rows: [], failures: [], warnings: [], ratchet: [], evaluation: null };
  }
  const mismatch = profileMismatch(result, baselines);
  if (mismatch) {
    return { usable: false, reason: `machine profile mismatch on: ${mismatch.join(", ")}`, rows: [], failures: [], warnings: [], ratchet: [], evaluation: null };
  }

  const failures = [];
  const warnings = [];
  const rows = [];
  const metrics = extractMetrics(result);
  const metricEntries = baselines.metrics ?? {};

  // Metrics in the baseline but absent from the result: a failure, never a skip.
  for (const [name, entry] of Object.entries(metricEntries)) {
    const measured = metrics[name] ?? null;
    if (measured == null) {
      failures.push(`metric "${name}" is in the baselines but absent from the result — the stage was not sampled`);
      rows.push({ name, kind: entry.kind ?? "gated", baseline: entry.baseline, measured: null, delta: null, threshold: null, verdict: "FAIL" });
    }
  }

  for (const [name, measured] of Object.entries(metrics)) {
    if (measured == null) continue;
    const entry = metricEntries[name];
    if (!entry) {
      // New metric with no baseline: warn and hand the author the exact JSON
      // entry to paste (task 11.8).
      warnings.push(
        `metric "${name}" has no baseline — paste this into scripts/memory-baselines.json:\n` +
          `      "${name}": { "baseline": ${measured}, "kind": "diagnostic" }`
      );
      rows.push({ name, kind: "diagnostic", baseline: null, measured, delta: null, threshold: null, verdict: "WARN" });
      continue;
    }

    const kind = entry.kind === "diagnostic" ? "diagnostic" : "gated";
    const growth = allowedGrowth(entry.baseline, entry);
    const threshold = entry.baseline + growth;
    const delta = measured - entry.baseline;
    const regressed = measured > threshold;

    rows.push({
      name,
      kind,
      baseline: entry.baseline,
      measured,
      delta,
      threshold: regressed ? threshold : null,
      verdict: regressed ? "FAIL" : "PASS",
    });
    if (regressed) {
      const message =
        `metric "${name}" (${kind}): measured ${formatBytes(measured)} exceeds baseline ${formatBytes(entry.baseline)} ` +
        `by ${formatBytes(delta)} (${formatSignificant((delta / entry.baseline) * 100, 3)}%) — ` +
        `threshold ${formatBytes(threshold)} = baseline + ${formatBytes(growth)} (allowance clamped between ` +
        `${formatBytes(entry.absoluteFloorBytes ?? DEFAULT_ALLOWANCES.absoluteFloorBytes)} and ` +
        `${formatBytes(entry.absoluteCeilingBytes ?? DEFAULT_ALLOWANCES.absoluteCeilingBytes)})`;
      if (kind === "gated") {
        // Hard gate: fails the run.
        failures.push(message);
      } else {
        // Diagnostic (task 11.4): reported with baseline/measured/deltas, but
        // never affects the exit status.
        warnings.push(`DIAGNOSTIC REGRESSION — ${message}`);
      }
    }
  }

  // Ratchet criterion over the cycle stages (task 11.3), now with per-role
  // variants (task 8.2): the same final-vs-reference and slope allowances,
  // evaluated separately for the tree total and the `native` /
  // `web-content` roles — a leak confined to the WebContent process must
  // fail even when the tree total hides it under its allowance.
  const ratchetParams = baselines.ratchet ?? {};
  const ratchet = [];
  const roleTotal = (sample, role) => {
    if (role === "tree") return sample.total?.Pss ?? null;
    const bytes = (sample.processes ?? [])
      .filter((p) => p.present && p.role === role)
      .reduce((sum, p) => sum + (p.values?.Pss ?? 0), 0);
    return bytes > 0 ? bytes : null;
  };
  for (const stage of ["single-cycles", "multi-cycles"]) {
    for (const role of ["tree", "native", "web-content"]) {
      const cycles = (result.samples ?? [])
        .filter((s) => s.stage === stage && s.cycle != null && roleTotal(s, role) != null)
        .map((s) => ({ cycle: s.cycle, totalPss: roleTotal(s, role) }))
        .sort((a, b) => a.cycle - b.cycle);
      if (cycles.length === 0) continue;
      const outcome = evaluateRatchet(cycles, ratchetParams);
      ratchet.push({ stage, role, ...outcome });
      for (const f of outcome.failures) failures.push(`[${stage}/${role}] ${f}`);
    }
  }

  const evaluation = {
    schema: "incrementum-memory-evaluation-v1",
    verdict: failures.length > 0 ? "fail" : "pass",
    machineProfileCompared: baselines.machineProfile,
    metrics: rows.map((row) => ({
      name: row.name,
      kind: row.kind,
      baseline: row.baseline,
      measured: row.measured,
      threshold: row.threshold,
      verdict: row.verdict,
    })),
    ratchet,
  };

  return { usable: true, rows, failures, warnings, ratchet, evaluation };
}

// ---------------------------------------------------------------------------
// CLI (task 11.1, 11.7)
// ---------------------------------------------------------------------------

export function main(argv = process.argv) {
  const warnOnly = argv.includes("--warn-only");
  const positional = argv.slice(2).filter((a) => !a.startsWith("--"));
  const resultPath = positional[0] ?? DEFAULT_RESULT_PATH;

  let result;
  try {
    result = JSON.parse(readFileSync(resultPath, "utf8"));
  } catch (err) {
    console.error(`[memory-budget] Cannot read ${resultPath} — run \`npm run bench:memory\` first (${err.message})`);
    process.exit(2);
  }

  let baselines;
  try {
    baselines = JSON.parse(readFileSync(DEFAULT_BASELINES_PATH, "utf8"));
  } catch (err) {
    console.error(`[memory-budget] Cannot read ${DEFAULT_BASELINES_PATH} — record baselines per the procedure in docs/memory-profile.md (${err.message})`);
    process.exit(2);
  }

  const outcome = compareMemoryResults({ result, baselines });

  if (!outcome.usable) {
    if (outcome.skipGate) {
      console.warn(`[memory-budget] Skipping gate: ${outcome.reason}`);
      process.exit(0);
    }
    console.error(`[memory-budget] Cannot issue a verdict: ${outcome.reason}`);
    process.exit(2);
  }

  console.log(`[memory-budget] comparing against profile: ${profileLabel(baselines.machineProfile)}`);

  printAlignedTable(
    [
      { label: "metric", width: 22 },
      { label: "kind", width: 11 },
      { label: "baseline", width: 12 },
      { label: "current", width: 12 },
      { label: "change", width: 12 },
      { label: "status", width: 8 },
    ],
    outcome.rows.map((row) => [
      row.name,
      row.kind,
      formatBytes(row.baseline),
      formatBytes(row.measured),
      row.delta == null ? "—" : (row.delta >= 0 ? "+" : "−") + formatBytes(Math.abs(row.delta)),
      row.verdict,
    ]),
  );

  for (const r of outcome.ratchet) {
    const ref = r.reference == null ? "—" : formatBytes(r.reference);
    const final = r.final == null ? "—" : formatBytes(r.final);
    const slope = r.slope == null ? "—" : `${formatBytes(r.slope)}/cycle`;
    const role = r.role ? `/${r.role}` : "";
    console.log(`[memory-budget] ratchet ${r.stage}${role}: reference ${ref}, final ${final}, slope ${slope}`);
  }

  for (const w of outcome.warnings) {
    console.warn(`[memory-budget] WARN:\n  - ${w}`);
  }

  const failed = outcome.failures.length > 0;
  if (failed) {
    console.error("[memory-budget] FAILED:");
    for (const f of outcome.failures) console.error(`  - ${f}`);
    console.error(
      "[memory-budget] If this regression is intentional, re-record scripts/memory-baselines.json in the same PR (see docs/memory-profile.md)."
    );
  }

  // Persist the machine-readable evaluation record (task 11.9).
  try {
    mkdirSync(dirname(DEFAULT_EVALUATION_PATH), { recursive: true });
    writeFileSync(DEFAULT_EVALUATION_PATH, JSON.stringify(outcome.evaluation, null, 2));
  } catch (err) {
    console.warn(`[memory-budget] Could not write evaluation record: ${err.message}`);
  }

  if (failed && !warnOnly) {
    console.error(`[memory-budget] ${outcome.failures.length} failure(s).`);
    process.exit(1);
  }

  const suffix = warnOnly && failed ? ` (warn-only: ${outcome.failures.length} failure(s) reported but not enforced)` : "";
  console.log(`[memory-budget] OK${suffix} — ${outcome.rows.length} metric(s) compared.`);
  process.exit(0);
}

function profileLabel(profile) {
  if (!profile) return "(none)";
  const parts = [profile.platform, profile.kernel, profile.cpuModel, profile.appVersion].filter(Boolean);
  return parts.join(" / ") || "(unknown)";
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
