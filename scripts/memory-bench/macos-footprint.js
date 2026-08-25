/**
 * macOS collector (change eliminate-long-running-memory-growth, tasks 2.3/2.7).
 *
 * Invokes the native helper (`native/macos-footprint`, built on demand) to
 * snapshot the launched app's process tree with per-process physical
 * footprint (`ri_phys_footprint`), then normalizes each process into the SAME
 * per-process sample shape the Linux collector produces:
 *
 *   { pid, present, role, values: { Pss, Rss, PhysFootprint, Wired, VmSize } }
 *
 * `Pss` carries the physical footprint on macOS — it is the additive,
 * PSS-philosophy headline (per-process charges are additive; shared pages
 * must not be double-counted), so the tree total, settle convergence, and the
 * comparator all keep working through the existing `total.Pss` key. `Rss` is
 * populated per process but NEVER summed, mirroring the Linux rule. D4.
 *
 * Membership: the helper walks ancestry from the launched PID; this module
 * re-verifies ancestry from the helper's own pid/ppid pairs (defense in
 * depth) and records the run-ID marker check per process where macOS allowed
 * reading the environment (`markerVerified: false` + ancestry-verified is
 * acceptable — D3).
 */

import { spawnSync } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const HELPER_DIR = join(moduleDir, "native", "macos-footprint");
export const HELPER_BINARY = join(HELPER_DIR, "target", "release", "macos-footprint");

/** Roles, matching discovery.js::ROLES. */
const ROLES = { NATIVE: "native", WEB_CONTENT: "web-content", NETWORK: "network", OTHER: "other" };

