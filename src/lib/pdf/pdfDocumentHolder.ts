/**
 * pdf.js document lifecycle holder (task 5.1).
 *
 * PDFViewer holds at most one live pdf.js loading task / document. This holder
 * tracks it in one place so the viewer can destroy it on unmount AND on
 * document change, including while a load is still in flight:
 *
 *   - `setLoadingTask(task)` is called at the moment `getDocument` returns
 *     (before any await), so an in-flight load is tracked from the start;
 *   - `setDocument(doc)` is called once the load resolves;
 *   - `reset()` destroys whatever is current — the pdf.js `loadingTask.destroy()`
 *     API destroys both the task and the document it already parsed, so one
 *     call covers both states — and keeps the holder usable for the next load
 *     (PDFViewer calls it from its effect cleanup, which also runs on every
 *     document change).
 *
 * `destroy()` on a pdf.js loading task rejects its promise with
 * AbortException-ish errors; PDFViewer's `mounted` guard already swallows
 * those, and `reset` ignores rejections.
 */

import type * as pdfjsLib from "pdfjs-dist";

export interface PdfDocumentHolder {
  /** Track a loading task the moment getDocument returns. */
  setLoadingTask(task: pdfjsLib.PDFDocumentLoadingTask | null): void;
  /** Track the resolved document. */
  setDocument(doc: pdfjsLib.PDFDocumentProxy | null): void;
  /** Destroy the current task/document; the holder remains usable. */
  reset(): void;
}

export function createPdfDocumentHolder(): PdfDocumentHolder {
  let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  let document: pdfjsLib.PDFDocumentProxy | null = null;

  function destroyCurrent(): void {
    const task = loadingTask;
    const doc = document;
    loadingTask = null;
    document = null;
    if (task) {
      // One call destroys both the task and its (possibly partial) document.
      task.destroy().catch(() => {});
    } else if (doc) {
      doc.destroy().catch(() => {});
    }
  }

  return {
    setLoadingTask(task) {
      loadingTask = task;
    },
    setDocument(doc) {
      if (doc) {
        // The loading task stays tracked (it is the destroy handle); only
        // remember the doc for the destroy() fallback when no task is left.
        document = doc;
      } else {
        document = null;
      }
    },
    reset() {
      destroyCurrent();
    },
  };
}
