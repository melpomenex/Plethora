import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileMarketingFixture, stableJson, validateMarketingLibrary } from "../marketing/compile-fixture-v2.mjs";
import { assertNativeImporterCompatibility, buildTauriFixtureImport } from "../marketing/build-tauri-fixture-import.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const LIBRARY_DIR = join(ROOT, "marketing/demo-library");

async function sourceFixture() {
  return JSON.parse(await readFile(join(LIBRARY_DIR, "library.json"), "utf8"));
}

test("fixture compiler repeats byte-for-byte with stable hashes and ordering", async () => {
  const first = await compileMarketingFixture({ root: ROOT, libraryDir: LIBRARY_DIR, write: false });
  const second = await compileMarketingFixture({ root: ROOT, libraryDir: LIBRARY_DIR, write: false });
  assert.equal(stableJson(first), stableJson(second));
  assert.match(first.metadata.fixtureHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    first.records.documents.map((record) => record.id),
    [...first.records.documents.map((record) => record.id)].sort(),
  );
});

test("fixture validation rejects broken cross-entity references", async () => {
  const source = await sourceFixture();
  source.documents[0].fileId = "00000000-0000-4000-8000-000000000099";
  assert.throws(() => validateMarketingLibrary(source, { libraryDir: LIBRARY_DIR }), /references missing id/);
});

test("fixture validation rejects unsafe licenses, personal data, paths, covers, and binaries", async (t) => {
  await t.test("license", async () => {
    const source = await sourceFixture();
    source.sources[0].license = "All rights reserved";
    assert.throws(() => validateMarketingLibrary(source, { libraryDir: LIBRARY_DIR }), /unapproved license/);
  });
  await t.test("personal data", async () => {
    const source = await sourceFixture();
    source.notes[0].body = "Contact private.person@example.com";
    assert.throws(() => validateMarketingLibrary(source, { libraryDir: LIBRARY_DIR }), /email address/);
  });
  await t.test("path traversal", async () => {
    const source = await sourceFixture();
    source.files[0].path = "../private.epub";
    assert.throws(() => validateMarketingLibrary(source, { libraryDir: LIBRARY_DIR }), /escapes marketing\/demo-library/);
  });
  await t.test("commercial cover", async () => {
    const source = await sourceFixture();
    source.files[0].path = "generated/cover.epub";
    assert.throws(() => validateMarketingLibrary(source, { libraryDir: LIBRARY_DIR }), /commercial cover/);
  });
  await t.test("unknown binary", async () => {
    const source = await sourceFixture();
    source.files[0].path = "generated/fixture.exe";
    assert.throws(() => validateMarketingLibrary(source, { libraryDir: LIBRARY_DIR }), /unknown file type/);
  });
});

test("native importer compatibility fails closed on migration drift", () => {
  assert.throws(() => assertNativeImporterCompatibility("DELETE FROM documents"), /compatibility check failed/);
});

test("native import archive is deterministic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plethora-marketing-fixture-"));
  try {
    const firstPath = join(directory, "first.zip");
    const secondPath = join(directory, "second.zip");
    await buildTauriFixtureImport(firstPath);
    await buildTauriFixtureImport(secondPath);
    assert.deepEqual(await readFile(firstPath), await readFile(secondPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
