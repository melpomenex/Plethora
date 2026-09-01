/**
 * Result writer (task 3.8).
 *
 * Every sample is keyed by stage and cycle index, and the file carries the
 * environment block that materially affects the numbers: OS + kernel, web
 * engine version, app version + build profile, CPU model, total RAM, display
 * server, cycle count, corpus identity, and the settle parameters — plus the
 * `reliable` flag so a consumer can reject an unreliable run without parsing
 * prose (memory-benchmark-harness spec "Results are machine-readable and carry
 * their environment").
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

function readFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function runCapture(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 5_000 }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Infer release vs debug from an explicit flag or the launched binary path.
 * Exported for driver + unit tests.
 */
export function inferBuildProfile(appPath, explicitProfile = null) {
  if (explicitProfile === "release" || explicitProfile === "debug") return explicitProfile;
  const normalized = (appPath || "").replace(/\\/g, "/").toLowerCase();
  if (/\/release\//.test(normalized) || normalized.endsWith("/release/plethora-tauri")) {
    return "release";
  }
  if (/\/debug\//.test(normalized) || normalized.endsWith("/debug/plethora-tauri")) {
    return "debug";
  }
  return "debug";
}

/** Machine-profile fields recorded with every result. */
export function collectEnvironment(
  { appVersion = null, buildProfile = null, platform = process.platform } = {},
) {
  if (platform === "darwin") {
    // macOS (eliminate-long-running-memory-growth, task 2.6): WKWebView ships
    // with the OS, so the "web engine version" IS the OS version; there is no
    // display server to report.
    const osVersion = runCapture("sw_vers", ["-productVersion"]);
    return {
      platform,
      platformKind: "darwin",
      osRelease: osVersion,
      kernel: runCapture("uname", ["-r"]),
      webkitGtkVersion: osVersion,
      appVersion,
      buildProfile,
      cpuModel: runCapture("sysctl", ["-n", "machdep.cpu.brand_string"]),
      totalRamBytes: Number(runCapture("sysctl", ["-n", "hw.memsize"])),
      displayServer: null,
      cwd: process.cwd(),
    };
  }
  return {
    platform,
    platformKind: "linux",
    osRelease: readOsRelease(),
    kernel: readKernel(),
    webkitGtkVersion: null, // filled by the driver when detectable
    appVersion,
    buildProfile,
    cpuModel: readCpuModel(),
    totalRamBytes: readTotalRam(),
    displayServer: process.env.DISPLAY ? "x11" : process.env.WAYLAND_DISPLAY ? "wayland" : null,
    cwd: process.cwd(),
  };
}

function readOsRelease() {
  const text = readFile("/etc/os-release");
  return /^PRETTY_NAME="?(.*?)"?$/m.exec(text ?? "")?.[1] ?? null;
}

function readKernel() {
  const text = readFile("/proc/sys/kernel/osrelease");
  return text?.trim() ?? null;
}

function readCpuModel() {
  const text = readFile("/proc/cpuinfo");
  const line = text?.split("\n").find((l) => l.startsWith("model name"));
  return line ? line.split(":")[1].trim() : null;
}

function readTotalRam() {
  const text = readFile("/proc/meminfo");
  const line = text?.split("\n").find((l) => l.startsWith("MemTotal"));
  if (!line) return null;
  const kb = Number(/(\d+)/.exec(line)?.[1]);
  return Number.isFinite(kb) ? kb * 1024 : null;
}

/**
 * Write the result file.
 *
 * @param {object} options
 * @param {string} options.path - output path (default .bench/memory-result.json)
 * @param {Array<{key: string, stage: string, cycle: number|null, sample: object}>} options.samples
 * @param {object} options.environment
 * @param {boolean} options.reliable
 * @param {string} [options.unreliableReason]
 * @param {number} options.cycleCount
 * @param {object} options.corpus - { items, corpusDir, itemHashes, manifestSha256 }
 * @param {object} options.settleParams
 * @param {string} options.startedAtIso
 * @returns {{ path: string, wrote: boolean }}
 */
export function writeResult({
  path,
  samples,
  environment,
  reliable,
  unreliableReason,
  cycleCount,
  corpus,
  settleParams,
  startedAtIso,
}) {
  const payload = {
    schema: "incrementum-memory-benchmark-v1",
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    reliable,
    ...(unreliableReason ? { unreliableReason } : {}),
    cycleCount,
    settleParams,
    environment,
    corpus: {
      manifestSha256: corpus.manifestSha256 ?? null,
      items: corpus.items,
      corpusDir: corpus.corpusDir,
      itemHashes: corpus.itemHashes ?? {},
    },
    samples,
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return { path, wrote: true };
}
