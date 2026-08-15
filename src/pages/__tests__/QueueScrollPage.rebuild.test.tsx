/**
 * Component-level regression net for session rebuild stability
 * (fix-optimal-session-rebuild-skip, design D5 layer 3).
 *
 * Renders the real QueueScrollPage with its boundaries mocked — stores,
 * src/api/*, and the heavy viewer surfaces — and drives the exact regression
 * sequence end-to-end: optimal session [epub, flashcard, epub] → rate the
 * epub → the rating lock releases → a documents store reload (new array
 * identity, the sync engine's debounced `loadDocuments`) lands → the
 * flashcard must still be the current, rendered, unrated item. Whatever
 * trigger causes the rebuild in the future, this test fails if the rebuild
 * displaces the item in view.
 *
 * Mocking rule: never mock page internals — only stores, API modules, and
 * the leaf viewer components (pattern: ReviewQueueView.test.tsx).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const queueState: Record<string, any> = {
    filteredItems: [],
    items: [],
    loadQueue: vi.fn(async () => {}),
    customSubset: null,
    postponeItemSmart: vi.fn(async () => {}),
  };
  const tabsState: Record<string, any> = {
    rootPane: { type: "tabs", id: "pane-1", activeTabId: "tab-1" },
    tabs: [],
    closeTab: vi.fn(),
    updateTab: vi.fn(),
    addTab: vi.fn(),
  };
  const settingsState: Record<string, any> = {
    settings: null, // filled in the module factory from real defaultSettings
    updateSettingsCategory: vi.fn(),
  };
  return { queueState, tabsState, settingsState };
});

// ── Stores ───────────────────────────────────────────────────────────────────

vi.mock("../../stores/queueStore", () => ({
  useQueueStore: Object.assign(
    (selector?: (s: any) => unknown) => (selector ? selector(mocks.queueState) : mocks.queueState),
    { getState: () => mocks.queueState },
  ),
}));

// The documents store must notify subscribers (the reload IS the trigger
// under test), so it is a real zustand store rather than a bare mock object.
vi.mock("../../stores/documentStore", async () => {
  const { create } = await import("zustand");
  const useDocumentStore = create(() => ({
    documents: [] as any[],
    loadDocuments: vi.fn(async () => {}),
    addDocument: vi.fn(),
    updateDocument: vi.fn(),
  }));
  return { useDocumentStore };
});

vi.mock("../../stores/settingsStore", async () => {
  const actual = await vi.importActual<any>("../../stores/settingsStore");
  const settings = JSON.parse(JSON.stringify(actual.defaultSettings));
  // Composition 60/15/25 (the default): 2 new docs + 1 due card compose to a
  // 3-item session [epub, card, epub]. Feed sources off so the optimal build
  // has no awaits and completes synchronously.
  settings.scrollQueue.composition = { documents: 60, extracts: 15, flashcards: 25 };
  settings.rssQueue.includeInQueue = false;
  settings.podcastQueue.includeInQueue = false;
  mocks.settingsState.settings = settings;
  return {
    ...actual,
    useSettingsStore: Object.assign(
      (selector?: (s: any) => unknown) =>
        selector ? selector(mocks.settingsState) : mocks.settingsState,
      { getState: () => mocks.settingsState },
    ),
  };
});

vi.mock("../../stores/tabsStore", () => ({
  useTabsStore: Object.assign(
    (selector?: (s: any) => unknown) => (selector ? selector(mocks.tabsState) : mocks.tabsState),
    { getState: () => mocks.tabsState },
  ),
}));

// Stable singletons: a bare selector like `(s) => s.providers` compares by
// Object.is, so returning a fresh array per call would re-render subscribers
// (e.g. useAiAvailability inside SelectionActionsSheet) in an infinite loop.
const classifierState = { classifiers: [] as any[] };
vi.mock("../../stores/classifiersStore", () => ({
  useClassifiersStore: Object.assign(
    (selector?: (s: any) => unknown) => (selector ? selector(classifierState) : classifierState),
    { getState: () => classifierState },
  ),
}));

const llmProvidersState = {
  providers: [] as any[],
  getEnabledProviders: () => [] as any[],
};
vi.mock("../../stores/llmProvidersStore", () => ({
  useLLMProvidersStore: Object.assign(
    (selector?: (s: any) => unknown) => (selector ? selector(llmProvidersState) : llmProvidersState),
    { getState: () => llmProvidersState },
  ),
}));

vi.mock("../../components/assistant/ragConfig", () => ({
  resolveEmbeddingConfigForRag: vi.fn(async () => null),
}));

// ── API boundary ─────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({
  getSmartStartPosition: vi.fn(),
  rateDocumentEngaging: vi.fn(),
  getDueItems: vi.fn(),
  getDueExtracts: vi.fn(),
  submitReview: vi.fn(),
  submitExtractReview: vi.fn(),
  getExtract: vi.fn(),
  getEpisodeQueue: vi.fn(),
  markEpisodePlayed: vi.fn(),
  importPodcastEpisodeAsDocument: vi.fn(),
  getUnreadItemsAuto: vi.fn(),
  getSubscribedFeedsAuto: vi.fn(),
  getSubscribedFeeds: vi.fn(),
  markItemReadAuto: vi.fn(),
  toggleItemFavoriteAuto: vi.fn(),
  getArticleFullContent: vi.fn(),
  fetchArticleFullContent: vi.fn(),
  createDocument: vi.fn(),
  updateDocumentContent: vi.fn(),
  updateDocumentPriority: vi.fn(),
  dismissDocument: vi.fn(),
  getDocument: vi.fn(),
  extractDocumentText: vi.fn(),
  bulkSuspendItems: vi.fn(),
  chatWithLLM: vi.fn(),
  getAIConfig: vi.fn(),
  fetchYouTubeTranscript: vi.fn(),
  createExtract: vi.fn(),
  deleteExtract: vi.fn(),
  setExtractPriority: vi.fn(),
  buildNeuralQueue: vi.fn(),
  getNeuralQueueResolvedFront: vi.fn(),
  consumeNeuralQueueElement: vi.fn(),
  refillNeuralQueueIfDepleted: vi.fn(),
  getNeuralQueueRemaining: vi.fn(),
}));

vi.mock("../../api/algorithm", () => ({
  getSmartStartPosition: api.getSmartStartPosition,
  rateDocumentEngaging: api.rateDocumentEngaging,
}));
vi.mock("../../api/learning-items", () => ({
  getDueItems: api.getDueItems,
}));
vi.mock("../../api/extract-review", () => ({
  getDueExtracts: api.getDueExtracts,
  submitExtractReview: api.submitExtractReview,
}));
vi.mock("../../api/extracts", () => ({
  getExtract: api.getExtract,
  createExtract: api.createExtract,
  deleteExtract: api.deleteExtract,
  setExtractPriority: api.setExtractPriority,
}));
vi.mock("../../api/review", () => ({ submitReview: api.submitReview }));
vi.mock("../../api/rss", () => ({
  getUnreadItemsAuto: api.getUnreadItemsAuto,
  getSubscribedFeedsAuto: api.getSubscribedFeedsAuto,
  markItemReadAuto: api.markItemReadAuto,
  toggleItemFavoriteAuto: api.toggleItemFavoriteAuto,
  getArticleFullContent: api.getArticleFullContent,
  fetchArticleFullContent: api.fetchArticleFullContent,
  // RSSQueueSettingsModal reads the feed list at mount even while closed.
  getSubscribedFeeds: api.getSubscribedFeeds,
}));
vi.mock("../../api/podcast", () => ({
  getEpisodeQueue: api.getEpisodeQueue,
  markEpisodePlayed: api.markEpisodePlayed,
  importPodcastEpisodeAsDocument: api.importPodcastEpisodeAsDocument,
}));
vi.mock("../../api/documents", () => ({
  createDocument: api.createDocument,
  updateDocumentContent: api.updateDocumentContent,
  updateDocumentPriority: api.updateDocumentPriority,
  dismissDocument: api.dismissDocument,
  getDocument: api.getDocument,
  extractDocumentText: api.extractDocumentText,
}));
vi.mock("../../api/queue", () => ({ bulkSuspendItems: api.bulkSuspendItems }));
vi.mock("../../api/llm", () => ({ chatWithLLM: api.chatWithLLM }));
vi.mock("../../api/ai", () => ({ getAIConfig: api.getAIConfig }));
vi.mock("../../api/youtube", () => ({ fetchYouTubeTranscript: api.fetchYouTubeTranscript }));
vi.mock("../../api/neural-queue", () => ({
  buildNeuralQueue: api.buildNeuralQueue,
  getNeuralQueueResolvedFront: api.getNeuralQueueResolvedFront,
  consumeNeuralQueueElement: api.consumeNeuralQueueElement,
  refillNeuralQueueIfDepleted: api.refillNeuralQueueIfDepleted,
  getNeuralQueueRemaining: api.getNeuralQueueRemaining,
}));
vi.mock("../../api/undoable", () => ({
  useUndoableOperations: () => ({
    deleteDocument: vi.fn(),
    deleteExtract: vi.fn(),
    deleteLearningItem: vi.fn(),
  }),
}));

// ── Leaf component boundary ──────────────────────────────────────────────────

vi.mock("../../components/viewer/DocumentViewer", () => ({
  DocumentViewer: ({ documentId }: { documentId: string }) => (
    <div data-testid="document-viewer" data-document-id={documentId}>
      Viewer for {documentId}
    </div>
  ),
}));
vi.mock("../../components/tabs/TabRegistry", () => ({
  DocumentViewer: () => <div data-testid="tab-registry-viewer" />,
}));
vi.mock("../../components/viewer/AudiobookViewer", () => ({
  AudiobookViewer: () => null,
}));
vi.mock("../../components/assistant/AssistantPanel", () => ({
  AssistantPanel: () => null,
}));
vi.mock("../../components/media/summary", () => ({
  ModernSummaryPanel: () => null,
}));
vi.mock("../../components/common/ReaderTTSControls", () => ({
  ReaderTTSControls: () => null,
}));
vi.mock("../../components/common/Tabs/TabContent", () => ({
  usePaneId: () => "pane-1",
  useIsActiveTab: () => true,
}));
vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../utils/rssSummary", () => ({
  useSummaryCache: () => ({
    getCachedSummary: vi.fn(async () => null),
    cacheSummary: vi.fn(async () => {}),
  }),
}));
// The queue's download-horizon prefetch dynamically imports the sync engine,
// whose scheduler re-arms zero-delay timers against an IndexedDB jsdom does
// not have — saturating the event loop after the first advance. The prefetch
// is fire-and-forget and irrelevant to session stability.
vi.mock("../../lib/autoFileSyncDownload", () => ({
  prefetchQueuedDocuments: vi.fn(async () => {}),
}));

import { QueueScrollPage } from "../QueueScrollPage";
import { useDocumentStore } from "../../stores/documentStore";
import { IFRAME_POINTER_ACTIVITY_EVENT } from "../../utils/iframePointerActivity";

// ── Fixtures ─────────────────────────────────────────────────────────────────
//
// Engagement totals are fully deterministic (priority + 2 recency + stable
// random + FNV jitter, all hashed from stable ids): with priorities
// 11 / 10 the combined-criterion interleave produces exactly
// [doc-1, card-1, doc-2] — doc-1 wins position 1 (11.33 vs the card's 9.02
// and doc-2's 10.44), the proportion bias (+~11.4 for items at position 2)
// puts the card second (20.4 vs 10.44), doc-2 last. After doc-1 is rated the
// pools are {doc-2, card} and the rebuilt head-to-head (no bias at position
// 1) flips to [doc-2, card-1] — index 0 would then address doc-2, which is
// exactly the unreviewed-card skip this change fixes.

const makeDocument = (id: string, title: string) =>
  ({
    id,
    title,
    fileType: "epub",
    category: "books",
    isArchived: false,
    isDismissed: false,
    dateLastReviewed: null,
    date_added: "2026-01-01T00:00:00Z",
    date_modified: "2026-01-01T00:00:00Z",
    reps: 0,
    readingCount: 0,
    priorityScore: 50,
  }) as any;

const makeDocRow = (id: string, title: string, priority: number) =>
  ({
    id: `q-${id}`,
    documentId: id,
    documentTitle: title,
    itemType: "document",
    priority,
    estimatedTime: 10,
    tags: ["books"],
    progress: 0,
  }) as any;

const makeCard = (id: string, question: string) =>
  ({
    id,
    document_id: "doc-1",
    item_type: "Basic",
    question,
    answer: "42",
    difficulty: 5,
    interval: 0,
    ease_factor: 2.5,
    due_date: "2026-01-01T00:00:00Z",
    date_created: "2026-01-01T00:00:00Z",
    date_modified: "2026-01-01T00:00:00Z",
    review_count: 0,
    lapses: 0,
    state: "New",
    is_suspended: false,
    tags: ["books"],
  }) as any;

const CARD_QUESTION = "What is the capital of France?";

const doc1 = makeDocument("doc-1", "First Epub");
const doc2 = makeDocument("doc-2", "Second Epub");
const doc3 = makeDocument("doc-3", "Third Epub");
const card1 = makeCard("card-1", CARD_QUESTION);

// queryBy*/queryAllBy*: the assertions check both presence and absence across
// the rating/reload sequence (getBy* would throw on the absence checks), and
// the card's question legitimately appears twice — in the card and truncated
// in the overlay's title bar.
const flashcardInView = () => screen.queryAllByText(CARD_QUESTION).length > 0;
const documentInView = () => screen.queryByTestId("document-viewer");

