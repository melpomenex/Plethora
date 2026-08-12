/**
 * Per-process sampling and tree aggregation for the memory benchmark collector.
 *
 * Sampling reads /proc/<pid>/smaps_rollup for each discovered process. A
 * process that exits between discovery and sampling is recorded as ABSENT with
 * the reason — it never fails the sample (spec "Memory is collected per
 * process and for the whole process tree").
 *
 * The tree total is the sum of the per-process PROPORTIONAL values — Pss,
 * Pss_Anon, Pss_File, Pss_Shmem, Private_Dirty, Swap — never Rss. The native
 * and web processes share large mapped library text; summing RSS double-counts
 * it. Private_Dirty and Swap are additive across processes (private memory is
 * not shared), so they join the PSS family in the total; Rss is excluded.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSmapsRollup } from "./smaps-rollup.js";

/**
 * Fields summed into the tree total (proportional / non-shared accounting).
 * Rss is deliberately excluded (see module doc).
 */
export const TOTAL_FIELDS = [
  "Pss",
  "Pss_Anon",
  "Pss_File",
  "Pss_Shmem",
  "Private_Dirty",
  "Swap",
];

/**
 * Read one process's sample.
 *
 * @returns {{ pid: number, present: true, values: Record<string, number|null> }
 *          | { pid: number, present: false, reason: string }}
 */
export function readProcessSample(procRoot, pid) {
  const rollupPath = join(procRoot, String(pid), "smaps_rollup");
  let text;
  try {
    text = readFileSync(rollupPath, "utf8");
  } catch (error) {
    return { pid, present: false, reason: `cannot read ${rollupPath}: ${error.code ?? error.message}` };
  }
  const parsed = parseSmapsRollup(text);
  if (!parsed.ok) {
    return { pid, present: false, reason: `malformed ${rollupPath}: ${parsed.error}` };
  }
  return { pid, present: true, values: parsed.values };
}

/**
 * Aggregate a sample across the discovered processes.
 *
 * @param {Array<{pid: number, role?: string}>} processes - discovery output.
 * @param {(pid: number) => ReturnType<typeof readProcessSample>} [readSample]
 * @returns {{
 *   processes: Array<{pid: number, present: boolean, role?: string, values?: Record<string, number|null>, reason?: string}>,
 *   total: Record<string, number>,   // sums over PRESENT processes only
 *   complete: boolean,               // false when any discovered process was absent
 * }}
 */
export function aggregateSample(processes, readSample = (pid) => readProcessSample("/proc", pid)) {
  const samples = processes.map((p) => {
    const sample = readSample(p.pid);
    return { ...sample, role: p.role };
  });
  const total = Object.fromEntries(TOTAL_FIELDS.map((f) => [f, 0]));
  let complete = true;

  for (const sample of samples) {
    if (!sample.present) {
      complete = false;
      continue;
    }
    for (const field of TOTAL_FIELDS) {
      const value = sample.values[field];
      // Absent field (null) contributes nothing and does not zero the total;
      // the total reports only what was measured. The per-process row carries
      // the null so consumers can see it was absent, not zero.
      total[field] += value ?? 0;
    }
  }

  return { processes: samples, total, complete };
}
