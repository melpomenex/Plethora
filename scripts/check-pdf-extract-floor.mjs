/**
 * Lockfile guard for openspec change `fix-pdf-extract-log-spam`: pdf-extract
 * 0.7.x/0.8.x print one unconditional `println!` per glyph/mismatch to
 * stdout during text extraction, which floods terminals and lags the whole
 * machine on Windows (issue #45). 0.9.0+ route diagnostics through the
 * `log` facade (filtered to error for the `pdf_extract` module in
 * src-tauri/src/lib.rs), so the lockfile must stay >= 0.10.0.
 *
 * Importable core (parsePdfExtractVersion + checkPdfExtractFloor) is unit
 * tested in scripts/__tests__/checkPdfExtractFloor.test.mjs; run directly it
 * checks the repo's real lockfile:
 *     node scripts/check-pdf-extract-floor.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const PDF_EXTRACT_FLOOR = "0.10.0";

/** Extract the pdf-extract package version from Cargo.lock text, or null. */
export function parsePdfExtractVersion(lockfileText) {
  const match = lockfileText.match(
    /name = "pdf-extract"\nversion = "([^"]+)"/,
  );
  return match ? match[1] : null;
}

function majorMinor(version) {
  return version.split(".").slice(0, 2).map(Number);
}

/**
 * Compare a resolved version against the floor. Returns
 * { ok, version, floor, message } — message names the reason on failure.
 */
export function checkPdfExtractFloor(lockfileText) {
  const version = parsePdfExtractVersion(lockfileText);
  if (version === null) {
    return {
      ok: false,
      version: null,
      floor: PDF_EXTRACT_FLOOR,
      message:
        'pdf-extract not found in Cargo.lock — expected >= 0.10.0 (unconditional-println! spam, openspec change fix-pdf-extract-log-spam / issue #45)',
    };
  }
  const [gotMaj, gotMin] = majorMinor(version);
  const [floorMaj, floorMin] = majorMinor(PDF_EXTRACT_FLOOR);
  const belowFloor = gotMaj < floorMaj || (gotMaj === floorMaj && gotMin < floorMin);
  if (belowFloor) {
    return {
      ok: false,
      version,
      floor: PDF_EXTRACT_FLOOR,
      message: `Cargo.lock resolved pdf-extract ${version} < ${PDF_EXTRACT_FLOOR}: that line prints per-glyph "Unicode mismatch" lines to stdout during PDF extraction (terminal flood, whole-PC lag on Windows — issue #45). See openspec change fix-pdf-extract-log-spam.`,
    };
  }
  return { ok: true, version, floor: PDF_EXTRACT_FLOOR, message: "" };
}

if (process.argv[1] && process.argv[1].endsWith("check-pdf-extract-floor.mjs")) {
  const lockPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src-tauri",
    "Cargo.lock",
  );
  const result = checkPdfExtractFloor(readFileSync(lockPath, "utf8"));
  console.log(
    result.ok
      ? `ok: pdf-extract ${result.version} >= ${result.floor}`
      : `FAIL: ${result.message}`,
  );
  process.exitCode = result.ok ? 0 : 1;
}
