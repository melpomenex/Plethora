import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudiobookImportDialog } from "../AudiobookImportDialog";

const mocks = vi.hoisted(() => ({
  pickFolderDocuments: vi.fn(),
  openFilePicker: vi.fn(),
  importMultipartAudiobook: vi.fn(),
  parseAudiobookMetadata: vi.fn(),
  searchAudiobookCover: vi.fn().mockResolvedValue([]),
  extractAudioCoverArt: vi.fn().mockResolvedValue(null),
  searchAudiobookMetadata: vi.fn().mockResolvedValue([]),
  loadDocuments: vi.fn(),
  importFromFiles: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  pickFolderDocuments: mocks.pickFolderDocuments,
  openFilePicker: mocks.openFilePicker,
  pickFilesMobile: vi.fn().mockResolvedValue([]),
  importDocumentFromFileStreamed: vi.fn(),
  updateDocument: vi.fn(),
}));

vi.mock("../../../api/audiobooks", async () => {
  const actual = await vi.importActual<typeof import("../../../api/audiobooks")>("../../../api/audiobooks");
  return {
    ...actual,
    parseAudiobookMetadata: mocks.parseAudiobookMetadata,
    searchAudiobookCover: mocks.searchAudiobookCover,
    extractAudioCoverArt: mocks.extractAudioCoverArt,
    searchAudiobookMetadata: mocks.searchAudiobookMetadata,
    importMultipartAudiobook: mocks.importMultipartAudiobook,
  };
});

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => true,
    isNativeMobile: () => false,
  };
});

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => false,
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: () => ({
    loadDocuments: mocks.loadDocuments,
    importFromFiles: mocks.importFromFiles,
  }),
}));

vi.mock("../../../stores/collectionStore", () => ({
  useCollectionStore: {
    getState: () => ({ activeCollectionId: "test-collection" }),
  },
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: mocks.showSuccess,
    error: mocks.showError,
    info: mocks.showInfo,
  }),
}));

