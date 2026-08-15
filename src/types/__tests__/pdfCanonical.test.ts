/**
 * Parity test: the TS canonical types must match the Rust serde output
 * exactly. The golden fixture is shared with
 * `src-tauri/src/pdf/model.rs::golden_fixture_round_trips_exactly`; both
 * sides pin the same file so field drift fails on either side.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PDF_CANONICAL_ENGINE_VERSION,
  PDF_CANONICAL_SCHEMA_VERSION,
  parsePdfCanonicalPage,
  type PdfCanonicalBlock,
  type PdfCanonicalPage,
  type PdfCanonicalWord,
} from "../pdfCanonical";

// Shared with `src-tauri/src/pdf/model.rs::golden_fixture_round_trips_exactly`.
// Read via fs because the vitest module graph excludes src-tauri/ (vitest
// always runs with the repo root as cwd).
const goldenRaw = readFileSync(
  resolve(process.cwd(), "src-tauri/tests/fixtures/pdf-reflow/golden-page-v2.json"),
  "utf8",
);
const golden = JSON.parse(goldenRaw) as PdfCanonicalPage;

const KEYS = {
  page: [
    "pageNumber", "width", "height", "rotation", "state", "classification", "confidence",
    "textCoverage", "words", "lines", "blocks", "warnings", "errorCategory", "schemaVersion",
    "engineVersion",
  ],
  word: [
    "id", "pageNumber", "text", "sourceBbox", "sourceFragments", "bboxExact", "readingOrder",
    "confidence", "source", "dehyphenated", "font",
  ],
  line: ["id", "wordIds", "bbox", "baselineY", "readingOrder"],
  block: [
    "id", "kind", "role", "pageNumber", "sourceRegions", "wordIds", "lineIds", "readingOrder",
    "confidence", "text", "direction", "language", "items", "table", "assetId", "altText",
    "captionOf", "href", "extraction",
  ],
  region: ["pageNumber", "bbox"],
  font: ["size", "bold", "italic", "family"],
  rect: ["x0", "y0", "x1", "y1"],
} as const;

function expectKeys(object: Record<string, unknown>, expected: readonly string[], label: string) {
  expect(Object.keys(object).sort(), label).toEqual([...expected].sort());
}

describe("pdfCanonical golden fixture parity", () => {
  it("parses via parsePdfCanonicalPage with matching versions", () => {
    const parsed = parsePdfCanonicalPage(goldenRaw);
    expect(parsed).not.toBeNull();
    expect(parsed?.schemaVersion).toBe(PDF_CANONICAL_SCHEMA_VERSION);
    expect(parsed?.engineVersion).toBe(PDF_CANONICAL_ENGINE_VERSION);
  });

  it("rejects foreign schema/engine versions", () => {
    const staleSchema = JSON.stringify({ ...golden, schemaVersion: 1 });
    const staleEngine = JSON.stringify({ ...golden, engineVersion: "pdfjs-geometry-v1" });
    expect(parsePdfCanonicalPage(staleSchema)).toBeNull();
    expect(parsePdfCanonicalPage(staleEngine)).toBeNull();
    expect(parsePdfCanonicalPage("not json")).toBeNull();
  });

  it("page field names match the Rust serde output", () => {
    expectKeys(golden as unknown as Record<string, unknown>, KEYS.page, "page");
  });

  it("word field names match the Rust serde output", () => {
    for (const word of golden.words) {
      expectKeys(word as unknown as Record<string, unknown>, KEYS.word, `word ${word.id}`);
      expectKeys(word.sourceBbox as unknown as Record<string, unknown>, KEYS.rect, "word bbox");
      if (word.font) {
        expectKeys(word.font as unknown as Record<string, unknown>, KEYS.font, "word font");
      }
    }
  });

  it("line and block field names match the Rust serde output", () => {
    for (const line of golden.lines) {
      expectKeys(line as unknown as Record<string, unknown>, KEYS.line, `line ${line.id}`);
    }
    for (const block of golden.blocks) {
      expectKeys(block as unknown as Record<string, unknown>, KEYS.block, `block ${block.id}`);
      for (const region of block.sourceRegions) {
        expectKeys(region as unknown as Record<string, unknown>, KEYS.region, "block region");
      }
    }
  });

  it("enum vocabularies match the Rust kebab-case serialization", () => {
    const paragraph = golden.blocks[0] as PdfCanonicalBlock;
    const figure = golden.blocks[1] as PdfCanonicalBlock;
    expect(golden.state).toBe("ready");
    expect(golden.classification).toBe("semantic-with-warnings");
    expect(paragraph.kind).toBe("paragraph");
    expect(paragraph.role).toBe("body");
    expect(paragraph.direction).toBe("ltr");
    expect(paragraph.extraction).toBe("native-pdf-text");
    expect(figure.kind).toBe("figure");
    expect(figure.extraction).toBe("graphical");
    expect((golden.words[0] as PdfCanonicalWord).source).toBe("native-pdf-text");
  });

  it("id scheme is page-scoped and deterministic", () => {
    expect(golden.words[0]?.id).toBe("p237:w0");
    expect(golden.lines[0]?.id).toBe("p237:l0");
    expect(golden.blocks[0]?.id).toBe("p237:b0");
  });
});
