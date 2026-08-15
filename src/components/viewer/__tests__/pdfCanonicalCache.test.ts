/**
 * Native-first read-through behavior for the canonical page cache (task 1.6):
 * the v1 prototype's native cache was write-only; these tests pin that v2
 * reads hit Rust and that results warm the memory layer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPdfCanonicalPageCache } from "../pdfCanonicalCache";
import type { PdfCanonicalPage } from "../../../types/pdfCanonical";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  isTauri: true,
}));

vi.mock("../../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isTauri: () => mocks.isTauri,
}));

function page(number: number): PdfCanonicalPage {
  return {
    pageNumber: number,
    width: 612,
    height: 792,
    rotation: 0,
    state: "ready",
    classification: "semantic",
    confidence: 0.9,
    textCoverage: 0.9,
    words: [],
    lines: [],
    blocks: [],
    warnings: [],
    errorCategory: null,
    schemaVersion: 2,
    engineVersion: "rust-hybrid-v2",
  };
}

const CONTEXT = {
  documentId: "doc-1",
  sourceIdentity: "identity-1",
  schemaVersion: 2,
  engineVersion: "rust-hybrid-v2",
};

describe("PdfCanonicalPageCache", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    mocks.isTauri = true;
  });

  it("reads pages from the native cache first, then warms memory", async () => {
    mocks.invokeCommand.mockResolvedValueOnce(page(7));
    const cache = createPdfCanonicalPageCache(CONTEXT);
    const first = await cache.getPage(7);
    expect(first?.pageNumber).toBe(7);
    expect(mocks.invokeCommand).toHaveBeenCalledTimes(1);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("pdf_reflow_get_page", {
      ...CONTEXT,
      pageNumber: 7,
    });

    const second = await cache.getPage(7);
    expect(second?.pageNumber).toBe(7);
    expect(mocks.invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("misses return null without caching a negative result", async () => {
    mocks.invokeCommand.mockResolvedValueOnce(null);
    const cache = createPdfCanonicalPageCache(CONTEXT);
    expect(await cache.getPage(3)).toBeNull();
    expect(mocks.invokeCommand).toHaveBeenCalledTimes(1);
    // A later write must still reach the native layer and be readable.
    mocks.invokeCommand.mockResolvedValueOnce(undefined);
    await cache.putPage(page(3));
    expect(mocks.invokeCommand).toHaveBeenCalledWith("pdf_reflow_put_page", {
      ...CONTEXT,
      page: expect.objectContaining({ pageNumber: 3 }),
    });
    expect((await cache.getPage(3))?.pageNumber).toBe(3);
    expect(mocks.invokeCommand).toHaveBeenCalledTimes(2);
  });

  it("write-through failures degrade to memory-only without throwing", async () => {
    mocks.invokeCommand.mockRejectedValueOnce(new Error("disk full"));
    const cache = createPdfCanonicalPageCache(CONTEXT);
    await expect(cache.putPage(page(2))).resolves.toBeUndefined();
    expect((await cache.getPage(2))?.pageNumber).toBe(2);
  });

  it("browser (non-Tauri) builds are memory-only", async () => {
    mocks.isTauri = false;
    const cache = createPdfCanonicalPageCache(CONTEXT);
    expect(await cache.getPage(5)).toBeNull();
    await cache.putPage(page(5));
    expect(mocks.invokeCommand).not.toHaveBeenCalled();
    expect((await cache.getPage(5))?.pageNumber).toBe(5);
  });

  it("reset drops the memory layer but not the native cache", async () => {
    mocks.invokeCommand.mockResolvedValue(page(9));
    const cache = createPdfCanonicalPageCache(CONTEXT);
    await cache.getPage(9);
    cache.reset();
    mocks.invokeCommand.mockClear();
    await cache.getPage(9);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("pdf_reflow_get_page", {
      ...CONTEXT,
      pageNumber: 9,
    });
  });
});
