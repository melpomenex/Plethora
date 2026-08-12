/**
 * Platform gate for the memory benchmark collector (task 2.6).
 *
 * Process-memory collection is platform-specific. On a platform with no
 * collector — or where the collector's data source is unavailable — the
 * harness must report an unsupported environment and produce NO result file,
 * rather than substitute a different metric or emit numbers that would be
 * compared against a baseline recorded elsewhere.
 */

import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";

/**
 * Check whether memory collection can run on this environment.
 *
 * @param {object} [options]
 * @param {string} [options.platform=process.platform]
 * @param {string} [options.procRoot="/proc"]
 * @returns {{ supported: true } | { supported: false, reason: string }}
 */
export function checkMemoryCollectionSupported({
  platform = process.platform,
  procRoot = "/proc",
} = {}) {
  if (platform !== "linux") {
    return {
      supported: false,
      reason:
        `memory collection is implemented only on Linux (current platform: "${platform}"); ` +
        "a collector for this platform would plug in behind the same scenario, baseline, and gate logic",
    };
  }

  const rollupPath = join(procRoot, "self", "smaps_rollup");
  if (!existsSync(rollupPath)) {
    return {
      supported: false,
      reason:
        `smaps_rollup is unavailable (${rollupPath} does not exist); ` +
        "kernel 4.14+ with /proc mounted is required, and summing smaps is not a substitute",
    };
  }
  try {
    accessSync(rollupPath, constants.R_OK);
  } catch {
    return {
      supported: false,
      reason: `smaps_rollup exists but is not readable (${rollupPath}); check process permissions`,
    };
  }
  return { supported: true };
}
