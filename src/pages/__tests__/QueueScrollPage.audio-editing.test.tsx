import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
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
    settings: null,
    updateSettingsCategory: vi.fn(),
  };
  return { queueState, tabsState, settingsState };
});

vi.mock("../../stores/queueStore", () => ({
  // DAQE's derived ranking cache. Absent means "no ranking yet", which
  // is the faithful empty value for a Map the components only read.
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
  updateLearningItem: vi.fn(async () => ({ success: true })),
  updateLearningItemContentWithVersion: vi.fn(async (_id: string, updated: any) => updated),
  updateLearningItemTags: vi.fn(async (_id: string, tags: string[]) => ({ tags })),
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

vi.mock("../../components/viewer/DocumentViewer", () => ({
  DocumentViewer: ({ documentId, listenToEdition, autoPlay }: any) => (
    <div
      data-testid="document-viewer"
      data-document-id={documentId}
      data-listen-edition={String(listenToEdition)}
      data-auto-play={String(autoPlay)}
    >
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

import { QueueScrollPage } from "../QueueScrollPage";
import { useDocumentStore } from "../../stores/documentStore";

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

const makeCard = (id: string, question: string, extras?: any) =>
  ({
    id,
    document_id: "doc-1",
    item_type: "Basic",
    question,
    answer: "Answer 42",
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
    ...extras,
  }) as any;

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
  api.getDueItems.mockResolvedValue([]);
  api.getDueExtracts.mockResolvedValue([]);
  api.getSubscribedFeeds.mockReturnValue([]);

  mocks.tabsState.tabs = [
    {
      id: "tab-1",
      title: "Queue Scroll",
      type: "queue-scroll",
      pinned: false,
      isModified: false,
      data: {
        queueScrollMode: "queue-list",
      },
    },
  ];
  mocks.tabsState.rootPane = { type: "tabs", id: "pane-1", activeTabId: "tab-1" };
  mocks.tabsState.updateTab.mockImplementation((tabId: string, patch: any) => {
    const tab = mocks.tabsState.tabs.find((t: any) => t.id === tabId);
    if (tab && patch?.data) tab.data = { ...tab.data, ...patch.data };
  });
});

describe("QueueScrollPage audio editions and in-queue editing", () => {
  it("renders DocumentViewer with listenToEdition and autoPlay when queue item has audio edition", async () => {
    const docAudio = makeDocument("doc-audio", "Audio Book Document");
    useDocumentStore.setState({ documents: [docAudio] });

    mocks.tabsState.tabs[0].data = {
      queueScrollMode: "queue-list",
      customQueueItems: [
        {
          id: "q-audio-1",
          documentId: "doc-audio",
          documentTitle: "Audio Book Document",
          itemType: "document",
          priority: 10,
          estimatedTime: 10,
          tags: ["books"],
          progress: 0,
          hasAudioEdition: true,
          audioEditionId: "edition-123",
        },
      ],
    };

    render(<QueueScrollPage />);

    await waitFor(() => {
      const viewer = screen.getByTestId("document-viewer");
      expect(viewer).toHaveAttribute("data-document-id", "doc-audio");
      expect(viewer).toHaveAttribute("data-listen-edition", "true");
      expect(viewer).toHaveAttribute("data-auto-play", "true");
    });
  });

  it("opens InlineCardEditor on edit button click and updates flashcard in place", async () => {
    const card = makeCard("card-edit-test", "Original Card Question");
    api.getDueItems.mockResolvedValue([card]);

    mocks.tabsState.tabs[0].data = {
      queueScrollMode: "queue-list",
      customQueueItems: [
        {
          id: "flashcard-card-edit-test",
          itemType: "learning-item",
          learningItemId: "card-edit-test",
          documentId: "doc-1",
          documentTitle: "Original Card Question",
          question: "Original Card Question",
          answer: "Answer 42",
          priority: 5,
          estimatedTime: 2,
          tags: ["books"],
          progress: 0,
        },
      ],
    };

    render(<QueueScrollPage />);

    await waitFor(() => {
      expect(screen.getByText("Basic")).toBeInTheDocument();
      expect(screen.getAllByText("Original Card Question").length).toBeGreaterThan(0);
    });

    const editBtn = screen.getByTestId("review-card-edit");
    await act(async () => {
      fireEvent.click(editBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-card-editor")).toBeInTheDocument();
    });

    const frontInput = screen.getByDisplayValue("Original Card Question");
    fireEvent.change(frontInput, { target: { value: "Updated Card Question" } });

    const saveBtn = screen.getByTestId("inline-card-editor-save");
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("inline-card-editor")).not.toBeInTheDocument();
      expect(screen.getAllByText("Updated Card Question").length).toBeGreaterThan(0);
    });
  });

  it("opens InlineCardEditor via Cmd+E shortcut when viewing flashcard", async () => {
    const card = makeCard("card-shortcut-test", "Shortcut Card Question");
    api.getDueItems.mockResolvedValue([card]);

    mocks.tabsState.tabs[0].data = {
      queueScrollMode: "queue-list",
      customQueueItems: [
        {
          id: "flashcard-card-shortcut-test",
          itemType: "learning-item",
          learningItemId: "card-shortcut-test",
          documentId: "doc-1",
          documentTitle: "Shortcut Card Question",
          priority: 5,
          estimatedTime: 2,
          tags: ["books"],
          progress: 0,
        },
      ],
    };

    render(<QueueScrollPage />);

    await waitFor(() => {
      expect(screen.getByText("Basic")).toBeInTheDocument();
      expect(screen.getAllByText("Shortcut Card Question").length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "e", metaKey: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-card-editor")).toBeInTheDocument();
    });
  });

  it("dispatches plethora:create-image-occlusion when editing image occlusion card in studio", async () => {
    const occlusionCard = makeCard("card-occlusion-test", "Occlusion Card", {
      item_type: "ImageOcclusion",
      interaction_metadata: {
        imageOcclusionAssetId: "asset-occlusion-99",
      },
    });
    api.getDueItems.mockResolvedValue([occlusionCard]);

    mocks.tabsState.tabs[0].data = {
      queueScrollMode: "queue-list",
      customQueueItems: [
        {
          id: "flashcard-card-occlusion-test",
          itemType: "learning-item",
          learningItemId: "card-occlusion-test",
          documentId: "doc-1",
          documentTitle: "Occlusion Card",
          priority: 5,
          estimatedTime: 2,
          tags: ["books"],
          progress: 0,
        },
      ],
    };

    const occlusionListener = vi.fn();
    window.addEventListener("plethora:create-image-occlusion", occlusionListener);

    render(<QueueScrollPage />);

    await waitFor(() => {
      expect(screen.getByText("ImageOcclusion")).toBeInTheDocument();
    });

    const editBtn = screen.getByTestId("review-card-edit");
    await act(async () => {
      fireEvent.click(editBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("inline-card-editor")).toBeInTheDocument();
    });

    const studioBtn = screen.getByTestId("inline-card-editor-studio-btn");
    await act(async () => {
      fireEvent.click(studioBtn);
    });

    expect(occlusionListener).toHaveBeenCalledTimes(1);
    expect(occlusionListener.mock.calls[0][0].detail).toEqual({
      assetId: "asset-occlusion-99",
      documentId: "doc-1",
    });

    window.removeEventListener("plethora:create-image-occlusion", occlusionListener);
  });
});
