import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Folder import becomes semantic BEFORE persistence (openspec change
 * fix-multipart-audiobook-language-gating-and-entitlement-persistence): a
 * picked folder of chapter files produces ONE logical audiobook via the
 * atomic multipart command — never N documents — while non-audio files and
 * standalone audio keep flowing through the ordinary per-file loop.
 */

const importDocumentMock = vi.fn();
const pickFolderDocumentsMock = vi.fn();
const importMultipartMock = vi.fn();
vi.mock("../../api/documents", () => ({
  importDocument: (...args: unknown[]) => importDocumentMock(...args),
  pickFolderDocuments: (...args: unknown[]) => pickFolderDocumentsMock(...args),
  loadDocuments: vi.fn(),
}));
vi.mock("../../api/audiobooks", () => ({
  isAudiobookFile: (p: string) => /\.(mp3|m4b|m4a|aac|ogg|flac|opus|wav|wma)$/i.test(p),
  importMultipartAudiobook: (...args: unknown[]) => importMultipartMock(...args),
  enrichAudiobookDocument: vi.fn(),
}));
vi.mock("../../api/segmentation", () => ({ segmentDocument: vi.fn() }));
vi.mock("../settingsStore", () => ({
  useSettingsStore: { getState: () => ({ settings: { documents: {} } }) },
}));
vi.mock("../collectionStore", () => ({
  useCollectionStore: { getState: () => ({ activeCollectionId: null }) },
}));
vi.mock("../smartTaggingQueueStore", () => ({
  useSmartTaggingQueueStore: { getState: () => ({ enqueue: vi.fn(), enqueueBatch: vi.fn() }) },
}));
vi.mock("../../utils/documentImport", () => ({
  importFromUrl: vi.fn(),
  importArxiv: vi.fn(),
}));
vi.mock("../../lib/tauri", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  invoke: vi.fn(),
  isTauri: () => true,
  isNativeMobile: () => false,
  isWebMode: () => false,
  isTauriRuntimeTarget: () => true,
}));
vi.mock("../../lib/feedback", () => ({
  emitFeedback: vi.fn().mockResolvedValue({ channels: [] }),
}));
vi.mock("../../components/common/Toast", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
  ToastType: { Success: "success", Error: "error", Info: "info" },
}));

import { useDocumentStore } from "../documentStore";

