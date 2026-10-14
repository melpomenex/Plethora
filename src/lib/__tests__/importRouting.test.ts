import { describe, it, expect, vi, beforeEach } from "vitest";
import { processSharedBatch, type ProcessSharedBatchDeps } from "../importRouting";
import * as openDocModule from "../../utils/openDocumentAtLocation";
import type { SharedBatch } from "../../types/share";

vi.mock("../../utils/openDocumentAtLocation", () => ({
  openDocumentAtLocation: vi.fn(),
}));

vi.mock("../../api/documents", () => ({
  createDocument: vi.fn().mockResolvedValue({ id: "doc-note-1", title: "Note", metadata: {} }),
  mergeDocumentMetadata: vi.fn().mockImplementation((id, updates) => Promise.resolve({ id, title: id, metadata: updates })),
  updateDocumentContent: vi.fn().mockImplementation((id, content) => Promise.resolve({ id, title: "Note", content, metadata: {} })),
}));

import { mergeDocumentMetadata } from "../../api/documents";
import { ArticleImportError } from "../../utils/articleImport/errors";

describe("processSharedBatch", () => {
  let mockToast: any;
  let mockDocStore: any;
  let mockTabsStore: any;
  let mockOpenExternal: any;
  let deps: ProcessSharedBatchDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast = {
      info: vi.fn().mockReturnValue("toast-info-1"),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      dismiss: vi.fn(),
    };
    mockDocStore = {
      importFromUrl: vi.fn(),
      openTwitterThread: vi.fn(),
      importFromFiles: vi.fn(),
      loadDocuments: vi.fn().mockResolvedValue([]),
      persistWebArticleFailure: vi.fn(),
    };
    mockTabsStore = {
      addTab: vi.fn(),
    };
    mockOpenExternal = vi.fn();
    deps = {
      t: (key: string) => key,
      toast: mockToast,
      getDocumentStore: () => mockDocStore,
      getTabsStore: () => mockTabsStore,
      openExternal: mockOpenExternal,
    };
  });

  it("successfully imports X thread, navigates to reader tab, and reports 1 imported", async () => {
    const threadDoc = {
      id: "x-thread-98765",
      title: "Thread by @scientist",
      metadata: { source: "https://x.com/scientist/status/98765" },
    };
    mockDocStore.openTwitterThread.mockResolvedValue(threadDoc);

    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://x.com/scientist/status/98765" }],
    };

    const result = await processSharedBatch(batch, deps);

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(mockDocStore.openTwitterThread).toHaveBeenCalledWith("https://x.com/scientist/status/98765");
    expect(openDocModule.openDocumentAtLocation).toHaveBeenCalledWith(
      "x-thread-98765",
      {},
      mockTabsStore.addTab
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      "mainLayout.importedSuccessfully",
      "Thread by @scientist",
      expect.any(Object)
    );
    expect(mockDocStore.loadDocuments).toHaveBeenCalled();
  });

  it("detects xThreadError in returned document, reports failed count, avoids false success toast, and navigates to reader error state", async () => {
    const erroredDoc = {
      id: "x-thread-private",
      title: "X Thread",
      metadata: {
        source: "https://x.com/user/status/11111",
        xThreadError: { type: "thread_unavailable", message: "Account is private" },
      },
    };
    mockDocStore.openTwitterThread.mockResolvedValue(erroredDoc);

    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://x.com/user/status/11111" }],
    };

    const result = await processSharedBatch(batch, deps);

    expect(result).toEqual({ imported: 0, failed: 1 });
    expect(mockDocStore.openTwitterThread).toHaveBeenCalledWith("https://x.com/user/status/11111");
    // Should navigate to reader so the user sees the native XThreadErrorState with Retry / Open on X
    expect(openDocModule.openDocumentAtLocation).toHaveBeenCalledWith(
      "x-thread-private",
      {},
      mockTabsStore.addTab
    );
    // Crucial: MUST NOT report a false success toast
    expect(mockToast.success).not.toHaveBeenCalled();
    // And MUST NOT show generic "Could not process shared content" when error state is already navigated to
    expect(mockToast.error).not.toHaveBeenCalledWith("mainLayout.importFailed", "Could not process shared content");
  });

  it("successfully imports web article and displays success toast with open action", async () => {
    const articleDoc = {
      id: "doc-article-1",
      title: "Great Science Article",
    };
    mockDocStore.importFromUrl.mockResolvedValue(articleDoc);

    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://example.com/article" }],
    };

    const result = await processSharedBatch(batch, deps);

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(mockDocStore.importFromUrl).toHaveBeenCalledWith("https://example.com/article");
    expect(mockToast.success).toHaveBeenCalledWith(
      "mainLayout.importedSuccessfully",
      "Great Science Article",
      expect.objectContaining({
        action: expect.objectContaining({ label: "mainLayout.open" }),
      })
    );

    // Trigger toast open action
    const toastCall = mockToast.success.mock.calls[0];
    const openAction = toastCall[2].action;
    openAction.onClick();
    expect(openDocModule.openDocumentAtLocation).toHaveBeenCalledWith(
      "doc-article-1",
      {},
      mockTabsStore.addTab
    );
  });

  it("attributes each saved URL, file, and text result before success and invalidation", async () => {
    const urlDoc = { id: "doc-url", title: "Article", metadata: { originalUrl: "https://example.org/article" } };
    const videoDoc = { id: "doc-video", title: "Video", fileType: "youtube", metadata: { originalUrl: "https://youtube.com/watch?v=abc12345678" } };
    const fileDoc = { id: "doc-file", title: "Paper", metadata: {} };
    mockDocStore.importFromUrl.mockResolvedValueOnce(urlDoc).mockResolvedValueOnce(videoDoc);
    mockDocStore.importFromFiles.mockResolvedValue([fileDoc]);
    const invalidated = vi.fn();
    window.addEventListener("plethora:capture-invalidated", invalidated);
    const batch: SharedBatch = {
      id: "batch-mixed",
      timestamp: 1724200000000,
      sourceApp: "com.example.sender",
      items: [
        { type: "url", url: "https://example.org/article" },
        { type: "url", url: "https://youtube.com/watch?v=abc12345678" },
        { type: "file", filePath: "/imports/paper.pdf", fileName: "paper.pdf" },
        { type: "text", text: "A note", title: "Note" },
      ],
    };

    const result = await processSharedBatch(batch, deps, { origin: "share_extension", sourceApp: "com.example.sender" });

    expect(result).toEqual({ imported: 4, failed: 0 });
    expect(mergeDocumentMetadata).toHaveBeenCalledTimes(4);
    const patches = vi.mocked(mergeDocumentMetadata).mock.calls.map(([, patch]) => patch.shareProvenance);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "share_extension", sourceUrl: "https://example.org/article", batchId: "batch-mixed", sourceApp: "com.example.sender" }),
      expect.objectContaining({ source: "share_extension", sourceUrl: "https://youtube.com/watch?v=abc12345678", batchId: "batch-mixed", sourceApp: "com.example.sender" }),
      expect.objectContaining({ source: "share_extension", batchId: "batch-mixed" }),
    ]));
    expect(patches[2]?.sourceUrl).toBeUndefined();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(invalidated.mock.calls[0][0].detail).toEqual({ source: "share-target", documentIds: expect.arrayContaining(["doc-url", "doc-video", "doc-file", "doc-note-1"]) });
    expect(mockToast.success).toHaveBeenCalledOnce();
    window.removeEventListener("plethora:capture-invalidated", invalidated);
  });

  it("attributes and invalidates a saved URL failure placeholder without counting it as imported", async () => {
    const placeholder = { id: "doc-placeholder", title: "Shared URL", metadata: { captureFailed: { reason: "network_failed" } } };
    mockDocStore.importFromUrl.mockRejectedValue(new ArticleImportError("network_failed"));
    mockDocStore.persistWebArticleFailure.mockResolvedValue(placeholder);
    const invalidated = vi.fn();
    window.addEventListener("plethora:capture-invalidated", invalidated);

    const result = await processSharedBatch({ timestamp: 1724200000000, items: [{ type: "url", url: "https://example.org/offline" }] }, deps, { origin: "android_share" });

    expect(result).toEqual({ imported: 0, failed: 0 });
    expect(mockDocStore.persistWebArticleFailure).toHaveBeenCalledWith("https://example.org/offline", "network_failed");
    expect(mergeDocumentMetadata).toHaveBeenCalledWith("doc-placeholder", expect.objectContaining({ shareProvenance: expect.objectContaining({ source: "android_share", sourceUrl: "https://example.org/offline" }) }));
    expect(invalidated.mock.calls[0][0].detail.documentIds).toEqual(["doc-placeholder"]);
    expect(mockToast.success).not.toHaveBeenCalled();
    window.removeEventListener("plethora:capture-invalidated", invalidated);
  });

  it("does not add share provenance for desktop external-open routing", async () => {
    mockDocStore.importFromUrl.mockResolvedValue({ id: "external-doc", title: "Opened file", metadata: {} });
    const result = await processSharedBatch({ timestamp: Date.now(), items: [{ type: "url", url: "https://example.org/opened" }] }, deps);
    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(mergeDocumentMetadata).not.toHaveBeenCalled();
  });

  it("attributes a specialized X thread while preserving its established browser provenance", async () => {
    mockDocStore.openTwitterThread.mockResolvedValue({
      id: "dedup-x-thread", title: "Existing X thread", metadata: {
        source: "browser_extension", originalUrl: "https://x.com/user/status/123",
      },
    });
    await processSharedBatch({ timestamp: 1724200000002, items: [{ type: "url", url: "https://x.com/user/status/123" }] }, deps, { origin: "android_share" });
    expect(mergeDocumentMetadata).toHaveBeenCalledWith("dedup-x-thread", expect.objectContaining({
      captureProvenance: expect.objectContaining({ source: "browser_extension", sourceUrl: "https://x.com/user/status/123" }),
      shareProvenance: expect.objectContaining({ source: "android_share", sourceUrl: "https://x.com/user/status/123" }),
    }));
  });

  it("retries attribution against the saved document without importing it again", async () => {
    const saved = { id: "retry-doc", title: "Saved once", metadata: {} };
    mockDocStore.importFromUrl.mockResolvedValue(saved);
    vi.mocked(mergeDocumentMetadata)
      .mockRejectedValueOnce(new Error("database offline"))
      .mockRejectedValueOnce(new Error("database offline"));
    const batch = { id: "retry-batch", timestamp: 1724200000001, items: [{ type: "url" as const, url: "https://example.org/retry" }] };
    const invalidated = vi.fn();
    window.addEventListener("plethora:capture-invalidated", invalidated);

    const first = await processSharedBatch(batch, deps, { origin: "share_extension" });
    expect(first).toEqual({ imported: 0, failed: 1 });
    expect(mockDocStore.importFromUrl).toHaveBeenCalledOnce();
    expect(invalidated).not.toHaveBeenCalled();

    const second = await processSharedBatch(batch, deps, { origin: "share_extension" });
    expect(second).toEqual({ imported: 1, failed: 0 });
    expect(mockDocStore.importFromUrl).toHaveBeenCalledOnce();
    expect(mergeDocumentMetadata).toHaveBeenCalledTimes(3);
    expect(mockToast.success).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledOnce();
    window.removeEventListener("plethora:capture-invalidated", invalidated);
  });
});