/** The rating → advance chain runs on real 300/500ms timers; under a loaded
 * parallel test run those timers fire late, so a fixed settle() can return
 * before the next item rendered. Poll for the post-advance state instead of
 * asserting immediately after a sleep. */
const awaitFlashcardCurrent = () =>
  waitFor(() => expect(flashcardInView()).toBe(true));
const awaitDocumentCurrent = (id: string) =>
  waitFor(() =>
    expect(documentInView()).toHaveAttribute("data-document-id", id),
  );

/** Fire a documents store reload — same content, new array identity, exactly
 *  what the sync engine's debounced `loadDocuments()` does. */
const reloadDocuments = async (docs: any[]) => {
  await act(async () => {
    useDocumentStore.setState({ documents: [...docs] });
  });
  // Let the (synchronous) optimal build effect commit.
  await act(async () => {});
};

// Real timers: the sync engine's scheduler re-arms zero-delay timers, which
// makes vitest's fake-timer advancing hang. The 300ms advance transition and
// the 300/500ms rating-lock releases are short enough to wait out for real.
const settle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const rateCurrentViaKeyboard = async (key = "3") => {
  await act(async () => {
    fireEvent.keyDown(document.body, { key });
  });
  // Past the 300ms transition + the 300/500ms rating-lock releases.
  await settle(700);
};