/** Is the helper binary present and executable? (Platform gate input, 2.4.) */
export function isHelperAvailable() {
  if (!existsSync(HELPER_BINARY)) return false;
  try {
    accessSync(HELPER_BINARY, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the helper via cargo if missing (driver-driven; task 2.7). Returns
 * true when the binary is available afterwards.
 */
export function ensureHelperBuilt({ buildTimeoutMs = 300_000 } = {}) {
  if (isHelperAvailable()) return true;
  const result = spawnSync("cargo", ["build", "--release"], {
    cwd: HELPER_DIR,
    encoding: "utf8",
    timeout: buildTimeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    console.error(
      `[macos-footprint] cargo build failed (status ${result.status}):\n${result.stderr ?? ""}`,
    );
    return false;
  }
  return isHelperAvailable();
}

/**
 * Snapshot the WebKit XPC pids that exist right now (driver baseline).
 * @returns {number[]}
 */
export function listWebKitPids() {
  const result = spawnSync(HELPER_BINARY, ["--list-webkit"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * Run the helper once and parse its JSON.
 * @returns {{ rootPid: number, processes: Array<object>, absent: Array<object>} | null}
 */
export function runHelper({ launchedPid, runId, webkitBaseline }) {
  const args = [String(launchedPid)];
  if (runId) args.push("--marker", runId);
  // Pass the flag even for an EMPTY baseline: "no pre-existing helpers"
  // is the strongest differential case (every WebKit process post-launch
  // belongs to this app).
  if (Array.isArray(webkitBaseline)) {
    args.push("--webkit-baseline", webkitBaseline.join(","));
  }
  const result = spawnSync(HELPER_BINARY, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `macos-footprint helper failed (status ${result.status}): ${result.stderr ?? result.error?.message ?? "no output"}`,
    );
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!parsed || !Array.isArray(parsed.processes)) {
      throw new Error("helper output has no processes array");
    }
    return parsed;
  } catch (error) {
    throw new Error(`macos-footprint helper emitted unparseable output: ${error.message}`);
  }
}

/** Driver-side ancestry re-verification over the helper's pid/ppid pairs. */
export function verifyAncestry(processes, rootPid) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const reachesRoot = (proc) => {
    let current = proc;
    let steps = 0;
    while (current && steps++ < 1024) {
      if (current.pid === rootPid) return true;
      if (current.ppid === current.pid) return false;
      current = byPid.get(current.ppid);
    }
    return false;
  };
  return processes.filter((p) => p.pid === rootPid || reachesRoot(p));
}

/**
 * Classify from the helper's roleHint with the launched pid pinned to
 * `native` (mirrors discovery.js::classifyRole).
 */
export function classifyFromHint(pid, launchedPid, roleHint, executable) {
  if (pid === launchedPid) return ROLES.NATIVE;
  const hint = roleHint ?? "";
  if (hint === ROLES.WEB_CONTENT || /webkit\.webcontent|webkitwebprocess/i.test(executable ?? "")) {
    return ROLES.WEB_CONTENT;
  }
  if (hint === ROLES.NETWORK || /webkit\.network/i.test(executable ?? "")) return ROLES.NETWORK;
  return ROLES.OTHER;
}

/**
 * Normalize helper rows into the shared per-process sample shape.
 *
 * Membership (D3): descendant of the launched root OR carrying the run-ID
 * marker in its environment. The OR matters on macOS: WKWebView helper
 * processes (WebContent/Networking/GPU) are XPC services reparented to
 * launchd, so ancestry alone finds only the native root — the marker is
 * the only relationship signal for them (markerVerified is recorded per
 * process; unreadable environments exclude rather than include).
 * @returns {Array<{pid, ppid, present, role, markerVerified, values}>}
 */
export function normalizeProcesses(helperOutput, launchedPid) {
  // The helper IS the membership authority: it applies the ancestry walk,
  // the (OS-dependent) run-ID marker, and the differential WebKit baseline.
  // Re-filtering here with JS-side ancestry+marker alone would drop the
  // launchd-reparented WKWebView helpers on macOS 26 (marker unreadable).
  const members = helperOutput.processes;
  const absent = new Set((helperOutput.absent ?? []).map((a) => a.pid));
  return members.map((p) => ({
    pid: p.pid,
    ppid: p.ppid,
    present: !absent.has(p.pid),
    role: classifyFromHint(p.pid, launchedPid, p.roleHint, p.executable),
    markerVerified: p.markerVerified === true,
    executable: p.executable,
    reason: absent.has(p.pid) ? "exited before footprint read" : undefined,
    // Pss carries the footprint (module doc); Rss never summed.
    values: {
      Pss: p.physFootprint ?? 0,
      Rss: p.residentSize ?? 0,
      PhysFootprint: p.physFootprint ?? 0,
      Wired: p.wiredSize ?? 0,
      VmSize: p.virtualSize ?? 0,
    },
  }));
}

/**
 * Collect one tree sample in the shared shape (the macOS analog of
 * `discoverProcesses` + `aggregateSample`).
 *
 * @returns {{
 *   processes: Array<{pid, present, role, markerVerified, values}>,
 *   total: { Pss: number, PhysFootprint: number },   // footprint sums; no Rss key
 *   complete: boolean,
 *   markerVerifiedAll: boolean,
 * }}
 */
export function collectMacOsTree({ helperOutput, launchedPid }) {
  const processes = normalizeProcesses(helperOutput, launchedPid);
  let pss = 0;
  let complete = true;
  for (const p of processes) {
    if (!p.present) {
      complete = false;
      continue;
    }
    pss += p.values.Pss;
  }
  return {
    processes,
    total: { Pss: pss, PhysFootprint: pss },
    complete,
    markerVerifiedAll: processes.length > 0 && processes.every((p) => p.markerVerified),
  };
}

/**
 * Full macOS sample entry point: run the helper and normalize.
 * (Injected `run` for tests.)
 */
export function sampleMacOsTree({ launchedPid, runId, webkitBaseline, run = runHelper }) {
  const helperOutput = run({ launchedPid, runId, webkitBaseline });
  return collectMacOsTree({ helperOutput, launchedPid });
}
