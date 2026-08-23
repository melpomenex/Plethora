import { beforeEach, describe, expect, it, vi } from "vitest";

const importDocumentMock = vi.fn();
const emitFeedbackMock = vi.hoisted(() => vi.fn().mockResolvedValue({ channels: [] }));

vi.mock("../../api/documents", () => ({
  importDocument: (...args: unknown[]) => importDocumentMock(...args),
  bulkDeleteDocuments: vi.fn(),
  pickFolderDocuments: vi.fn(),
  loadDocuments: vi.fn(),
  getDocuments: vi.fn().mockResolvedValue([]),
  getDocument: vi.fn(),
}));

vi.mock("../../api/segmentation", () => ({ segmentDocument: vi.fn().mockResolvedValue(0) }));
vi.mock("../settingsStore", () => ({
  useSettingsStore: { getState: () => ({ settings: { documents: { autoProcessOnImport: false } } }) },
}));
vi.mock("../collectionStore", () => ({
  useCollectionStore: { getState: () => ({ activeCollectionId: null }) },
}));
vi.mock("../../utils/documentImport", () => ({
  importFromUrl: vi.fn(),
  importFromArxiv: vi.fn(),
}));
vi.mock("../../lib/tauri", () => ({ listen: vi.fn(), isTauri: () => false, isNativeMobile: () => false }));
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

function createMockDoc(id: string, title: string): Document {
  return {
    id,
    title,
    filePath: `/staged/${id}.pdf`,
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
  };
}

describe("Document Import Hardening & State Resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({
      documents: [],
      isImporting: false,
      isSegmenting: false,
      importProgress: { current: 0, total: 0 },
      error: null,
    });
  });

  it("resets isImporting and isSegmenting to false on unexpected import throw", async () => {
    importDocumentMock.mockRejectedValueOnce(new Error("Disk corrupted"));

    await expect(
      useDocumentStore.getState().importGenericFile("/staged/corrupted.pdf")
    ).rejects.toThrow("Disk corrupted");

    const state = useDocumentStore.getState();
    expect(state.isImporting).toBe(false);
    expect(state.isSegmenting).toBe(false);
    expect(state.error).toBe("Disk corrupted");
  });

  it("handles multi-file imports with partial failures without leaving stuck states", async () => {
    const doc1 = createMockDoc("doc-1", "Valid Doc");
    importDocumentMock
      .mockResolvedValueOnce(doc1)
      .mockRejectedValueOnce(new Error("File 2 broken"));

    const result = await useDocumentStore
      .getState()
      .importGenericFiles(["/staged/valid.pdf", "/staged/broken.pdf"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("doc-1");

    const state = useDocumentStore.getState();
    expect(state.isImporting).toBe(false);
    expect(state.isSegmenting).toBe(false);
    expect(state.documents).toHaveLength(1);
  });

  it("successfully imports and tracks progress across valid files", async () => {
    const doc1 = createMockDoc("doc-1", "First");
    const doc2 = createMockDoc("doc-2", "Second");
    importDocumentMock.mockResolvedValueOnce(doc1).mockResolvedValueOnce(doc2);

    const result = await useDocumentStore
      .getState()
      .importGenericFiles(["/staged/first.pdf", "/staged/second.pdf"]);

    expect(result).toHaveLength(2);
    const state = useDocumentStore.getState();
    expect(state.isImporting).toBe(false);
    expect(state.documents).toHaveLength(2);
    expect(state.importProgress.current).toBe(2);
  });
});
