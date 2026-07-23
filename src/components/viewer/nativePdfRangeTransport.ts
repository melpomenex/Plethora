import { PDFDataRangeTransport } from "pdfjs-dist";
import {
  getPdfDocumentSourceInfo,
  readPdfDocumentRange,
  type PdfDocumentSourceInfo,
} from "../../api/documents";
import { PdfDiagnostics } from "./pdfDiagnostics";
import { normalizePdfError, type NormalizedPdfError } from "./pdfErrors";

export const NATIVE_PDF_INITIAL_RANGE_BYTES = 256 * 1024;
const DEFAULT_MAX_CONCURRENCY = 3;
const MAX_CACHE_ENTRIES = 24;

type PendingRequest = { begin: number; end: number };
type MergedRequest = { begin: number; end: number; requests: PendingRequest[] };

export interface NativePdfRangeSource {
  info: PdfDocumentSourceInfo;
  transport: NativePdfRangeTransport;
  diagnostics: PdfDiagnostics;
  failure: Promise<never>;
}

export class NativePdfRangeTransport extends PDFDataRangeTransport {
  private readonly queue: PendingRequest[] = [];
  private readonly mergedQueue: MergedRequest[] = [];
  private readonly cache = new Map<string, Uint8Array>();
  private active = 0;
  private flushScheduled = false;
  private cancelled = false;
  private failureReject!: (error: NormalizedPdfError) => void;
  readonly failure: Promise<never>;

  constructor(
    readonly documentId: string,
    readonly info: PdfDocumentSourceInfo,
    initialData: Uint8Array,
    readonly diagnostics: PdfDiagnostics,
    private readonly maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  ) {
    super(info.size, initialData, false);
    this.failure = new Promise<never>((_resolve, reject) => {
      this.failureReject = reject;
    });
    // Avoid an unhandled rejection if a caller tears down before racing failure.
    void this.failure.catch(() => undefined);
  }

  requestDataRange(begin: number, end: number): void {
    if (this.cancelled || begin >= end) return;
    const boundedBegin = Math.max(0, begin);
    const boundedEnd = Math.min(this.info.size, end);
    if (boundedBegin >= boundedEnd) return;

    for (let chunkBegin = boundedBegin; chunkBegin < boundedEnd; chunkBegin += this.info.maxChunkSize) {
      const chunkEnd = Math.min(boundedEnd, chunkBegin + this.info.maxChunkSize);
      const key = `${chunkBegin}:${chunkEnd}`;
      const cached = this.cache.get(key);
      if (cached) {
        queueMicrotask(() => {
          if (!this.cancelled) this.onDataRange(chunkBegin, new Uint8Array(cached));
        });
      } else {
        this.queue.push({ begin: chunkBegin, end: chunkEnd });
      }
    }
    if (this.queue.length === 0) return;
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  abort(): void {
    this.cancelled = true;
    this.queue.length = 0;
    this.mergedQueue.length = 0;
    this.cache.clear();
  }

  private flush(): void {
    this.flushScheduled = false;
    if (this.cancelled || this.queue.length === 0) return;

    const sorted = this.queue.splice(0).sort((a, b) => a.begin - b.begin || a.end - b.end);
    const merged: MergedRequest[] = [];
    for (const request of sorted) {
      const last = merged.at(-1);
      if (last && request.begin <= last.end && Math.max(last.end, request.end) - last.begin <= this.info.maxChunkSize) {
        last.end = Math.max(last.end, request.end);
        last.requests.push(request);
      } else {
        merged.push({ ...request, requests: [request] });
      }
    }

    this.mergedQueue.push(...merged);
    this.pumpMerged();
  }

  private pumpMerged(): void {
    while (!this.cancelled && this.active < this.maxConcurrency && this.mergedQueue.length > 0) {
      const request = this.mergedQueue.shift()!;
      this.active += 1;
      void this.readMerged(request).finally(() => {
        this.active -= 1;
        this.pumpMerged();
      });
    }
  }

  private async readMerged(merged: MergedRequest): Promise<void> {
    try {
      const bytes = await readPdfDocumentRange(
        this.documentId,
        merged.begin,
        merged.end - merged.begin,
        this.info.identity,
      );
      if (this.cancelled) return;
      this.diagnostics.recordRange(bytes.byteLength);
      for (const request of merged.requests) {
        const start = request.begin - merged.begin;
        const end = start + (request.end - request.begin);
        const slice = bytes.slice(start, end);
        this.remember(`${request.begin}:${request.end}`, slice);
        this.onDataRange(request.begin, slice);
      }
      this.onDataProgress(Math.min(merged.end, this.info.size), this.info.size);
    } catch (error) {
      if (this.cancelled) return;
      const normalized = normalizePdfError(error);
      this.abort();
      this.failureReject(normalized);
    }
  }

  private remember(key: string, bytes: Uint8Array): void {
    this.cache.delete(key);
    this.cache.set(key, new Uint8Array(bytes));
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}

export async function createNativePdfRangeSource(documentId: string): Promise<NativePdfRangeSource> {
  const info = await getPdfDocumentSourceInfo(documentId);
  const diagnostics = new PdfDiagnostics("native-range", info.size);
  const initialLength = Math.min(info.size, NATIVE_PDF_INITIAL_RANGE_BYTES, info.maxChunkSize);
  const initialData = await readPdfDocumentRange(documentId, 0, initialLength, info.identity);
  diagnostics.recordRange(initialData.byteLength);
  const transport = new NativePdfRangeTransport(documentId, info, initialData, diagnostics);
  transport.transportReady();
  return { info, transport, diagnostics, failure: transport.failure };
}