describe("documentStore.importFromFolder semantic planning", () => {
  beforeEach(() => {
    importDocumentMock.mockReset();
    pickFolderDocumentsMock.mockReset();
    importMultipartMock.mockReset();
    useDocumentStore.setState({ documents: [], isImporting: false, error: null });
  });

  it("imports a book folder as ONE audiobook via the multipart command", async () => {
    pickFolderDocumentsMock.mockResolvedValue([
      { path: "/books/The Hobbit/01 - An Unexpected Party.mp3", relativePath: "01 - An Unexpected Party.mp3", fileName: "01 - An Unexpected Party.mp3" },
      { path: "/books/The Hobbit/02 - Roast Mutton.mp3", relativePath: "02 - Roast Mutton.mp3", fileName: "02 - Roast Mutton.mp3" },
      { path: "/books/The Hobbit/03 - A Short Rest.mp3", relativePath: "03 - A Short Rest.mp3", fileName: "03 - A Short Rest.mp3" },
    ]);
    importMultipartMock.mockResolvedValue({
      document: { id: "book-1", title: "The Hobbit", fileType: "audio" },
      editionId: "ed-1",
      sectionCount: 3,
      deduplicated: false,
      attachedToExisting: false,
    });

    const imported = await useDocumentStore.getState().importFromFolder();

    expect(importMultipartMock).toHaveBeenCalledTimes(1);
    const call = importMultipartMock.mock.calls[0][0] as {
      files: Array<{ path: string }>;
      fallbackTitle: string;
    };
    expect(call.files).toHaveLength(3);
    expect(call.fallbackTitle).toBe("The Hobbit");
    // The physical files never hit the per-document importer.
    expect(importDocumentMock).not.toHaveBeenCalled();
    expect(imported).toHaveLength(1);
    expect(useDocumentStore.getState().documents).toHaveLength(1);
  });

  it("separates multiple book folders and passes non-audio files through the ordinary loop", async () => {
    pickFolderDocumentsMock.mockResolvedValue([
      { path: "/a/A/01.mp3", relativePath: "A/01.mp3", fileName: "01.mp3" },
      { path: "/a/A/02.mp3", relativePath: "A/02.mp3", fileName: "02.mp3" },
      { path: "/a/B/01.mp3", relativePath: "B/01.mp3", fileName: "01.mp3" },
      { path: "/a/B/02.mp3", relativePath: "B/02.mp3", fileName: "02.mp3" },
      { path: "/a/notes.pdf", relativePath: "notes.pdf", fileName: "notes.pdf" },
    ]);
    importMultipartMock.mockImplementation(async (opts: { fallbackTitle: string }) => ({
      document: { id: `book-${opts.fallbackTitle}`, title: opts.fallbackTitle, fileType: "audio" },
      editionId: "e",
      sectionCount: 2,
      deduplicated: false,
      attachedToExisting: false,
    }));
    importDocumentMock.mockResolvedValue({ id: "pdf-1", fileType: "pdf" });

    const imported = await useDocumentStore.getState().importFromFolder();

    expect(importMultipartMock).toHaveBeenCalledTimes(2);
    expect(importDocumentMock).toHaveBeenCalledTimes(1);
    expect(importDocumentMock.mock.calls[0][0]).toBe("/a/notes.pdf");
    expect(imported).toHaveLength(3);
  });

  it("imports a mixed folder: one book + standalone audio + document", async () => {
    pickFolderDocumentsMock.mockResolvedValue([
      { path: "/b/Book/01.mp3", relativePath: "Book/01.mp3", fileName: "01.mp3" },
      { path: "/b/Book/02.mp3", relativePath: "Book/02.mp3", fileName: "02.mp3" },
      { path: "/b/solo.mp3", relativePath: "solo.mp3", fileName: "solo.mp3" },
      { path: "/b/paper.pdf", relativePath: "paper.pdf", fileName: "paper.pdf" },
    ]);
    importMultipartMock.mockResolvedValue({
      document: { id: "book-1", title: "Book", fileType: "audio" },
      editionId: "e",
      sectionCount: 2,
      deduplicated: false,
      attachedToExisting: false,
    });
    importDocumentMock.mockResolvedValue({ id: "plain-1", fileType: "audio" });

    const imported = await useDocumentStore.getState().importFromFolder();

    expect(importMultipartMock).toHaveBeenCalledTimes(1);
    // solo.mp3 + paper.pdf go through the ordinary loop.
    expect(importDocumentMock.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "/b/solo.mp3",
      "/b/paper.pdf",
    ]);
    expect(imported).toHaveLength(3);
  });

  it("media attached to an existing synced row still surfaces the document", async () => {
    pickFolderDocumentsMock.mockResolvedValue([
      { path: "/books/The Hobbit/01.mp3", relativePath: "01.mp3", fileName: "01.mp3" },
      { path: "/books/The Hobbit/02.mp3", relativePath: "02.mp3", fileName: "02.mp3" },
    ]);
    importMultipartMock.mockResolvedValue({
      document: { id: "synced-book", title: "The Hobbit", fileType: "audio" },
      editionId: "ed-attached",
      sectionCount: 2,
      deduplicated: true,
      attachedToExisting: true,
    });

    const imported = await useDocumentStore.getState().importFromFolder();

    expect(imported).toHaveLength(1);
    expect(useDocumentStore.getState().documents[0].id).toBe("synced-book");
  });

  it("resets isImporting after a loose multi-file book import with no standalone paths", async () => {
    importMultipartMock.mockResolvedValue({
      document: { id: "book-1", title: "Book Title", fileType: "audio" },
      editionId: "e",
      sectionCount: 3,
      deduplicated: false,
      attachedToExisting: false,
    });

    await useDocumentStore.getState().importFromFiles([
      "/x/Book Title - 01.mp3",
      "/x/Book Title - 02.mp3",
    ]);

    expect(useDocumentStore.getState().isImporting).toBe(false);
  });

  it("a deduplicated re-import adds no document", async () => {
    pickFolderDocumentsMock.mockResolvedValue([
      { path: "/books/The Hobbit/01.mp3", relativePath: "01.mp3", fileName: "01.mp3" },
      { path: "/books/The Hobbit/02.mp3", relativePath: "02.mp3", fileName: "02.mp3" },
    ]);
    importMultipartMock.mockResolvedValue({
      document: { id: "book-1", title: "The Hobbit", fileType: "audio" },
      editionId: "",
      sectionCount: 0,
      deduplicated: true,
      attachedToExisting: false,
    });

    const imported = await useDocumentStore.getState().importFromFolder();

    expect(imported).toHaveLength(0);
    expect(useDocumentStore.getState().documents).toHaveLength(0);
  });

  it("a book import failure does not abort sibling books", async () => {
    pickFolderDocumentsMock.mockResolvedValue([
      { path: "/a/A/01.mp3", relativePath: "A/01.mp3", fileName: "01.mp3" },
      { path: "/a/A/02.mp3", relativePath: "A/02.mp3", fileName: "02.mp3" },
      { path: "/a/B/01.mp3", relativePath: "B/01.mp3", fileName: "01.mp3" },
      { path: "/a/B/02.mp3", relativePath: "B/02.mp3", fileName: "02.mp3" },
    ]);
    importMultipartMock
      .mockRejectedValueOnce(new Error("probe failed"))
      .mockResolvedValueOnce({
        document: { id: "book-b", title: "B", fileType: "audio" },
        editionId: "e",
        sectionCount: 2,
        deduplicated: false,
        attachedToExisting: false,
      });

    const imported = await useDocumentStore.getState().importFromFolder();

    expect(imported).toHaveLength(1);
    expect(imported[0].id).toBe("book-b");
  });
});

describe("documentStore.importFromFiles loose multi-file picks", () => {
  beforeEach(() => {
    importDocumentMock.mockReset();
    importMultipartMock.mockReset();
    useDocumentStore.setState({ documents: [], isImporting: false, error: null });
  });

  it("groups a shared-base multi-file pick into one book", async () => {
    importMultipartMock.mockResolvedValue({
      document: { id: "book-1", title: "Book Title", fileType: "audio" },
      editionId: "e",
      sectionCount: 3,
      deduplicated: false,
      attachedToExisting: false,
    });

    const imported = await useDocumentStore.getState().importFromFiles([
      "/x/Book Title - 01.mp3",
      "/x/Book Title - 02.mp3",
      "/x/Book Title - 03.mp3",
    ]);

    expect(importMultipartMock).toHaveBeenCalledTimes(1);
    expect(importDocumentMock).not.toHaveBeenCalled();
    expect(imported).toHaveLength(1);
  });

  it("unrelated audio files import standalone (no folder semantics)", async () => {
    importDocumentMock.mockResolvedValue({ id: "doc", fileType: "audio" });

    const imported = await useDocumentStore.getState().importFromFiles([
      "/Downloads/a.mp3",
      "/Downloads/b.mp3",
    ]);

    expect(importMultipartMock).not.toHaveBeenCalled();
    expect(importDocumentMock).toHaveBeenCalledTimes(2);
    expect(imported).toHaveLength(2);
  });
});
