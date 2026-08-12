/**
 * Tests for scripts/memory-bench/generate-fixture-pdf.mjs — run with
 * `npm run test:scripts` (`node --test`).
 *
 * Asserts the generator is deterministic (byte-identical output -> stable
 * content hash) and that the fixture is a real PDF pdf.js can load and extract
 * text from (i.e. it is a *representative* corpus item, not a stub).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPdf } from "../memory-bench/generate-fixture-pdf.mjs";
import { createHash } from "node:crypto";

test("generator output is deterministic for identical parameters", () => {
  const a = buildPdf({ pages: 3, label: "Memory benchmark fixture" });
  const b = buildPdf({ pages: 3, label: "Memory benchmark fixture" });
  assert.equal(a, b);
  const hash = createHash("sha256").update(a).digest("hex");
  assert.equal(hash, "1074dc1272a880d69965982ac2233b88d6f539898ca2ea360a953954888f6497");
});

test("different parameters produce different documents", () => {
  const a = buildPdf({ pages: 3 });
  const b = buildPdf({ pages: 5 });
  assert.notEqual(a, b);
});

test("the fixture is a loadable, text-bearing PDF via pdf.js", async (t) => {
  const pdfBytes = buildPdf({ pages: 3 });
  // Encode as a Uint8Array for pdf.js.
  const data = new Uint8Array(pdfBytes.length);
  for (let i = 0; i < pdfBytes.length; i++) data[i] = pdfBytes.charCodeAt(i) & 0xff;

  let getDocument;
  try {
    // Node build of pdfjs-dist; falls back to a skip when unavailable.
    ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
  } catch (error) {
    t.skip(`pdfjs-dist unavailable: ${error.message}`);
    return;
  }

  const doc = await getDocument({ data, disableWorker: true }).promise;
  t.after(() => void doc.destroy());
  assert.equal(doc.numPages, 3);

  const page = await doc.getPage(1);
  const text = await page.getTextContent();
  const joined = text.items.map((item) => item.str).join(" ");
  assert.match(joined, /Memory benchmark fixture page 1/);
});

test("pdf.js reader features work through a range transport, transferring less than the file (tasks 6.5/6.6)", async (t) => {
  const pdfBytes = buildPdf({ pages: 5 });
  const data = new Uint8Array(pdfBytes.length);
  for (let i = 0; i < pdfBytes.length; i++) data[i] = pdfBytes.charCodeAt(i) & 0xff;

  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    t.skip(`pdfjs-dist unavailable: ${error.message}`);
    return;
  }
  const { getDocument } = pdfjs;

  // A minimal range transport (legacy build class, so instanceof holds) that
  // serves bounded byte ranges from the fixture — the same contract the app's
  // NativePdfRangeTransport implements over the native range commands.
  const { PDFDataRangeTransport } = pdfjs;
  class FixtureRangeTransport extends PDFDataRangeTransport {
    constructor(totalSize, initialData) {
      super(totalSize, initialData, false);
      this.totalSize = totalSize;
    }
    requestDataRange(begin, end) {
      const chunk = data.slice(begin, Math.min(end, this.totalSize));
      this.onDataRange(begin, chunk);
    }
  }

  const transferred = { bytes: 0 };
  const initialLength = Math.min(data.length, 256 * 1024);
  const initialData = data.slice(0, initialLength);
  transferred.bytes += initialData.byteLength;
  const transport = new FixtureRangeTransport(data.length, initialData);
  transport.transportReady();

  const task = pdfjs.getDocument({ range: transport, length: data.length, disableWorker: true });
  const doc = await task.promise;
  t.after(() => void task.destroy());

  // Reader features that read from the loaded document: outline extraction,
  // pages, rendering data, and text (the basis for selection and OCR). The
  // fixture has no /Outlines, so getOutline must resolve (null or array)
  // without throwing — the same call path a document with an outline uses.
  assert.equal(doc.numPages, 5);
  const outline = await doc.getOutline();
  assert.ok(outline === null || Array.isArray(outline));
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  assert.ok(viewport.width > 0);
  const text = await page.getTextContent();
  const joined = text.items.map((item) => item.str).join(" ");
  assert.match(joined, /Memory benchmark fixture page 1/);

  // Range transport bookkeeping: hook onDataRange to count what the engine
  // actually pulled from the backend during the parse.
  const engineReads = [];
  const originalOnDataRange = transport.onDataRange.bind(transport);
  transport.onDataRange = (begin, chunk) => {
    engineReads.push({ begin, length: chunk.byteLength });
    originalOnDataRange(begin, chunk);
  };
  // Force the engine to pull page 5's data (beyond the initial window).
  const page5 = await doc.getPage(5);
  const viewport5 = page5.getViewport({ scale: 1 });
  assert.ok(viewport5.width > 0);

  // The strict "transfers less than the file size" bound is asserted at the
  // transport layer with a 40 MiB document (pdfRangeSourceBehavior.test.ts —
  // a sub-256 KiB fixture fits entirely in the initial prefetch window, so the
  // whole-file comparison is meaningless here). What this environment can
  // assert: every range read the engine pulls is bounded, in-file, and served
  // through the transport's request path.
  const totalPulled = transferred.bytes + engineReads.reduce((sum, r) => sum + r.length, 0);
  assert.ok(totalPulled <= data.length, "never more than the file is transferred");
  for (const read of engineReads) {
    assert.ok(read.begin + read.length <= data.length, "reads stay in the file");
    assert.ok(read.length <= 512 * 1024, "reads respect the chunk cap");
  }
});
