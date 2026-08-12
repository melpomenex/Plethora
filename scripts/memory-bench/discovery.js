/**
 * Process discovery for the memory benchmark collector.
 *
 * Finds every process belonging to the instance the driver launched, using
 * two independent signals (design D3):
 *
 *   1. Relationship: the candidate's process group is the launched process's
 *      group, OR its ancestor chain (walking PPid) reaches the launched pid.
 *   2. Verification: the candidate's /proc/<pid>/environ contains the
 *      launch-time run-id marker the driver set when it launched the app.
 *
 * Both must hold. A bare name match is never sufficient — WebKitGTK auxiliary
 * processes can be reparented, and a name match on "WebKitWebProcess" would
 * silently absorb another application's browser.
 *
 * Discovery is re-run at every sample (the driver calls it per sample), so
 * processes that appear or exit mid-scenario are handled naturally.
 *
 * All file access is rooted at `procRoot` so tests can point it at a synthetic
 * tree (see scripts/__tests__/memoryBenchDiscovery.test.ts).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Environment variable the driver sets on the launched app. */
export const RUN_ID_ENV = "INCREMENTUM_MEMORY_RUN_ID";

/** Process role classification. */
export const ROLES = {
  NATIVE: "native",
  WEB_CONTENT: "web-content",
  NETWORK: "network",
  OTHER: "other",
};

function isNumericDir(name) {
  return /^\d+$/.test(name);
}

/**
 * Read /proc/<pid>/status into a map of "Field:" -> value. Missing file
 * returns null (process exited / not present).
 */
function readStatus(procRoot, pid) {
  try {
    const text = readFileSync(join(procRoot, String(pid), "status"), "utf8");
    const fields = {};
    for (const line of text.split("\n")) {
      const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
      if (m) fields[m[1]] = m[2].trim();
    }
    return fields;
  } catch {
    return null;
  }
}

/** Read the run-id marker value from /proc/<pid>/environ, or null. */
export function readRunIdMarker(procRoot, pid) {
  try {
    const environ = readFileSync(join(procRoot, String(pid), "environ"));
    for (const entry of environ.toString("utf8").split("\0")) {
      const eq = entry.indexOf("=");
      if (eq === -1) continue;
      if (entry.slice(0, eq) === RUN_ID_ENV) return entry.slice(eq + 1);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Classify a process by role from its executable/comm name.
 * The launched app itself is "native"; WebKitGTK auxiliary processes are
 * classified by name; anything else marked by the run id is "other".
 */
export function classifyRole({ pid, launchedPid, name }) {
  if (pid === launchedPid) return ROLES.NATIVE;
  const n = (name || "").toLowerCase();
  if (n.includes("webcontent") || n.includes("webkitwebprocess")) return ROLES.WEB_CONTENT;
  if (n.includes("network") || n.includes("webkitnetworkprocess")) return ROLES.NETWORK;
  return ROLES.OTHER;
}

/**
 * Discover processes belonging to the launched instance.
 *
 * @param {object} options
 * @param {string} [options.procRoot="/proc"]
 * @param {number} options.launchedPid - pid the driver launched the app with.
 * @param {string} options.runId - the run-id marker value to verify against.
 * @returns {Array<{pid: number, ppid: number, pgrp: number, name: string,
 *                  role: string}>} sorted by pid.
 */
export function discoverProcesses({ procRoot = "/proc", launchedPid, runId }) {
  let entries;
  try {
    entries = readdirSync(procRoot, { withFileTypes: true });
  } catch {
    throw new Error(`cannot read ${procRoot} (${procRoot === "/proc" ? "is /proc mounted?" : "fixture missing"})`);
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isNumericDir(entry.name)) continue;
    const pid = Number(entry.name);
    const status = readStatus(procRoot, pid);
    if (!status) continue;

    const ppid = status.PPid ? Number(status.PPid) : NaN;
    const pgrp = status.NSpgid ? Number(status.NSpgid) : NaN;
    const name = status.Name ?? "";
    candidates.push({ pid, ppid, pgrp, name });
  }

  const launchedStatus = candidates.find((c) => c.pid === launchedPid);
  if (!launchedStatus) {
    return []; // The launched process itself is gone; nothing is attributable.
  }
  const launchedPgrp = launchedStatus.pgrp;

  /** Does `candidate` reach the launched pid by parent chain? */
  const byPid = new Map(candidates.map((c) => [c.pid, c]));
  const reachesLaunched = (candidate) => {
    let seen = 0;
    let current = candidate;
    while (current && seen++ < 1024) {
      if (current.pid === launchedPid) return true;
      if (current.ppid === current.pid || !Number.isFinite(current.ppid)) return false;
      current = byPid.get(current.ppid);
    }
    return false;
  };

  const discovered = [];
  for (const candidate of candidates) {
    if (candidate.pid === launchedPid) {
      // The launched process itself: relationship is trivially true, but it
      // must still carry the marker (it does by construction of the driver).
      if (readRunIdMarker(procRoot, candidate.pid) === runId) {
        discovered.push({ ...candidate, role: ROLES.NATIVE });
      }
      continue;
    }
    const related = candidate.pgrp === launchedPgrp || reachesLaunched(candidate);
    if (!related) continue;
    // Verify: the marker must be present and match. An unrelated application's
    // web-content process fails this even if its name matches.
    if (readRunIdMarker(procRoot, candidate.pid) !== runId) continue;
    discovered.push({
      ...candidate,
      role: classifyRole({ pid: candidate.pid, launchedPid, name: candidate.name }),
    });
  }

  return discovered.sort((a, b) => a.pid - b.pid);
}
