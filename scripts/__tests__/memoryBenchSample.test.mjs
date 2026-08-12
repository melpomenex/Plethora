/**
 * Unit tests for scripts/memory-bench/sample.js and platform.js — run with
 * `npm run test:scripts` (`node --test`). Covers task 2.5 (aggregator: total
 * is a PSS-family sum, never Rss; an absent process does not fail the sample)
 * and task 2.6 (platform gate: non-Linux and missing smaps_rollup report
 * unsupported).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregateSample, readProcessSample, TOTAL_FIELDS } from "../memory-bench/sample.js";
import { checkMemoryCollectionSupported } from "../memory-bench/platform.js";

const KiB = 1024;

function rollup(overrides = {}) {
  const base = {
    Pss: 100 * KiB,
    Pss_Anon: 60 * KiB,
    Pss_File: 40 * KiB,
    Pss_Shmem: 0,
    Private_Dirty: 30 * KiB,
    Rss: 500 * KiB,
    Swap: 0,
  };
  return { ...base, ...overrides };
}

test("tree total sums the proportional fields and never includes Rss", () => {
  const out = aggregateSample(
    [{ pid: 1 }, { pid: 2 }],
    (pid) => ({ pid, present: true, values: rollup(pid === 2 ? { Rss: 900 * KiB } : {}) }),
  );
  assert.equal(out.complete, true);
  assert.equal(out.total.Pss, 200 * KiB);
  assert.equal(out.total.Pss_Anon, 120 * KiB);
  assert.equal(out.total.Pss_File, 80 * KiB);
  assert.equal(out.total.Swap, 0);
  // Rss is 500 + 900 KiB, but must NOT appear in the total at all.
  assert.ok(!("Rss" in out.total));
  for (const field of TOTAL_FIELDS) {
    assert.equal(typeof out.total[field], "number");
  }
});

test("absent fields inside a present process contribute nothing but stay visible per-process", () => {
  const out = aggregateSample(
    [{ pid: 1 }],
    () => ({
      pid: 1,
      present: true,
      values: { Pss: 100 * KiB, Pss_Anon: null, Pss_File: 40 * KiB, Pss_Shmem: null, Private_Dirty: 30 * KiB, Rss: 500 * KiB, Swap: null },
    }),
  );
  assert.equal(out.complete, true);
  assert.equal(out.total.Pss, 100 * KiB);
  assert.equal(out.total.Pss_Anon, 0); // null contributes nothing, not a fake zero
  assert.equal(out.total.Swap, 0);
  assert.equal(out.processes[0].values.Pss_Anon, null); // absence is visible
});

test("an absent process does not fail the sample and its bytes are not counted", () => {
  const out = aggregateSample(
    [{ pid: 1 }, { pid: 2 }],
    (pid) =>
      pid === 2
        ? { pid: 2, present: false, reason: "process exited between discovery and sampling" }
        : { pid: 1, present: true, values: rollup() },
  );
  assert.equal(out.complete, false);
  assert.equal(out.total.Pss, 100 * KiB); // only process 1 contributed
  assert.match(out.processes[1].reason, /exited/);
});

test("readProcessSample records an exited process as absent with a reason", (t) => {
  const root = mkdtempSync(join(tmpdir(), "membench-sample-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // No smaps_rollup file for pid 42 -> absent.
  const absent = readProcessSample(root, 42);
  assert.equal(absent.present, false);
  assert.match(absent.reason, /cannot read/);

  // A valid rollup parses through the same path.
  const pid = join(root, "7");
  mkdirSync(pid);
  writeFileSync(join(pid, "smaps_rollup"), `Pss:                100 kB\nRss:                200 kB\n`);
  const present = readProcessSample(root, 7);
  assert.equal(present.present, true);
  assert.equal(present.values.Pss, 100 * KiB);
  assert.equal(present.values.Rss, 200 * KiB);
  assert.equal(present.values.Pss_Anon, null);

  // A malformed rollup is an absent-with-reason, not a number.
  writeFileSync(join(pid, "smaps_rollup"), "not a rollup\n");
  const malformed = readProcessSample(root, 7);
  assert.equal(malformed.present, false);
  assert.match(malformed.reason, /malformed/);
});

test("platform gate: non-Linux is unsupported", () => {
  const out = checkMemoryCollectionSupported({ platform: "darwin" });
  assert.equal(out.supported, false);
  assert.match(out.reason, /only on Linux/);
});

test("platform gate: missing smaps_rollup is unsupported and names what is needed", () => {
  const out = checkMemoryCollectionSupported({
    platform: "linux",
    procRoot: "/nonexistent-proc-root",
  });
  assert.equal(out.supported, false);
  assert.match(out.reason, /smaps_rollup is unavailable/);
});

test("platform gate: supported on Linux with a readable smaps_rollup", () => {
  const out = checkMemoryCollectionSupported({ platform: "linux", procRoot: "/proc" });
  assert.equal(out.supported, true);
});
