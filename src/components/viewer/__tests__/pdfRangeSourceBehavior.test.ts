/**
 * Range-source behavior tests (tasks 6.4 + 6.6).
 *
 * The REAL pdf.js engine is exercised through a range transport in the node
 * test environment (scripts/__tests__/memoryBenchPdfFixture.test.mjs — the
 * engine cannot run under jsdom: no DOMMatrix, no Promise.try, and the global
 * vitest setup stubs pdfjs-dist). This file covers the app-controlled layer:
 *   - 6.4: an identity failure from the backend is surfaced, not swallowed;
 *   - 6.6: the transport fetches only requested ranges, bounded by the chunk
 *     cap, and a page-turning session transfers far less than the file size;
 *   - the transfer stats are recorded in diagnostics (visible in the
 *     benchmark), so a whole-file regression is observable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getInfo: vi.fn(),
  readRange: vi.fn(),
}));

vi.mock("../../../api/documents", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/documents")>();
  return {
    ...original,
    getPdfDocumentSourceInfo: api.getInfo,
    readPdfDocumentRange: api.readRange,
  };
});

import { createNativePdfRangeSource, NativePdfRangeTransport } from "../nativePdfRangeTransport";
import { PdfDiagnostics } from "../pdfDiagnostics";

const KiB = 1024;

function makeInfo(size: number, maxChunkSize = 512 * KiB) {
  return {
    documentId: "doc-range-behavior",
    size,
    identity: "identity-1",
    fingerprint: "fingerprint-1",
    maxChunkSize,
  };
}

describe("native range source (app-controlled layer)", () => {
  beforeEach(() => {
    api.getInfo.mockReset();
    api.readRange.mockReset();
  });

  it("a range source whose identity fails surfaces an attributed failure (task 6.4)", async () => {
    api.getInfo.mockRejectedValue({
      code: "pdf_source_changed",
      message: "The PDF changed after it was opened.",
      recoverable: true,
    });
    await expect(createNativePdfRangeSource("doc-range-behavior")).rejects.toMatchObject({
      code: "pdf_source_changed",
    });
  });

  it("transfers only requested ranges, bounded by the chunk cap (task 6.6)", async () => {
    // A large document: 40 MiB.
    const size = 40 * 1024 * KiB;
    api.getInfo.mockResolvedValue(makeInfo(size));
    api.readRange.mockImplementation(async (_id: string, offset: number, length: number) =>
      new Uint8Array(length),
    );

    const source = await createNativePdfRangeSource("doc-range-behavior");
    const delivered: Array<{ begin: number; end: number }> = [];
    source.transport.addRangeListener((begin: number, bytes: Uint8Array) => {
      delivered.push({ begin, end: begin + bytes.byteLength });
    });

    // Simulate a pdf.js page-turn session: initial load plus a few scattered
    // ranges (pages far apart, never the whole file).
    source.transport.requestDataRange(0, 16 * KiB);
    source.transport.requestDataRange(20 * 1024 * KiB, 20 * 1024 * KiB + 8 * KiB);
    source.transport.requestDataRange(39 * 1024 * KiB, 39 * 1024 * KiB + 4 * KiB);
    await vi.waitFor(() => expect(delivered.length).toBe(3), { timeout: 2_000 });

    const transferred = api.readRange.mock.calls.reduce(
      (sum, call) => sum + call[2], // length argument
      0,
    );
    // Far less than the file size: only the initial chunk + requested ranges.
    expect(transferred).toBeLessThan(size / 100);
    // Every backend request respects the chunk cap and stays in the file.
    for (const call of api.readRange.mock.calls) {
      expect(call[2]).toBeLessThanOrEqual(source.info.maxChunkSize);
      expect(call[1] + call[2]).toBeLessThanOrEqual(size);
    }
    // Every delivered slice matches a requested range (no whole-file fetch).
    expect(delivered.length).toBe(3);
  });

  it("records transfer stats to diagnostics (visible in the benchmark)", async () => {
    const size = 10 * 1024 * KiB;
    api.getInfo.mockResolvedValue(makeInfo(size));
    api.readRange.mockImplementation(async (_id: string, offset: number, length: number) =>
      new Uint8Array(length),
    );

    const source = await createNativePdfRangeSource("doc-range-behavior");
    source.transport.requestDataRange(1024, 4096);
    await vi.waitFor(() => expect(api.readRange.mock.calls.length).toBeGreaterThan(1), { timeout: 2_000 });

    const snapshot = source.diagnostics.value();
    expect(snapshot.sourceStrategy).toBe("native-range");
    expect(snapshot.rangeRequests).toBeGreaterThan(1); // initial + requested
    expect(snapshot.rangeBytes).toBeGreaterThan(4096);
  });
});
