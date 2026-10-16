import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../../contexts/ThemeContext";

// Keep the hub's provider imports inert so the palette mounts without
// Tauri/network backends (same scaffold as CommandCenter.hub.test.tsx).
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
import {
  settleDestinationAction,
  useDestinationActionStore,
} from "../../../commandPalette/destinationActions";
import { useUIStore } from "../../../stores/uiStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useCollectionStore } from "../../../stores/collectionStore";
import { useTabsStore } from "../../../stores/tabsStore";
import type { Document } from "../../../types/document";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    title: "Analytics with Attention",
    filePath: "/library/analytics.pdf",
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
    progressPercent: 20,
    currentPage: 10,
    totalPages: 100,
    collectionId: "col-default",
    content: "Analytics analytics analytics everywhere in this document.",
    ...overrides,
  };
}

function activeTabType(): string | null {
  const state = useTabsStore.getState();
  const paneIds = state.getTabPaneIds();
  const pane = state.findPaneById(state.navigationPaneId ?? paneIds[0]);
  if (!pane || pane.type !== "tabs" || !pane.activeTabId) return null;
  return state.tabs.find((tab) => tab.id === pane.activeTabId)?.type ?? null;
}

function openTab(type: "dashboard" | "rss") {
  useTabsStore.getState().addTab({
    title: type,
    icon: null,
    type,
    content: () => null,
    closable: true,
  });
}

async function search(term: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: term } });
  await waitFor(
    () => {
      expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    },
    { timeout: 4000 }
  );
}

function optionTitles(): string[] {
  return Array.from(document.querySelectorAll('[role="option"]')).map(
    (node) => node.textContent ?? ""
  );
}

describe("CommandCenter unified registry search", () => {
  beforeEach(() => {
    useUIStore.setState({ commandPaletteOpen: true, commandPaletteQuery: "" });
    useCollectionStore.setState({ activeCollectionId: "col-default" });
    useDocumentStore.setState({
      documents: [makeDocument()],
      isLoading: false,
      hasCompletedFirstLoad: true,
    });
    useTabsStore.setState({ tabs: [], rootPane: { id: "pane-root", type: "tabs", tabIds: [], activeTabId: null }, navigationPaneId: null });
  });

  it("ranks an exact destination query ahead of matching content", async () => {
    render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );

    await search("analytics");

    const titles = optionTitles();
    expect(titles.length).toBeGreaterThan(0);
    // The destination command must come first, ahead of the document whose
    // title and content also match "analytics".
    expect(titles[0]).toContain("Analytics");
    const firstIsCommand = document.querySelectorAll('[role="option"]')[0];
    expect(firstIsCommand?.textContent).toContain("View reading and review statistics");
    expect(titles.some((title) => title.includes("Analytics with Attention"))).toBe(true);
  });

  it("returns the same destination matches while the RSS view is active", async () => {
    openTab("dashboard");
    const { unmount } = render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );
    await search("podcasts");
    const dashboardTitles = optionTitles().filter((title) => title.includes("Podcasts"));
    expect(dashboardTitles.length).toBeGreaterThan(0);
    unmount();

    openTab("rss");
    expect(activeTabType()).toBe("rss");
    render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );
    await search("podcasts");
    const rssTitles = optionTitles().filter((title) => title.includes("Podcasts"));
    expect(rssTitles.length).toBeGreaterThan(0);
    expect(rssTitles[0]).toBe(dashboardTitles[0]);
  });

  it("suppresses the global Refresh RSS Feeds command while the RSS view is active", async () => {
    openTab("rss");
    render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );

    await search("refresh");
    const titles = optionTitles();
    expect(titles.some((title) => title.includes("Refresh Feed"))).toBe(true);
    expect(titles.some((title) => title.includes("Refresh RSS Feeds"))).toBe(false);
  });

  it("registers the refresh RSS command outside the RSS view", async () => {
    openTab("dashboard");
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );

    await search("refresh feeds");
    const title = optionTitles().find((entry) => entry.includes("Refresh RSS Feeds"));
    expect(title).toBeTruthy();

    fireEvent.click(
      Array.from(document.querySelectorAll('[role="option"]')).find((node) =>
        node.textContent?.includes("Refresh RSS Feeds")
      ) as HTMLElement
    );
    await waitFor(() => {
      expect(useDestinationActionStore.getState().pending).toMatchObject({
        destination: "rss",
        action: "refresh",
      });
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "navigate", detail: "/rss" })
    );
    const pending = useDestinationActionStore.getState().pending;
    if (pending) settleDestinationAction(pending.id);
    dispatchSpy.mockRestore();
  });

  it("opens a settings section through the destination-action handoff", async () => {
    render(
      <ThemeProvider>
        <CommandCenter />
      </ThemeProvider>
    );

    await search("appearance settings");
    const row = Array.from(document.querySelectorAll('[role="option"]')).find((node) =>
      node.textContent?.includes("Settings: Appearance")
    );
    expect(row).toBeTruthy();

    fireEvent.click(row as HTMLElement);
    await waitFor(() => {
      expect(useDestinationActionStore.getState().pending).toMatchObject({
        destination: "settings",
        action: "section",
        section: "appearance",
      });
    });
    const pending = useDestinationActionStore.getState().pending;
    if (pending) settleDestinationAction(pending.id);
  });
});
