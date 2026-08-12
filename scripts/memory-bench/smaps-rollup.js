/**
 * smaps_rollup parser for the memory benchmark collector.
 *
 * Reads the fields the benchmark tracks from /proc/<pid>/smaps_rollup:
 *   Pss, Pss_Anon, Pss_File, Pss_Shmem, Private_Dirty, Rss, Swap
 *
 * Contract (design D4 in openspec/changes/bound-runtime-memory-and-gate):
 * - Each field comes from its labelled line with its unit; the kernel always
 *   emits `kB`.
 * - An unknown or absent field is reported ABSENT (null), never defaulted to
 *   zero. A zero-valued default would read as an improvement — the worst
 *   failure mode for a memory gate.
 * - A malformed file (no recognised labels at all, or a tracked field whose
 *   value cannot be parsed) produces an attributed error, never a
 *   plausible-looking number.
 *
 * Pure function of its input string, so it is unit-testable with fixture text
 * (see scripts/__tests__/memoryBenchSmaps.test.ts).
 */

/** The fields the benchmark tracks, in display order. */
export const ROLLUP_FIELDS = [
  "Pss",
  "Pss_Anon",
  "Pss_File",
  "Pss_Shmem",
  "Private_Dirty",
  "Rss",
  "Swap",
];

/** Units the kernel emits for these fields. Only kB is recognised. */
const KILOBYTES = 1024;
const RECOGNISED_UNITS = new Map([
  ["kB", KILOBYTES],
  ["KB", KILOBYTES],
]);

/**
 * Parse a smaps_rollup document.
 *
 * @param {string} text - raw contents of a /proc/<pid>/smaps_rollup file.
 * @returns {{ ok: true, values: Record<string, number | null>, notes: string[] }
 *          | { ok: false, error: string }}
 *   - `values[field]` is the byte count, or null when the field is absent
 *     (line missing, or present with an unrecognised unit).
 *   - `notes` records every line that was skipped or degraded (unknown labels
 *     are expected and not noted; tracked fields with bad units are).
 *   - `error` is set only for input that cannot be interpreted as a rollup.
 */
export function parseSmapsRollup(text) {
  if (typeof text !== "string") {
    return { ok: false, error: `smaps_rollup input is not text (${typeof text})` };
  }
  const lines = text.split("\n");
  const values = Object.fromEntries(ROLLUP_FIELDS.map((f) => [f, null]));
  const notes = [];
  let recognisedLabels = 0;
  let malformed = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    const match = /^([A-Za-z_]+):\s*(\d+)\s*(\S*)\s*$/.exec(line);
    if (!match) {
      // The first physical line of a rollup is the address-range header
      // ("632a60c23000-... [rollup]"); any other unparsable line is suspect.
      if (i > 0 && !/[A-Za-z_]+:/.test(line)) {
        malformed = malformed ?? `line ${i + 1} is not a labelled field: "${line}"`;
      }
      continue;
    }
    const label = match[1];
    const rawValue = match[2];
    const unit = match[3];

    if (!ROLLUP_FIELDS.includes(label)) {
      // Unknown labels (Shared_Clean, AnonHugePages, ...) are normal in a
      // rollup and are simply not tracked. Do not flag them.
      continue;
    }
    recognisedLabels += 1;

    const multiplier = RECOGNISED_UNITS.get(unit);
    if (multiplier === undefined) {
      // Known label with an unexpected unit: report the field as ABSENT
      // rather than inventing a conversion. This is the D4 failure mode.
      values[label] = null;
      notes.push(`field ${label} (line ${i + 1}) has unrecognised unit "${unit}"; reported absent`);
      continue;
    }

    values[label] = Number(rawValue) * multiplier;
  }

  if (recognisedLabels === 0) {
    return {
      ok: false,
      error: malformed ?? "not a smaps_rollup document (no recognised fields)",
    };
  }
  if (malformed) {
    // A document that has some valid fields but also unparsable lines is an
    // attributed error: partial numbers could be mistaken for a measurement.
    return { ok: false, error: malformed };
  }
  return { ok: true, values, notes };
}
