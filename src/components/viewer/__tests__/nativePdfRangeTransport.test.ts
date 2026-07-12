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

const info = {
  documentId: "doc-1",
  size: 1024,
  identity: "identity-1",
  fingerprint: "fingerprint-1",
  maxChunkSize: 512,
};

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("NativePdfRangeTransport", () => {
  beforeEach(() => {
    api.getInfo.mockReset().mockResolvedValue(info);
    api.readRange.mockReset().mockImplementation(async (_id, offset: number, length: number) => ({
      offset,
      bytes: Array.from({ length }, (_, index) => (offset + index) % 256),
      identity: info.identity,
      eof: offset + length >= info.size,
    }));
  });

  it("loads bounded initial data without requesting the whole PDF", async () => {
    const source = await createNativePdfRangeSource("doc-1");
    expect(api.readRange).toHaveBeenCalledWith("doc-1", 0, 512, info.identity);
    expect(source.transport.initialData).toHaveLength(512);
  });

  it("coalesces overlapping requests and returns each requested slice", async () => {
    const transport = new NativePdfRangeTransport(
      "doc-1",
      info,
      new Uint8Array(),
      new PdfDiagnostics("native-range", info.size),
    );
    const delivered: Array<{ begin: number; bytes: number[] }> = [];
    transport.addRangeListener((begin: number, bytes: Uint8Array) => {
      delivered.push({ begin, bytes: Array.from(bytes) });
    });
    transport.transportReady();
    transport.requestDataRange(100, 200);
    transport.requestDataRange(150, 250);
    await settle();
    expect(api.readRange).toHaveBeenCalledTimes(1);
    expect(api.readRange).toHaveBeenCalledWith("doc-1", 100, 150, info.identity);
    expect(delivered.map((item) => [item.begin, item.bytes.length])).toEqual([[100, 100], [150, 100]]);
  });

  it("serves repeated exact requests from its bounded cache", async () => {
    const transport = new NativePdfRangeTransport("doc-1", info, new Uint8Array(), new PdfDiagnostics());
    transport.transportReady();
    transport.requestDataRange(10, 20);
    await settle();
    transport.requestDataRange(10, 20);
    await settle();
    expect(api.readRange).toHaveBeenCalledTimes(1);
  });

  it("splits PDF.js requests that exceed the native maximum chunk", async () => {
    const transport = new NativePdfRangeTransport("doc-1", info, new Uint8Array(), new PdfDiagnostics());
    transport.transportReady();
    transport.requestDataRange(0, 1024);
    await settle();
    expect(api.readRange).toHaveBeenCalledTimes(2);
    expect(api.readRange.mock.calls.map((call) => [call[1], call[2]])).toEqual([[0, 512], [512, 512]]);
  });

  it("does not deliver stale bytes after abort", async () => {
    let release!: () => void;
    api.readRange.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ offset: 0, bytes: [1, 2], identity: info.identity, eof: false });
    }));
    const transport = new NativePdfRangeTransport("doc-1", info, new Uint8Array(), new PdfDiagnostics());
    const listener = vi.fn();
    transport.addRangeListener(listener);
    transport.transportReady();
    transport.requestDataRange(0, 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.abort();
    release();
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });
});
