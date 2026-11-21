import { describe, expect, it, vi } from "vitest";
import type { Document } from "../../types/document";
import {
  formatSelectionExcerpt,
  resolveGenericAssistantContext,
  resolvePdfAssistantContext,
  resolveTwitterThreadAssistantContext,
  SELECTION_TRUNCATION_MARKER,
} from "../assistantContext";

const baseDocument = (overrides: Partial<Document> = {}): Document => ({
  id: "doc-1",
  title: "Test PDF",
  filePath: "/tmp/test.pdf",
  fileType: "pdf",
  tags: [],
  dateAdded: "2026-01-01T00:00:00.000Z",
  dateModified: "2026-01-01T00:00:00.000Z",
  extractCount: 0,
  learningItemCount: 0,
  priorityRating: 0,
  prioritySlider: 0,
  priorityScore: 0,
  isArchived: false,
  isFavorite: false,
  ...overrides,
});

const longText = (label: string) =>
  `${label} `.repeat(80).trim();

describe("resolvePdfAssistantContext", () => {
  it("prefers live PDF window text when it is available", async () => {
    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindowText: longText("window"),
      storedDocumentText: longText("document"),
      pageNumber: 12,
      contextPageWindow: 2,
    });

    expect(result.status).toBe("ready");
    expect(result.source).toBe("pdf-window");
    expect(result.content).toContain("Active page: 12");
    expect(result.content).toContain("Context source: pdf-window");
  });

  it("falls back to OCR text when the live PDF window is weak", async () => {
    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindowText: "too short",
      ocrText: longText("ocr"),
      preferOcr: true,
    });

    expect(result.status).toBe("ready");
    expect(result.source).toBe("ocr");
    expect(result.content).toContain("Context source: ocr");
  });

  it("loads extracted document text when the PDF window is empty", async () => {
    const loader = vi.fn(async () => "<p>" + longText("extracted") + "</p>");
    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindowText: "",
      extractedTextLoader: loader,
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    expect(result.source).toBe("document-content");
    expect(result.content).toContain("extracted extracted");
  });

  it("returns unavailable when no usable PDF text source exists", async () => {
    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindowText: "",
      storedDocumentText: "",
    });

    expect(result.status).toBe("unavailable");
    expect(result.source).toBe("none");
    expect(result.message).toContain("No text content available");
  });

  it("uses the physical active page for a reader-relative request", async () => {
    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindow: { documentId: "doc-1", activePage: 47, activePageText: "The observed value was 85." },
      pageNumber: 47,
      storedDocumentText: longText("foreword"),
      requireCurrentPage: true,
    });
    expect(result).toMatchObject({ status: "ready", pageScoped: true, coverage: "window" });
    expect(result.content).toContain("Active page: 47");
    expect(result.content).toContain("The observed value was 85.");
    expect(result.content).not.toContain("foreword");
  });

  it.each([
    { documentId: "previous-document", activePage: 47, activePageText: "Wrong document" },
    { documentId: "doc-1", activePage: 46, activePageText: "Previous page" },
    { documentId: "doc-1", activePage: 47, activePageText: "" },
    { documentId: "doc-1", activePage: 47, activePageText: "47 / 100" },
  ])("rejects stale or empty current-page context %j", async (liveWindow) => {
    const extractedTextLoader = vi.fn(async () => longText("foreword"));
    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindow,
      pageNumber: 47,
      liveWindowText: longText("neighbor"),
      ocrText: longText("unscoped OCR"),
      requireCurrentPage: true,
      extractedTextLoader,
    });
    expect(result).toMatchObject({ status: "unavailable", pageScoped: true });
    expect(result.content).toBeUndefined();
    expect(extractedTextLoader).not.toHaveBeenCalled();
  });
});

describe("resolveGenericAssistantContext", () => {
  it("marks empty generic context as unavailable", () => {
    const result = resolveGenericAssistantContext("");
    expect(result.status).toBe("unavailable");
  });

  it("places selection first with precedence instruction", () => {
    const result = resolveGenericAssistantContext("document body text", "document", "selected paragraph");
    expect(result.status).toBe("ready");
    expect(result.content).toContain("Selected text:");
    expect(result.content).toContain("selected paragraph");
    expect(result.content).toContain("about the Selected text first");
    const selectionIdx = (result.content ?? "").indexOf("Selected text:");
    const docIdx = (result.content ?? "").indexOf("Document context:");
    expect(selectionIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeGreaterThan(selectionIdx);
  });

  it("resolves selection-only generic context as selection source", () => {
    const result = resolveGenericAssistantContext("", "document", "only selection");
    expect(result.status).toBe("ready");
    expect(result.source).toBe("selection");
    expect(result.content).toContain("only selection");
  });

  it("keeps empty-selection fallback unchanged", () => {
    const result = resolveGenericAssistantContext("document body text", "document", "   ");
    expect(result.status).toBe("ready");
    expect(result.content).toBe("document body text");
  });
});

describe("selection precedence", () => {
  it("emits normalized selection before document context in PDF resolver", async () => {
    const result = await resolvePdfAssistantContext({
      document: baseDocument({ title: "Photosynthesis" }),
      liveWindowText: longText("window"),
      selection: "  selected   paragraph  ",
      pageNumber: 3,
    });

    expect(result.status).toBe("ready");
    expect(result.content).toContain("Photosynthesis");
    expect(result.content).toContain("Selected text:");
    expect(result.content).toContain("selected paragraph");
    expect(result.content).toContain("about the Selected text first");
    const selectionIdx = (result.content ?? "").indexOf("Selected text:");
    const docIdx = (result.content ?? "").indexOf("Document context:");
    expect(selectionIdx).toBeGreaterThanOrEqual(0);
    expect(docIdx).toBeGreaterThan(selectionIdx);
  });

  it("truncates over-long selection with marker", async () => {
    const huge = `word `.repeat(3000).trim();
    const formatted = formatSelectionExcerpt(huge);
    expect(formatted.truncated).toBe(true);
    expect(formatted.text).toContain(SELECTION_TRUNCATION_MARKER);

    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindowText: longText("window"),
      selection: huge,
    });
    expect(result.content).toContain(SELECTION_TRUNCATION_MARKER);
  });

  it("resolves selection-only PDF context when body is missing", async () => {
    const result = await resolvePdfAssistantContext({
      document: baseDocument(),
      liveWindowText: "",
      storedDocumentText: "",
      selection: "only selection here",
    });
    expect(result.status).toBe("ready");
    expect(result.source).toBe("selection");
    expect(result.content).toContain("only selection here");
  });

  it("includes truncated selection first in thread resolver", () => {
    const doc = baseDocument({ title: "Thread doc", content: "thread body here" });
    const result = resolveTwitterThreadAssistantContext(doc, "selected post text");
    expect(result.status).toBe("ready");
    expect(result.content).toContain("Selected text:");
    expect(result.content).toContain("selected post text");
    expect(result.content).toContain("about the Selected text first");
    const selectionIdx = (result.content ?? "").indexOf("Selected text:");
    const threadIdx = (result.content ?? "").indexOf("Thread Content:");
    expect(selectionIdx).toBeGreaterThanOrEqual(0);
    expect(threadIdx).toBeGreaterThan(selectionIdx);
  });
});
