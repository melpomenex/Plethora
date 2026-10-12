import { describe, it, expect, vi, beforeEach } from "vitest";
import { processSharedBatch, type ProcessSharedBatchDeps } from "../importRouting";
import * as openDocModule from "../../utils/openDocumentAtLocation";
import type { SharedBatch } from "../../types/share";

vi.mock("../../utils/openDocumentAtLocation", () => ({
  openDocumentAtLocation: vi.fn(),
}));

vi.mock("../../api/documents", () => ({
  createDocument: vi.fn().mockResolvedValue({ id: "doc-note-1", title: "Note", metadata: {} }),
  updateDocument: vi.fn().mockImplementation((_id, d) => Promise.resolve(d)),
}));

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
});
