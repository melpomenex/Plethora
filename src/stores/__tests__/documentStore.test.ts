import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the api layer so the store hits our fake implementations.
const bulkDeleteDocumentsMock = vi.fn();
const pickFolderDocumentsMock = vi.fn();
const importDocumentMock = vi.fn();
const loadDocumentsMock = vi.fn();
const getDocumentsMock = vi.fn();
const getDocumentMock = vi.fn();
const emitFeedbackMock = vi.hoisted(() => vi.fn().mockResolvedValue({ channels: [] }));
vi.mock("../../api/documents", () => ({
  bulkDeleteDocuments: (...args: unknown[]) => bulkDeleteDocumentsMock(...args),
  pickFolderDocuments: (...args: unknown[]) => pickFolderDocumentsMock(...args),
  importDocument: (...args: unknown[]) => importDocumentMock(...args),
  // loadDocuments is destructured as documentsApi.loadDocuments in the store.
  loadDocuments: (...args: unknown[]) => loadDocumentsMock(...args),
  getDocuments: (...args: unknown[]) => getDocumentsMock(...args),
  getDocument: (...args: unknown[]) => getDocumentMock(...args),
}));

vi.mock("../../api/segmentation", () => ({ segmentDocument: vi.fn() }));
vi.mock("../settingsStore", () => ({
  useSettingsStore: { getState: () => ({ settings: { documents: {} } }) },
}));
// Mutable so tests can simulate switching the active collection mid-fetch.
const collectionStoreState = { activeCollectionId: null as string | null };
vi.mock("../collectionStore", () => ({
  useCollectionStore: { getState: () => collectionStoreState },
}));
vi.mock("../../utils/documentImport", () => ({
  importFromUrl: vi.fn(),
  importArxivPdf: vi.fn(),
}));
vi.mock("../../lib/tauri", () => ({ listen: vi.fn(), isTauri: () => false }));
vi.mock("../../lib/feedback", () => ({ emitFeedback: emitFeedbackMock }));
vi.mock("../../lib/fileSyncRegistration", () => ({
  registerImportedFileSync: vi.fn().mockResolvedValue(null),
  registerExistingFilesSync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../components/common/Toast", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
  ToastType: { Success: "success", Error: "error", Info: "info" },
}));

import { useDocumentStore } from "../documentStore";
import type { Document } from "../../types/document";

function makeDoc(id: string): Document {
  return {
    id,
    title: `Doc ${id}`,
    filePath: `/tmp/${id}.pdf`,
    fileType: "pdf",
    tags: [],
    dateAdded: "2024-01-01T00:00:00.000Z",
    dateModified: "2024-01-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
  };
}

describe("documentStore.bulkDelete", () => {
  beforeEach(() => {
    bulkDeleteDocumentsMock.mockReset();
    useDocumentStore.setState({
      documents: [makeDoc("a"), makeDoc("b"), makeDoc("c")],
      currentDocument: null,
    });
  });

  it("removes successfully-deleted documents from state", async () => {
    bulkDeleteDocumentsMock.mockResolvedValue({
      succeeded: ["a", "b"],
      failed: [],
      errors: [],
    });

    const result = await useDocumentStore.getState().bulkDelete(["a", "b"]);

    expect(bulkDeleteDocumentsMock).toHaveBeenCalledWith(["a", "b"]);
    expect(result.succeeded).toEqual(["a", "b"]);

    const docs = useDocumentStore.getState().documents;
    expect(docs.map((d) => d.id)).toEqual(["c"]);
  });

  it("retains documents that failed to delete", async () => {
    bulkDeleteDocumentsMock.mockResolvedValue({
      succeeded: ["a"],
      failed: ["b"],
      errors: ["b: boom"],
    });

    await useDocumentStore.getState().bulkDelete(["a", "b"]);

    const docs = useDocumentStore.getState().documents;
    // 'a' removed; 'b' and 'c' survive.
    expect(docs.map((d) => d.id).sort()).toEqual(["b", "c"]);
  });

  it("clears currentDocument when it was among the deleted", async () => {
    useDocumentStore.setState({ currentDocument: makeDoc("a") });
    bulkDeleteDocumentsMock.mockResolvedValue({
      succeeded: ["a"],
      failed: [],
      errors: [],
    });

    await useDocumentStore.getState().bulkDelete(["a"]);

    expect(useDocumentStore.getState().currentDocument).toBeNull();
  });

  it("is a no-op for an empty id list", async () => {
    const result = await useDocumentStore.getState().bulkDelete([]);

    expect(bulkDeleteDocumentsMock).not.toHaveBeenCalled();
    expect(result.succeeded).toEqual([]);
    expect(useDocumentStore.getState().documents).toHaveLength(3);
  });
});

