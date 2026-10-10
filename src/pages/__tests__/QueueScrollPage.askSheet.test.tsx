/**
 * Regression test: in mobile Scroll Mode (queue), tapping Ask on a text
 * selection must open the new AskSheet bottom-sheet composer — not fall
 * through to the legacy AI action sheet.
 *
 * Bug report: with rating buttons present in queue scroll mode, the ask
 * sheet never opened. Root cause: QueueScrollPage.handleSelectionBarAction
 * had no AskSheet branch, so "ask" fell through to setPendingAiAction and
 * the legacy SelectionActionsSheet.
 *
 * Mocking rule (from QueueScrollPage.rebuild.test.tsx): never mock page
 * internals — only stores, API modules, leaf components, and the shared
 * selection hook.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";

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
  rankBreakdowns: new Map<string, unknown>(),
  rankBreakdownKnobs: null,
  useQueueStore: Object.assign(
    (selector?: (s: any) => unknown) => (selector ? selector(mocks.queueState) : mocks.queueState),
    { getState: () => mocks.queueState },
  ),
}));

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
  settings.rssQueue.includeInQueue = false;
  settings.podcastQueue.includeInQueue = false;
  // The AskSheet feature flag under test.
  settings.features.askSheetMobile = true;
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
  ASSISTANT_MIN_WIDTH: 300,
  ASSISTANT_MAX_WIDTH: 800,
  READER_MIN_WIDTH: 320,
}));
vi.mock("../../components/media/summary", () => ({
  ModernSummaryPanel: () => null,
}));
vi.mock("../../components/common/ReaderTTSControls", () => ({
  ReaderTTSControls: () => null,
}));
vi.mock("../../components/common/Tabs/TabContent", () => ({
  useTabId: () => "tab-1",
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
vi.mock("../../lib/autoFileSyncDownload", () => ({
  prefetchQueuedDocuments: vi.fn(async () => {}),
}));

// ── AskSheet regression probes ───────────────────────────────────────────────

vi.mock("../../hooks/useMobileShell", () => ({
  useMobileShell: () => true,
}));

const barCapture = vi.hoisted(() => ({
  onAction: null as null | ((action: string) => void),
}));
vi.mock("../../components/viewer/selectionInteraction/SelectionActionBar", () => ({
  SelectionActionBar: (props: any) => {
    barCapture.onAction = props.onAction;
    return <div data-testid="selection-action-bar" />;
  },
}));

vi.mock("../../components/assistant/AskSheet", () => ({
  AskSheet: (props: any) => (
    <div
      data-testid="ask-sheet-probe"
      data-open={props.open ? "true" : "false"}
      data-passage={props.request?.passage ?? ""}
      data-document-id={props.request?.documentId ?? ""}
      data-document-title={props.request?.documentTitle ?? ""}
    />
  ),
}));

vi.mock("../../components/viewer/SelectionActionsSheet", () => ({
  SelectionActionsSheet: (props: any) => (
    <div
      data-testid="legacy-sheet-probe"
      data-initial-action={props.initialAction ?? ""}
    />
  ),
}));

const selectionFake = vi.hoisted(() => ({
  phase: "idle",
  placement: null,
  readySelection: null,
  capturedAction: null,
  captureForAction: vi.fn(() => ({
    operationId: "op-1",
    text: "the selected passage",
    passage: "the selected passage",
    selectionContext: null,
    geometry: null,
    documentId: null,
    surface: "bar",
    readerContext: null,
    capturedAt: Date.now(),
  })),
  dismiss: vi.fn(),
  registerBarSize: vi.fn(),
  registerContentRoot: vi.fn(),
  notifyActionSettled: vi.fn(),
}));
vi.mock("../../components/viewer/selectionInteraction/useSelectionInteraction", () => ({
  useSelectionInteraction: () => selectionFake,
}));

import { QueueScrollPage } from "../QueueScrollPage";
import { useDocumentStore } from "../../stores/documentStore";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeDocument = (id: string, title: string) =>
  ({
    id,
    title,
    fileType: "html",
    category: "articles",
    isArchived: false,
    isDismissed: false,
    dateLastReviewed: null,
    date_added: "2026-01-01T00:00:00Z",
    date_modified: "2026-01-01T00:00:00Z",
    reps: 0,
    readingCount: 0,
    priorityScore: 50,
  }) as any;

const makeDocRow = (id: string, title: string) =>
  ({
    id: `q-${id}`,
    documentId: id,
    documentTitle: title,
    itemType: "document",
    priority: 11,
    estimatedTime: 10,
    tags: ["articles"],
    progress: 0,
  }) as any;

const doc1 = makeDocument("doc-1", "First Article");

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  window.scrollTo = () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();

  api.getSmartStartPosition.mockResolvedValue({ position: 0, shouldShowToast: false, lastPosition: 0 });
  api.getDueItems.mockResolvedValue([]);
  api.getDueExtracts.mockResolvedValue([]);
  api.getSubscribedFeeds.mockReturnValue([]);

  mocks.queueState.filteredItems = [];
  mocks.queueState.items = [];
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
      // queue-list mode: scrollItems derive deterministically from the static
      // customQueueItems below — no neural/optimal machinery involved.
      data: {
        queueScrollMode: "queue-list",
        customQueueItems: [makeDocRow("doc-1", "First Article")],
      },
    },
  ];

  useDocumentStore.setState({ documents: [doc1] });
  barCapture.onAction = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("QueueScrollPage AskSheet routing (mobile scroll mode)", () => {
  it("opens AskSheet — not the legacy sheet — when Ask is tapped on a selection", async () => {
    render(<QueueScrollPage />);

    // The queue-list session build is async; wait for the document item.
    await waitFor(() => expect(screen.getByTestId("document-viewer")).toBeTruthy());
    expect(barCapture.onAction).not.toBeNull();

    await act(async () => {
      barCapture.onAction!("ask");
    });

    const probe = screen.getByTestId("ask-sheet-probe");
    expect(probe.getAttribute("data-open")).toBe("true");
    expect(probe.getAttribute("data-passage")).toBe("the selected passage");
    expect(probe.getAttribute("data-document-id")).toBe("doc-1");
    expect(probe.getAttribute("data-document-title")).toBe("First Article");

    // The legacy AI action sheet must not have been driven.
    expect(screen.getByTestId("legacy-sheet-probe").getAttribute("data-initial-action")).toBe("");
  });

  it("keeps the legacy path when the askSheetMobile flag is off", async () => {
    mocks.settingsState.settings.features.askSheetMobile = false;
    render(<QueueScrollPage />);

    await waitFor(() => expect(screen.getByTestId("document-viewer")).toBeTruthy());
    expect(barCapture.onAction).not.toBeNull();

    await act(async () => {
      barCapture.onAction!("ask");
    });

    // AskSheet stays closed; the legacy sheet receives the ask action.
    expect(screen.getByTestId("ask-sheet-probe").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("legacy-sheet-probe").getAttribute("data-initial-action")).toBe("ask");
  });
});
