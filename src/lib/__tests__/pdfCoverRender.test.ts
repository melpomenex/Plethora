import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PDFDocumentProxy, PageViewport, RenderTask } from "pdfjs-dist";

// We test the pure renderable function directly (it accepts a PDFDocumentProxy),
// so the module-level `pdfjs-dist` mock in test/setup.ts is sufficient. The
// native-range path is exercised separately through its own integration tests.

// Hoisted mock for the native range transport so we can drive renderPdfCover's
// timeout/error paths deterministically without a Tauri backend.
type SourceFactory = () => Promise<unknown>;
let mockCreateSource: SourceFactory = () => Promise.reject(new Error("no backend"));
vi.mock("../components/viewer/nativePdfRangeTransport", () => ({
  createNativePdfRangeSource: () => mockCreateSource(),
}));

import { renderFirstPageToDataUrl, renderPdfCover } from "../pdfCoverRender";

/** Minimal fake `PageViewport` — only `width`/`height` are read for scaling. */
function makeViewport(width: number, height: number, scale: number): PageViewport {
  return { width: width * scale, height: height * scale, scale } as PageViewport;
}

interface CapturedRender {
  viewport: PageViewport;
  canvasContext: CanvasRenderingContext2D;
}

/** Build a fake pdfjs page that reports a given native size for page 1. */
function makeFakePdf(
  nativeWidth: number,
  nativeHeight: number,
  renderImpl?: (ctx: any, viewport: PageViewport) => void,
) {
  const captured: CapturedRender[] = [];
  const page = {
    getViewport: vi.fn(({ scale }: { scale?: number }) =>
      makeViewport(nativeWidth, nativeHeight, scale ?? 1),
    ),
    render: vi.fn(({ canvasContext, viewport }: any) => {
      captured.push({ viewport, canvasContext });
      if (renderImpl) renderImpl(canvasContext, viewport);
      return { promise: Promise.resolve() } as RenderTask;
    }),
    cleanup: vi.fn(),
  };
  return {
    pdf: {
      getPage: vi.fn(async () => page),
      destroy: vi.fn(async () => {}),
    } as unknown as PDFDocumentProxy,
    captured,
  };
}

// jsdom does not implement a real canvas backend, so `getContext("2d")` returns
// null and `toDataURL` throws. Install working stubs for these tests.
const stubContext = {
  fillStyle: "",
  fillRect: vi.fn(),
} as unknown as CanvasRenderingContext2D;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(stubContext as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,MockEncodedBytes",
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderFirstPageToDataUrl", () => {
  it("scales a wide page down to the ~400px target width", async () => {
    // A4-ish page in points: 595 x 842. Expected scale ~0.672 → ~400px wide.
    const { pdf, captured } = makeFakePdf(595, 842);

    await renderFirstPageToDataUrl(pdf);

    expect(captured).toHaveLength(1);
    expect(captured[0].viewport.width).toBeCloseTo(400, 0);
  });

  it("does not upscale a page smaller than the target width", async () => {
    // Tiny page (200x200) — target is 400px but we must NOT upscale beyond native.
    const { pdf, captured } = makeFakePdf(200, 200);

    const dataUrl = await renderFirstPageToDataUrl(pdf);

    expect(dataUrl).toBe("data:image/jpeg;base64,MockEncodedBytes");
    expect(captured).toHaveLength(1);
    expect(captured[0].viewport.width).toBeCloseTo(200, 0);
  });

  it("returns null when a 2D context is unavailable", async () => {
    const { pdf } = makeFakePdf(595, 842);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValueOnce(null);

    const dataUrl = await renderFirstPageToDataUrl(pdf);

    expect(dataUrl).toBeNull();
  });

  it("propagates render errors (caller treats as null via renderPdfCover)", async () => {
    const pdf = {
      getPage: vi.fn(async () => ({
        getViewport: vi.fn(({ scale }: { scale?: number }) => makeViewport(595, 842, scale ?? 1)),
        render: vi.fn(() => ({ promise: Promise.reject(new Error("boom")) })),
        cleanup: vi.fn(),
      })),
      destroy: vi.fn(async () => {}),
    } as unknown as PDFDocumentProxy;

    await expect(renderFirstPageToDataUrl(pdf)).rejects.toThrow("boom");
  });
});

describe("renderPdfCover", () => {
  it("returns null when the source cannot be opened", async () => {
    mockCreateSource = () => Promise.reject(new Error("pdf missing"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await renderPdfCover("doc-err", { timeoutMs: 1000 });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null when the render exceeds the time budget", async () => {
    // A hanging source (never settles) must be bounded by the timeout guard.
    mockCreateSource = () => new Promise(() => {});
    const result = await renderPdfCover("doc-hang", { timeoutMs: 10 });
    expect(result).toBeNull();
  });
});
