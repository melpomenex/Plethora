/**
 * Change A task 4.4 — unit tests for the iOS monotonic build-number scheme in
 * scripts/release.cjs. Pure-function tests only: release.cjs's side effects
 * run solely under its require.main guard, so importing it here is inert.
 *
 * Scheme (docs/release/ios-reproducible-build.md): CURRENT_PROJECT_VERSION is
 * a monotonic integer persisted in a committed counter file; every release
 * increments it by exactly one; IOS_BUILD_NUMBER overrides for extra
 * between-release TestFlight uploads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readBuildNumber, computeNextBuildNumber } from "../release.cjs";

test("readBuildNumber returns 0 when the counter file does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "ios-bn-"));
  try {
    assert.equal(readBuildNumber(join(dir, "absent.txt")), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readBuildNumber parses committed counters and rejects corrupt ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "ios-bn-"));
  try {
    const p = join(dir, "build-number.txt");
    writeFileSync(p, "1\n");
    assert.equal(readBuildNumber(p), 1);
    writeFileSync(p, "  42  \n");
    assert.equal(readBuildNumber(p), 42);

    writeFileSync(p, "abc\n");
    assert.throws(() => readBuildNumber(p), /Corrupt build-number file/);
    writeFileSync(p, "-3\n");
    assert.throws(() => readBuildNumber(p), /Corrupt build-number file/);
    writeFileSync(p, "2.5\n");
    assert.throws(() => readBuildNumber(p), /Corrupt build-number file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeNextBuildNumber is strictly monotonic (+1 per release)", () => {
  assert.equal(computeNextBuildNumber(0), 1);
  assert.equal(computeNextBuildNumber(1), 2);
  assert.equal(computeNextBuildNumber(2007000), 2007001);
  // Monotonicity invariant across a simulated release train.
  let n = 7;
  for (let i = 0; i < 10; i++) {
    const next = computeNextBuildNumber(n);
    assert.ok(next > n);
    n = next;
  }
  assert.equal(n, 17);
});

test("committed counter file round-trips through the +1 scheme", () => {
  const dir = mkdtempSync(join(tmpdir(), "ios-bn-"));
  try {
    const p = join(dir, "build-number.txt");
    writeFileSync(p, `${computeNextBuildNumber(readBuildNumber(p))}\n`);
    assert.equal(readFileSync(p, "utf8").trim(), "1");
    writeFileSync(p, `${computeNextBuildNumber(readBuildNumber(p))}\n`);
    assert.equal(readFileInt(p), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readFileInt(p) {
  return Number(readFileSync(p, "utf8").trim());
}
