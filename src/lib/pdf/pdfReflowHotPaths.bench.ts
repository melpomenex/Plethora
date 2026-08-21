/**
 * Reflow hot-path benchmarks (task 9.3): pure TS functions on deterministic
 * seeded inputs — coordinate transforms, canonical anchor resolution, and
 * reflow word-span selection mapping. The Rust analysis cost is measured by
 * the memory-bench reflow scenario; these gate the frontend hot paths.
 */
import { bench, describe } from "vitest";
import { seededRandom } from "../../test/bench-support";
import {
  pdfPointToRaster,
  pdfRectToRaster,
  rasterPointToPdf,
  rasterRectToPdf,
  type RasterGeometry,
} from "./coordinates";
import { anchorFromCanonicalBlock, resolveCanonicalAnchor } from "../../components/viewer/pdfAnchorResolver";
import type { PdfCanonicalBlock, PdfCanonicalPage, PdfCanonicalWord } from "../../types/pdfCanonical";
import type { PdfSourceAnchorState } from "../../types/readerPosition";

const random = seededRandom(0x5eed1234);

function geometry(): RasterGeometry {
  return { width: 1224, height: 1584, scale: 2, rotation: 0, pageWidth: 612, pageHeight: 792 };
}

describe("pdf coordinates", () => {
  const points = Array.from({ length: 2000 }, () => [
    random() * 612,
    random() * 792,
  ]) as Array<[number, number]>;

  bench("point round trip (rotation 0)", () => {
    let sink = 0;
    const g = geometry();
    for (const [x, y] of points) {
      const [vx, vy] = pdfPointToRaster(x, y, g);
      const [rx, ry] = rasterPointToPdf(vx, vy, g);
      sink += rx + ry;
    }
    if (Number.isNaN(sink)) throw new Error("elided");
  });

  const rects = Array.from({ length: 1000 }, () => {
    const x0 = random() * 500;
    const y0 = random() * 700;
    return { x0, y0, x1: x0 + random() * 100, y1: y0 + random() * 12 };
  });

  bench("rect round trip", () => {
    let sink = 0;
    const g = geometry();
    for (const rect of rects) {
      const raster = pdfRectToRaster(rect, g);
      const back = rasterRectToPdf(raster, g);
      sink += back.x0 + back.y1;
    }
    if (Number.isNaN(sink)) throw new Error("elided");
  });
});

function canonicalPage(wordCount: number): PdfCanonicalPage {
  const words: PdfCanonicalWord[] = Array.from({ length: wordCount }, (_, index) => ({
    id: `p1:w${index}`,
    pageNumber: 1,
    text: `word${index}`,
    sourceBbox: {
      x0: 100 + (index % 20) * 20,
      y0: 700 - Math.floor(index / 20) * 12,
      x1: 118 + (index % 20) * 20,
      y1: 710 - Math.floor(index / 20) * 12,
    },
    sourceFragments: [],
    bboxExact: true,
    readingOrder: index,
    confidence: 1,
    source: "native-pdf-text",
    dehyphenated: false,
    font: null,
  }));
  const block: PdfCanonicalBlock = {
    id: "p1:b0",
    kind: "paragraph",
    role: "body",
    pageNumber: 1,
    sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 400, x1: 500, y1: 710 } }],
    wordIds: words.map((word) => word.id),
    lineIds: [],
    readingOrder: 0,
    confidence: 0.95,
    text: words.map((word) => word.text).join(" "),
    direction: "ltr",
    language: null,
    items: null,
    table: null,
    assetId: null,
    altText: null,
    captionOf: null,
    href: null,
    extraction: "native-pdf-text",
  };
  return {
    pageNumber: 1,
    width: 612,
    height: 792,
    rotation: 0,
    state: "ready",
    classification: "semantic",
    confidence: 0.95,
    textCoverage: 1,
    words,
    lines: [],
    blocks: [block],
    warnings: [],
    errorCategory: null,
    schemaVersion: 2,
    engineVersion: "rust-hybrid-v3",
  };
}

describe("canonical anchors", () => {
  const page = canonicalPage(400);
  const pages = new Map([[1, page]]);

  bench("anchor round trip via wordId (400 words)", () => {
    let sink: string | null = null;
    for (let index = 0; index < 100; index += 1) {
      const anchor: PdfSourceAnchorState = anchorFromCanonicalBlock(
        page.blocks[0],
        "fp",
        `p1:w${(index * 4) % 400}`,
      );
      const resolved = resolveCanonicalAnchor(pages, anchor);
      sink = resolved?.block.id ?? null;
    }
    if (sink === undefined) throw new Error("elided");
  });

  bench("anchor resolution via textQuote fallback", () => {
    let sink: string | null = null;
    for (let index = 0; index < 50; index += 1) {
      const anchor: PdfSourceAnchorState = {
        pageNumber: 1,
        textQuote: `word${(index * 7) % 400}`,
      };
      const resolved = resolveCanonicalAnchor(pages, anchor);
      sink = resolved?.block.id ?? null;
    }
    if (sink === undefined) throw new Error("elided");
  });
});
