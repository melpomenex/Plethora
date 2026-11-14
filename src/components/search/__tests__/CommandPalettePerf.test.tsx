import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../../contexts/ThemeContext";
import type { Document } from "../../../types/document";
import type { PaletteSearchQuery, PaletteSearchResponse } from "../../../api/ftsSearch";
import {
  mapPaletteSearchItemToSearchResult,
  matchDocumentTitlesSync,
  stripHtmlLight,
} from "../../../commandPalette/paletteSearchAdapter";
import { PaletteResults } from "../palette/PaletteResults";

const mockIsTauri = vi.hoisted(() => vi.fn(() => false));
const mockPaletteSearch = vi.hoisted(() =>
  vi.fn<(query: PaletteSearchQuery) => Promise<PaletteSearchResponse>>(async () => ({
    items: [],
    totalEstimate: 0,
    elapsedMs: 1,
    hasMore: false,
  }))
);
const mockGetSubscribedFeedsAuto = vi.hoisted(() => vi.fn(async () => []));
const mockFetchYouTubeTranscript = vi.hoisted(() => vi.fn(async () => []));
const mockGetAllLearningItems = vi.hoisted(() => vi.fn(async () => []));
const mockLoadExtracts = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: mockIsTauri,
  };
});

vi.mock("../../../api/ftsSearch", async () => {
  const actual = await vi.importActual<typeof import("../../../api/ftsSearch")>(
    "../../../api/ftsSearch"
  );
  return {
    ...actual,
    paletteSearch: mockPaletteSearch,
  };
});

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
  getAllLearningItems: mockGetAllLearningItems,
}));
vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => ({ path: "none", available: false, loading: false }),
}));
vi.mock("../../../api/rss", () => ({
  getSubscribedFeedsAuto: mockGetSubscribedFeedsAuto,
}));
vi.mock("../../../api/podcast", () => ({
  getSubscribedPodcasts: vi.fn(async () => []),
  getPodcastEpisodes: vi.fn(async () => []),
  getPodcastTranscript: vi.fn(async () => null),
}));
vi.mock("../../../api/youtube", () => ({
  fetchYouTubeTranscript: mockFetchYouTubeTranscript,
}));
vi.mock("../../../api/transcription", () => ({
  getTranscript: vi.fn(async () => ({ segments: [] })),
}));

import { CommandCenter } from "../CommandCenter";
import {
  GlobalSearch,
  SearchResultType,
  type PaletteHubController,
  type SearchQuery,
  type SearchResult,
} from "../GlobalSearch";
import { buildCommandRegistry } from "../../../commandPalette/registry";
import { en } from "../../../lib/i18n/locales/en";
import { useUIStore } from "../../../stores/uiStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useCollectionStore } from "../../../stores/collectionStore";
import { useTabsStore } from "../../../stores/tabsStore";
import { useExtractStore } from "../../../stores/extractStore";
import type { PaletteHomeModel } from "../../../commandPalette/types";

function makeDoc(index: number, overrides: Partial<Document> = {}): Document {
  return {
    id: `doc-${index}`,
    title: `Library Document ${index}`,
    filePath: `/library/doc-${index}.pdf`,
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
    collectionId: "col-default",
    ...overrides,
  };
}

