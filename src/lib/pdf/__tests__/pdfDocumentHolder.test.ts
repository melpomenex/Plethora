/**
 * Tests for src/lib/pdf/pdfDocumentHolder.ts (task 5.1): the pdf.js loading
 * task / document is destroyed on reset — including while a load is still in
 * flight — and a resolved document is destroyed when no task handle is left.
 */
import { describe, it, expect, vi } from "vitest";
import { createPdfDocumentHolder } from "../pdfDocumentHolder";
import type * as pdfjsLib from "pdfjs-dist";

/** Cast minimal fakes to the pdf.js types the holder's API requires. */
function fakeTask() {
  return { destroy: vi.fn(() => Promise.resolve()) } as unknown as pdfjsLib.PDFDocumentLoadingTask;
}

function fakeDoc() {
  return { destroy: vi.fn(() => Promise.resolve()) } as unknown as pdfjsLib.PDFDocumentProxy;
}

describe("pdfDocumentHolder", () => {
  it("destroys an in-flight loading task on reset (aborts the load)", () => {
    const holder = createPdfDocumentHolder();
    const task = fakeTask();
    holder.setLoadingTask(task);
    holder.reset();
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the task even when the document already resolved", () => {
    const holder = createPdfDocumentHolder();
    const task = fakeTask();
    const doc = fakeDoc();
    holder.setLoadingTask(task);
    holder.setDocument(doc);
    holder.reset();
    // One destroy call on the task destroys the document too (pdf.js contract);
    // the document handle is only used as a fallback when no task is tracked.
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(doc.destroy).not.toHaveBeenCalled();
  });

  it("falls back to destroying the document when only the document is tracked", () => {
    const holder = createPdfDocumentHolder();
    const doc = fakeDoc();
    holder.setDocument(doc);
    holder.reset();
    expect(doc.destroy).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second reset destroys nothing", () => {
    const holder = createPdfDocumentHolder();
    const task = fakeTask();
    holder.setLoadingTask(task);
    holder.reset();
    holder.reset();
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  it("remains usable after reset (a new load can be tracked)", () => {
    const holder = createPdfDocumentHolder();
    const first = fakeTask();
    const second = fakeTask();
    holder.setLoadingTask(first);
    holder.reset();
    holder.setLoadingTask(second);
    holder.reset();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
  });

  it("ignores a rejected destroy (the caller's mounted guard handles it)", () => {
    const holder = createPdfDocumentHolder();
    const task = {
      destroy: vi.fn(() => Promise.reject(new Error("destroyed"))),
    } as unknown as pdfjsLib.PDFDocumentLoadingTask;
    holder.setLoadingTask(task);
    // reset() is synchronous and must not throw or surface the rejection.
    expect(() => holder.reset()).not.toThrow();
  });
});
