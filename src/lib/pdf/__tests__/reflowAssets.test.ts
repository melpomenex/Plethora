/**
 * Source-crop asset pipeline (task 6.2): the crop must report its pixel
 * dims alongside the asset id — they are the renderer's intrinsic-aspect
 * basis. These tests pin the crop math (scale 2.0, 4px pad, edge clamping)
 * through the real canvas width/height arithmetic with a stubbed 2D context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PDFDocumentProxy, PageViewport, RenderTask } from "pdfjs-dist";

vi.mock("../../../api/pdfReflow", () => ({
  putPdfReflowAsset: vi.fn(async (ctx: { documentId: string }) => `asset-${ctx.documentId}`),
  getPdfReflowAsset: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

import {
  ensureRegionAssetUrl,
  renderAndStoreRegionAsset,
  releaseDocumentResources,
  clearAssetUrlCache,
  fetchAssetObjectUrl,
} from "../reflowAssets";

function makeViewport(width: number, height: number, scale: number): PageViewport {
  return { width: width * scale, height: height * scale, scale } as PageViewport;
}

/** Letter-size page: at CROP_RENDER_SCALE 2.0 the canvas is 1224×1584 px. */
function makeFakePdf(nativeWidth = 612, nativeHeight = 792) {
  const page = {
    getViewport: vi.fn(({ scale }: { scale?: number }) =>
      makeViewport(nativeWidth, nativeHeight, scale ?? 1),
    ),
    render: vi.fn(() => ({ promise: Promise.resolve() }) as RenderTask),
    cleanup: vi.fn(),
  };
  return {
    pdf: {
      getPage: vi.fn(async () => page),
      destroy: vi.fn(async () => {}),
    } as unknown as PDFDocumentProxy,
  };
}

const context = {
  documentId: "doc-1",
  sourceIdentity: "identity-1",
  schemaVersion: 2,
  engineVersion: "rust-hybrid-v3",
};

// jsdom has no canvas backend: stub the 2D context and PNG encoding. The
// canvas width/height attributes (which drive the crop arithmetic) stay real.
const stubContext = {
  fillStyle: "",
  fillRect: vi.fn(),
  drawImage: vi.fn(),
} as unknown as CanvasRenderingContext2D;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stubContext as any);
  // jsdom's Blob has no arrayBuffer(); return a blob-like with the byte
  // access the pipeline needs.
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: (blob: Blob | null) => void,
  ) {
    callback({ arrayBuffer: async () => new Uint8Array([1, 2, 3]) } as unknown as Blob);
  });
});

afterEach(() => {
  clearAssetUrlCache();
  vi.restoreAllMocks();
});

describe("renderAndStoreRegionAsset", () => {
  it("returns the stored asset id with the exact crop pixel dims", async () => {
    // Interior region: 405×183pt at 2.0 scale plus 4px pad each side.
    const { pdf } = makeFakePdf();
    const asset = await renderAndStoreRegionAsset({
      pdf,
      pageNumber: 1,
      rect: { x0: 105, y0: 400, x1: 510, y1: 583 },
      context,
    });
    expect(asset).toEqual({ assetId: "asset-doc-1", width: 818, height: 374 });
  });

  it("clamps the pad at the page edges instead of overreading the canvas", async () => {
    const { pdf } = makeFakePdf();
    const asset = await renderAndStoreRegionAsset({
      pdf,
      pageNumber: 1,
      // 12×12pt region hugging the bottom-right corner: the pad scales down
      // to 1px for the 24×24px crop, and both sides clamp to the canvas
      // edge, so the crop is 25×25 (not the unpadded 24 or the padded 26).
      rect: { x0: 600, y0: 0, x1: 612, y1: 12 },
      context,
    });
    expect(asset).toEqual({ assetId: "asset-doc-1", width: 25, height: 25 });
  });

  it("scales the pad with the crop size (thin strips are not inflated)", async () => {
    const { pdf } = makeFakePdf();
    // A 0.6pt-tall rule-like strip 300pt wide: crop 600×1.2px → pad 1px, so
    // the crop is ~602×4px instead of the historical 608×9px.
    const asset = await renderAndStoreRegionAsset({
      pdf,
      pageNumber: 1,
      rect: { x0: 100, y0: 100, x1: 400, y1: 100.6 },
      context,
    });
    expect(asset).not.toBeNull();
    expect(asset!.height).toBeLessThanOrEqual(5);
    expect(asset!.width).toBeGreaterThan(595);
  });

  it("returns null when no 2D context is available", async () => {
    const { pdf } = makeFakePdf();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValueOnce(null);
    const asset = await renderAndStoreRegionAsset({
      pdf,
      pageNumber: 1,
      rect: { x0: 0, y0: 0, x1: 100, y1: 100 },
      context,
    });
    expect(asset).toBeNull();
  });
});

describe("ensureRegionAssetUrl", () => {
  it("resolves the object URL together with the crop dims", async () => {
    const { pdf } = makeFakePdf();
    const createObjectURL = vi.fn(() => "blob:mock-url");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    try {
      const asset = await ensureRegionAssetUrl({
        pdf,
        pageNumber: 1,
        rect: { x0: 105, y0: 400, x1: 510, y1: 583 },
        context,
      });
      expect(asset).toEqual({ url: "blob:mock-url", width: 818, height: 374 });
      expect(createObjectURL).toHaveBeenCalled();
    } finally {
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
    }
  });
});

describe("releaseDocumentResources", () => {
  it("revokes object URLs for one document and leaves sibling documents intact", async () => {
    const urlsByDoc = new Map<string, string>();
    let seq = 0;
    const createObjectURL = vi.fn(() => `blob:mock-${++seq}`);
    const revokeObjectURL = vi.fn((url: string) => {
      for (const [docId, cached] of urlsByDoc.entries()) {
        if (cached === url) urlsByDoc.delete(docId);
      }
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    try {
      const { pdf } = makeFakePdf();
      await renderAndStoreRegionAsset({
        pdf,
        pageNumber: 1,
        rect: { x0: 105, y0: 400, x1: 510, y1: 583 },
        context,
      });
      urlsByDoc.set("doc-1", "blob:mock-1");
      const contextB = { ...context, documentId: "doc-2" };
      await renderAndStoreRegionAsset({
        pdf,
        pageNumber: 1,
        rect: { x0: 105, y0: 400, x1: 510, y1: 583 },
        context: contextB,
      });
      urlsByDoc.set("doc-2", "blob:mock-2");

      releaseDocumentResources("doc-1");

      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-1");
      const siblingUrl = await fetchAssetObjectUrl(contextB, "asset-doc-2");
      expect(siblingUrl).toBe("blob:mock-2");
    } finally {
      clearAssetUrlCache();
      delete (URL as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });
});
