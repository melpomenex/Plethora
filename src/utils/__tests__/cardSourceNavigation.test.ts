/**
 * Unit tests for the flashcard → source resolution ladder
 * (`src/utils/cardSourceNavigation.ts`).
 *
 * I/O boundaries (extract fetch, ai_provenance, document store, tab opening)
 * are mocked; the ladder's ordering, confidence gating, and failure
 * semantics are exercised for real, including the uniqueness gate that
 * prevents false highlights.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getExtractMock = vi.fn();
const getAiProvenanceMock = vi.fn();
const loadDocumentsMock = vi.fn();
const openDocumentAtLocationMock = vi.fn();

vi.mock("../../api/extracts", () => ({
  getExtract: (id: string) => getExtractMock(id),
}));

vi.mock("../../api/ai-provenance", () => ({
  getAiProvenance: (kind: string, id: string) => getAiProvenanceMock(kind, id),
}));

let documentsStore: Array<Record<string, unknown>> = [];
vi.mock("../../stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      documents: documentsStore,
      loadDocuments: loadDocumentsMock,
    }),
  },
}));

vi.mock("../openDocumentAtLocation", () => ({
  openDocumentAtLocation: (...args: unknown[]) => openDocumentAtLocationMock(...args),
}));

import {
  resolveCardSource,
  locatorFromSelectionContext,
  type CardSourceProbe,
} from "../cardSourceNavigation";

function htmlDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    title: "Memory Systems",
    fileType: "html",
    content:
      "Chapter 4 begins here. The hippocampus helps stabilize and transfer newly encoded memories during sleep. Later chapters repeat other facts.",
    ...overrides,
  };
}

function pdfDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-pdf",
    title: "A Book",
    fileType: "pdf",
    content: "page one text\fthe spacing effect improves recall\fpage three text",
    ...overrides,
  };
}

function probe(overrides: Partial<CardSourceProbe> = {}): CardSourceProbe {
  return { id: "item-1", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  documentsStore = [htmlDoc()];
  loadDocumentsMock.mockResolvedValue(undefined);
});

describe("locatorFromSelectionContext", () => {
  it("maps a PDF selection context to its page", () => {
    const locator = locatorFromSelectionContext({
      type: "pdf",
      pages: [{ pageNumber: 42, viewportRects: [], pdfRects: [] }],
    });
    expect(locator).toEqual({ kind: "pdf", pageNumber: 42 });
  });

  it("maps an EPUB CFI range", () => {
    const locator = locatorFromSelectionContext({
      type: "epub",
      cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:10)",
      selectedText: "something",
    });
    expect(locator?.kind).toBe("epub");
  });

  it("maps a text selection to html with a text quote", () => {
    const locator = locatorFromSelectionContext({
      type: "text",
      surface: "html",
      startOffset: 5,
      endOffset: 9,
      selectedText: "hippocampus helps",
    });
    expect(locator?.kind).toBe("html");
    expect((locator as { textQuote?: string }).textQuote).toContain("hippocampus");
  });

  it("maps an audio capture provenance to its timestamp", () => {
    const locator = locatorFromSelectionContext({
      kind: "audio_capture",
      documentId: "doc-1",
      sourceStartAnchor: "a",
      sourceEndAnchor: "b",
      audioTimestampSec: 87,
      captureWindowSec: 5,
      confidence: "high",
    });
    expect(locator).toEqual({ kind: "audio", timeSeconds: 87 });
  });
});

describe("resolveCardSource", () => {
  it("resolves an extract-backed PDF card exactly", async () => {
    documentsStore = [pdfDoc()];
    getExtractMock.mockResolvedValue({
      id: "ext-1",
      document_id: "doc-pdf",
      content: "the spacing effect improves",
      page_number: 2,
      selection_context: {
        type: "pdf",
        pages: [{ pageNumber: 2, viewportRects: [], pdfRects: [] }],
      },
    });

    const resolution = await resolveCardSource(probe({ extract_id: "ext-1" }));
    expect(resolution.status).toBe("ready");
    if (resolution.status === "ready") {
      expect(resolution.confidence).toBe("exact");
      expect(resolution.location).toMatchObject({ kind: "pdf", pageNumber: 2 });
      expect(resolution.highlightQuery).toContain("spacing effect");
    }
  });

  it("resolves an extract-backed text card with a unique quote", async () => {
    getExtractMock.mockResolvedValue({
      id: "ext-1",
      document_id: "doc-1",
      content: "stabilize and transfer newly encoded memories",
      selection_context: null,
    });

    const resolution = await resolveCardSource(probe({ extract_id: "ext-1" }));
    expect(resolution.status).toBe("ready");
    if (resolution.status === "ready") {
      expect(resolution.confidence).toBe("matched");
      expect(resolution.location.kind).toBe("html");
      expect(resolution.highlightQuery).toBeTruthy();
    }
  });

  it("refuses to highlight when the quote matches multiple places", async () => {
    documentsStore = [
      htmlDoc({
        content:
          "duplicate sentence appears here. filler filler filler. duplicate sentence appears here too. more text follows so this is long enough.",
      }),
    ];
    getExtractMock.mockResolvedValue({
      id: "ext-1",
      document_id: "doc-1",
      content: "duplicate sentence appears here",
      selection_context: null,
    });

    const resolution = await resolveCardSource(probe({ extract_id: "ext-1" }));
    // "duplicate sentence appears here" is a prefix of the second occurrence
    // too, so two normalized matches exist — the resolution must not present
    // a verified single match.
    if (resolution.status === "ready") {
      // Either downgraded, or (if only one literal match) still verified —
      // assert the exact-match claim only when truly unique.
      expect(resolution.confidence).toBe("matched");
      expect(
        documentsStore[0] &&
          String((documentsStore[0] as { content: string }).content)
            .toLowerCase()
            .split(resolution.highlightQuery?.toLowerCase() ?? "").length - 1
      ).toBe(1);
    } else {
      expect(resolution.status).toBe("coarse");
      if (resolution.status === "coarse") {
        expect(resolution.reason).toBe("ambiguous");
        expect(resolution.highlightQuery).toBeUndefined();
      }
    }
  });

  it("falls back to the coarse PDF page when the extract has no anchors", async () => {
    documentsStore = [pdfDoc()];
    getExtractMock.mockResolvedValue({
      id: "ext-1",
      document_id: "doc-pdf",
      content: "text that does not appear in the document at all",
      page_number: 3,
      selection_context: null,
    });

    const resolution = await resolveCardSource(probe({ extract_id: "ext-1" }));
    expect(resolution).toMatchObject({
      status: "coarse",
      reason: "no-anchor",
      documentId: "doc-pdf",
    });
    if (resolution.status === "coarse") {
      expect(resolution.location).toMatchObject({ kind: "pdf", pageNumber: 3 });
    }
  });

  it("uses the stored envelope for extract-less cards", async () => {
    documentsStore = [pdfDoc()];
    getExtractMock.mockResolvedValue(null);
    getAiProvenanceMock.mockResolvedValue([]);

    const resolution = await resolveCardSource(
      probe({
        source_reference: JSON.stringify({
          version: 1,
          document_id: "doc-pdf",
          locator: { kind: "pdf", pageNumber: 2, textQuote: "the spacing effect" },
          excerpt: "the spacing effect improves recall",
          section_label: "Chapter 1",
        }),
      })
    );

    expect(resolution).toMatchObject({ status: "ready", confidence: "exact" });
    if (resolution.status === "ready") {
      expect(resolution.sectionLabel).toBe("Chapter 1");
    }
  });

  it("treats a corrupt envelope as absent", async () => {
    getExtractMock.mockResolvedValue(null);
    getAiProvenanceMock.mockResolvedValue([]);

    const resolution = await resolveCardSource(
      probe({ source_reference: "{not json at all" })
    );
    expect(resolution).toMatchObject({ status: "unavailable", reason: "no-source" });
  });

  it("reports unavailable when the source document is gone, keeping the excerpt", async () => {
    getExtractMock.mockResolvedValue({
      id: "ext-1",
      document_id: "doc-deleted",
      content: "orphaned but remembered",
      selection_context: null,
    });

    const resolution = await resolveCardSource(probe({ extract_id: "ext-1" }));
    expect(resolution).toMatchObject({
      status: "unavailable",
      reason: "document-missing",
      excerpt: "orphaned but remembered",
    });
    expect(loadDocumentsMock).toHaveBeenCalled();
  });

  it("resolves through the ai_provenance capture record", async () => {
    getExtractMock.mockResolvedValue(null);
    getAiProvenanceMock.mockResolvedValue([
      {
        id: "prov-1",
        target_kind: "learning_item",
        target_id: "item-1",
        task_id: "learn-this",
        provider: "openai",
        metadata_json: JSON.stringify({
          passage: "The hippocampus helps stabilize and transfer newly encoded memories",
          documentId: "doc-1",
        }),
      },
    ]);

    const resolution = await resolveCardSource(probe({ id: "item-1" }));
    expect(resolution.status).toBe("ready");
    if (resolution.status === "ready") {
      expect(resolution.documentId).toBe("doc-1");
      expect(resolution.excerpt).toContain("hippocampus");
    }
  });

  it("ignores malformed ai_provenance metadata safely", async () => {
    getExtractMock.mockResolvedValue(null);
    getAiProvenanceMock.mockResolvedValue([
      { id: "prov-1", metadata_json: "{{{broken" },
    ]);

    const resolution = await resolveCardSource(probe({ id: "item-1" }));
    expect(resolution).toMatchObject({ status: "unavailable", reason: "no-source" });
  });
});

describe("cardSourceReference envelope", () => {
  it("round-trips through serialize and parse, clamping the excerpt", async () => {
    const { serializeCardSourceReference } = await import("../../types/cardSourceReference");
    const { parseCardSourceReference } = await import("../../types/cardSourceReference");

    const raw = serializeCardSourceReference({
      document_id: "doc-1",
      locator: { kind: "html", scrollPercent: 42, textQuote: "q" },
      excerpt: "x".repeat(500),
    });
    const parsed = parseCardSourceReference(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.excerpt.length).toBe(300);
  });

  it("rejects unknown versions and bad locators", async () => {
    const { parseCardSourceReference } = await import("../../types/cardSourceReference");
    expect(
      parseCardSourceReference(
        JSON.stringify({ version: 2, document_id: "d", locator: { kind: "html" }, excerpt: "x" })
      )
    ).toBeNull();
    expect(
      parseCardSourceReference(
        JSON.stringify({ version: 1, document_id: "d", locator: { kind: "floppy" }, excerpt: "x" })
      )
    ).toBeNull();
    expect(parseCardSourceReference(null)).toBeNull();
  });
});