describe("documentStore.hydrateDocument", () => {
  beforeEach(() => {
    getDocumentMock.mockReset();
    useDocumentStore.setState({
      documents: [{ ...makeDoc("summary"), content: undefined }],
      currentDocument: null,
    });
  });

  it("replaces a content-free startup summary with the full document", async () => {
    const full = { ...makeDoc("summary"), content: "Persisted browser article body." };
    getDocumentMock.mockResolvedValue(full);

    const hydrated = await useDocumentStore.getState().hydrateDocument("summary");

    expect(getDocumentMock).toHaveBeenCalledWith("summary");
    expect(hydrated?.content).toBe("Persisted browser article body.");
    expect(useDocumentStore.getState().documents[0].content).toBe("Persisted browser article body.");
  });

  it("does not replace a different active document when hydration completes late", async () => {
    let resolveHydration!: (doc: Document) => void;
    getDocumentMock.mockReturnValue(new Promise<Document>((resolve) => {
      resolveHydration = resolve;
    }));
    useDocumentStore.setState({ currentDocument: makeDoc("active") });

    const pending = useDocumentStore.getState().hydrateDocument("summary");
    resolveHydration({ ...makeDoc("summary"), content: "Late body" });
    await pending;

    expect(useDocumentStore.getState().currentDocument?.id).toBe("active");
    expect(useDocumentStore.getState().documents[0].content).toBe("Late body");
  });
});

describe("documentStore.loadDocuments", () => {
  beforeEach(() => {
    getDocumentsMock.mockReset();
    collectionStoreState.activeCollectionId = null;
    useDocumentStore.setState({ documents: [] });
  });

  it("discards a response for a collection the user has since switched away from", async () => {
    // Simulate: switch to collection B (slow fetch in flight) then quickly
    // switch back to A (fast fetch, resolves first and repopulates state).
    // B's stale response landing afterwards must not blend its documents
    // back in — that's the bug where switching back to the original
    // collection appeared to silently fail.
    collectionStoreState.activeCollectionId = "col-b";
    let resolveB!: (docs: Document[]) => void;
    getDocumentsMock.mockReturnValueOnce(
      new Promise<Document[]>((resolve) => {
        resolveB = resolve;
      }),
    );
    const pendingB = useDocumentStore.getState().loadDocuments();

    collectionStoreState.activeCollectionId = "col-a";
    getDocumentsMock.mockResolvedValueOnce([{ ...makeDoc("doc-a"), collectionId: "col-a" }]);
    await useDocumentStore.getState().loadDocuments();

    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["doc-a"]);

    resolveB([{ ...makeDoc("doc-b"), collectionId: "col-b" }]);
    await pendingB;

    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["doc-a"]);
  });

  it("does not replace hydrated article content with a lightweight library summary", async () => {
    const hydrated = {
      ...makeDoc("article"),
      title: "Old title",
      fileType: "html" as const,
      content: "Persisted article text",
      contentHash: "content-hash",
      metadata: {
        source: "browser_extension",
        articleHtml: "<article><h2>Structured article</h2></article>",
      },
    };
    useDocumentStore.setState({
      documents: [hydrated],
      currentDocument: hydrated,
    });
    getDocumentsMock.mockResolvedValue([
      {
        ...makeDoc("article"),
        title: "Fresh summary title",
        fileType: "html",
        content: undefined,
        contentHash: undefined,
        metadata: undefined,
      },
    ]);

    await useDocumentStore.getState().loadDocuments();

    const article = useDocumentStore.getState().documents[0];
    expect(article.title).toBe("Fresh summary title");
    expect(article.content).toBe("Persisted article text");
    expect(article.contentHash).toBe("content-hash");
    expect(article.metadata?.articleHtml).toContain("<h2>Structured article</h2>");
  });
});

describe("documentStore.importFromFolder", () => {
  beforeEach(() => {
    pickFolderDocumentsMock.mockReset();
    importDocumentMock.mockReset();
    loadDocumentsMock.mockReset();
    emitFeedbackMock.mockClear();
    useDocumentStore.setState({ documents: [] });
  });

  it("imports all staged files returned by the folder picker", async () => {
    pickFolderDocumentsMock.mockResolvedValue([
      { path: "/imports/Sci-Fi/Dune.epub", relativePath: "Sci-Fi/Dune.epub", fileName: "Dune.epub" },
      { path: "/imports/guide.pdf", relativePath: "guide.pdf", fileName: "guide.pdf" },
    ]);
    importDocumentMock.mockImplementation(async (filePath: string) =>
      makeDoc(filePath.split("/").pop() || filePath)
    );
    loadDocumentsMock.mockResolvedValue(undefined);

    const result = await useDocumentStore.getState().importFromFolder();

    expect(pickFolderDocumentsMock).toHaveBeenCalledWith();
    expect(importDocumentMock).toHaveBeenCalledTimes(2);
    expect(importDocumentMock).toHaveBeenCalledWith("/imports/Sci-Fi/Dune.epub", null);
    expect(importDocumentMock).toHaveBeenCalledWith("/imports/guide.pdf", null);
    expect(result).toHaveLength(2);
    expect(emitFeedbackMock).toHaveBeenCalledWith("import.completed", expect.objectContaining({
      documentCount: 2,
      extractCount: 0,
      title: "Import complete",
    }));
  });

  it("returns an empty list and toasts when the folder has no supported files", async () => {
    pickFolderDocumentsMock.mockResolvedValue([]);

    const result = await useDocumentStore.getState().importFromFolder();

    expect(pickFolderDocumentsMock).toHaveBeenCalled();
    expect(importDocumentMock).not.toHaveBeenCalled();
    expect(result).toEqual([]);
    expect(useDocumentStore.getState().isImporting).toBe(false);
    expect(emitFeedbackMock).toHaveBeenCalledWith("import.completed", expect.objectContaining({
      documentCount: 0,
      title: "No files found",
    }));
  });
});
