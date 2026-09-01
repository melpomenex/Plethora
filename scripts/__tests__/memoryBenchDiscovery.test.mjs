/**
 * Unit tests for scripts/memory-bench/discovery.js — run with
 * `npm run test:scripts` (`node --test`). Builds a synthetic /proc tree in a
 * temp dir covering the task 2.4 scenarios:
 *  - an unrelated application's web-content process with the same executable
 *    name (excluded),
 *  - a reparented marked child (included),
 *  - a process appearing only in later samples (included),
 *  - (exit-between-discovery-and-sampling is covered in memoryBenchSample.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProcesses, RUN_ID_ENV, ROLES, classifyRole } from "../memory-bench/discovery.js";

const RUN_ID = "run-abc123";

function statusFile(name, ppid, pgrp) {
  return `Name:\t${name}\nState:\tS (sleeping)\nPid:\t0\nPPid:\t${ppid}\nNSpgid:\t${pgrp}\n`;
}

function writeProcTree(root, procs) {
  for (const [pid, spec] of Object.entries(procs)) {
    const dir = join(root, pid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "status"), spec.status);
    if (spec.marker !== undefined) {
      const entries = spec.marker
        ? `${RUN_ID_ENV}=${RUN_ID}\0DISPLAY=:0\0HOME=/tmp\0`
        : `DISPLAY=:0\0HOME=/tmp\0`;
      writeFileSync(join(dir, "environ"), entries);
    }
  }
}

function makeTree(root) {
  writeProcTree(root, {
    1: { status: statusFile("systemd", 0, 1) }, // unrelated kernel/user process
    100: {
      status: statusFile("plethora-tauri", 1, 500),
      marker: true, // the launched app
    },
    101: {
      status: statusFile("WebKitWebProcess", 100, 500), // direct child
      marker: true,
    },
    102: {
      status: statusFile("WebKitNetworkProcess", 1, 500), // reparented to init, same pgrp
      marker: true,
    },
    105: {
      status: statusFile("WebKitWebProcess", 100, 501), // different pgrp, ancestor chain reaches 100
      marker: true,
    },
    200: {
      status: statusFile("WebKitWebProcess", 1, 900), // unrelated app, same name
      marker: false, // no run-id marker
    },
    201: {
      status: statusFile("chrome", 200, 900), // another unrelated child
      marker: false,
    },
  });
}

function freshTree(t) {
  const root = mkdtempSync(join(tmpdir(), "membench-proc-"));
  makeTree(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("discovers the launched process and its marked relatives, excluding foreign processes", (t) => {
  const root = freshTree(t);
  const found = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  const pids = found.map((p) => p.pid);

  assert.deepEqual(pids, [100, 101, 102, 105]);
  // The unrelated app's web-content process with the same name is excluded.
  assert.ok(!pids.includes(200), "foreign WebKitWebProcess must not be counted");
  assert.ok(!pids.includes(201));
  assert.ok(!pids.includes(1));
});

test("classifies roles: native, web content, network, other", (t) => {
  const root = freshTree(t);
  const found = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  const byPid = Object.fromEntries(found.map((p) => [p.pid, p]));

  assert.equal(byPid[100].role, ROLES.NATIVE);
  assert.equal(byPid[101].role, ROLES.WEB_CONTENT);
  assert.equal(byPid[102].role, ROLES.NETWORK);
  assert.equal(byPid[105].role, ROLES.WEB_CONTENT);
});

test("a reparented marked child (ppid outside the tree, same pgrp) is still counted", (t) => {
  const root = freshTree(t);
  const found = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  const p102 = found.find((p) => p.pid === 102);
  assert.ok(p102, "reparented child must be discovered through pgrp + marker");
  assert.equal(p102.ppid, 1);
});

test("a child in a different pgrp but reachable by ancestor chain is counted", (t) => {
  const root = freshTree(t);
  const found = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  const p105 = found.find((p) => p.pid === 105);
  assert.ok(p105, "ancestor-chain reachable child must be discovered");
  assert.equal(p105.pgrp, 501);
});

test("a process appearing only in later samples is included on re-discovery", (t) => {
  const root = freshTree(t);
  const first = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  assert.ok(!first.some((p) => p.pid === 103), "103 does not exist yet");

  // Simulate the app spawning a web process between samples.
  writeProcTree(root, {
    103: { status: statusFile("WebKitWebProcess", 100, 500), marker: true },
  });
  const second = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  assert.ok(second.some((p) => p.pid === 103), "mid-scenario process must appear in later samples");
});

test("a marked process is only counted when the marker value matches the run", (t) => {
  const root = freshTree(t);
  // Ask for a different run id: nothing in the tree carries it.
  const found = discoverProcesses({ procRoot: root, launchedPid: 100, runId: "other-run" });
  assert.deepEqual(found, []);
});

test("when the launched process is gone, nothing is attributable", (t) => {
  const root = freshTree(t);
  rmSync(join(root, "100"), { recursive: true, force: true });
  const found = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  assert.deepEqual(found, []);
});

test("a missing /proc root produces an attributed error", () => {
  assert.throws(
    () => discoverProcesses({ procRoot: join(tmpdir(), "does-not-exist-membench"), launchedPid: 100, runId: RUN_ID }),
    /cannot read/,
  );
});

test("classifyRole maps truncated Linux WebKit comm names", () => {
  assert.equal(
    classifyRole({ pid: 101, launchedPid: 100, name: "WebKitWebProce" }),
    ROLES.WEB_CONTENT,
  );
  assert.equal(
    classifyRole({ pid: 102, launchedPid: 100, name: "WebKitNetworkPr" }),
    ROLES.NETWORK,
  );
});

test("truncated comm names are classified via discovery", (t) => {
  const root = mkdtempSync(join(tmpdir(), "membench-proc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeProcTree(root, {
    100: { status: statusFile("plethora-tauri", 1, 500), marker: true },
    101: { status: statusFile("WebKitWebProce", 100, 500), marker: true },
    102: { status: statusFile("WebKitNetworkPr", 100, 500), marker: true },
  });
  const found = discoverProcesses({ procRoot: root, launchedPid: 100, runId: RUN_ID });
  const byPid = Object.fromEntries(found.map((p) => [p.pid, p]));
  assert.equal(byPid[101].role, ROLES.WEB_CONTENT);
  assert.equal(byPid[102].role, ROLES.NETWORK);
});
