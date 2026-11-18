import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AudiobooksTab } from "../AudiobooksTab";
import { useDocumentStore, useTabsStore } from "../../../stores";
import type { Document } from "../../../types/document";

const mockBulkSuspendItems = vi.fn().mockResolvedValue({ succeeded: ["ab-1"], failed: [], errors: [] });
const mockBulkUnsuspendItems = vi.fn().mockResolvedValue({ succeeded: ["ab-1"], failed: [], errors: [] });
const mockModalConfirm = vi.fn().mockResolvedValue(true);
const mockModalPrompt = vi.fn().mockResolvedValue("science");
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("../../../api/audioEditions", () => ({
  listAudioEditions: () => Promise.resolve([]),
  deleteAudioEdition: vi.fn(),
}));

vi.mock("../../../api/queue", () => ({
  bulkSuspendItems: (ids: string[]) => mockBulkSuspendItems(ids),
  bulkUnsuspendItems: (ids: string[]) => mockBulkUnsuspendItems(ids),
}));

vi.mock("../../../components/common/Modal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../components/common/Modal")>();
  return {
    ...actual,
    useModal: () => ({
      confirm: mockModalConfirm,
      alert: vi.fn().mockResolvedValue(true),
      prompt: mockModalPrompt,
    }),
  };
});

vi.mock("../../../components/common/Toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../components/common/Toast")>();
  return {
    ...actual,
    useToast: () => ({
      success: mockToastSuccess,
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  };
});

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    isNativePhone: () => false,
    getPlatform: () => "linux",
    invokeCommand: vi.fn(),
  };
});

describe("AudiobooksTab - Audiobook Card Context Menu", () => {
  const audiobookDoc: Document = {
    id: "ab-1",
    title: "Evolution, Health, and Disease",
    filePath: "/audiobooks/evolution.m4b",
    fileType: "audio",
    tags: [],
    dateAdded: "2024-01-01T00:00:00.000Z",
    dateModified: "2024-01-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    isArchived: false,
    isFavorite: false,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    progressPercent: 25,
    currentPage: 180,
    metadata: {
      author: "Stephen Stearns",
      fileSize: 12800000,
    },
  };

  const mockLoadDocuments = vi.fn().mockResolvedValue(undefined);
  const mockDeleteDocument = vi.fn().mockResolvedValue(undefined);
  const mockUpdateDocumentOptimistic = vi.fn().mockResolvedValue({ success: true });
  const mockAddTab = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    useDocumentStore.setState({
      documents: [audiobookDoc],
      loadDocuments: mockLoadDocuments,
      deleteDocument: mockDeleteDocument,
      updateDocumentOptimistic: mockUpdateDocumentOptimistic,
    });

    useTabsStore.setState({
      addTab: mockAddTab,
    });

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("opens right-click context menu on an audiobook card with appropriate actions", async () => {
    render(<AudiobooksTab />);

    const card = await screen.findByTestId("audiobook-card-ab-1");
    fireEvent.contextMenu(card, { clientX: 100, clientY: 120 });

    expect(await screen.findByText("Play Audiobook")).toBeInTheDocument();
    expect(screen.getByText("Add to Queue")).toBeInTheDocument();
    expect(screen.getByText("Remove from Queue")).toBeInTheDocument();
    expect(screen.getByText("Add to Favorites")).toBeInTheDocument();
    expect(screen.getByText("Mark as Finished")).toBeInTheDocument();
    expect(screen.getByText("Reset Progress")).toBeInTheDocument();
    expect(screen.getByText("Mark as DNF (Did Not Finish)")).toBeInTheDocument();
    expect(screen.getByText("Add Tag...")).toBeInTheDocument();
    expect(screen.getByText("Copy Title")).toBeInTheDocument();
    expect(screen.getByText("Copy Author")).toBeInTheDocument();
    expect(screen.getByText("Delete Audiobook")).toBeInTheDocument();
  });

  it("opens context menu from the three-dots button on an audiobook card", async () => {
    render(<AudiobooksTab />);

    const dotsBtn = await screen.findByTestId("audiobook-menu-button-ab-1");
    fireEvent.click(dotsBtn);

    expect(await screen.findByText("Play Audiobook")).toBeInTheDocument();
    expect(screen.getByText("Delete Audiobook")).toBeInTheDocument();
  });

  it("executes Play, Favorite, Finish, DNF, Copy Title, and Delete actions", async () => {
    render(<AudiobooksTab />);

    // Play Audiobook
    fireEvent.contextMenu(await screen.findByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Play Audiobook"));
    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Evolution, Health, and Disease",
        type: "document-viewer",
        data: { documentId: "ab-1" },
      }),
      undefined
    );

    // Add to Favorites
    fireEvent.contextMenu(screen.getByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Add to Favorites"));
    await waitFor(() => {
      expect(mockUpdateDocumentOptimistic).toHaveBeenCalledWith("ab-1", { isFavorite: true });
    });

    // Mark as Finished
    fireEvent.contextMenu(screen.getByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Mark as Finished"));
    await waitFor(() => {
      expect(mockUpdateDocumentOptimistic).toHaveBeenCalledWith("ab-1", { progressPercent: 100 });
    });

    // Copy Title
    fireEvent.contextMenu(screen.getByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Copy Title"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Evolution, Health, and Disease");

    // Mark as DNF
    fireEvent.contextMenu(screen.getByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Mark as DNF (Did Not Finish)"));
    expect(JSON.parse(localStorage.getItem("audiobook-dnf-list") || "[]")).toContain("ab-1");

    // Delete Audiobook
    fireEvent.contextMenu(screen.getByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Delete Audiobook"));
    await waitFor(() => {
      expect(mockModalConfirm).toHaveBeenCalled();
      expect(mockDeleteDocument).toHaveBeenCalledWith("ab-1");
    });
  });

  it("supports Add to Queue and Remove from Queue", async () => {
    render(<AudiobooksTab />);

    fireEvent.contextMenu(await screen.findByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Add to Queue"));
    await waitFor(() => {
      expect(mockBulkUnsuspendItems).toHaveBeenCalledWith(["ab-1"]);
      expect(mockUpdateDocumentOptimistic).toHaveBeenCalledWith("ab-1", {
        isArchived: false,
        isDismissed: false,
      });
    });

    fireEvent.contextMenu(screen.getByTestId("audiobook-card-ab-1"));
    fireEvent.click(await screen.findByText("Remove from Queue"));
    await waitFor(() => {
      expect(mockBulkSuspendItems).toHaveBeenCalledWith(["ab-1"]);
    });
  });
});
