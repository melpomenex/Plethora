/**
 * Queue Scroll assistant-context parity (youtube-canonical-transcript-intelligence):
 * the embedded viewer must feed the Assistant Panel the canonical timestamped
 * transcript with live playback time, and PDF window text plus selection-ask
 * handoffs must reach the same panel.
 *
 * Mocking rule (from QueueScrollPage.rebuild.test.tsx): never mock page
 * internals — only stores, API modules, and the leaf viewer components.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";

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
  getLearningItem: vi.fn(async () => null),
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

// ── Leaf component boundary with context probes ──────────────────────────────

const viewerProbe = vi.hoisted(() => ({ props: null as any }));
vi.mock("../../components/viewer/DocumentViewer", () => ({
  DocumentViewer: (props: any) => {
    viewerProbe.props = props;
    return (
      <div data-testid="document-viewer" data-document-id={props.documentId}>
        Viewer for {props.documentId}
      </div>
    );
  },
}));
vi.mock("../../components/tabs/TabRegistry", () => ({
  DocumentViewer: () => <div data-testid="tab-registry-viewer" />,
}));
vi.mock("../../components/viewer/AudiobookViewer", () => ({
  AudiobookViewer: () => null,
}));

const panelProbe = vi.hoisted(() => ({ context: null as any }));
vi.mock("../../components/assistant/AssistantPanel", () => ({
  AssistantPanel: (props: any) => {
    panelProbe.context = props.context;
    return (
      <div data-testid="assistant-panel-probe" className={props.className}>
        <div data-testid="assistant-messages-probe" data-assistant-messages className="overflow-y-auto">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} data-assistant-message-id={`assistant-${index}`} style={{ height: 80 }}>
              Assistant message {index}
            </div>
          ))}
        </div>
      </div>
    );
  },
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

vi.mock("../../hooks/useMobileShell", () => ({
  useMobileShell: () => false,
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
vi.mock("../../components/viewer/selectionInteraction/SelectionActionBar", () => ({
  SelectionActionBar: () => <div data-testid="selection-action-bar" />,
}));
vi.mock("../../components/viewer/SelectionActionsSheet", () => ({
  SelectionActionsSheet: () => null,
}));

import { QueueScrollPage } from "../QueueScrollPage";
import { useDocumentStore } from "../../stores/documentStore";
import { SELECTION_ASK_EVENT } from "../../utils/selectionAskHandoff";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeDocument = (id: string, title: string, fileType: string, filePath: string) =>
  ({
    id,
    title,
    filePath,
    fileType,
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

const makeDocRow = (id: string, title: string, priority: number) =>
  ({
    id: `q-${id}`,
    documentId: id,
    documentTitle: title,
    itemType: "document",
    priority,
    estimatedTime: 10,
    tags: ["articles"],
    progress: 0,
  }) as any;

const youtubeDoc = makeDocument(
  "doc-yt",
  "Attention Lecture",
  "youtube",
  "https://www.youtube.com/watch?v=vid-1",
);
const pdfDoc = makeDocument("doc-pdf", "Cells Paper", "pdf", "/tmp/cells.pdf");
const firstEpubDoc = makeDocument("doc-epub-1", "First EPUB", "epub", "/tmp/first.epub");
const secondEpubDoc = makeDocument("doc-epub-2", "Second EPUB", "epub", "/tmp/second.epub");

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
  api.fetchYouTubeTranscript.mockResolvedValue([]);

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
});

afterEach(() => {
  vi.clearAllMocks();
});

const emitVideoContext = (context: unknown) => {
  act(() => {
    viewerProbe.props.onVideoContextChange(context);
  });
};

describe("Queue Scroll assistant context parity", () => {
  it("feeds the canonical timestamped transcript and live playback time to the Assistant", async () => {
    mocks.queueState.filteredItems = [makeDocRow("doc-yt", "Attention Lecture", 11)];
    mocks.queueState.items = [...mocks.queueState.filteredItems];
    useDocumentStore.setState({ documents: [youtubeDoc] });

    render(<QueueScrollPage />);
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", "doc-yt");

    emitVideoContext({
      videoId: "vid-1",
      title: "Attention Lecture",
      transcript: "[34:20] The speaker explains attention.\n[34:30] Next passage.",
      currentTime: 2060,
      duration: 3600,
      transcriptStatus: "ready-full",
    });

    await waitFor(() => {
      expect(panelProbe.context?.type).toBe("video");
    });
    expect(panelProbe.context.content).toContain("[34:20] The speaker explains attention.");
    expect(panelProbe.context.position?.currentTime).toBe(2060);
    expect(panelProbe.context.transcriptStatus).toBe("ready-full");
    expect(panelProbe.context.status).toBe("ready");
    expect(panelProbe.context.metadata?.videoId).toBe("vid-1");
  });

  it("reports a missing YouTube transcript honestly instead of faking readiness", async () => {
    mocks.queueState.filteredItems = [makeDocRow("doc-yt", "Attention Lecture", 11)];
    mocks.queueState.items = [...mocks.queueState.filteredItems];
    useDocumentStore.setState({ documents: [youtubeDoc] });

    render(<QueueScrollPage />);
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", "doc-yt");

    emitVideoContext({
      videoId: "vid-1",
      title: "Attention Lecture",
      transcript: undefined,
      currentTime: 0,
      duration: 3600,
      transcriptStatus: "unavailable",
    });

    await waitFor(() => {
      expect(panelProbe.context?.transcriptStatus).toBe("unavailable");
    });
    expect(panelProbe.context.content).toBeUndefined();
    expect(panelProbe.context.status).toBe("unavailable");
  });

  it("routes PDF window text and selection-Ask handoffs into the panel context", async () => {
    mocks.queueState.filteredItems = [makeDocRow("doc-pdf", "Cells Paper", 11)];
    mocks.queueState.items = [...mocks.queueState.filteredItems];
    useDocumentStore.setState({ documents: [pdfDoc] });

    render(<QueueScrollPage />);
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", "doc-pdf");

    act(() => {
      viewerProbe.props.onPdfContextTextChange("PDF window text about cell membranes.");
    });

    await waitFor(() => {
      expect(panelProbe.context?.content).toContain("PDF window text about cell membranes.");
    });
    expect(panelProbe.context.type).toBe("document");

    // Select-to-Ask lands in the same thread without re-selecting.
    act(() => {
      window.dispatchEvent(
        new CustomEvent(SELECTION_ASK_EVENT, {
          detail: { snapshot: { documentId: "doc-pdf", excerpt: "the selected membrane passage" } },
        }),
      );
    });

    await waitFor(() => {
      expect(panelProbe.context?.selection).toBe("the selected membrane passage");
    });
    expect(screen.getByTestId("assistant-panel-probe")).toBeInTheDocument();
  });

  it("keeps the Assistant transcript in place while viewing an EPUB in Scroll Mode", async () => {
    const items = [
      makeDocRow(firstEpubDoc.id, firstEpubDoc.title, 11),
      makeDocRow(secondEpubDoc.id, secondEpubDoc.title, 10),
    ];
    mocks.queueState.filteredItems = items;
    mocks.queueState.items = items;
    mocks.tabsState.tabs[0].data = {
      queueScrollMode: "queue-list",
      customQueueItems: items,
    };
    useDocumentStore.setState({ documents: [firstEpubDoc, secondEpubDoc] });

    render(<QueueScrollPage />);
    const viewer = await screen.findByTestId("document-viewer");
    expect(viewer).toHaveAttribute("data-document-id", firstEpubDoc.id);

    const assistant = screen.getByTestId("assistant-panel-probe");
    expect(assistant).toHaveClass("assistant-panel");
    const transcript = screen.getByTestId("assistant-messages-probe");
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 300 },
    });
    transcript.scrollTop = 240;

    fireEvent.wheel(transcript, { deltaY: 120 });
    expect(screen.getByTestId("document-viewer")).toHaveAttribute("data-document-id", firstEpubDoc.id);
    expect(transcript.scrollTop).toBe(240);

    act(() => viewerProbe.props.onScrollPositionChange({ scrollPercent: 100 }));
    fireEvent.touchStart(transcript, { touches: [{ clientX: 100, clientY: 450 }] });
    fireEvent.touchMove(transcript, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(transcript, { changedTouches: [{ clientX: 100, clientY: 100 }] });

    expect(screen.getByTestId("document-viewer")).toHaveAttribute("data-document-id", firstEpubDoc.id);
    expect(transcript.scrollTop).toBe(240);
  });

  it("does not reset the Assistant transcript when the delayed EPUB item reset runs", async () => {
    const items = [
      makeDocRow(firstEpubDoc.id, firstEpubDoc.title, 11),
      makeDocRow(secondEpubDoc.id, secondEpubDoc.title, 10),
    ];
    mocks.queueState.filteredItems = items;
    mocks.queueState.items = items;
    mocks.tabsState.tabs[0].data = {
      queueScrollMode: "queue-list",
      customQueueItems: items,
    };
    useDocumentStore.setState({ documents: [firstEpubDoc, secondEpubDoc] });

    render(<QueueScrollPage />);
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", firstEpubDoc.id);

    const transcript = screen.getByTestId("assistant-messages-probe");
    Object.defineProperties(transcript, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 300 },
    });
    transcript.scrollTop = 900;

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(await screen.findByTestId("document-viewer")).toHaveAttribute("data-document-id", secondEpubDoc.id);

    // Queue Scroll Mode resets its reader surface 300 ms after navigation.
    // That delayed reset must not reach the independently scrolling Assistant.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(transcript.scrollTop).toBe(900);
  });
});
