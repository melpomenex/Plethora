import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAll } from "../generate-pdf-reflow-fixtures.mjs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("fixture generation is deterministic and produces parseable PDFs", () => {
  const dirA = mkdtempSync(join(tmpdir(), "reflow-fixtures-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "reflow-fixtures-b-"));
  try {
    const writtenA = generateAll(dirA);
    const writtenB = generateAll(dirB);
    assert.ok(writtenA.length >= 15, `expected 15+ fixtures, got ${writtenA.length}`);
    for (let index = 0; index < writtenA.length; index++) {
      const bytesA = readFileSync(writtenA[index]);
      const bytesB = readFileSync(writtenB[index]);
      assert.ok(bytesA.equals(bytesB), `${writtenA[index]} must be byte-identical across runs`);
      const text = bytesA.toString("latin1");
      assert.ok(text.startsWith("%PDF-1.4"));
      assert.ok(text.includes("%%EOF"));
      assert.ok(text.includes("/Type /Catalog"));
    }
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});
