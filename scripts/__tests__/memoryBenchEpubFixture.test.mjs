/**
 * Tests for scripts/memory-bench/generate-fixture-epub.mjs — run with
 * `npm run test:scripts` (`node --test`).
 *
 * Asserts the generator is deterministic (byte-identical output -> stable
 * content hash) and that the fixture is a structurally valid EPUB zip that
 * JSZip (the same library epub.js uses) can parse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildEpub } from "../memory-bench/generate-fixture-epub.mjs";

test("epub generator output is deterministic for identical parameters", () => {
  const a = buildEpub({ chapters: 3, title: "Memory Benchmark Fixture" });
  const b = buildEpub({ chapters: 3, title: "Memory Benchmark Fixture" });
  assert.deepEqual(a, b);
  const hash = createHash("sha256").update(a).digest("hex");
  assert.equal(hash, "1fc271d6aa62657b22dff4a6bb5c7521fc4394e99119ec603cab0724e1508035");
});

test("different parameters produce different documents", () => {
  const a = buildEpub({ chapters: 3 });
  const b = buildEpub({ chapters: 5 });
  assert.notDeepEqual(a, b);
});

test("the fixture is a valid EPUB zip that JSZip can parse", async (t) => {
  let JSZip;
  try {
    ({ default: JSZip } = await import("jszip"));
  } catch (error) {
    t.skip(`jszip unavailable: ${error.message}`);
    return;
  }
  const epub = buildEpub({ chapters: 3 });
  const zip = await JSZip.loadAsync(epub);
  const names = Object.keys(zip.files);

  // EPUB container contract: uncompressed mimetype first, container.xml,
  // OPF package with the spine.
  assert.equal(zip.files["mimetype"]._data.uncompressedSize, 20);
  assert.ok(names.includes("META-INF/container.xml"));
  assert.ok(names.includes("OEBPS/content.opf"));
  assert.ok(names.includes("OEBPS/nav.xhtml"));
  assert.match(await zip.files["mimetype"].async("string"), /application\/epub\+zip/);

  const opf = await zip.files["OEBPS/content.opf"].async("string");
  assert.match(opf, /chapter-1\.xhtml/);
  assert.match(opf, /chapter-3\.xhtml/);
  const chapter1 = await zip.files["OEBPS/chapter-1.xhtml"].async("string");
  assert.match(chapter1, /Chapter 1/);
});
