/**
 * Integration test (share-target → document-store dedupe): re-sharing the
 * same URL through useShareTarget must not create a duplicate document.
 * Sequential re-shares surface the existing document via the canonical-URL
 * lookup; rapid re-shares coalesce via the in-flight import map. The api and
 * pipeline layers are mocked; the real documentStore dedupe machinery runs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findDocumentIdBySourceUrlMock,
  getDocumentMock,
  createDocumentMock,
  updateWebArticleMock,
  updateDocumentMock,
  storeSourceSnapshotMock,
  cleanupSourceSnapshotsMock,
  deleteSourceSnapshotsMock,
  importArticleMock,
  importRawFallbackPageMock,
  invokeCommandMock,
} = vi.hoisted(() => ({
  findDocumentIdBySourceUrlMock: vi.fn().mockResolvedValue(null),
  getDocumentMock: vi.fn().mockResolvedValue(null),
  createDocumentMock: vi.fn(),
  updateWebArticleMock: vi.fn(),
  updateDocumentMock: vi.fn(),
  storeSourceSnapshotMock: vi.fn().mockResolvedValue(null),
  cleanupSourceSnapshotsMock: vi.fn().mockResolvedValue(0),
  deleteSourceSnapshotsMock: vi.fn().mockResolvedValue(0),
  importArticleMock: vi.fn(),
  importRawFallbackPageMock: vi.fn(),
  invokeCommandMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../api/documents", () => ({
  findDocumentIdBySourceUrl: (...args: unknown[]) => findDocumentIdBySourceUrlMock(...args),
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
  createDocument: (...args: unknown[]) => createDocumentMock(...args),
  updateWebArticle: (...args: unknown[]) => updateWebArticleMock(...args),
  updateDocument: (...args: unknown[]) => updateDocumentMock(...args),
  updateDocumentContent: vi.fn().mockImplementation((_id: string, doc: unknown) => Promise.resolve(doc)),
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

vi.mock("../../utils/documentImport", () => ({
  importFromUrl: vi.fn(),
  importArxivPdf: vi.fn(),
}));

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ settings: { documents: { webImportKeepRawSource: true } } }),
  },
}));

vi.mock("../../stores/collectionStore", () => ({
  useCollectionStore: { getState: () => ({ activeCollectionId: null }) },
}));

vi.mock("../../api/segmentation", () => ({}));

vi.mock("../../lib/tauri", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  invokeCommand: (...args: unknown[]) => invokeCommandMock(...args),
  isTauri: () => true,
  isNativeMobile: () => false,
}));

vi.mock("../../lib/feedback", () => ({
  emitFeedback: vi.fn().mockResolvedValue({ channels: [] }),
}));

vi.mock("../../components/common/Toast", () => ({
  useToast: () => ({
    info: vi.fn().mockReturnValue("toast-id"),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../stores/kindleImportDialogStore", () => ({
  openKindleImportDialog: vi.fn(),
}));

// Avoid pulling the real viewer (and its store-subscription side effects).
vi.mock("../../components/viewer/DocumentViewer", () => ({
  DocumentViewer: () => null,
}));

vi.mock("../../stores/tabsStore", () => ({
  useTabsStore: { getState: () => ({ addTab: vi.fn() }) },
}));

import { renderHook } from "@testing-library/react";
import { useShareTarget } from "../useShareTarget";
import { useDocumentStore } from "../../stores/documentStore";
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

function pipelineOutcome() {
  return {
    article: {
      title: "Persisted Article",
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
  };
}

describe("useShareTarget → documentStore re-share dedupe (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findDocumentIdBySourceUrlMock.mockResolvedValue(null);
    getDocumentMock.mockResolvedValue(null);
    importArticleMock.mockResolvedValue(pipelineOutcome());
    createDocumentMock.mockResolvedValue(baseDoc("d1"));
    updateWebArticleMock.mockResolvedValue(baseDoc("d1"));
    updateDocumentMock.mockResolvedValue(baseDoc("d1"));
    invokeCommandMock.mockResolvedValue([]);
    // Reset store state between scenarios.
    useDocumentStore.setState({ documents: [] } as any);
  });

  it("re-sharing the same URL surfaces the existing document instead of duplicating", async () => {
    let capturedHandler: ((batch: any) => Promise<any>) | null = null;
    vi.spyOn(await import("../../lib/shareTarget"), "registerShareListener").mockImplementation(
      (handler: any) => {
        capturedHandler = handler;
        return () => {};
      }
    );

    renderHook(() => useShareTarget());

    // First share: full pipeline, one document created.
    await capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://example.com/a?utm_medium=social" }],
    });
    expect(importArticleMock).toHaveBeenCalledTimes(1);

    // Second share of the same URL (tracking params varied): the store's
    // canonical-URL dedupe lookup surfaces the existing document — the
    // article pipeline must NOT run again and no second document is created.
    findDocumentIdBySourceUrlMock.mockResolvedValue("d1");
    getDocumentMock.mockResolvedValue(baseDoc("d1"));
    await capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://example.com/a" }],
    });

    expect(importArticleMock).toHaveBeenCalledTimes(1);
    expect(createDocumentMock).toHaveBeenCalledTimes(1);
    // Dedupe lookup ran with the normalized (tracking-stripped) URL.
    expect(findDocumentIdBySourceUrlMock).toHaveBeenCalledWith("https://example.com/a");
  });

  it("rapid re-shares of the same URL coalesce into one in-flight import", async () => {
    let capturedHandler: ((batch: any) => Promise<any>) | null = null;
    vi.spyOn(await import("../../lib/shareTarget"), "registerShareListener").mockImplementation(
      (handler: any) => {
        capturedHandler = handler;
        return () => {};
      }
    );

    let resolvePipeline: (v: unknown) => void = () => {};
    importArticleMock.mockImplementation(
      () => new Promise((resolve) => { resolvePipeline = resolve; })
    );

    renderHook(() => useShareTarget());

    const first = capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://example.com/b" }],
    });
    const second = capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://example.com/b?utm_source=x" }],
    });

    await vi.waitFor(() => expect(importArticleMock).toHaveBeenCalledTimes(1));
    resolvePipeline(pipelineOutcome());
    await Promise.all([first, second]);

    expect(importArticleMock).toHaveBeenCalledTimes(1);
    expect(createDocumentMock).toHaveBeenCalledTimes(1);
  });
});
