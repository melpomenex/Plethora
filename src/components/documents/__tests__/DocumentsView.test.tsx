import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { DocumentsView } from "../DocumentsView";
import type { Document } from "../../../types/document";

const modalMock = vi.hoisted(() => ({
  prompt: vi.fn<(message: string, defaultValue?: string, title?: string) => Promise<string | null>>(),
  confirm: vi.fn(),
  alert: vi.fn<(message: string, title?: string) => Promise<boolean>>().mockResolvedValue(true),
  // The priority popup opens via modal.custom; resolving true simulates "Apply".
  custom: vi.fn((): Promise<boolean> => Promise.resolve(true)),
}));

const documentsApiMock = vi.hoisted(() => ({
  bulkMoveDocumentsToCollection: vi.fn(),
  updateDocumentPriority: vi.fn(),
  bulkSetDocumentPriority: vi.fn(async () => ({ succeeded: [], failed: [], errors: [] })),
}));

const collectionsMock = vi.hoisted(() => ({
  collections: [{ id: "col-1", name: "Reading" }],
  createCollection: vi.fn(async (name: string) => ({ id: "col-new", name })),
  activeCollectionId: "col-1",
  switchCollection: vi.fn(),
}));

const mockStore = vi.hoisted(() => ({
  documents: [
    {
      id: "doc-1",
      title: "Priority Doc",
      filePath: "/tmp/priority.pdf",
      fileType: "pdf",
      tags: ["History", "Archive", "Reading", "Extra"],
      dateAdded: "2024-01-01T00:00:00.000Z",
      dateModified: "2024-01-02T00:00:00.000Z",
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 4,
      prioritySlider: 0,
      priorityScore: 85,
      isArchived: false,
      isFavorite: false,
    },
    {
      id: "doc-2",
      title: "Secondary Doc",
      filePath: "/tmp/secondary.epub",
      fileType: "epub",
      tags: ["Science"],
      dateAdded: "2024-01-03T00:00:00.000Z",
      dateModified: "2024-01-03T00:00:00.000Z",
      extractCount: 2,
      learningItemCount: 5,
      priorityRating: 2,
      prioritySlider: 0,
      priorityScore: 40,
      isArchived: false,
      isFavorite: false,
    },
  ] as Document[],
  isLoading: false,
  isImporting: false,
  importProgress: { current: 0, total: 0 },
  error: null,
  loadDocuments: vi.fn(),
  openFilePickerAndImport: vi.fn(),
  importFromFiles: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: Object.assign(() => mockStore, {
    getState: () => mockStore,
    subscribe: vi.fn(),
  }),
}));

vi.mock("../../common/Modal", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useModal: () => modalMock,
}));

vi.mock("../../../api/documents", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bulkMoveDocumentsToCollection: documentsApiMock.bulkMoveDocumentsToCollection,
  updateDocumentPriority: documentsApiMock.updateDocumentPriority,
  bulkSetDocumentPriority: documentsApiMock.bulkSetDocumentPriority,
}));

vi.mock("../../../stores/collectionStore", () => ({
  useCollectionStore: Object.assign(
    (selector: (state: typeof collectionsMock) => unknown) => selector(collectionsMock),
    { getState: () => collectionsMock, subscribe: vi.fn() },
  ),
}));

vi.mock("../../../lib/pwa", () => ({
  getDeviceInfo: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isPWA: false,
    isOnline: true,
    pixelRatio: 1,
    screenWidth: 1200,
    screenHeight: 800,
  }),
}));

beforeEach(() => {
  window.localStorage.clear();
  mockStore.loadDocuments.mockClear();
  mockStore.updateDocument.mockClear();
  modalMock.prompt.mockReset();
  documentsApiMock.bulkMoveDocumentsToCollection.mockReset();
  documentsApiMock.updateDocumentPriority.mockReset();
  documentsApiMock.bulkSetDocumentPriority.mockReset();
  documentsApiMock.bulkSetDocumentPriority.mockResolvedValue({
    succeeded: ["doc-1"],
    failed: [],
    errors: [],
  });
  modalMock.custom.mockReset();
  modalMock.custom.mockResolvedValue(true);
  collectionsMock.createCollection.mockClear();
});

