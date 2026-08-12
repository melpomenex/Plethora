/**
 * Unit tests for scripts/memory-bench/smaps-rollup.js — run with
 * `npm run test:scripts` (`node --test`). Covers the task 2.2 fixtures:
 * a normal file, a file missing optional fields, a file with an unexpected
 * unit, and a malformed file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSmapsRollup, ROLLUP_FIELDS } from "../memory-bench/smaps-rollup.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "..", "memory-bench", "fixtures");
const fixture = (name) => readFileSync(join(fixtureDir, name), "utf8");

test("normal rollup parses every tracked field with kB units into bytes", () => {
  const out = parseSmapsRollup(fixture("smaps-rollup-normal.txt"));
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(out.values).sort(), [...ROLLUP_FIELDS].sort());
  assert.equal(out.values.Pss, 31288 * 1024);
  assert.equal(out.values.Pss_Anon, 12544 * 1024);
  assert.equal(out.values.Pss_File, 18744 * 1024);
  assert.equal(out.values.Pss_Shmem, 0); // a real zero is zero, not absent
  assert.equal(out.values.Private_Dirty, 3664 * 1024);
  assert.equal(out.values.Rss, 47536 * 1024);
  assert.equal(out.values.Swap, 2048 * 1024);
  assert.equal(out.notes.length, 0);
});

test("missing optional fields are absent (null), never defaulted to zero", () => {
  const out = parseSmapsRollup(fixture("smaps-rollup-missing-fields.txt"));
  assert.equal(out.ok, true);
  assert.equal(out.values.Pss, 4096 * 1024);
  assert.equal(out.values.Pss_Anon, 4096 * 1024);
  assert.equal(out.values.Pss_Shmem, null); // absent
  assert.equal(out.values.Swap, null); // absent
  assert.equal(out.values.Pss_File, null); // absent
  assert.equal(out.values.Private_Dirty, 4096 * 1024);
  assert.equal(out.values.Rss, 8192 * 1024);
});

test("field with an unexpected unit is reported absent with a note, not converted", () => {
  const out = parseSmapsRollup(fixture("smaps-rollup-unexpected-unit.txt"));
  assert.equal(out.ok, true);
  assert.equal(out.values.Pss, null); // "4 MiB" is unrecognised -> absent
  assert.equal(out.values.Rss, 4096 * 1024);
  assert.equal(out.values.Pss_Anon, 4096 * 1024);
  assert.equal(out.notes.length, 1);
  assert.match(out.notes[0], /Pss/);
  assert.match(out.notes[0], /unrecognised unit "MiB"/);
});

test("malformed input produces an attributed error, not a plausible number", () => {
  const out = parseSmapsRollup(fixture("smaps-rollup-malformed.txt"));
  assert.equal(out.ok, false);
  assert.match(out.error, /line \d+/); // attributes the failure to a line
});

test("empty input is an attributed error", () => {
  const out = parseSmapsRollup("");
  assert.equal(out.ok, false);
  assert.match(out.error, /no recognised fields|not a smaps_rollup/);
});

test("non-text input is an attributed error", () => {
  const out = parseSmapsRollup(null);
  assert.equal(out.ok, false);
  assert.match(out.error, /not text/);
});

test("integration: the real /proc/self/smaps_rollup parses cleanly on Linux", async (t) => {
  const { existsSync } = await import("node:fs");
  const path = "/proc/self/smaps_rollup";
  if (process.platform !== "linux" || !existsSync(path)) {
    t.skip(`${path} unavailable on this platform`);
    return;
  }
  const { readFileSync } = await import("node:fs");
  const out = parseSmapsRollup(readFileSync(path, "utf8"));
  assert.equal(out.ok, true, out.error ?? "");
  for (const field of ROLLUP_FIELDS) {
    assert.ok(
      typeof out.values[field] === "number" || out.values[field] === null,
      `${field} is a byte count or absent`,
    );
  }
});
