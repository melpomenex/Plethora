import { render, screen, waitFor } from "@testing-library/react";
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
    // The mocked assistant resolution reports unavailable (honest tile text).
    expect(screen.getByText(/Assistant unavailable/)).toBeInTheDocument();
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
  });
});