describe("DocumentsView", () => {
  it("restores list mode from storage", () => {
    window.localStorage.setItem("documentsViewMode", "list");
    render(<DocumentsView enableYouTubeImport={false} />);
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.queryByText("In Priority Queue")).toBeNull();
  });

  it("updates inspector on selection", () => {
    render(<DocumentsView enableYouTubeImport={false} />);
    fireEvent.click(screen.getAllByText("Priority Doc")[0]);
    expect(screen.getAllByText("Priority Doc").length).toBeGreaterThan(0);
    expect(screen.getByText("Inspector")).toBeInTheDocument();
  });

  it("adjusts the active document priority with the registered shortcut", async () => {
    // The shortcut now opens the priority popup; resolving the modal to true
    // applies the seeded slider value for the active document.
    documentsApiMock.updateDocumentPriority.mockResolvedValue({
      id: "doc-1",
      priorityRating: 5,
      prioritySlider: 90,
      priorityScore: 95,
    });
    render(<DocumentsView enableYouTubeImport={false} />);
    fireEvent.click(screen.getAllByText("Priority Doc")[0]);

    fireEvent.keyDown(window, { key: "p", code: "KeyP", altKey: true });

    await waitFor(() => expect(modalMock.custom).toHaveBeenCalled());
    await waitFor(() =>
      expect(documentsApiMock.updateDocumentPriority).toHaveBeenCalledWith(
        "doc-1",
        0, // rating is derived server-side; the popup passes 0 to mean "slider-authoritative"
        expect.any(Number),
      ),
    );
  });

  it("supports reverse shift-click ranges in list mode", () => {
    window.localStorage.setItem("documentsViewMode", "list");
    render(<DocumentsView enableYouTubeImport={false} />);

    fireEvent.click(screen.getAllByText("Secondary Doc")[0]);
    fireEvent.click(screen.getAllByText("Priority Doc")[0], { shiftKey: true });

    const rowCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>(".documents-content .border.rounded-lg input[type=checkbox]")
    );
    expect(rowCheckboxes).toHaveLength(2);
    expect(rowCheckboxes.every((checkbox) => checkbox.checked)).toBe(true);
  });

  it("clears a selected document when its checkbox is clicked again", () => {
    window.localStorage.setItem("documentsViewMode", "list");
    render(<DocumentsView enableYouTubeImport={false} />);

    const checkbox = screen.getByLabelText("Select Priority Doc") as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("dismisses the bulk action bar when the last document is deselected", () => {
    window.localStorage.setItem("documentsViewMode", "list");
    render(<DocumentsView enableYouTubeImport={false} />);

    const checkbox = screen.getByLabelText("Select Priority Doc") as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(screen.getByText("Select All")).toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(screen.queryByText("Select All")).toBeNull();
  });

  it("adds a second document via its checkbox without clearing the first", () => {
    window.localStorage.setItem("documentsViewMode", "list");
    render(<DocumentsView enableYouTubeImport={false} />);

    const first = screen.getByLabelText("Select Priority Doc") as HTMLInputElement;
    const second = screen.getByLabelText("Select Secondary Doc") as HTMLInputElement;

    fireEvent.click(first);
    fireEvent.click(second);

    expect(first.checked).toBe(true);
    expect(second.checked).toBe(true);
  });

  // These handlers used window.prompt(), which the desktop WebView suppresses.
  describe("bulk actions", () => {
    function selectFirstDocument() {
      window.localStorage.setItem("documentsViewMode", "list");
      render(<DocumentsView enableYouTubeImport={false} />);
      fireEvent.click(screen.getByLabelText("Select Priority Doc"));
    }

    /** "Reprioritize"/"Tag" also appear outside the bulk bar, so scope to it. */
    function clickBulkAction(label: string) {
      const bar = screen.getByText("Select All").closest("div")!;
      const button = within(bar).getByText(label);
      fireEvent.click(button);
    }

    it("tags every selected document through the in-app prompt", async () => {
      modalMock.prompt.mockResolvedValue("Physics");
      selectFirstDocument();

      clickBulkAction("Tag");

      await waitFor(() =>
        expect(mockStore.updateDocument).toHaveBeenCalledWith(
          "doc-1",
          expect.objectContaining({ tags: expect.arrayContaining(["Physics"]) }),
        )
      );
    });

    it("leaves documents untouched when the tag prompt is dismissed", async () => {
      modalMock.prompt.mockResolvedValue(null);
      selectFirstDocument();

      clickBulkAction("Tag");

      await waitFor(() => expect(modalMock.prompt).toHaveBeenCalled());
      expect(mockStore.updateDocument).not.toHaveBeenCalled();
      // Dismissing must not clear the selection.
      expect((screen.getByLabelText("Select Priority Doc") as HTMLInputElement).checked).toBe(true);
    });

    it("reprioritizes through the priority popup", async () => {
      // Bulk reprioritize opens the popup; resolving true applies the seeded
      // slider value to every selected doc via bulk_set_document_priority.
      selectFirstDocument();

      clickBulkAction("Reprioritize");

      await waitFor(() =>
        expect(documentsApiMock.bulkSetDocumentPriority).toHaveBeenCalledWith(
          ["doc-1"],
          expect.any(Number),
        ),
      );
    });

    it("cancelling the priority popup changes nothing", async () => {
      modalMock.custom.mockResolvedValueOnce(false);
      selectFirstDocument();

      clickBulkAction("Reprioritize");

      await waitFor(() => expect(modalMock.custom).toHaveBeenCalled());
      expect(documentsApiMock.bulkSetDocumentPriority).not.toHaveBeenCalled();
    });

    it("moves documents into an existing collection", async () => {
      modalMock.prompt.mockResolvedValue("Reading");
      documentsApiMock.bulkMoveDocumentsToCollection.mockResolvedValue({
        succeeded: ["doc-1"],
        failed: [],
        errors: [],
      });
      selectFirstDocument();

      clickBulkAction("Move");

      await waitFor(() =>
        expect(documentsApiMock.bulkMoveDocumentsToCollection).toHaveBeenCalledWith(["doc-1"], "col-1")
      );
      expect(collectionsMock.createCollection).not.toHaveBeenCalled();
    });

    it("creates the collection first when the target does not exist", async () => {
      modalMock.prompt.mockResolvedValue("Brand New");
      documentsApiMock.bulkMoveDocumentsToCollection.mockResolvedValue({
        succeeded: ["doc-1"],
        failed: [],
        errors: [],
      });
      selectFirstDocument();

      clickBulkAction("Move");

      await waitFor(() => expect(collectionsMock.createCollection).toHaveBeenCalledWith("Brand New"));
      expect(documentsApiMock.bulkMoveDocumentsToCollection).toHaveBeenCalledWith(["doc-1"], "col-new");
    });

    it("releases the selection after a completed move", async () => {
      modalMock.prompt.mockResolvedValue("Reading");
      documentsApiMock.bulkMoveDocumentsToCollection.mockResolvedValue({
        succeeded: ["doc-1"],
        failed: [],
        errors: [],
      });
      selectFirstDocument();

      clickBulkAction("Move");

      await waitFor(() => expect(screen.queryByText("Select All")).toBeNull());
    });
  });

});
