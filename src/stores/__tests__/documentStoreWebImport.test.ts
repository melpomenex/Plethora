/**
 * Store-level tests for the Web Article Import Pipeline orchestration
 * (overhaul-web-article-import task 8.6): happy-path mapping, failure codes
 * produce no document, dedupe (existing + in-flight), snapshot skip on
 * oversize, and the raw-fallback marker path. All APIs are mocked — the
 * pipeline itself is covered by the fixture suite.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findDocumentIdBySourceUrlMock,
  getDocumentMock,
  createDocumentMock,
  updateWebArticleMock,
  updateDocumentMock,
  updateDocumentContentMock,
  deleteDocumentMock,
  storeSourceSnapshotMock,
  cleanupSourceSnapshotsMock,
  deleteSourceSnapshotsMock,
  importArticleMock,
  importRawFallbackPageMock,
  importArxivPdfMock,
  getArxivPaperMock,
} = vi.hoisted(() => ({
  findDocumentIdBySourceUrlMock: vi.fn().mockResolvedValue(null),
  getDocumentMock: vi.fn().mockResolvedValue(null),
  createDocumentMock: vi.fn(),
  updateWebArticleMock: vi.fn(),
  updateDocumentMock: vi.fn(),
  updateDocumentContentMock: vi.fn(),
  deleteDocumentMock: vi.fn().mockResolvedValue(undefined),
  storeSourceSnapshotMock: vi.fn().mockResolvedValue(null),
  cleanupSourceSnapshotsMock: vi.fn().mockResolvedValue(0),
  deleteSourceSnapshotsMock: vi.fn().mockResolvedValue(0),
  importArticleMock: vi.fn(),
  importRawFallbackPageMock: vi.fn(),
  importArxivPdfMock: vi.fn(),
  getArxivPaperMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../api/documents", () => ({
  findDocumentIdBySourceUrl: (...args: unknown[]) => findDocumentIdBySourceUrlMock(...args),
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
  createDocument: (...args: unknown[]) => createDocumentMock(...args),
  updateWebArticle: (...args: unknown[]) => updateWebArticleMock(...args),
  updateDocument: (...args: unknown[]) => updateDocumentMock(...args),
  updateDocumentContent: (...args: unknown[]) => updateDocumentContentMock(...args),
  deleteDocument: (...args: unknown[]) => deleteDocumentMock(...args),
  storeSourceSnapshot: (...args: unknown[]) => storeSourceSnapshotMock(...args),
  cleanupSourceSnapshots: (...args: unknown[]) => cleanupSourceSnapshotsMock(...args),
  deleteSourceSnapshots: (...args: unknown[]) => deleteSourceSnapshotsMock(...args),
}));

vi.mock("../../utils/articleImport/importPipeline", () => ({
  importArticle: (...args: unknown[]) => importArticleMock(...args),
}));

vi.mock("../../utils/articleImport/rawFallback", () => ({
  importRawFallbackPage: (...args: unknown[]) => importRawFallbackPageMock(...args),
}));

vi.mock("../settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ settings: { documents: { webImportKeepRawSource: true } } }),
  },
}));

const collectionStoreState = { activeCollectionId: null as string | null };
vi.mock("../collectionStore", () => ({
  useCollectionStore: { getState: () => collectionStoreState },
}));

vi.mock("../../utils/documentImport", () => ({
  importFromUrl: vi.fn(),
  importArxivPdf: (...args: unknown[]) => importArxivPdfMock(...args),
}));
vi.mock("../../api/arxiv", () => ({
  getArxivPaper: (...args: unknown[]) => getArxivPaperMock(...args),
}));
vi.mock("../../api/segmentation", () => ({}));
vi.mock("../../lib/tauri", () => ({ listen: vi.fn(() => Promise.resolve(() => {})), isTauri: () => true, isNativeMobile: () => false }));
vi.mock("../../lib/feedback", () => ({ emitFeedback: vi.fn().mockResolvedValue({ channels: [] }) }));
vi.mock("../../components/common/Toast", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
  ToastType: { Success: "success", Error: "error", Info: "info" },
}));
vi.mock("../../api/audiobooks", () => ({
  enrichAudiobookDocument: vi.fn(),
  isAudiobookFile: vi.fn(() => false),
}));
vi.mock("../kindleImportDialogStore", () => ({
  openKindleImportDialog: vi.fn(),
}));

import { useDocumentStore } from "../documentStore";
import { ArticleImportError } from "../../utils/articleImport/errors";
import type { Document } from "../../types/document";

function baseDoc(id: string): Document {
  return {
    id,
    title: "Persisted Article",
    filePath: "https://example.com/a",
    fileType: "html",
    tags: [],
    dateAdded: "2026-08-15T00:00:00.000Z",
    dateModified: "2026-08-15T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 50,
    priorityScore: 5,
    isArchived: false,
    isFavorite: false,
  } as Document;
}

function pipelineOutcome(overrides: Record<string, unknown> = {}) {
  return {
    article: {
      title: "A Serious Article",
      byline: "Reporter Name",
      siteName: "example.com",
      publishedTime: "2026-08-15T00:00:00Z",
      heroImage: "https://cdn.example.com/hero.jpg",
      contentHtml: '<article class="inc-article"><div class="inc-body"><p>Body.</p></div></article>',
      textContent: "Body.",
      stats: { words: 2, images: 0, figures: 0 },
    },
    diagnostics: {
      originalUrl: "https://example.com/a?utm_source=x",
      canonicalUrl: "https://example.com/a",
      resolvedUrl: "https://example.com/a",
      fetch: { status: 200, contentType: "text/html", redirectHops: 0 },
      candidates: [],
      selected: { engine: "defuddle", score: 72, confidence: "high", words: 600, paragraphs: 20, images: 1 },
      normalizationWarnings: [],
      timings: {},
    },
    rawHtml: "<html></html>",
    rawFilePath: "/tmp/raw.html",
    resolvedUrl: "https://example.com/a",
    canonicalUrl: "https://example.com/a",
    normalizedOriginalUrl: "https://example.com/a",
    ...overrides,
  };
}

function arxivOutcome() {
  const outcome = pipelineOutcome();
  return {
    ...outcome,
    article: {
      ...outcome.article,
      title: "Canonical arXiv Paper",
      contentHtml:
        '<article class="inc-article"><header><h1 class="inc-title">Canonical arXiv Paper</h1></header><div class="inc-body"><h2>Method</h2><p>Canonical body.</p></div></article>',
      textContent: "Canonical arXiv Paper Method Canonical body.",
    },
    diagnostics: {
      ...outcome.diagnostics,
      originalUrl: "https://arxiv.org/abs/2410.07524v1",
      canonicalUrl: "https://arxiv.org/abs/2410.07524v1",
      resolvedUrl: "https://arxiv.org/html/2410.07524v1",
      selected: {
        engine: "site:arxiv.org",
        score: 90,
        confidence: "high",
        words: 800,
        paragraphs: 20,
        images: 1,
      },
    },
    resolvedUrl: "https://arxiv.org/html/2410.07524v1",
    canonicalUrl: "https://arxiv.org/abs/2410.07524v1",
    normalizedOriginalUrl: "https://arxiv.org/abs/2410.07524v1",
  };
}

const dialogPaper = {
  id: "2410.07524",
  title: "Dialog title must not replace canonical title",
  authors: ["Dialog Author"],
  summary: "Dialog abstract",
  published: "2024-10-10T00:00:00Z",
  updated: "2024-10-11T00:00:00Z",
  pdfUrl: "https://arxiv.org/pdf/2410.07524.pdf",
  absUrl: "https://arxiv.org/abs/2410.07524",
  categories: ["cs.AI", "cs.LG"],
  primaryCategory: "cs.AI",
};

beforeEach(() => {
  vi.clearAllMocks();
  findDocumentIdBySourceUrlMock.mockResolvedValue(null);
  getDocumentMock.mockResolvedValue(null);
  storeSourceSnapshotMock.mockResolvedValue(null);
  cleanupSourceSnapshotsMock.mockResolvedValue(0);
  deleteDocumentMock.mockResolvedValue(undefined);
  getArxivPaperMock.mockResolvedValue(null);
  useDocumentStore.setState({ documents: [], isImporting: false, error: null });
});

describe("documentStore.importFromUrl (article pipeline path)", () => {
  it("happy path maps the outcome into a persisted document", async () => {
    const outcome = pipelineOutcome();
    importArticleMock.mockResolvedValue(outcome);
    createDocumentMock.mockImplementation(async (title: string) => baseDoc("d1"));
    updateWebArticleMock.mockImplementation(async (_id: string) => baseDoc("d1"));
    updateDocumentMock.mockImplementation(async () => ({ ...baseDoc("d1"), title: "A Serious Article" }));

    const doc = await useDocumentStore.getState().importFromUrl("https://example.com/a?utm_source=x");

    expect(importArticleMock).toHaveBeenCalledWith(
      "https://example.com/a?utm_source=x",
      expect.objectContaining({})
    );
    expect(createDocumentMock).toHaveBeenCalledWith("A Serious Article", "https://example.com/a", "html", null);
    expect(updateWebArticleMock).toHaveBeenCalledWith(
      "d1",
      outcome.article.contentHtml,
      expect.objectContaining({
        source: "https://example.com/a?utm_source=x",
        wordCount: 2,
        webArticle: expect.objectContaining({
          extractor: "defuddle",
          extractionScore: 72,
          extractionConfidence: "high",
          originalUrl: "https://example.com/a?utm_source=x",
          canonicalUrl: "https://example.com/a",
        }),
      }),
      "https://example.com/a",
      "https://cdn.example.com/hero.jpg"
    );
    expect(doc.title).toBe("A Serious Article");
    expect(useDocumentStore.getState().documents).toHaveLength(1);
  });

  it("stores the raw-source snapshot when the setting is on and a temp file exists", async () => {
    importArticleMock.mockResolvedValue(pipelineOutcome());
    storeSourceSnapshotMock.mockResolvedValue({
      stored: true,
      path: "/app/source-snapshots/d1.html.gz",
      sha256: "abc",
      rawBytes: 1000,
      gzipBytes: 300,
    });
    createDocumentMock.mockResolvedValue(baseDoc("d1"));
    updateWebArticleMock.mockResolvedValue(baseDoc("d1"));
    updateDocumentMock.mockResolvedValue(baseDoc("d1"));

    await useDocumentStore.getState().importFromUrl("https://example.com/a");

    expect(storeSourceSnapshotMock).toHaveBeenCalledWith("d1", "/tmp/raw.html");
    const metadataArg = updateWebArticleMock.mock.calls[0][2];
    expect(metadataArg.webArticle.sourceSnapshot).toEqual({
      path: "/app/source-snapshots/d1.html.gz",
      sha256: "abc",
      rawBytes: 1000,
      gzipBytes: 300,
    });
  });

  it("oversize snapshot is skipped with a diagnostic and the import still succeeds", async () => {
    importArticleMock.mockResolvedValue(pipelineOutcome());
    storeSourceSnapshotMock.mockResolvedValue({
      stored: false,
      skippedReason: "raw source 6000000 bytes exceeds snapshot cap of 5242880 bytes",
    });
    createDocumentMock.mockResolvedValue(baseDoc("d1"));
    updateWebArticleMock.mockResolvedValue(baseDoc("d1"));
    updateDocumentMock.mockResolvedValue(baseDoc("d1"));

    const doc = await useDocumentStore.getState().importFromUrl("https://example.com/a");

    expect(doc.id).toBe("d1");
    const metadataArg = updateWebArticleMock.mock.calls[0][2];
    expect(metadataArg.webArticle.sourceSnapshot).toBeUndefined();
    expect(metadataArg.webArticle.diagnostics.normalizationWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining("snapshot skipped")])
    );
  });

  it("pipeline failures create NO document and rethrow the typed error", async () => {
    importArticleMock.mockRejectedValue(
      new ArticleImportError("low_confidence", undefined, { retriable: false })
    );

    await expect(
      useDocumentStore.getState().importFromUrl("https://example.com/fail")
    ).rejects.toMatchObject({ code: "low_confidence" });

    expect(createDocumentMock).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().documents).toHaveLength(0);
    expect(useDocumentStore.getState().error).toBeTruthy();
  });

  it("dedupe: an existing document with the same source URL is surfaced, nothing created", async () => {
    const existing = baseDoc("existing-1");
    findDocumentIdBySourceUrlMock.mockResolvedValue("existing-1");
    getDocumentMock.mockResolvedValue(existing);

    const doc = await useDocumentStore.getState().importFromUrl("https://example.com/a?utm_medium=social");

    // Tracking params must not defeat the dedupe lookup.
    expect(findDocumentIdBySourceUrlMock).toHaveBeenCalledWith("https://example.com/a");
    expect(doc.id).toBe("existing-1");
    expect(importArticleMock).not.toHaveBeenCalled();
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it("in-flight dedupe: two rapid shares of the same URL run the pipeline once", async () => {
    let resolvePipeline: (v: unknown) => void = () => {};
    importArticleMock.mockImplementation(
      () => new Promise((resolve) => { resolvePipeline = resolve; })
    );
    createDocumentMock.mockResolvedValue(baseDoc("d1"));
    updateWebArticleMock.mockResolvedValue(baseDoc("d1"));
    updateDocumentMock.mockResolvedValue(baseDoc("d1"));

    const first = useDocumentStore.getState().importFromUrl("https://example.com/a");
    const second = useDocumentStore.getState().importFromUrl("https://example.com/a?utm_source=x");
    // Wait until the pipeline actually started before releasing its result —
    // the deferred resolver is only wired up on the first importArticle call.
    await vi.waitFor(() => expect(importArticleMock).toHaveBeenCalledTimes(1));
    resolvePipeline(pipelineOutcome());
    const [docA, docB] = await Promise.all([first, second]);

    expect(importArticleMock).toHaveBeenCalledTimes(1);
    expect(docA.id).toBe("d1");
    expect(docB.id).toBe("d1");
    expect(useDocumentStore.getState().documents).toHaveLength(1);
  });

  it("direct-file URLs keep the legacy non-article path", async () => {
    const { importFromUrl: legacyUtil } = await import("../../utils/documentImport");
    const legacyMock = legacyUtil as ReturnType<typeof vi.fn>;
    legacyMock.mockReset();
    legacyMock.mockResolvedValue({
      title: "Paper",
      filePath: "/tmp/p.pdf",
      fileType: "pdf",
      content: "text",
      tags: [],
      category: "Web Import",
      metadata: {},
    });
    createDocumentMock.mockResolvedValue(baseDoc("d2"));
    updateDocumentMock.mockResolvedValue(baseDoc("d2"));
    vi.mocked(updateDocumentMock).mockImplementation(async () => baseDoc("d2"));

    await useDocumentStore.getState().importFromUrl("https://arxiv.org/pdf/2401.00001.pdf");

    expect(importArticleMock).not.toHaveBeenCalled();
    expect(legacyMock).toHaveBeenCalled();
  });
});

describe("canonical arXiv HTML orchestration", () => {
  function arrangeCanonicalPersistence(id = "arxiv-1") {
    importArticleMock.mockResolvedValue(arxivOutcome());
    createDocumentMock.mockResolvedValue(baseDoc(id));
    updateWebArticleMock.mockResolvedValue(baseDoc(id));
    updateDocumentMock.mockImplementation(async (_id: string, update: Document) => update);
  }

  it("gives dedicated and generic clean imports the same canonical body and provenance", async () => {
    arrangeCanonicalPersistence("generic");
    await useDocumentStore.getState().importFromUrl("https://arxiv.org/html/2410.07524v1");
    const genericBody = updateWebArticleMock.mock.calls[0][1];
    const genericMetadata = updateWebArticleMock.mock.calls[0][2];

    useDocumentStore.setState({ documents: [] });
    findDocumentIdBySourceUrlMock.mockClear();
    createDocumentMock.mockClear();
    updateWebArticleMock.mockClear();
    updateDocumentMock.mockClear();
    importArticleMock.mockClear();
    arrangeCanonicalPersistence("dedicated");

    await useDocumentStore
      .getState()
      .importFromArxiv("2410.07524v1", "html", dialogPaper);
    const dedicatedBody = updateWebArticleMock.mock.calls[0][1];
    const dedicatedMetadata = updateWebArticleMock.mock.calls[0][2];

    expect(dedicatedBody).toBe(genericBody);
    expect(dedicatedMetadata.webArticle).toMatchObject({
      canonicalUrl: genericMetadata.webArticle.canonicalUrl,
      extractor: genericMetadata.webArticle.extractor,
      extractionVersion: 4,
    });
    expect(importArticleMock).toHaveBeenCalledWith(
      "https://arxiv.org/abs/2410.07524v1",
      expect.any(Object)
    );
    expect(getArxivPaperMock).not.toHaveBeenCalled();
    expect(updateDocumentMock).toHaveBeenCalledWith(
      "dedicated",
      expect.objectContaining({
        category: "Research Papers",
        tags: expect.arrayContaining(["arxiv", "research", "cs.AI", "cs.LG"]),
        priorityScore: 7,
      })
    );
    expect(dedicatedMetadata).toMatchObject({
      arxivId: "2410.07524",
      arxivUrl: "https://arxiv.org/abs/2410.07524v1",
      htmlUrl: "https://arxiv.org/html/2410.07524v1",
      subject: "cs.AI",
    });
  });

  it("returns an existing canonical document without applying dialog metadata", async () => {
    const existing = {
      ...baseDoc("existing-arxiv"),
      category: "Personal",
      tags: ["keep-me"],
      priorityScore: 2,
    } as Document;
    findDocumentIdBySourceUrlMock.mockResolvedValue("existing-arxiv");
    getDocumentMock.mockResolvedValue(existing);

    const result = await useDocumentStore
      .getState()
      .importFromArxiv("2410.07524v1", "html", dialogPaper);

    expect(result).toEqual(existing);
    expect(findDocumentIdBySourceUrlMock).toHaveBeenCalledWith(
      "https://arxiv.org/abs/2410.07524v1"
    );
    expect(importArticleMock).not.toHaveBeenCalled();
    expect(updateWebArticleMock).not.toHaveBeenCalled();
    expect(updateDocumentMock).not.toHaveBeenCalled();
    expect(getArxivPaperMock).not.toHaveBeenCalled();
  });

  it("coalesces concurrent abs, html, and dedicated identifier forms", async () => {
    let resolvePipeline: (value: ReturnType<typeof arxivOutcome>) => void = () => {};
    importArticleMock.mockImplementation(
      () => new Promise((resolve) => { resolvePipeline = resolve; })
    );
    createDocumentMock.mockResolvedValue(baseDoc("coalesced"));
    updateWebArticleMock.mockResolvedValue(baseDoc("coalesced"));
    updateDocumentMock.mockResolvedValue(baseDoc("coalesced"));

    const abs = useDocumentStore.getState().importFromUrl("https://arxiv.org/abs/2410.07524v1");
    const html = useDocumentStore.getState().importFromUrl("https://arxiv.org/html/2410.07524v1/");
    const dedicated = useDocumentStore
      .getState()
      .importFromArxiv("2410.07524v1", "html", dialogPaper);
    await vi.waitFor(() => expect(importArticleMock).toHaveBeenCalledTimes(1));
    resolvePipeline(arxivOutcome());

    const results = await Promise.all([abs, html, dedicated]);
    expect(results.map((document) => document.id)).toEqual([
      "coalesced",
      "coalesced",
      "coalesced",
    ]);
    expect(createDocumentMock).toHaveBeenCalledTimes(1);
    expect(storeSourceSnapshotMock).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().documents).toHaveLength(1);
  });

  it("keeps metadata lookup best-effort and never selects legacy HTML", async () => {
    getArxivPaperMock.mockRejectedValue(new Error("Atom API unavailable"));
    arrangeCanonicalPersistence();

    await useDocumentStore.getState().importFromArxiv("2410.07524v1", "html");

    expect(getArxivPaperMock).toHaveBeenCalledWith("2410.07524");
    expect(importArticleMock).toHaveBeenCalledTimes(1);
    expect(importArxivPdfMock).not.toHaveBeenCalled();
    expect(updateWebArticleMock.mock.calls[0][2]).toMatchObject({
      arxivId: "2410.07524",
      webArticle: expect.objectContaining({ extractor: "site:arxiv.org" }),
    });
  });

  it("cleans up a provisional document when canonical persistence fails", async () => {
    importArticleMock.mockResolvedValue(arxivOutcome());
    createDocumentMock.mockResolvedValue(baseDoc("provisional"));
    updateWebArticleMock.mockRejectedValue(new Error("database write failed"));

    await expect(
      useDocumentStore.getState().importFromArxiv("2410.07524v1", "html", dialogPaper)
    ).rejects.toThrow("database write failed");
    expect(deleteDocumentMock).toHaveBeenCalledWith("provisional");
    expect(useDocumentStore.getState().documents).toHaveLength(0);
  });

  it("rejects invalid dedicated HTML input before lookup or persistence", async () => {
    await expect(
      useDocumentStore.getState().importFromArxiv("not-an-arxiv-paper", "html")
    ).rejects.toThrow("Invalid Arxiv ID or URL");
    expect(getArxivPaperMock).not.toHaveBeenCalled();
    expect(importArticleMock).not.toHaveBeenCalled();
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it("leaves default and explicit PDF imports on the PDF utility", async () => {
    const pdfData = {
      ...baseDoc("pdf-data"),
      filePath: "/tmp/paper.pdf",
      fileType: "pdf",
      content: "abstract",
      category: "Research Papers",
    } as Omit<Document, "id">;
    importArxivPdfMock.mockResolvedValue(pdfData);
    createDocumentMock.mockResolvedValue({ ...baseDoc("pdf-1"), fileType: "pdf" });
    updateDocumentContentMock.mockResolvedValue({ ...baseDoc("pdf-1"), fileType: "pdf" });
    updateDocumentMock.mockResolvedValue({ ...baseDoc("pdf-1"), fileType: "pdf" });

    await useDocumentStore.getState().importFromArxiv("2410.07524v1");

    expect(importArxivPdfMock).toHaveBeenCalledWith("2410.07524v1");
    expect(importArticleMock).not.toHaveBeenCalled();
    expect(updateWebArticleMock).not.toHaveBeenCalled();
  });
});

describe("documentStore.importRawPageFromUrl (escape hatch)", () => {
  it("persists the full page marked raw-fallback with the visible notice", async () => {
    importRawFallbackPageMock.mockResolvedValue(
      pipelineOutcome({
        diagnostics: {
          originalUrl: "https://example.com/stub",
          canonicalUrl: "https://example.com/stub",
          resolvedUrl: "https://example.com/stub",
          fetch: { status: 200, contentType: "text/html", redirectHops: 0 },
          candidates: [],
          selected: { engine: "raw-fallback", score: 0, confidence: "low", words: 1, paragraphs: 1, images: 0 },
          normalizationWarnings: ["raw fallback: full page stored, not an extracted article"],
          timings: {},
        },
        article: {
          title: "Full Page Import",
          contentHtml:
            '<article class="inc-article inc-raw"><header><aside class="inc-raw-notice">Imported as the full page (extraction failed).</aside></header><div class="inc-body"><p>Everything.</p></div></article>',
          textContent: "Everything.",
          stats: { words: 1, images: 0, figures: 0 },
        },
      })
    );
    createDocumentMock.mockResolvedValue(baseDoc("raw1"));
    updateWebArticleMock.mockResolvedValue(baseDoc("raw1"));
    updateDocumentMock.mockResolvedValue(baseDoc("raw1"));

    const doc = await useDocumentStore.getState().importRawPageFromUrl("https://example.com/stub", {
      extraTags: ["article", "web"],
    });

    expect(importRawFallbackPageMock).toHaveBeenCalled();
    const metadataArg = updateWebArticleMock.mock.calls[0][2];
    expect(metadataArg.webArticle.extractor).toBe("raw-fallback");
    expect(metadataArg.webArticle.extractionScore).toBe(0);
    expect(metadataArg.webArticle.extractionConfidence).toBe("low");
    expect(metadataArg.webArticle.diagnostics.normalizationWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining("raw fallback")])
    );
    expect(doc.id).toBe("raw1");
  });

  it("failure creates no document", async () => {
    importRawFallbackPageMock.mockRejectedValue(
      new ArticleImportError("network_failed")
    );
    await expect(
      useDocumentStore.getState().importRawPageFromUrl("https://example.com/gone")
    ).rejects.toMatchObject({ code: "network_failed" });
    expect(createDocumentMock).not.toHaveBeenCalled();
  });
});
