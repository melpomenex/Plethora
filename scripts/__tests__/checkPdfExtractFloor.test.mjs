/**
 * Unit tests for scripts/check-pdf-extract-floor.mjs — run with
 * `npm run test:scripts` (node --test). Fixture locks exercise the pass,
 * downgrade-fail, and missing-dependency-fail paths against the pure
 * check function; one test also verifies the repo's real Cargo.lock is
 * above the floor so a `cargo update` regression fails CI here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPdfExtractFloor,
  parsePdfExtractVersion,
  PDF_EXTRACT_FLOOR,
} from "../check-pdf-extract-floor.mjs";

function lockWith(version) {
  return [
    'name = "lopdf"',
    'version = "0.38.0"',
    "",
    "[[package]]",
    'name = "pdf-extract"',
    `version = "${version}"`,
    "source = ",
    "dependencies = [",
    "]",
  ].join("\n");
}

const NO_PDF_EXTRACT_LOCK = [
  "[[package]]",
  'name = "lopdf"',
  'version = "0.38.0"',
].join("\n");

test("parses the pdf-extract version out of a Cargo.lock", () => {
  assert.equal(parsePdfExtractVersion(lockWith("0.10.0")), "0.10.0");
  assert.equal(parsePdfExtractVersion(NO_PDF_EXTRACT_LOCK), null);
});

test("0.7.x lock fails with a message naming the spam and the fix", () => {
  const out = checkPdfExtractFloor(lockWith("0.7.12"));
  assert.equal(out.ok, false);
  assert.match(out.message, /0\.7\.12/);
  assert.match(out.message, /Unicode mismatch/);
  assert.match(out.message, /fix-pdf-extract-log-spam/);
});

test("0.8.x lock (last println! line) also fails", () => {
  assert.equal(checkPdfExtractFloor(lockWith("0.8.2")).ok, false);
});

test("floor-version and newer locks pass", () => {
  assert.equal(checkPdfExtractFloor(lockWith(PDF_EXTRACT_FLOOR)).ok, true);
  assert.equal(checkPdfExtractFloor(lockWith("0.10.1")).ok, true);
  assert.equal(checkPdfExtractFloor(lockWith("0.12.0")).ok, true);
});

test("missing pdf-extract entry fails rather than passing silently", () => {
  const out = checkPdfExtractFloor(NO_PDF_EXTRACT_LOCK);
  assert.equal(out.ok, false);
  assert.match(out.message, /not found/);
});

test("repo's real Cargo.lock resolves pdf-extract above the floor", () => {
  const lockPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src-tauri",
    "Cargo.lock",
  );
  const out = checkPdfExtractFloor(readFileSync(lockPath, "utf8"));
  assert.equal(
    out.ok,
    true,
    `real Cargo.lock regressed: ${out.message}`,
  );
});