function makeHubController(): PaletteHubController {
  const translate = (key: string) => en[key] ?? key;
  const commands = buildCommandRegistry({
    translate,
    theme: { id: "dark", name: "Dark", variant: "dark" },
    themes: [{ id: "dark", name: "Dark", variant: "dark" }],
    setTheme: vi.fn(),
    isWeb: false,
    selectedDocumentTitle: null,
  });
  const home: PaletteHomeModel = {
    collectionId: "col-default",
    firstUse: false,
    resume: { status: "none", item: null },
    recent: { status: "none", item: null },
    due: { status: "ready", dueCount: 0 },
    assistant: { available: false },
    suggestions: [],
    contextualActions: [],
  };
  return {
    home,
    commands,
    expandedExamples: [],
    dispatch: vi.fn(async () => {}),
    onContextualAction: vi.fn(),
    saveNote: vi.fn(async () => null),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Command Palette performance & two-stage search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(false);
    useUIStore.setState({ commandPaletteOpen: true, commandPaletteQuery: "" });
    useCollectionStore.setState({ activeCollectionId: "col-default" });
    useDocumentStore.setState({
      documents: [],
      isLoading: false,
      hasCompletedFirstLoad: true,
    });
    useExtractStore.setState({
      extracts: [],
      isLoading: false,
      loadExtracts: mockLoadExtracts,
    });
    useTabsStore.setState({
      tabs: [],
      rootPane: { id: "pane-root", type: "tabs", tabIds: [], activeTabId: null },
      navigationPaneId: null,
    });
  });

  describe("paletteSearchAdapter", () => {
    it("matches document #9950 in a 10,000-doc library with no 500-item cap and scores <= 0.95", () => {
      const docs: Document[] = Array.from({ length: 10_000 }, (_, i) =>
        makeDoc(i, {
          title: i === 9950 ? "Attention Item 9950 Quantum Notes" : `Library Document ${i}`,
          tags: i === 9950 ? ["quantum"] : ["general"],
          isArchived: i === 100,
        })
      );

      const results = matchDocumentTitlesSync(docs, { query: "9950" }, {
        activeCollectionId: "col-default",
        limit: 30,
      });

      expect(results.map((r) => r.id)).toEqual(["doc-9950"]);
      expect(results[0].score).toBeLessThanOrEqual(0.95);
      expect(results[0].score).toBeGreaterThan(0.5);

      const archived = matchDocumentTitlesSync(docs, { query: "Document 100" }, {
        activeCollectionId: "col-default",
      });
      expect(archived.some((r) => r.id === "doc-100")).toBe(false);
    });

    it("strips HTML script/style blocks without touching DOMParser", () => {
      const originalDomParser = globalThis.DOMParser;
      const domParserSpy = vi.fn(() => {
        throw new Error("DOMParser must not be invoked during search");
      });
      globalThis.DOMParser = domParserSpy as unknown as typeof DOMParser;
      try {
        const cleaned = stripHtmlLight(
          '<p>Hello&nbsp;<strong>world</strong></p><script>alert("xss")</script><style>.x{}</style>'
        );
        expect(cleaned).toBe("Hello world");
        expect(domParserSpy).not.toHaveBeenCalled();
      } finally {
        globalThis.DOMParser = originalDomParser;
      }
    });

    it("maps SQLite PaletteSearchItem with clamped score and secondary transcript hits", () => {
      const mapped = mapPaletteSearchItemToSearchResult(
        {
          id: "yt-9950",
          resultType: "media",
          title: "Attention Lecture 9950",
          excerpt: "Discusses <mark>spaced repetition</mark> schedules",
          score: 120,
          documentId: "yt-9950",
          fileType: "youtube",
          tags: [],
          transcriptMatch: true,
          scopes: ["all", "documents"],
          primaryHit: {
            id: "yt-hit-1",
            location: { kind: "youtube", timeSeconds: 185, textQuote: "spaced repetition" },
            label: "3:05",
            excerptHtml: "<mark>spaced repetition</mark> schedules",
          },
          secondaryHits: [
            {
              id: "yt-hit-2",
              location: { kind: "youtube", timeSeconds: 420, textQuote: "spaced repetition" },
              label: "7:00",
              excerptHtml: "second <mark>spaced repetition</mark> pass",
            },
          ],
        },
        "spaced repetition"
      );

      expect(mapped.score).toBeLessThanOrEqual(0.95);
      expect(mapped.score).toBeGreaterThanOrEqual(0.42);
      expect(mapped.metadata?.transcriptMatch).toBe(true);
      expect(mapped.metadata?.primaryHit?.label).toBe("3:05");
      expect(mapped.metadata?.secondaryHits).toHaveLength(1);
      expect(mapped.metadata?.scopes).toEqual(["all", "documents"]);
    });
  });

  describe("CommandCenter Tauri Stage B integration", () => {
    it("queries SQLite paletteSearch in Tauri mode without RSS prefetch, extract scan, or transcript fetch, and keeps exact command precedence", async () => {
      mockIsTauri.mockReturnValue(true);
      useDocumentStore.setState({
        documents: [
          makeDoc(1, { title: "Analytics with Attention" }),
          makeDoc(9950, { title: "Attention Item 9950" }),
        ],
      });

      mockPaletteSearch.mockImplementation(async (query) => {
        if (query.query.toLowerCase().includes("analytics")) {
          return {
            items: [
              {
                id: "doc-1",
                resultType: "document",
                title: "Analytics with Attention",
                excerpt: "<mark>Analytics</mark> doc match",
                score: 118,
                documentId: "doc-1",
                fileType: "pdf",
                tags: [],
                transcriptMatch: false,
                secondaryHits: [],
                scopes: ["all", "documents"],
              },
            ],
            totalEstimate: 1,
            elapsedMs: 2,
            hasMore: false,
          };
        }
        return {
          items: [
            {
              id: "doc-9950",
              resultType: "document",
              title: "Attention Item 9950",
              excerpt: "Found in <mark>9950</mark>",
              score: 112,
              documentId: "doc-9950",
              fileType: "pdf",
              tags: [],
              transcriptMatch: false,
              secondaryHits: [],
              scopes: ["all", "documents"],
            },
          ],
          totalEstimate: 1,
          elapsedMs: 3,
          hasMore: false,
        };
      });

      render(
        <ThemeProvider>
          <CommandCenter />
        </ThemeProvider>
      );

      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "analytics" } });

      await waitFor(() => {
        const options = document.querySelectorAll('[role="option"]');
        expect(options.length).toBeGreaterThan(1);
        expect(options[0].textContent).toContain("Analytics");
        expect(options[0].textContent).toContain("View reading and review statistics");
      });

      fireEvent.change(input, { target: { value: "9950" } });
      await waitFor(() => {
        expect(mockPaletteSearch).toHaveBeenCalled();
        const text = Array.from(document.querySelectorAll('[role="option"]'))
          .map((n) => n.textContent ?? "")
          .join("\n");
        expect(text).toContain("Attention Item 9950");
      });

      expect(mockGetSubscribedFeedsAuto).not.toHaveBeenCalled();
      expect(mockFetchYouTubeTranscript).not.toHaveBeenCalled();
      expect(mockLoadExtracts).not.toHaveBeenCalled();

      // Switch to Actions scope: must skip backend FTS search
      const callsBeforeActions = mockPaletteSearch.mock.calls.length;
      fireEvent.click(screen.getByRole("tab", { name: /Actions/i }));
      fireEvent.change(input, { target: { value: "settings" } });
      await new Promise((r) => setTimeout(r, 150));
      expect(mockPaletteSearch.mock.calls.length).toBe(callsBeforeActions);

      // Switch to Cards scope: queries cards + extracts in SQLite
      fireEvent.click(screen.getByRole("tab", { name: /Cards/i }));
      fireEvent.change(input, { target: { value: "neuron" } });
      await waitFor(() => {
        const cardCalls = mockPaletteSearch.mock.calls.slice(callsBeforeActions);
        expect(cardCalls.some((args) => args[0].scope === "cards")).toBe(true);
        expect(
          cardCalls.some(
            (args) =>
              args[0].scope === "documents" &&
              Array.isArray(args[0].resultTypes) &&
              args[0].resultTypes.includes("extract")
          )
        ).toBe(true);
      });
    });
  });

  describe("GlobalSearch focus, Stage A responsiveness, and stale cancellation", () => {
    it("focuses the input immediately on open in both hub and standalone modes", () => {
      const controller = makeHubController();
      const { unmount } = render(
        <GlobalSearch
          isOpen={true}
          onOpenChange={vi.fn()}
          hideTrigger={true}
          onSearch={vi.fn(async () => [])}
          onResultClick={vi.fn()}
          controller={controller}
        />
      );
      expect(document.activeElement).toBe(screen.getByRole("combobox"));
      unmount();

      render(
        <GlobalSearch
          isOpen={true}
          onOpenChange={vi.fn()}
          hideTrigger={true}
          onSearch={vi.fn(async () => [])}
          onResultClick={vi.fn()}
        />
      );
      expect(document.activeElement).toBe(screen.getByRole("textbox"));
    });

    it("renders Stage A synchronously while Stage B settles, drops stale out-of-order responses, and cancels on close", async () => {
      const firstSlow = deferred<SearchResult[]>();
      const secondFast = deferred<SearchResult[]>();
      const thirdClose = deferred<SearchResult[]>();

      const onSearch = vi.fn(async (q: SearchQuery): Promise<SearchResult[]> => {
        if (q.query === "alp") return firstSlow.promise;
        if (q.query === "alpha") return secondFast.promise;
        return thirdClose.promise;
      });
      const onSearchFast = vi.fn((q: SearchQuery): SearchResult[] => [
        {
          id: `fast-${q.query}`,
          type: SearchResultType.Document,
          title: `Fast Stage A: ${q.query}`,
          score: 0.9,
        },
      ]);

      const onOpenChange = vi.fn();
      const { rerender } = render(
        <GlobalSearch
          isOpen={true}
          onOpenChange={onOpenChange}
          hideTrigger={true}
          onSearchFast={onSearchFast}
          onSearch={onSearch}
          onResultClick={vi.fn()}
          controller={makeHubController()}
        />
      );

      const input = screen.getByRole("combobox");
      fireEvent.change(input, { target: { value: "alp" } });

      // Stage A renders synchronously before debounce triggers Stage B.
      expect(screen.getByText("Fast Stage A: alp")).toBeInTheDocument();
      expect(screen.queryByText(/Searching/i)).not.toBeInTheDocument();

      await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));

      // User keeps typing "alpha"; slow "alp" finishes AFTER "alpha" settles.
      fireEvent.change(input, { target: { value: "alpha" } });
      expect(screen.getByText("Fast Stage A: alpha")).toBeInTheDocument();

      await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(2));

      await act(async () => {
        secondFast.resolve([
          {
            id: "b-alpha",
            type: SearchResultType.Document,
            title: "Stage B: alpha winner",
            score: 0.94,
          },
        ]);
      });

      await waitFor(() => expect(screen.getByText("Stage B: alpha winner")).toBeInTheDocument());

      // Late resolution of first query must be ignored.
      await act(async () => {
        firstSlow.resolve([
          {
            id: "b-alp-stale",
            type: SearchResultType.Document,
            title: "STALE alp response",
            score: 0.99,
          },
        ]);
      });
      expect(screen.queryByText("STALE alp response")).not.toBeInTheDocument();
      expect(screen.getByText("Stage B: alpha winner")).toBeInTheDocument();

      // Start another search and immediately close palette before it resolves.
      fireEvent.change(input, { target: { value: "closing" } });
      await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(3));

      rerender(
        <GlobalSearch
          isOpen={false}
          onOpenChange={onOpenChange}
          hideTrigger={true}
          onSearchFast={onSearchFast}
          onSearch={onSearch}
          onResultClick={vi.fn()}
          controller={makeHubController()}
        />
      );

      await act(async () => {
        thirdClose.resolve([
          {
            id: "b-closed",
            type: SearchResultType.Document,
            title: "Should not surface after close",
            score: 0.95,
          },
        ]);
      });
      expect(screen.queryByText("Should not surface after close")).not.toBeInTheDocument();
    });
  });

  describe("PaletteResults progressive rendering", () => {
    it("bounds initial DOM nodes at 30 and reveals remaining items via button or keyboard selection", () => {
      const results: SearchResult[] = Array.from({ length: 50 }, (_, i) => ({
        id: `res-${i}`,
        type: SearchResultType.Document,
        title: `Result ${i}`,
        score: 0.8,
      }));

      const { rerender } = render(
        <PaletteResults
          results={results}
          selectedIndex={0}
          isSearching={false}
          onSelect={vi.fn()}
          onActivate={vi.fn()}
          listboxId="test-listbox"
          emptyState={<div>empty</div>}
        />
      );

      expect(screen.getAllByRole("option")).toHaveLength(30);
      const showMoreBtn = screen.getByRole("button", { name: /Show more \(20 remaining\)/i });
      fireEvent.click(showMoreBtn);
      expect(screen.getAllByRole("option")).toHaveLength(50);

      // Reset with a fresh result reference and advance selectedIndex past 30.
      const freshResults = results.map((r) => ({ ...r }));
      rerender(
        <PaletteResults
          results={freshResults}
          selectedIndex={0}
          isSearching={false}
          onSelect={vi.fn()}
          onActivate={vi.fn()}
          listboxId="test-listbox"
          emptyState={<div>empty</div>}
        />
      );
      expect(screen.getAllByRole("option")).toHaveLength(30);

      rerender(
        <PaletteResults
          results={freshResults}
          selectedIndex={35}
          isSearching={false}
          onSelect={vi.fn()}
          onActivate={vi.fn()}
          listboxId="test-listbox"
          emptyState={<div>empty</div>}
        />
      );
      expect(screen.getAllByRole("option")).toHaveLength(50);
    });
  });
});
