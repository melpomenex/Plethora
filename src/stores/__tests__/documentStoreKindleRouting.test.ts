import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Verifies that `documentStore.importFromFiles` detects Kindle clippings
 * files by filename and routes them to the global Kindle import dialog store
 * instead of importing them through the generic single-doc pipeline (which
 * would land them as unreadable `.txt` blobs). This is the central frontend
 * chokepoint that covers drag & drop, the main file picker, and folder
 * import.
 */

// Mock the API layer so we can assert call counts.
const importDocumentMock = vi.fn();
const pickFolderDocumentsMock = vi.fn();
const loadDocumentsMock = vi.fn();
vi.mock("../../api/documents", () => ({
  importDocument: (...args: unknown[]) => importDocumentMock(...args),
  pickFolderDocuments: (...args: unknown[]) => pickFolderDocumentsMock(...args),
  loadDocuments: (...args: unknown[]) => loadDocumentsMock(...args),
}));

vi.mock("../../api/segmentation", () => ({ segmentDocument: vi.fn() }));
vi.mock("../settingsStore", () => ({
  useSettingsStore: { getState: () => ({ settings: { documents: {} } }) },
}));
vi.mock("../collectionStore", () => ({
  useCollectionStore: { getState: () => ({ activeCollectionId: null }) },
}));
vi.mock("../../utils/documentImport", () => ({
  importFromUrl: vi.fn(),
  importFromArxiv: vi.fn(),
}));
vi.mock("../../lib/tauri", () => ({ listen: vi.fn(), isTauri: () => false }));
vi.mock("../../lib/feedback", () => ({
  emitFeedback: vi.fn().mockResolvedValue({ channels: [] }),
}));
vi.mock("../../components/common/Toast", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
  ToastType: { Success: "success", Error: "error", Info: "info" },
}));

import { useDocumentStore } from "../documentStore";
import { useKindleImportDialogStore } from "../kindleImportDialogStore";

describe("documentStore.importFromFiles Kindle routing", () => {
  beforeEach(() => {
    importDocumentMock.mockReset();
    pickFolderDocumentsMock.mockReset();
    loadDocumentsMock.mockReset();
    useKindleImportDialogStore.getState().close();
  });

  it("opens the Kindle import dialog for a My Clippings.txt drop and does NOT call the generic importer", async () => {
    const kindlePath = "/Volumes/Kindle/documents/My Clippings.txt";
    importDocumentMock.mockResolvedValue({ id: "k1" });

    const result = await useDocumentStore
      .getState()
      .importFromFiles([kindlePath]);

    // The generic single-doc importer must not be touched for Kindle files.
    expect(importDocumentMock).not.toHaveBeenCalled();
    // The dialog store should now be holding the path.
    expect(useKindleImportDialogStore.getState().filePath).toBe(kindlePath);
    // And importFromFiles should return [] (the dialog takes over async).
    expect(result).toEqual([]);
  });

  it("routes a normal .txt file through the generic importer and leaves the dialog closed", async () => {
    const plainPath = "/tmp/notes.txt";
    importDocumentMock.mockResolvedValue({
      id: "doc-1",
      title: "notes",
      filePath: plainPath,
      fileType: "markdown",
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
    });

    await useDocumentStore.getState().importFromFiles([plainPath]);

    expect(importDocumentMock).toHaveBeenCalledTimes(1);
    expect(importDocumentMock).toHaveBeenCalledWith(plainPath, null);
    expect(useKindleImportDialogStore.getState().filePath).toBeNull();
  });

  it("handles a mixed batch: Kindle file routed to dialog, others to the generic importer", async () => {
    const kindlePath = "/home/u/My Clippings.txt";
    const pdfPath = "/tmp/paper.pdf";
    importDocumentMock.mockResolvedValue({
      id: "doc-pdf",
      title: "paper",
      filePath: pdfPath,
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
    });

    const result = await useDocumentStore
      .getState()
      .importFromFiles([kindlePath, pdfPath]);

    // The PDF goes through the generic importer exactly once; the Kindle file
    // does not.
    expect(importDocumentMock).toHaveBeenCalledTimes(1);
    expect(importDocumentMock).toHaveBeenCalledWith(pdfPath, null);
    // The Kindle dialog is open for the Kindle path.
    expect(useKindleImportDialogStore.getState().filePath).toBe(kindlePath);
    // The returned array reflects only the generic import (the PDF).
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("doc-pdf");
  });

  it("registers a plain-text fallback when the dialog rejects the file", async () => {
    // The fallback hook is what the dialog invokes if the content sniff says
    // "not Kindle". We can't easily simulate the dialog firing it from here,
    // but we can pin down that the hook is wired through the store.
    const kindlePath = "/home/u/My Clippings.txt";
    await useDocumentStore.getState().importFromFiles([kindlePath]);

    expect(useKindleImportDialogStore.getState().filePath).toBe(kindlePath);
    expect(useKindleImportDialogStore.getState().onFallbackToGenericImport).toBeInstanceOf(
      Function,
    );
  });
});

describe("documentStore.importFromFile (singular) Kindle routing", () => {
  beforeEach(() => {
    importDocumentMock.mockReset();
    useKindleImportDialogStore.getState().close();
  });

  it("opens the Kindle dialog and rejects with a typed signal", async () => {
    const kindlePath = "/k/My Clippings.txt";
    await expect(
      useDocumentStore.getState().importFromFile(kindlePath),
    ).rejects.toThrow(/KINDLE_DIALOG_OPENED/);

    expect(importDocumentMock).not.toHaveBeenCalled();
    expect(useKindleImportDialogStore.getState().filePath).toBe(kindlePath);
  });
});
