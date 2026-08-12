/**
 * Shared report-rendering helpers for the budget check scripts (task 11.12).
 *
 * Factored out of `scripts/check-perf-budget.mjs` so the memory gate
 * (`scripts/check-memory-budget.mjs`) reuses them instead of duplicating
 * them. `check-perf-budget.mjs` keeps its exact output shape (its tests pin
 * the behavior).
 */

/**
 * Format a number with `digits` significant figures, dropping trailing zeros
 * (e.g. 0.001234 -> "0.001234", 12345.6 -> "12350" for 4 digits).
 * Used for cost ratios, byte counts, and any other numeric cell.
 */
export function formatSignificant(value, digits = 4) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number(value.toPrecision(digits)).toString();
}

/**
 * Human-readable byte formatting for the memory gate's report.
 * 1024-based units, one decimal for fractional values:
 *   123 -> "123 B", 2048 -> "2.0 KiB", 1572864 -> "1.5 MiB", ...
 */
export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = "B";
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  const text = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${text} ${unit}`;
}

/**
 * Print an aligned table of rows to `console.log`.
 *
 * @param {Array<{ label: string, width: number }>} columns
 * @param {Array<Array<string | number>>} rows - one cell per column
 */
export function printAlignedTable(columns, rows) {
  const pad = (s, n) => String(s).padEnd(n);
  const header = columns.map((c) => pad(c.label, c.width)).join("");
  console.log(header);
  for (const row of rows) {
    console.log(columns.map((c, i) => pad(row[i] ?? "", c.width)).join(""));
  }
}
