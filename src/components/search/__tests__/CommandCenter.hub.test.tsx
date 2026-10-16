import { useSavedQueueStore } from "../../../stores/savedQueueStore";
import { STARTER_SAVED_QUEUES } from "../../../api/savedQueues";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../contexts/ThemeContext";

// The hub controller lives in CommandCenter; these mocks keep its provider
// imports inert so the palette can mount without Tauri/network backends.
vi.mock("../../../api/documents", () => ({
  getDocuments: vi.fn(async () => []),
  getDocument: vi.fn(async () => null),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(async () => {}),
  updateDocumentContent: vi.fn(async () => ({})),
}));
vi.mock("../../../api/review", () => ({
  getDueItems: vi.fn(async () => []),
}));
vi.mock("../../../api/learning-items", () => ({
  getAllLearningItems: vi.fn(async () => []),
}));
vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => ({ path: "none", available: false, loading: false }),
}));
vi.mock("../../../api/rss", () => ({
  getSubscribedFeedsAuto: vi.fn(async () => []),
}));
vi.mock("../../../api/rss-search", () => ({
  searchArticlesAuto: vi.fn(async () => []),
}));
vi.mock("../../../api/podcast", () => ({
  getSubscribedPodcasts: vi.fn(async () => []),
  getPodcastEpisodes: vi.fn(async () => []),
  getPodcastTranscript: vi.fn(async () => null),
}));
vi.mock("../../../api/youtube", () => ({
  fetchYouTubeTranscript: vi.fn(async () => []),
}));
vi.mock("../../../api/transcription", () => ({
  getTranscript: vi.fn(async () => ({ segments: [] })),
}));

import { CommandCenter } from "../CommandCenter";
import { useLibraryAskHandoffStore } from "../../../commandPalette/libraryAskHandoff";
import { useUIStore } from "../../../stores/uiStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useCollectionStore } from "../../../stores/collectionStore";
import type { Document } from "../../../types/document";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    title: "The-Doctrine-of-Fascism",
    filePath: "/library/fascism.pdf",
    fileType: "pdf",
    tags: [],
    dateAdded: "2026-09-01T00:00:00.000Z",
    dateModified: "2026-10-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
    progressPercent: 40,
    currentPage: 137,
    totalPages: 342,
    collectionId: "col-default",
    ...overrides,
  };
}

describe("CommandCenter hub controller mount", () => {
  beforeEach(() => {
    useUIStore.setState({ commandPaletteOpen: true, commandPaletteQuery: "" });
    useCollectionStore.setState({ activeCollectionId: "col-default" });
    useDocumentStore.setState({
      documents: [makeDocument()],
      isLoading: false,
      hasCompletedFirstLoad: true,
    });
  });

  it("mounts the hub with a real home model and no crashes", async () => {
    render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(document.querySelector(".command-hub-panel")).not.toBeNull();
    });
    // Real home content derived from the store's documents.
    await waitFor(() => {
      expect(screen.getByText("The-Doctrine-of-Fascism")).toBeInTheDocument();
    });
    expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    expect(screen.getByText("Ask Plethora")).toBeInTheDocument();
    // Opening the workspace remains useful when generation needs setup.
    expect(screen.getByText("Open Document Q&A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ask about your library/ }));
    expect(useLibraryAskHandoffStore.getState().pending).toMatchObject({ intent: "open", question: "" });
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("shows the first-run state for an empty library", async () => {
    useDocumentStore.setState({ documents: [], isLoading: false, hasCompletedFirstLoad: true });
    render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Your library is empty")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask about your library/ }));
    expect(useLibraryAskHandoffStore.getState().pending?.intent).toBe("open");
  });
  it("keeps Actions open while late saved queues load, rename and disappear", async () => {
    useSavedQueueStore.setState({ savedQueues: [], isLoading: true, error: null });
    render(<ThemeProvider><CommandCenter /></ThemeProvider>);
    fireEvent.click(screen.getByRole("tab", { name: "Actions" }));
    const profile = { ...STARTER_SAVED_QUEUES[1], id: "reactive", name: "Reactive Profile" };
    act(() => useSavedQueueStore.setState({ savedQueues: [profile], isLoading: false }));
    expect(await screen.findByText(/Saved Queues: Reactive Profile/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute("aria-selected", "true");
    act(() => useSavedQueueStore.setState({ savedQueues: [{ ...profile, name: "Renamed Profile" }] }));
    expect(await screen.findByText(/Saved Queues: Renamed Profile/)).toBeInTheDocument();
    act(() => useSavedQueueStore.setState({ savedQueues: [] }));
    expect(screen.queryByText(/Saved Queues: Renamed Profile/)).not.toBeInTheDocument();
  });

});
