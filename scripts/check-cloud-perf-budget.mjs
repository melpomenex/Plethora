#!/usr/bin/env node
/**
 * Cloud Performance Budget Check (Proposal 24).
 *
 * Compares cloud endpoint load-test measurements against scripts/cloud-perf-baselines.json.
 *
 * Usage:
 *   node scripts/check-cloud-perf-budget.mjs [resultsJson] [--warn-only]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultBaselinesPath = join(scriptDir, 'cloud-perf-baselines.json');

export function checkCloudPerf(results, baselines, options = {}) {
  const tolerance = baselines.defaultTolerance || 1.3;
  const failures = [];
  const warnings = [];
  const comparisons = [];

  for (const [endpointKey, config] of Object.entries(baselines.endpoints || {})) {
    const measured = results.endpoints?.[endpointKey];
    if (!measured) {
      if (!options.warnOnly) {
        warnings.push(`Missing cloud endpoint measurement in run: ${endpointKey}`);
      }
      continue;
    }

    const maxAllowedP95 = config.maxP95Ms * tolerance;
    const isP95Regression = measured.p95Ms > maxAllowedP95;

    comparisons.push({
      endpoint: endpointKey,
      baselineP95: config.maxP95Ms,
      measuredP95: measured.p95Ms,
      verdict: isP95Regression ? 'FAIL' : 'PASS',
    });

    if (isP95Regression) {
      failures.push(
        `Cloud latency regression on ${endpointKey}: measured P95 ${measured.p95Ms}ms > baseline limit ${maxAllowedP95.toFixed(1)}ms`
      );
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    comparisons,
  };
}

// CLI runner
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const warnOnly = args.includes('--warn-only');
  const resultsFile = args.find((a) => !a.startsWith('--'));

  if (!resultsFile || !existsSync(resultsFile)) {
    console.log('[cloud-perf-budget] No cloud results file provided or file not found. Skipping.');
    process.exit(0);
  }

  const results = JSON.parse(readFileSync(resultsFile, 'utf8'));
  const baselines = JSON.parse(readFileSync(defaultBaselinesPath, 'utf8'));
  const result = checkCloudPerf(results, baselines, { warnOnly });

  for (const comp of result.comparisons) {
    console.log(
      `[cloud-perf-budget] ${comp.endpoint.padEnd(30)} baseline P95: ${comp.baselineP95}ms | measured: ${comp.measuredP95}ms | ${comp.verdict}`
    );
  }

  if (result.warnings.length > 0) {
    console.warn('[cloud-perf-budget] WARNINGS:', result.warnings);
  }

  if (!result.ok) {
    console.error('[cloud-perf-budget] FAILURES:');
    for (const f of result.failures) {
      console.error(`  - ${f}`);
    }
    if (!warnOnly) {
      process.exit(1);
    }
  }

  console.log('[cloud-perf-budget] All checked cloud latency budgets passed.');
  process.exit(0);
}