const revealAndRateFlashcard = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
  });
  await settle(700);
};

// jsdom lacks scrollTo on elements; the page resets scroll on every advance.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  window.scrollTo = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();

  api.getSmartStartPosition.mockResolvedValue({ position: 0, shouldShowToast: false, lastPosition: 0 });
  api.rateDocumentEngaging.mockResolvedValue({ success: true } as any);
  api.submitReview.mockResolvedValue({ success: true } as any);
  api.getDueItems.mockResolvedValue([card1]);
  api.getDueExtracts.mockResolvedValue([]);
  api.getSubscribedFeeds.mockReturnValue([]);

  mocks.queueState.filteredItems = [makeDocRow("doc-1", "First Epub", 11), makeDocRow("doc-2", "Second Epub", 10)];
  mocks.queueState.items = [...mocks.queueState.filteredItems];
  mocks.queueState.customSubset = null;

  mocks.tabsState.rootPane = { type: "tabs", id: "pane-1", activeTabId: "tab-1" };
  mocks.tabsState.tabs = [
    {
      id: "tab-1",
      title: "Scroll",
      icon: null,
      type: "queue-scroll",
      content: () => null,
      closable: true,
      data: { queueScrollMode: "optimal" },
    },
  ];
  mocks.tabsState.updateTab.mockImplementation((tabId: string, patch: any) => {
    const tab = mocks.tabsState.tabs.find((t: any) => t.id === tabId);
    if (tab && patch?.data) tab.data = { ...tab.data, ...patch.data };
  });

  useDocumentStore.setState({ documents: [doc1, doc2] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("QueueScrollPage session rebuild stability (optimal path)", () => {
  it("6.2/6.3: keeps the flashcard across a post-rating documents reload, then rates it into the next epub", async () => {
    render(<QueueScrollPage />);

    // Initial composition: [doc-1, card-1, doc-2].
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", "doc-1");

    // Rate the epub (the page's own keyboard rating path → handleRating).
    await rateCurrentViaKeyboard("3");
    expect(api.rateDocumentEngaging).toHaveBeenCalledWith("doc-1", 3, expect.any(Number));

    // advanceAfterRemoval revealed the flashcard; it is current and unrated.
    await awaitFlashcardCurrent();
    expect(documentInView()).not.toBeInTheDocument();
    expect(api.submitReview).not.toHaveBeenCalled();

    // The regression trigger: a documents store reload lands while idle
    // (past the lock releases). The recomposed session reorders to
    // [doc-2, card-1] — without re-anchoring, index 0 would now address
    // doc-2 and the card would be skipped, unreviewed.
    await reloadDocuments([doc1, doc2]);

    expect(flashcardInView()).toBe(true);
    expect(documentInView()).not.toBeInTheDocument();
    expect(api.submitReview).not.toHaveBeenCalled();

    // Rate the card (reveal → Good, through the real card component).
    await revealAndRateFlashcard();
    expect(api.submitReview).toHaveBeenCalledWith("card-1", 3, expect.any(Number), undefined, expect.anything());

    // The next epub becomes current — the rebuild neither double-advanced
    // nor resurrected the rated epub.
    await awaitDocumentCurrent("doc-2");
    expect(flashcardInView()).toBe(false);
  }, 20000);

  it("6.5: a current item deleted externally advances off it exactly once", async () => {
    mocks.queueState.filteredItems = [
      makeDocRow("doc-1", "First Epub", 11),
      makeDocRow("doc-2", "Second Epub", 10),
      makeDocRow("doc-3", "Third Epub", 4),
    ];
    mocks.queueState.items = [...mocks.queueState.filteredItems];
    useDocumentStore.setState({ documents: [doc1, doc2, doc3] });

    render(<QueueScrollPage />);
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", "doc-1");

    // Walk to doc-2: rate doc-1 → card; rate the card → doc-2 current.
    await rateCurrentViaKeyboard("3");
    await awaitFlashcardCurrent();
    await revealAndRateFlashcard();
    await awaitDocumentCurrent("doc-2");

    // doc-2 is deleted elsewhere; the store reload no longer contains it.
    await reloadDocuments([doc1, doc3]);

    // The rebuild advanced off the dead item exactly once: doc-3 is current,
    // the deleted doc-2 is gone, and neither the rated epub nor the rated
    // card resurrected.
    expect(documentInView()).toHaveAttribute("data-document-id", "doc-3");
    expect(screen.queryByTestId("document-viewer")?.getAttribute("data-document-id")).not.toBe("doc-2");
  }, 20000);
});

describe("QueueScrollPage session rebuild stability (queue-list path)", () => {
  beforeEach(() => {
    // Open with explicit items [epub, flashcard, epub] — the list IS the
    // session preview, replayed in order.
    mocks.tabsState.tabs[0].data = {
      queueScrollMode: "queue-list",
      customQueueItems: [
        makeDocRow("doc-1", "First Epub", 11),
        {
          id: "flashcard-card-1",
          itemType: "learning-item",
          learningItemId: "card-1",
          documentId: "doc-1",
          documentTitle: "Card",
          priority: 5,
          estimatedTime: 2,
          tags: ["books"],
          progress: 0,
        },
        makeDocRow("doc-2", "Second Epub", 10),
      ],
    };
  });

  it("6.4: queue-list sessions get the same guarantee across a rating + reload", async () => {
    render(<QueueScrollPage />);
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", "doc-1");

    // Rate the epub → the flashcard is current and unrated.
    await rateCurrentViaKeyboard("3");
    await awaitFlashcardCurrent();
    expect(api.submitReview).not.toHaveBeenCalled();

    // A documents reload rebuilds the replayed list (static customQueueItems
    // re-derived, rated rows filtered) — the card must stay current.
    await reloadDocuments([doc1, doc2]);
    expect(flashcardInView()).toBe(true);
    expect(documentInView()).not.toBeInTheDocument();
    expect(api.submitReview).not.toHaveBeenCalled();

    // Rating the card advances to the next epub, exactly once.
    await revealAndRateFlashcard();
    await awaitDocumentCurrent("doc-2");
  }, 20000);
});

describe("QueueScrollPage overlay controls recovery from the content iframe", () => {
  it("pointer activity forwarded out of the content iframe reveals the hidden controls", async () => {
    render(<QueueScrollPage />);
    await screen.findByTestId("document-viewer");

    // jsdom applies no Tailwind styles, so assert on the overlay root's
    // visibility CLASS rather than computed visibility: ScrollOverlayControls
    // toggles `opacity-0 invisible` ↔ `opacity-100 visible` with showControls.
    // The page also hides the controls on every index change (including
    // mount), so the session starts with them hidden — the exact situation
    // the user hits mid-reading.
    const overlayRootOf = (start: HTMLElement | null): HTMLElement | null => {
      let node = start;
      while (node) {
        if (
          node.classList.contains("fixed") &&
          node.classList.contains("inset-0") &&
          node.classList.contains("z-50")
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    };
    const controlsHidden = () =>
      overlayRootOf(screen.queryByTitle("queueScroll.exitScrollMode"))?.classList.contains("invisible") ?? true;
    expect(screen.getByTitle("queueScroll.exitScrollMode")).toBeInTheDocument();
    expect(controlsHidden()).toBe(true);

    // A pointer move inside the content iframe — where the parent window's
    // mousemove listener can't see it — is bridged to the parent. This is
    // the bottom-of-the-screen recovery path: without the bridge the user
    // had to reach the top bar, a side rail, or a screen edge instead.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(IFRAME_POINTER_ACTIVITY_EVENT, { detail: { kind: "pointer" } }),
      );
    });
    expect(controlsHidden()).toBe(false);
  }, 15000);
});
