/**
 * Collector tests (task 2.7): pdf.js items/styles map to the Rust command
 * input shape, analysis scale is edge-bounded, and canvas-less environments
 * degrade to text-only rather than failing.
 */
import { describe, expect, it } from "vitest";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  analysisScaleFor,
  collectPageAnalysisInput,
  resolveFontInfo,
  toCollectedTextItems,
} from "../pdfCanonicalCollector";

function fakePage(options: {
  items: unknown[];
  styles?: Record<string, { fontFamily?: string }>;
  renderThrows?: boolean;
}): PDFPageProxy {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      rotation: 0,
      scale,
    }),
    getTextContent: async () => ({ items: options.items, styles: options.styles ?? {} }),
    render: () => {
      if (options.renderThrows) {
        return { promise: Promise.reject(new Error("no canvas")), cancel: () => {} } as never;
      }
      return { promise: Promise.resolve(), cancel: () => {} } as never;
    },
  } as unknown as PDFPageProxy;
}

function fakeProxy(page: PDFPageProxy): PDFDocumentProxy {
  return {
    getPage: async () => page,
  } as unknown as PDFDocumentProxy;
}

const ITEM = {
  str: "The quick",
  transform: [10, 0, 0, 10, 100, 700],
  width: 90,
  height: 10,
  dir: "ltr",
  fontName: "g_d0_f2",
  hasEOL: false,
};

describe("pdfCanonicalCollector", () => {
  it("bounds the analysis scale to the longest raster edge", () => {
    // 612×792pt page: 120dpi (1.667) → longest edge 1320px < 1700 cap.
    expect(analysisScaleFor(612, 792)).toBeCloseTo(120 / 72, 9);
    // A0 poster (~2384×3370pt) would explode past the cap: clamped so the
    // longest edge is exactly 1700px.
    expect(analysisScaleFor(2384, 3370)).toBeCloseTo(1700 / 3370, 9);
  });

  it("resolves font metadata from the pdf.js styles map", () => {
    const font = resolveFontInfo(ITEM, { g_d0_f2: { fontFamily: "g_d0_f2: serif bold" } });
    expect(font).toEqual({
      size: 10,
      bold: true,
      italic: false,
      family: "g_d0_f2: serif bold",
    });
    const unknown = resolveFontInfo(ITEM, {});
    expect(unknown).toEqual({ size: 10, bold: false, italic: false, family: null });
  });

  it("maps items to the Rust command shape and skips marked content", () => {
    const items = toCollectedTextItems(
      [ITEM, { type: "beginMarkedContent" }],
      { g_d0_f2: { fontFamily: "Helvetica-BoldOblique" } },
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      str: "The quick",
      transform: [10, 0, 0, 10, 100, 700],
      width: 90,
      height: 10,
      dir: "ltr",
      font: { size: 10, bold: true, italic: true, family: "Helvetica-BoldOblique" },
      hasEol: false,
    });
  });

  it("collects text-only input when rendering fails", async () => {
    const input = await collectPageAnalysisInput(
      fakeProxy(fakePage({ items: [ITEM], renderThrows: true })),
      3,
    );
    expect(input.pageNumber).toBe(3);
    expect(input.pageWidth).toBe(612);
    expect(input.pageHeight).toBe(792);
    expect(input.rotation).toBe(0);
    // jsdom has no real canvas — the raster degrades to null, never throws.
    expect(input.rasterPngBase64).toBeNull();
    expect(input.rasterScale).toBeGreaterThan(0);
    expect(input.textItems).toHaveLength(1);
    expect(input.textItems[0]?.str).toBe("The quick");
  });

  it("reports UNROTATED user-space page dims for /Rotate 90 pages", async () => {
    // Real pdf.js swaps viewport dims when the page carries /Rotate 90:
    // a 612×792 user-space page renders as a 792×612 landscape raster. The
    // analyzer's RasterGeometry expects user-space dims (it applies the
    // rotation itself), so the collector must NOT send the swapped size.
    const rotatedPage = {
      getViewport: ({ scale, rotation }: { scale: number; rotation?: number }) => {
        const r = rotation ?? 90;
        const swap = r % 180 === 90;
        return {
          width: (swap ? 792 : 612) * scale,
          height: (swap ? 612 : 792) * scale,
          rotation: r,
          scale,
        };
      },
      getTextContent: async () => ({ items: [ITEM], styles: {} }),
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }) as never,
    } as unknown as PDFPageProxy;
    const input = await collectPageAnalysisInput(fakeProxy(rotatedPage), 1);
    expect(input.pageWidth).toBe(612);
    expect(input.pageHeight).toBe(792);
    expect(input.rotation).toBe(90);
  });
});
