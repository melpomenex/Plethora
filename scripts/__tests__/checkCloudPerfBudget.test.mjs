/**
 * Unit tests for scripts/check-cloud-perf-budget.mjs — run with `npm run test:scripts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCloudPerf } from "../check-cloud-perf-budget.mjs";

const sampleBaselines = {
  defaultTolerance: 1.3,
  endpoints: {
    auth_session_verify: { maxP95Ms: 50 },
    sync_push_record: { maxP95Ms: 100 },
  },
};

test("cloud perf budget passes when measurements are within limit", () => {
  const sampleResults = {
    endpoints: {
      auth_session_verify: { p95Ms: 45 },
      sync_push_record: { p95Ms: 95 },
    },
  };

  const outcome = checkCloudPerf(sampleResults, sampleBaselines);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.failures.length, 0);
  assert.equal(outcome.comparisons.length, 2);
  assert.equal(outcome.comparisons[0].verdict, "PASS");
});

test("cloud perf budget fails when latency exceeds tolerance", () => {
  const sampleResults = {
    endpoints: {
      auth_session_verify: { p95Ms: 120 }, // 120 > 50 * 1.3 = 65
      sync_push_record: { p95Ms: 90 },
    },
  };

  const outcome = checkCloudPerf(sampleResults, sampleBaselines);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failures.length, 1);
  assert.match(outcome.failures[0], /auth_session_verify/);
});

test("warns when endpoint is missing from test run", () => {
  const sampleResults = {
    endpoints: {
      auth_session_verify: { p95Ms: 40 },
    },
  };

  const outcome = checkCloudPerf(sampleResults, sampleBaselines, { warnOnly: false });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.warnings.length, 1);
  assert.match(outcome.warnings[0], /sync_push_record/);
});