describe("AudiobookImportDialog directory & multi-part import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.parseAudiobookMetadata.mockResolvedValue({
      title: "",
      author: "",
      duration: 300,
    });
    mocks.importMultipartAudiobook.mockResolvedValue({
      document: { id: "doc-123", title: "Dune", file_type: "audio" },
      deduplicated: false,
    });
  });

  it("initializes chapters and defaults to single combined book when directory is picked", async () => {
    mocks.pickFolderDocuments.mockResolvedValue([
      { path: "/audio/Frank Herbert - Dune/01 - Prologue.mp3", fileName: "01 - Prologue.mp3" },
      { path: "/audio/Frank Herbert - Dune/02 - The Desert.mp3", fileName: "02 - The Desert.mp3" },
    ]);

    render(<AudiobookImportDialog isOpen={true} onClose={vi.fn()} />);

    // Click "Directory"
    const dirBtn = screen.getByText("Directory");
    fireEvent.click(dirBtn);

    await waitFor(() => {
      expect(screen.getByText("Book Details")).toBeInTheDocument();
    });

    // Check that title and author are derived from folder name
    expect(screen.getByDisplayValue("Dune")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Frank Herbert")).toBeInTheDocument();

    // Check chapters review section
    expect(screen.getByText(/Chapters & Parts \(2\)/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Prologue")).toBeInTheDocument();
    expect(screen.getByDisplayValue("The Desert")).toBeInTheDocument();

    // Check mode toggle is visible in header
    expect(screen.getByText("Combine into single book")).toBeInTheDocument();
    expect(screen.getByText("Separate audiobooks")).toBeInTheDocument();
  });

  it("switches mode between single combined book and separate batch items", async () => {
    mocks.pickFolderDocuments.mockResolvedValue([
      { path: "/audio/Frank Herbert - Dune/01 - Prologue.mp3", fileName: "01 - Prologue.mp3" },
      { path: "/audio/Frank Herbert - Dune/02 - The Desert.mp3", fileName: "02 - The Desert.mp3" },
    ]);

    render(<AudiobookImportDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Directory"));

    await waitFor(() => {
      expect(screen.getByText("Combine into single book")).toBeInTheDocument();
    });

    // Click "Separate audiobooks"
    fireEvent.click(screen.getByText("Separate audiobooks"));

    await waitFor(() => {
      expect(screen.getByText("Import Audiobooks")).toBeInTheDocument();
      expect(screen.getByText("01 - Prologue.mp3")).toBeInTheDocument();
      expect(screen.getByText("02 - The Desert.mp3")).toBeInTheDocument();
    });

    // Switch back to "Combine into single book"
    fireEvent.click(screen.getByText("Combine into single book"));

    await waitFor(() => {
      expect(screen.getByText("Book Details")).toBeInTheDocument();
      expect(screen.getByText(/Chapters & Parts \(2\)/)).toBeInTheDocument();
    });
  });

  it("allows editing chapter titles, reordering, and track exclusion", async () => {
    mocks.pickFolderDocuments.mockResolvedValue([
      { path: "/audio/Dune/01 - Prologue.mp3", fileName: "01 - Prologue.mp3" },
      { path: "/audio/Dune/02 - Desert.mp3", fileName: "02 - Desert.mp3" },
      { path: "/audio/Dune/03 - Promo.mp3", fileName: "03 - Promo.mp3" },
    ]);

    render(<AudiobookImportDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Directory"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Prologue")).toBeInTheDocument();
    });

    // Edit chapter title
    const prologueInput = screen.getByDisplayValue("Prologue");
    fireEvent.change(prologueInput, { target: { value: "Introduction" } });
    expect(screen.getByDisplayValue("Introduction")).toBeInTheDocument();

    // Reorder: Move second chapter up
    const moveUpBtns = screen.getAllByTitle("Move up");
    fireEvent.click(moveUpBtns[1]); // Move Desert up

    // Desert should now be first, Introduction second
    const inputs = screen.getAllByPlaceholderText(/Chapter \d/);
    expect((inputs[0] as HTMLInputElement).value).toBe("Desert");
    expect((inputs[1] as HTMLInputElement).value).toBe("Introduction");

    // Exclude track 3 (Promo)
    const excludeBtns = screen.getAllByTitle("Exclude track");
    fireEvent.click(excludeBtns[2]);

    await waitFor(() => {
      expect(screen.getByText(/Chapters & Parts \(2\)/)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("03 - Promo.mp3")).not.toBeInTheDocument();
  });

  it("passes customized chapter titles and persists cumulative chapter timeline on import", async () => {
    mocks.pickFolderDocuments.mockResolvedValue([
      { path: "/audio/Dune/01 - Prologue.mp3", fileName: "01 - Prologue.mp3" },
      { path: "/audio/Dune/02 - Desert.mp3", fileName: "02 - Desert.mp3" },
    ]);

    render(<AudiobookImportDialog isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("Directory"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Prologue")).toBeInTheDocument();
    });

    // Customize title
    const input = screen.getByDisplayValue("Prologue");
    fireEvent.change(input, { target: { value: "Custom Prologue" } });

    // Click Next: Transcript
    fireEvent.click(screen.getByText(/Next: Transcript/));

    await waitFor(() => {
      expect(screen.getByText("Next: Confirm")).toBeInTheDocument();
    });

    // Click Next: Confirm
    fireEvent.click(screen.getByText(/Next: Confirm/));

    await waitFor(() => {
      expect(screen.getByText("1. Custom Prologue")).toBeInTheDocument();
      expect(screen.getByText("2. Desert")).toBeInTheDocument();
    });

    // Click Import
    const importBtn = screen.getByRole("button", { name: /Import Audiobook/i });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mocks.importMultipartAudiobook).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [
            expect.objectContaining({ path: "/audio/Dune/01 - Prologue.mp3", title: "Custom Prologue" }),
            expect.objectContaining({ path: "/audio/Dune/02 - Desert.mp3", title: "Desert" }),
          ],
        })
      );
    });

    // Verify localStorage has persisted chapters with cumulative timeline
    const stored = JSON.parse(localStorage.getItem("audiobook-doc-123") || "{}");
    expect(stored.chapters).toHaveLength(2);
    expect(stored.chapters[0].title).toBe("Custom Prologue");
    expect(stored.chapters[0].startTime).toBe(0);
    expect(stored.chapters[1].title).toBe("Desert");
  });
});
