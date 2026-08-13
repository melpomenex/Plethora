/**
 * Unit tests for scripts/check-perf-budget.mjs — run with `npm run test:scripts`
 * (`node --test`, no shelling out: the comparison function is imported
 * directly so the four outcome classes are exercised against fixture objects).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparePerfResults, ANCHOR_NAME } from "../check-perf-budget.mjs";

/** Fixed anchor so fixture costs are easy to compute by hand (anchorHz = 1000). */
const anchor = { name: ANCHOR_NAME, hz: 1000 };

function results(benches) {
  return [anchor, ...benches];
}

function baselines(entries) {
  return { defaultTolerance: 1.25, benchmarks: entries };
}

test("over-tolerance measured cost is a failure naming limit and benchmark", () => {
  const out = comparePerfResults({
    results: results([{ name: "hot", hz: 50 }]), // cost = 20
    baselines: baselines({ hot: { cost: 10 } }), // limit = 12.5
  });
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /"hot"/);
  assert.match(out.failures[0], /12\.5/);
  assert.equal(out.rows.find((r) => r.name === "hot")?.verdict, "FAIL");
});

test("baselined benchmark missing from results is a failure", () => {
  const out = comparePerfResults({
    results: results([]),
    baselines: baselines({ gone: { cost: 5 } }),
  });
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /"gone"/);
  assert.match(out.failures[0], /deleted or failed to run/);
});

test("result without a baseline entry is a warning carrying the paste line", () => {
  const out = comparePerfResults({
    results: results([{ name: "fresh", hz: 200 }]), // cost = 5
    baselines: baselines({}),
  });
  assert.equal(out.failures.length, 0);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /"fresh": \{ "cost": 5 \}/);
  assert.equal(out.rows.find((r) => r.name === "fresh")?.verdict, "WARN");
});

test("measured cost more than 25% below baseline warns the baseline is stale", () => {
  const out = comparePerfResults({
    results: results([{ name: "fast", hz: 300 }]), // cost ≈ 3.33 < 7.5
    baselines: baselines({ fast: { cost: 10 } }),
  });
  assert.equal(out.failures.length, 0);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /stale/);
  assert.equal(out.rows.find((r) => r.name === "fast")?.verdict, "WARN");
});

test("within-tolerance benchmark passes", () => {
  const out = comparePerfResults({
    results: results([{ name: "ok", hz: 95 }]), // cost ≈ 10.5, limit 12.5
    baselines: baselines({ ok: { cost: 10 } }),
  });
  assert.equal(out.failures.length, 0);
  assert.equal(out.warnings.length, 0);
  assert.equal(out.rows.find((r) => r.name === "ok")?.verdict, "PASS");
});

test("per-benchmark tolerance overrides the default", () => {
  const out = comparePerfResults({
    results: results([{ name: "lenient", hz: 55 }]), // cost ≈ 18.2
    baselines: baselines({ lenient: { cost: 10, tolerance: 2 } }), // limit = 20
  });
  assert.equal(out.failures.length, 0);
  assert.equal(out.rows.find((r) => r.name === "lenient")?.verdict, "PASS");
});

test("median cohort calibration removes a runner-wide shift but preserves an individual regression", () => {
  const entries = {
    a: { cost: 10 },
    b: { cost: 10 },
    c: { cost: 10 },
    d: { cost: 10 },
    hot: { cost: 10 },
  };
  const out = comparePerfResults({
    // Four paths and the runner anchor shifted together by 2x relative to the
    // baseline cohort; hot has an additional 50% regression (raw ratio 3x).
    results: results([
      { name: "a", hz: 50 },
      { name: "b", hz: 50 },
      { name: "c", hz: 50 },
      { name: "d", hz: 50 },
      { name: "hot", hz: 1000 / 30 },
    ]),
    baselines: baselines(entries),
  });
  assert.equal(out.environmentScale, 2);
  assert.equal(out.rows.find((r) => r.name === "a")?.verdict, "PASS");
  assert.equal(out.rows.find((r) => r.name === "hot")?.verdict, "FAIL");
});

test("missing anchor is signalled as not comparable (anchor null, nothing compared)", () => {
  const out = comparePerfResults({
    results: [{ name: "hot", hz: 50 }], // no noise-anchor in the run
    baselines: baselines({ hot: { cost: 10 } }),
  });
  assert.equal(out.anchor, null);
  assert.equal(out.failures.length, 0);
  assert.equal(out.warnings.length, 0);
  assert.equal(out.rows.length, 0);
});
