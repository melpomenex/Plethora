import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../lib/i18n";
import { useTabsStore, type TabPane } from "../stores/tabsStore";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  ChatCircle,
  CircleNotch,
  Code,
  Eye,
  EyeSlash,
  Info,
  Lightbulb,
  Sliders,
  Sparkle,
  TextT,
  Translate,
  WarningCircle,
  Waves,
} from "@phosphor-icons/react";
import { lookupDictionary, type DictionaryResult } from "../utils/dictionaryLookup";
import { getStoredAssistantProvider, persistAssistantProvider } from "../utils/assistantProvider";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueueStore } from "../stores/queueStore";
import type { QueueItem } from "../types/queue";
import { useDocumentStore } from "../stores/documentStore";
import { defaultSettings, useSettingsStore } from "../stores/settingsStore";
import { DocumentViewer } from "../components/viewer/DocumentViewer";
import { AudiobookViewer } from "../components/viewer/AudiobookViewer";
import { FlashcardScrollItem } from "../components/review/FlashcardScrollItem";
import { rateDocumentEngaging, getSmartStartPosition } from "../api/algorithm";
import { getDueItems, type LearningItem } from "../api/learning-items";
import { sanitizeHtml } from "../components/common/RichContentRenderer";
import { getDueExtracts, submitExtractReview } from "../api/extract-review";
import { createExtract, deleteExtract, setExtractPriority, getExtract, type Extract } from "../api/extracts";
import {
  buildNeuralQueue,
  getNeuralQueueResolvedFront,
  consumeNeuralQueueElement,
  refillNeuralQueueIfDepleted,
  getNeuralQueueRemaining,
  type ResolvedNeuralQueueEntry,
  type NeuralElementKind,
} from "../api/neural-queue";
import { resolveEmbeddingConfig } from "../stores/ragStore";
import {
  buildNeuralScrollItems as neuralBuildNeuralScrollItems,
  neuralSeedFromItem,
  NEURAL_FETCH_BATCH,
} from "./queueScrollNeural";
import { ExtractScrollItem } from "../components/review/ExtractScrollItem";
import { ClozeCreatorPopup } from "../components/extracts/ClozeCreatorPopup";
import { QACreatorPopup } from "../components/extracts/QACreatorPopup";
import { CreateExtractDialog } from "../components/extracts/CreateExtractDialog";
import { QueueExtractsView } from "../components/queue/QueueExtractsView";
import { FlashcardStudioModal } from "../components/review/FlashcardStudioModal";
import { LearningCardsList } from "../components/learning/LearningCardsList";
import { submitReview } from "../api/review";
import { composeSession } from "./queueScrollBudget";
import { DEFAULT_COMBINED_SORT_CONFIG, orderScrollItemsByCombinedCriterion, selectByQuotaInOrder } from "../utils/queueScrollOrder";
import { gateScrollItemsByComposition, gateScrollItemsByType, resolveMissingExtractContent } from "./queueScrollItemTypes";
import { FLASHCARD_REVEAL_EVENT, resolveScrollRatingKey } from "./queueScrollKeyboard";
import { shouldBuildScrollSession } from "./queueScrollSessionLifecycle";
import {
  getUnreadItemsAuto,
  getSubscribedFeedsAuto,
  type FeedItem as RSSFeedItem,
  type Feed as RSSFeed,
  markItemReadAuto,
  toggleItemFavoriteAuto,
  getArticleFullContent,
  fetchArticleFullContent,
} from "../api/rss";
import { cleanArticleHtml } from "../components/media/RSSFullContentView";
import { getEpisodeQueue, markEpisodePlayed, importPodcastEpisodeAsDocument, type PodcastEpisode } from "../api/podcast";
import { cn } from "../utils";
import type { SessionItemTypes } from "../utils/reviewUx";
import type { Document } from "../types/document";
import { scoreRssRelevance, type RssClassifier } from "../utils/rssRelevance";
import { useClassifiersStore } from "../stores/classifiersStore";
import { RelevanceIndicator } from "../components/media/RelevanceIndicator";
import { ItemDetailsPopover, type ItemDetailsTarget } from "../components/common/ItemDetailsPopover";
import type { TaggedItemSummary } from "../api/tags";
import { useUndoableOperations } from "../api/undoable";
import { AssistantPanel, type AssistantContext, type AssistantPosition } from "../components/assistant/AssistantPanel";
import { useToast } from "../components/common/Toast";
import { useMobileShell } from "../hooks/useMobileShell";
import { RSSQueueSettingsModal } from "../components/settings/RSSQueueSettings";
import { createDocument, updateDocumentContent, updateDocumentPriority, dismissDocument, getDocument, extractDocumentText } from "../api/documents";
import { trimToTokenWindow } from "../utils/tokenizer";
import { fetchYouTubeTranscript } from "../api/youtube";
import { ReaderTTSControls } from "../components/common/ReaderTTSControls";
import { usePaneId, useIsActiveTab } from "../components/common/Tabs/TabContent";
import { useQueueTimeTracker, type QueueTimedTarget } from "../hooks/useQueueTimeTracker";
import { DocumentViewer as DocumentViewerTab } from "../components/tabs/TabRegistry";
import { ScrollQueueSettings } from "../components/queue/ScrollQueueSettings";
import { ScrollOverlayControls } from "../components/queue/ScrollOverlayControls";
import type { ExtractSourceContext } from "../types/extractNavigation";
import { bulkSuspendItems } from "../api/queue";
import { ModernSummaryPanel } from "../components/media/summary";
import { useSummaryCache } from "../utils/rssSummary";
import {
  SUMMARY_LENGTH_CONFIG,
  SUMMARY_LOADING_STAGES,
  type SummaryLength,
  type SummaryFocus,
} from "../types/rssSummary";
import { chatWithLLM, type LLMMessage } from "../api/llm";
import { getAIConfig, type AIConfig } from "../api/ai";
import { useLLMProvidersStore } from "../stores/llmProvidersStore";
import {
  resolvePdfAssistantContext,
  resolveGenericAssistantContext,
  type ResolvedAssistantContext
} from "../utils/assistantContext";
import {
  hasActiveTextSelection,
  isEligibleOverlayTapTarget,
  isStationaryTap,
} from "../utils/queueOverlayActivation";
import {
  handleVolumeRockerNavigation,
  isVolumeRockerNavigationKey,
} from "../utils/volumeRockerNavigation";

/**
 * Default item types for a Scroll Mode tab whose `data` carries no
 * `itemTypes` (e.g. opened by some route other than the Queue): all three
 * types on — the pre-existing behaviour, so nothing else regresses.
 */
const DEFAULT_ITEM_TYPES: SessionItemTypes = { documents: true, extracts: true, learningItems: true };

const buildTranscriptText = (segments: Array<{ text: string }>): string =>
  segments
    .map((segment) => segment.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const stripHtmlToText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractYouTubeId = (urlOrId: string): string => {
  if (!urlOrId) return "";
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) return match[1];
  }

  return urlOrId;
};

const prioritySliderToRating = (slider: number): number => {
  if (slider >= 81) return 5;
  if (slider >= 61) return 4;
  if (slider >= 41) return 3;
  if (slider >= 21) return 2;
  return 1;
};

/**
 * Unified scroll item type for documents, RSS articles, and flashcards
 */
interface ScrollItem {
  id: string;
  type: "document" | "rss" | "flashcard" | "extract" | "podcast";
  documentId?: string;
  documentTitle: string;
  rssItem?: RSSFeedItem;
  rssFeed?: RSSFeed;
  podcastEpisode?: PodcastEpisode;
  learningItem?: LearningItem;
  extract?: Extract;
  /** Topic/category for variety mixing */
  category?: string;
  /** Estimated reading time in minutes */
  estimatedTime?: number;
  /** Priority for engagement ordering */
  engagementScore?: number;
  /** RSS relevance score (0.0-1.0) from classifier-based scoring */
  relevanceScore?: number;
  /**
   * The element_tree.id this item came from in neural review (undefined in
   * normal Scroll Mode). Used to correlate with the neural_queue so advancing
   * can `consume` the right element and trigger a refill when depleted.
   */
  neuralElementId?: number;
}

/**
 * Map due flashcards to scroll items. Shared by the optimal path and the
 * sequential path's top-up so both entry points build identical cards.
 */
function toFlashcardScrollItems(
  cards: LearningItem[],
  stableRandom: (str: string, offset?: number) => number
): ScrollItem[] {
  return cards.map((item) => ({
    id: `flashcard-${item.id}`,
    type: "flashcard" as const,
    documentTitle: item.question.substring(0, 50) + (item.question.length > 50 ? "..." : ""),
    learningItem: item,
    category: item.tags?.[0] ?? "flashcards",
    estimatedTime: 2, // Flashcards are quick
    // Use stable random based on item ID to prevent re-render loops
    engagementScore: 5 + stableRandom(item.id, 1) * 2,
  }));
}

/**
 * Map document queue rows to scroll items, skipping archived documents.
 * Shared by the optimal path and the sequential path's top-up.
 */
function toDocumentScrollItems(
  items: QueueItem[],
  documentsMap: ReadonlyMap<string, Document>,
  stableRandom: (str: string, offset?: number) => number
): ScrollItem[] {
  return items
    .map((item): ScrollItem | null => {
      const doc = documentsMap.get(item.documentId);
      if (doc?.isArchived) {
        return null;
      }
      const isNew = !doc?.dateLastReviewed;
      const priority = item.priority ?? 5;
      const recencyBoost = isNew ? 2 : 0;
      const baseScore = priority + recencyBoost;
      const serendipityBonus = stableRandom(item.id, 2) * 1.5;

      return {
        id: item.id,
        type: "document" as const,
        documentId: item.documentId,
        documentTitle: item.documentTitle,
        category: doc?.category ?? item.tags?.[0] ?? "uncategorized",
        estimatedTime: item.estimatedTime ?? 10,
        engagementScore: baseScore + serendipityBonus,
      };
    })
    .filter((item): item is ScrollItem => item !== null);
}

/**
 * Map due extracts to scroll items. Shared by the optimal path and the
 * sequential path's top-up.
 */
function toExtractScrollItems(
  extracts: Extract[],
  documentsMap: ReadonlyMap<string, Document>,
  fallbackTitle: string,
  stableRandom: (str: string, offset?: number) => number
): ScrollItem[] {
  return extracts.map((extract) => {
    const doc = documentsMap.get(extract.document_id);
    const title = doc ? doc.title : fallbackTitle;

    return {
      id: `extract-${extract.id}`,
      type: "extract" as const,
      documentTitle: title,
      extract: extract,
      category: extract.category ?? doc?.category ?? "extracts",
      estimatedTime: 3,
      engagementScore: 5 + stableRandom(extract.id, 4) * 1.5,
    };
  });
}

/**
 * Remove duplicate scroll items by id, keeping the first occurrence — the
 * sequential path's own rows come first, so they always take priority over
 * topped-up items from the due pools.
 */
function dedupeById(items: ScrollItem[]): ScrollItem[] {
  const seen = new Set<string>();
  const result: ScrollItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

/**
 * Resolve neural-queue entries into renderable ScrollItems. Thin wrapper over
 * the testable `buildNeuralScrollItems` in `queueScrollNeural.ts` — the
 * structural `NeuralScrollItem` it returns is a subset of ScrollItem, so the
 * cast is sound. See that module for the resolution/ordering rationale.
 */
async function buildNeuralScrollItems(
  entries: ResolvedNeuralQueueEntry[],
  documentsMap: ReadonlyMap<string, Document>,
  fallbackTitle: string,
): Promise<ScrollItem[]> {
  return (await neuralBuildNeuralScrollItems(entries, documentsMap, fallbackTitle)) as ScrollItem[];
}

// Session storage keys for smart resume
const SESSION_KEYS = {
  LAST_POSITION: "scroll-mode-last-position",
  SESSION_TIMESTAMP: "scroll-mode-session-time",
  ITEMS_REVIEWED: "scroll-mode-items-reviewed",
  RATED_IDS: "scroll-mode-rated-ids",
  READ_RSS_IDS: "scroll-mode-read-rss-ids",
} as const;

/**
 * QueueScrollPage - TikTok-style vertical scrolling through document queue, flashcards, and RSS articles
 *
 * Features:
 * - Full-screen immersive document reading and flashcard review
 * - Mouse wheel scroll navigation (scroll down = next, scroll up = previous)
 * - Smooth transitions between items
 * - Inline rating controls for documents and flashcards
 * - RSS article reading with mark as read
 * - Position indicator
 * - FSRS-6 Engaging algorithm with variety mixing
 * - Smart start position (resumes or varies start for engagement)
 */
export function QueueScrollPage() {
  const { t } = useI18n();
  const { filteredItems: allQueueItems, loadQueue, customSubset, postponeItemSmart } = useQueueStore(useShallow(s => ({
    filteredItems: s.filteredItems,
    loadQueue: s.loadQueue,
    customSubset: s.customSubset,
    postponeItemSmart: s.postponeItemSmart,
  })));
  const { deleteDocument: deleteDocumentUndoable, deleteExtract: deleteExtractUndoable, deleteLearningItem: deleteLearningItemUndoable } = useUndoableOperations();
  const { documents, loadDocuments, addDocument, updateDocument } = useDocumentStore(useShallow(s => ({
    documents: s.documents,
    loadDocuments: s.loadDocuments,
    addDocument: s.addDocument,
    updateDocument: s.updateDocument,
  })));
  const { rootPane, closeTab, updateTab, addTab, tabs } = useTabsStore(useShallow(s => ({
    rootPane: s.rootPane,
    closeTab: s.closeTab,
    updateTab: s.updateTab,
    addTab: s.addTab,
    tabs: s.tabs,
  })));
  const { settings, updateSettingsCategory } = useSettingsStore(useShallow(s => ({
    settings: s.settings,
    updateSettingsCategory: s.updateSettingsCategory,
  })));
  const paneId = usePaneId();

  const isActiveTab = useIsActiveTab();

  // The tab this scroll view lives in. Resolve it from *our own* pane, and only
  // while we are the active tab — the previous version read the first pane's
  // activeTabId, i.e. whatever tab was globally active. Because the position
  // effect below re-fires whenever that id changes, switching to any other tab
  // made this component write its scroll position into *that* tab's data,
  // wiping fields it did not own (a document-viewer's documentId, for one,
  // which left it rendering nothing at all).
  const activeTabId = useMemo(() => {
    if (!isActiveTab) return null;
    const findPane = (pane: typeof rootPane): TabPane | null => {
      if (pane.type === "tabs") return pane.id === paneId ? pane : null;
      if (pane.type === "split") {
        for (const child of pane.children) {
          const found = findPane(child);
          if (found) return found;
        }
      }
      return null;
    };
    return findPane(rootPane)?.activeTabId ?? null;
  }, [rootPane, paneId, isActiveTab]);

  // Merge into the tab's existing data. `updateTab` spreads at the Tab level, so
  // passing `data` wholesale replaces it and silently drops any key we didn't set.
  const patchTabData = useCallback(
    (tabId: string, patch: Record<string, unknown>) => {
      const existing = useTabsStore.getState().tabs.find((t) => t.id === tabId)?.data ?? {};
      updateTab(tabId, { data: { ...existing, ...patch } });
    },
    [updateTab]
  );
  const toast = useToast();

  // Derive ONLY the queue-related fields the builders/persisters read from the
  // active tab's data. The wrapper object returned here is rebuilt every render
  // (because `tabs` changes on every navigation), but the EFFECT dependency
  // arrays below list the individual FIELDS (e.g. `.customQueueItems`) rather
  // than the wrapper, so React compares them with Object.is. Because the queue
  // is written once into tab data at creation and only `currentIndex`/
  // `renderedIndex` are patched on navigation, those field references stay
  // stable across navigation and the builders do NOT re-run on every step.
  const activeTabQueueData = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    return {
      customQueueItems: activeTab?.data?.customQueueItems as QueueItem[] | undefined,
      queueScrollMode: activeTab?.data?.queueScrollMode as "queue-list" | "optimal" | undefined,
      itemTypes: (activeTab?.data?.itemTypes as SessionItemTypes | undefined) ?? DEFAULT_ITEM_TYPES,
      persistedCurrentIndex: activeTab?.data?.currentIndex as number | undefined,
    };
  }, [tabs, activeTabId]);

  const contextWindowTokens = settings.ai.maxTokens;
  const aiModel = settings.ai.model;

  // Use smart start position instead of always starting at 0
  const [currentIndex, setCurrentIndex] = useState(0);
  const [renderedIndex, setRenderedIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showRatingControls, setShowRatingControls] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRssSettings, setShowRssSettings] = useState(false);
  const [isImageExpanded, setIsImageExpanded] = useState(settings.rssQueue.showCoverImage ?? false);

  // Full content states
  const [showFullContent, setShowFullContent] = useState(false);
  const [fullContentMap, setFullContentMap] = useState<Map<string, string>>(new Map());
  const [loadingFullContent, setLoadingFullContent] = useState<Set<string>>(new Set());
  const [fullContentErrors, setFullContentErrors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    setIsImageExpanded(settings.rssQueue.showCoverImage ?? false);
  }, [currentIndex, settings.rssQueue.showCoverImage]);
  const [scrollItems, setScrollItems] = useState<ScrollItem[]>([]);
  // Composition report of the last-built OPTIMAL session (the path where the
  // shares are authoritative): what each type supplied and how far it fell
  // short of its share. Shown as a note in the Queue Settings panel. The
  // sequential path clears it — its session is a list replay with top-ups, so
  // a share gap there is not the final session's gap.
  const [compositionReport, setCompositionReport] = useState<{
    counts: { documents: number; extracts: number; flashcards: number };
    shortfall: { documents: number; extracts: number; flashcards: number };
  } | null>(null);
  // ── Neural review mode ("Go neural") ────────────────────────────────────
  // When active, scrollItems come from the neural_queue (spreading activation
  // seeded at the item the user was reading) instead of the normal queue.
  // The pre-neural snapshot is restored on exit so the user returns to exactly
  // where they were — the priority queue is never mutated.
  const [isNeuralMode, setIsNeuralMode] = useState(false);
  const [isNeuralLoading, setIsNeuralLoading] = useState(false);
  const [neuralRemaining, setNeuralRemaining] = useState<number | null>(null);
  const [preNeuralScrollItems, setPreNeuralScrollItems] = useState<ScrollItem[] | null>(null);
  const [preNeuralIndex, setPreNeuralIndex] = useState(0);
  // The seed (kind + ref id) the user entered neural from, kept in a ref so the
  // refill-after-consume path can re-seed without re-deriving it. Per the
  // backend contract, refill re-seeds at the *consumed* element, so this holds
  // the most-recently-studied element, updated on each advance.
  const neuralSeedRef = useRef<{ kind: NeuralElementKind; refId: string } | null>(null);
  // The embedding config used at neural-build time, kept so the refill-after-
  // consume path passes the same config (semantic neighbors stay in play).
  const neuralEmbeddingConfigRef = useRef<import("../api/rag").EmbeddingConfig | null>(null);
  const [dueFlashcards, setDueFlashcards] = useState<LearningItem[]>([]);
  const [dueExtracts, setDueExtracts] = useState<Extract[]>([]);
  // Maps podcast episodeId → real Document.id, so extracts created from a
  // podcast's transcript resolve to a genuine document row (the synthetic
  // document passed to AudiobookViewer otherwise uses the episode id, which
  // fails the extracts.document_id FK). Resolved lazily via
  // importPodcastEpisodeAsDocument (idempotent — returns existing doc if any).
  const [podcastDocIds, setPodcastDocIds] = useState<Record<string, string>>({});
  const [isRating, setIsRating] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [ratedDocumentIds, setRatedDocumentIds] = useState<Set<string>>(new Set());
  // Non-due extract content resolved for this tab session. The queue-list
  // rebuild re-derives from static tab data on every rating; this cache keeps
  // it from re-fetching the same non-due extracts on each rebuild. Reset on
  // tab unmount/remount (refs do not survive a closed-and-reopened tab).
  const resolvedExtractCacheRef = useRef<Map<string, Extract>>(new Map());
  // Track flashcards/extracts reviewed or dismissed this session. In queue-list
  // mode the build effect re-derives scrollItems from the static customQueueItems
  // tab data whenever dueFlashcards/dueExtracts change, which re-inserts a card
  // that was just rated/dismissed (customQueueItems is never mutated). Filtering
  // these sets in the rebuild closes that loop — mirrors ratedDocumentIds.
  const [ratedFlashcardIds, setRatedFlashcardIds] = useState<Set<string>>(new Set());
  const [ratedExtractIds, setRatedExtractIds] = useState<Set<string>>(new Set());
  const [readRssItemIds, setReadRssItemIds] = useState<Set<string>>(new Set());
  const [itemsReviewedThisSession, setItemsReviewedThisSession] = useState(0);
  const [, setAssistantInputActive] = useState(false);
  const [assistantPosition, setAssistantPosition] = useState<AssistantPosition>(() => {
    const saved = localStorage.getItem("assistant-panel-position");
    return saved === "left" ? "left" : "right";
  });

  // AI Summary panel state — mirrors the summary experience from RSS Scroll
  // Mode, but works across document and RSS items in the unified Optimal Queue.
  const { getCachedSummary, cacheSummary } = useSummaryCache();
  const [showSummary, setShowSummary] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [loadingStage, setLoadingStage] = useState<keyof typeof SUMMARY_LOADING_STAGES>("analyzing");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [modernSummaryMode, setModernSummaryMode] = useState<"modern" | "terminal">(() => {
    const saved = localStorage.getItem("queue-summary-display-mode");
    return saved === "terminal" ? "terminal" : "modern";
  });
  const [modernSummaryLength, setModernSummaryLength] = useState<SummaryLength>(() => {
    const saved = localStorage.getItem("queue-summary-length");
    return saved === "brief" || saved === "medium" || saved === "detailed" ? saved : "medium";
  });
  const [modernSummaryFocus, setModernSummaryFocus] = useState<SummaryFocus>(() => {
    const saved = localStorage.getItem("queue-summary-focus");
    return saved === "key-points" || saved === "actionable" || saved === "background" ? saved : "key-points";
  });
  const [summaryPanelWidth, setSummaryPanelWidth] = useState(() => {
    const saved = localStorage.getItem("queue-summary-width");
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isNaN(parsed) ? 320 : parsed;
  });
  const transcriptCacheRef = useRef<Map<string, string>>(new Map());
  const transcriptFetchInFlightRef = useRef<Set<string>>(new Set());

  const [selectedProvider, setSelectedProvider] = useState<"openai" | "anthropic" | "gemini" | "deepseek" | "ollama" | "openrouter">(() =>
    getStoredAssistantProvider("openai"),
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scrollViewMode, setScrollViewMode] = useState<"document" | "extracts" | "cards">("document");
  // Assistant panel visibility — persisted across sessions. The floating toggle
  // was removed in a prior refactor (queue-scroll-mode-ui-fix); restored here so
  // the user can show/hide the assistant from the scroll-mode top bar without it
  // overlapping audiobook controls (the original conflict).
  const [isAssistantVisible, setIsAssistantVisible] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem("assistant-panel-visible") !== "false";
  });
  const toggleAssistantVisibility = useCallback(() => {
    setIsAssistantVisible((prev) => {
      const next = !prev;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("assistant-panel-visible", String(next));
      }
      return next;
    });
  }, []);
  const isMobile = useMobileShell();
  const [rssSelectedText, setRssSelectedText] = useState("");
  const lastRssSelectionRef = useRef("");
  const activeRssSelection = rssSelectedText || lastRssSelectionRef.current;
  const MAX_SELECTION_CHARS = 10000;
  // Persist provider selection
  useEffect(() => {
    persistAssistantProvider(selectedProvider);
  }, [selectedProvider]);

  // Reset view mode and hide controls when scrolling to a new item
  useEffect(() => {
    setScrollViewMode("document");
    setShowControls(false);
  }, [currentIndex]);

  // Synchronize rating controls visibility with overlay controls on mobile
  useEffect(() => {
    if (isMobile) {
      setShowRatingControls(showControls);
    }
  }, [showControls, isMobile]);

  const providers = [
    { id: "openai", name: "OpenAI", icon: Sparkle, color: "text-green-500" },
    { id: "anthropic", name: "Anthropic", icon: ChatCircle, color: "text-orange-500" },
    { id: "gemini", name: "Gemini", icon: Sparkle, color: "text-blue-400" },
    { id: "deepseek", name: "DeepSeek", icon: Waves, color: "text-blue-500" },
    { id: "ollama", name: "Ollama", icon: Code, color: "text-blue-500" },
    { id: "openrouter", name: "OpenRouter", icon: Sliders, color: "text-purple-500" },
  ] as const;

  // Popup state
  const [activeExtractForCloze, setActiveExtractForCloze] = useState<{ id: string, text: string, extractContent?: string, range: [number, number] } | null>(null);
  const [activeExtractForQA, setActiveExtractForQA] = useState<string | null>(null);
  const [isExtractDialogOpen, setIsExtractDialogOpen] = useState(false);
  const [flashcardStudioSeed, setFlashcardStudioSeed] = useState<{ key: string; documentId?: string | null; excerpt?: string; draftCardType?: "qa" | "cloze" | "image-occlusion" | null; imageAssetId?: string; resetDraftCards?: boolean; autoEditDraft?: boolean; extractId?: string } | null>(null);

  const lastScrollTime = useRef(0);
  const scrollCooldown = 500; // ms between scroll actions
  const containerRef = useRef<HTMLDivElement>(null);
  const rssContentRef = useRef<HTMLDivElement>(null);
  // Tracks whether the current flashcard's answer is revealed, so the global
  // 1-4 rating keys follow the card's own "reveal before rating" rule.
  const flashcardRevealedRef = useRef(false);
  const handleFlashcardReveal = useCallback((revealed: boolean) => {
    flashcardRevealedRef.current = revealed;
  }, []);
  // handleRating is declared below the keydown effect that calls it; route the
  // call through this ref (kept current by an effect) to avoid a TDZ error.
  const rateCurrentItemRef = useRef<(rating: number) => void>(() => {});

  // Mobile PWA text selection state for RSS items
  const [mobileRssSelection, setMobileRssSelection] = useState<{
    text: string;
    position: { x: number; y: number };
    showButton: boolean;
  }>({ text: "", position: { x: 0, y: 0 }, showButton: false });
  const mobileRssSelectionTimeoutRef = useRef<number | null>(null);

  // Dictionary lookup state for RSS selections
  const [dictionaryResult, setDictionaryResult] = useState<DictionaryResult | null>(null);
  const [isDictionaryLoading, setIsDictionaryLoading] = useState(false);
  // `isMobile` (declared above via useMobileShell()) drives the touch selection
  // UI. The old `isPWA()` gate made it unreachable in the native Android/iOS
  // build; useMobileShell() covers native phones/tablets and narrow browsers.

  const buildQueueExtractSourceContext = useCallback((params: {
    documentId: string;
    title: string;
    sourceKind: ExtractSourceContext["sourceKind"];
  }): ExtractSourceContext => ({
    documentId: params.documentId,
    sourceTitle: params.title,
    sourceKind: params.sourceKind,
    queueType: "queue-scroll",
  }), []);

  const openExtractInDocumentTab = useCallback((params: {
    documentId: string;
    documentTitle: string;
    extract: Extract;
    sourceContext: ExtractSourceContext;
  }) => {
    addTab({
      title: params.documentTitle,
      icon: <TextT className="w-4 h-4 text-muted-foreground" />,
      type: "document-viewer",
      content: DocumentViewerTab,
      closable: true,
      data: {
        documentId: params.documentId,
        initialViewMode: "extracts",
        focusedExtractId: params.extract.id,
        extractSourceContext: params.sourceContext,
      },
    }, paneId);
  }, [addTab, paneId]);

  useEffect(() => {
    const savedRatedIds = sessionStorage.getItem(SESSION_KEYS.RATED_IDS);
    if (savedRatedIds) {
      try {
        setRatedDocumentIds(new Set(JSON.parse(savedRatedIds)));
      } catch {
        // ignore parse errors
      }
    }

    const savedReadRssIds = sessionStorage.getItem(SESSION_KEYS.READ_RSS_IDS);
    if (savedReadRssIds) {
      try {
        setReadRssItemIds(new Set(JSON.parse(savedReadRssIds)));
      } catch {
        // ignore parse errors
      }
    }

    const savedItemsReviewed = sessionStorage.getItem(SESSION_KEYS.ITEMS_REVIEWED);
    if (savedItemsReviewed) {
      setItemsReviewedThisSession(parseInt(savedItemsReviewed, 10) || 0);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.RATED_IDS, JSON.stringify(Array.from(ratedDocumentIds)));
  }, [ratedDocumentIds]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.READ_RSS_IDS, JSON.stringify(Array.from(readRssItemIds)));
  }, [readRssItemIds]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.ITEMS_REVIEWED, String(itemsReviewedThisSession));
  }, [itemsReviewedThisSession]);

  // Image Save hover listener for RSS articles / direct images inside QueueScrollPage
  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === "IMG" && rssContentRef.current?.contains(target)) {
        const img = target as HTMLImageElement;
        const rect = img.getBoundingClientRect();
        window.dispatchEvent(
          new CustomEvent("image-hover", {
            detail: {
              src: img.src,
              rect: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              },
            },
          })
        );
      }
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.tagName === "IMG" && rssContentRef.current?.contains(target)) {
        window.dispatchEvent(new CustomEvent("image-leave"));
      }
    };

    const doc = window.document;
    doc.addEventListener("mouseover", handleMouseOver);
    doc.addEventListener("mouseout", handleMouseOut);

    return () => {
      doc.removeEventListener("mouseover", handleMouseOver);
      doc.removeEventListener("mouseout", handleMouseOut);
    };
  }, []);

  const handleExtractUpdate = useCallback((extractId: string, updates: { content: string; notes?: string }) => {
    setScrollItems(prev => prev.map((item) => (
      item.type === "extract" && item.extract?.id === extractId
        ? { ...item, extract: { ...item.extract, content: updates.content, notes: updates.notes, date_modified: new Date().toISOString() } }
        : item
    )));
  }, []);

  const updateRssSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text) {
      setRssSelectedText("");
      return;
    }

    const container = rssContentRef.current;
    const anchorNode = selection?.anchorNode ?? null;
    const focusNode = selection?.focusNode ?? null;
    const selectionInContainer = !!container
      && ((anchorNode && container.contains(anchorNode)) || (focusNode && container.contains(focusNode)));
    if (!selectionInContainer) {
      setRssSelectedText("");
      return;
    }

    if (text.length > MAX_SELECTION_CHARS) {
      setRssSelectedText("");
      return;
    }

    setRssSelectedText(text);
    lastRssSelectionRef.current = text;
  }, [MAX_SELECTION_CHARS]);

  const clearRssTextSelection = useCallback(() => {
    setRssSelectedText("");
    lastRssSelectionRef.current = "";
    setDictionaryResult(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const documentsMap = useMemo(() => {
    const map = new Map<string, typeof documents[number]>();
    for (let i = 0; i < documents.length; i++) {
      const d = documents[i];
      map.set(d.id, d);
    }
    return map;
  }, [documents]);

  // Filter documents
  // When a custom semantic cluster is active, use those items as the base queue instead
  const documentQueueItems = useMemo(() => {
    const baseItems = customSubset ?? allQueueItems;
    return baseItems.filter((item) => {
      if (item.itemType !== "document") return false;
      if (ratedDocumentIds.has(item.documentId)) return false;
      const doc = documentsMap.get(item.documentId);
      if (!doc) return false;
      if (doc.isDismissed) return false;
      return true;
    });
  }, [allQueueItems, customSubset, documentsMap, ratedDocumentIds]);

  // Smart start position calculation
  const calculateSmartStart = useCallback(async (totalItems: number) => {
    if (totalItems === 0) return { position: 0, shouldShowToast: false, lastPosition: 0 };

    const lastPositionStr = sessionStorage.getItem(SESSION_KEYS.LAST_POSITION);
    const lastPosition = lastPositionStr ? parseInt(lastPositionStr, 10) : undefined;

    try {
      const response = await getSmartStartPosition({
        total_items: totalItems,
        last_session_position: lastPosition,
        items_reviewed_this_session: itemsReviewedThisSession,
        // Use timestamp as seed for reproducible variety
        seed: Date.now(),
      });

      return {
        position: response.start_position,
        shouldShowToast: response.is_resuming && lastPosition !== undefined && lastPosition > 0,
        lastPosition: lastPosition ?? 0,
      };
    } catch (error) {
      console.error("Failed to get smart start position:", error);
      return { position: 0, shouldShowToast: false, lastPosition: 0 };
    }
  }, [itemsReviewedThisSession]);

  // IMPORTANT: Await loadDocuments() to prevent race condition in YouTube filter
  // Now uses smart start position for variety
  useEffect(() => {
    const loadAllData = async () => {
      setIsLoadingData(true);

      try {
        // This ensures the YouTube filter has all documents loaded before computing
        await loadDocuments();
        if (useQueueStore.getState().items.length === 0) {
          await loadQueue();
        }

        const [dueItems, extracts] = await Promise.all([
          getDueItems(),
          getDueExtracts()
        ]);
        setDueFlashcards(dueItems);
        setDueExtracts(extracts);
      } catch (error) {
        console.error("Failed to load review items:", error);
      } finally {
        setIsLoadingData(false);
      }
    };
    loadAllData();
  }, []); // Only run on mount

  // Restore the exact last-viewed position once items are loaded, falling back to
  // the backend "smart start" (engagement-variety) algorithm only for a genuinely
  // fresh session. This makes "navigate away → back to Scroll Mode" land on the
  // exact item the user was reading, and also survives closing/reopening the tab
  // (position is persisted into tab.data + sessionStorage on every index change).
  const restoredPositionRef = useRef(false);
  useEffect(() => {
    if (scrollItems.length === 0 || currentIndex !== 0 || restoredPositionRef.current) {
      return;
    }

    // 1. Try the persisted position from this tab's data (survives tab close/reopen).
    let restoredIndex: number | null = null;
    const persistedIndex = activeTabQueueData.persistedCurrentIndex;
    if (typeof persistedIndex === "number" && persistedIndex > 0 && persistedIndex < scrollItems.length) {
      restoredIndex = persistedIndex;
    }

    // 2. Fall back to the session-storage position (survives app reload within a session).
    if (restoredIndex === null) {
      const lastPositionStr = sessionStorage.getItem(SESSION_KEYS.LAST_POSITION);
      const lastPosition = lastPositionStr ? parseInt(lastPositionStr, 10) : NaN;
      if (!Number.isNaN(lastPosition) && lastPosition > 0 && lastPosition < scrollItems.length) {
        restoredIndex = lastPosition;
      }
    }

    if (restoredIndex !== null) {
      // Exact restore — do NOT run the engagement-variety algorithm here.
      restoredPositionRef.current = true;
      setCurrentIndex(restoredIndex);
      setRenderedIndex(restoredIndex);
      return;
    }

    // 3. Genuinely fresh session — run the smart-start algorithm for variety.
    restoredPositionRef.current = true;
    calculateSmartStart(scrollItems.length).then(result => {
      const { position: startPos, shouldShowToast, lastPosition } = result;
      if (startPos > 0) {
        setCurrentIndex(startPos);
        setRenderedIndex(startPos);

        if (activeTabId) {
          patchTabData(activeTabId, {
            currentIndex: startPos,
            renderedIndex: startPos,
            sessionTimestamp: Date.now(),
          });
        }

        // Only show toast when position is actually applied
        if (shouldShowToast) {
          toast.info(t("queueScroll.resuming"), t("queueScroll.resumingPosition", { position: lastPosition + 1, total: scrollItems.length }));
        }
      }
    });
  }, [scrollItems.length, currentIndex, calculateSmartStart, activeTabId, patchTabData, toast, activeTabQueueData.persistedCurrentIndex]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_KEYS.LAST_POSITION, String(currentIndex));

    if (activeTabId) {
      patchTabData(activeTabId, { currentIndex, renderedIndex });
    }
  }, [currentIndex, renderedIndex, activeTabId, patchTabData]);

  // Load/fetch full content for the active RSS item in the queue
  useEffect(() => {
    const currentItem = scrollItems[currentIndex];
    if (!currentItem || currentItem.type !== "rss" || !showFullContent || !currentItem.rssItem) return;

    const item = currentItem.rssItem;
    const itemId = item.id;
    const itemLink = item.link;

    // 1. Already in memory map
    if (fullContentMap.has(itemId)) return;

    // 2. Already in object
    if (item.fullContent) {
      setFullContentMap((prev) => {
        const next = new Map(prev);
        next.set(itemId, item.fullContent!);
        return next;
      });
      return;
    }

    const loadContent = async () => {
      setLoadingFullContent((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
      setFullContentErrors((prev) => {
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });

      try {
        // Try getting cached content first
        const cached = await getArticleFullContent(itemId);
        if (cached?.content) {
          setFullContentMap((prev) => {
            const next = new Map(prev);
            next.set(itemId, cached.content!);
            return next;
          });
          // Update item in scroll list to keep it updated
          setScrollItems((prev) =>
            prev.map((si) =>
              si.type === "rss" && si.rssItem?.id === itemId
                ? {
                    ...si,
                    rssItem: {
                      ...si.rssItem,
                      fullContent: cached.content,
                      fullContentFetchedAt: cached.fetchedAt,
                    } as any,
                  }
                : si
            )
          );
        } else {
          // Fetch from network/API
          const result = await fetchArticleFullContent(itemId, itemLink);
          if (result.success && result.fullContent) {
            setFullContentMap((prev) => {
              const next = new Map(prev);
              next.set(itemId, result.fullContent!);
              return next;
            });
            // Update item in scroll list
            setScrollItems((prev) =>
              prev.map((si) =>
                si.type === "rss" && si.rssItem?.id === itemId
                  ? {
                      ...si,
                      rssItem: {
                        ...si.rssItem,
                        fullContent: result.fullContent,
                        fullContentFetchedAt: result.fetchedAt,
                      } as any,
                    }
                  : si
              )
            );
          } else {
            setFullContentErrors((prev) => {
              const next = new Map(prev);
              next.set(itemId, result.error || "Failed to fetch full article content");
              return next;
            });
          }
        }
      } catch (err) {
        setFullContentErrors((prev) => {
          const next = new Map(prev);
          next.set(itemId, err instanceof Error ? err.message : "Unknown error occurred");
          return next;
        });
      } finally {
        setLoadingFullContent((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    };

    void loadContent();
  }, [currentIndex, showFullContent, scrollItems]);

  // Cache for `getStableRandom` — a deterministic per-id jitter used when
  // mapping due pools to scroll items, so re-renders don't reshuffle.
  const stableRandomCacheRef = useRef<Map<string, number>>(new Map());

  const getStableRandom = useCallback((str: string, offset: number = 0): number => {
    const key = str + "|" + offset;
    const cache = stableRandomCacheRef.current;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    hash = ((hash << 5) - hash) + offset;
    hash = hash & hash;
    const val = Math.abs(hash) / 2147483647;
    if (cache.size > 2048) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    cache.set(key, val);
    return val;
  }, []);

  // Build/rebuild the composed session from its external inputs. Rating and
  // dismissal mutate the established session in place via
  // `advanceAfterRemoval`; rebuilding when that lock is released would restart
  // the mix at the current numeric index and replace the queued successor.
  const wasRatingOnLastBuildEffectRunRef = useRef(false);
  useEffect(() => {
    const wasRating = wasRatingOnLastBuildEffectRunRef.current;
    wasRatingOnLastBuildEffectRunRef.current = isRating;
    if (!shouldBuildScrollSession({ isRating, wasRating })) return;
    // Neural mode owns scrollItems — the normal queue-build must not overwrite
    // the spreading-activation session. It re-runs when neural mode is exited
    // (isNeuralMode flips to false, restoring the snapshot separately).
    if (isNeuralMode) return;
    let cancelled = false;

    const buildScrollItems = async () => {
      const customQueueItems = activeTabQueueData.customQueueItems;
      const queueScrollMode = activeTabQueueData.queueScrollMode;

      if (queueScrollMode === "queue-list" || (customQueueItems && customQueueItems.length > 0)) {
        const sourceQueueItems = (customQueueItems && customQueueItems.length > 0)
          ? customQueueItems
          : documentQueueItems;

        const extractsMap = new Map(dueExtracts.map((e) => [e.id, e]));
        const flashcardsMap = new Map(dueFlashcards.map((f) => [f.id, f]));

        // Queue extracts that are not part of the currently-due set have no
        // entry in `extractsMap`; their queue rows only carry a bounded
        // `learningHint` preview. Resolve the real extract content up front,
        // in one batched fetch, so each card renders the extract's full
        // content instead of a truncated synthetic stand-in.
        const resolvedExtractsMap = await resolveMissingExtractContent(
          sourceQueueItems,
          extractsMap,
          getExtract,
          ratedExtractIds,
          resolvedExtractCacheRef.current,
        );

        const sequentialItems: ScrollItem[] = sourceQueueItems
          .map((item) => {
            if (item.itemType === "extract") {
              // Skip extracts already reviewed/dismissed this session — without
              // this, the rebuild re-inserts them (customQueueItems is static).
              if (item.extractId && ratedExtractIds.has(item.extractId)) return null;
              if (!item.extractId && ratedExtractIds.has(item.id)) return null;
              const extractId = item.extractId ?? item.id;
              const extractObj = extractsMap.get(extractId) ?? resolvedExtractsMap.get(extractId);
              // Omit extracts whose content cannot be resolved (e.g. deleted)
              // rather than rendering a blank or truncated card.
              if (!extractObj) return null;
              const doc = documentsMap.get(item.documentId);
              return {
                id: item.id.startsWith("extract-") ? item.id : `extract-${extractId}`,
                type: "extract" as const,
                documentTitle: item.documentTitle || doc?.title || t("queueScroll.unknownDocument"),
                extract: extractObj,
                category: item.category ?? doc?.category ?? "extracts",
                estimatedTime: item.estimatedTime ?? 3,
                engagementScore: item.priority ?? 5,
              } as ScrollItem;
            }

            if (item.itemType === "learning-item") {
              // Skip flashcards already reviewed/dismissed this session — without
              // this, the rebuild re-inserts them (customQueueItems is static).
              if (item.learningItemId && ratedFlashcardIds.has(item.learningItemId)) return null;
              if (!item.learningItemId && ratedFlashcardIds.has(item.id)) return null;
              const cardObj = item.learningItemId ? flashcardsMap.get(item.learningItemId) : undefined;
              return {
                id: item.id.startsWith("flashcard-") ? item.id : `flashcard-${item.learningItemId ?? item.id}`,
                type: "flashcard" as const,
                documentTitle: item.documentTitle || (item.question ? item.question.substring(0, 50) : ""),
                learningItem: cardObj ?? ({
                  id: item.learningItemId ?? item.id,
                  document_id: item.documentId,
                  question: item.question ?? item.learningHint ?? "",
                  answer: item.answer ?? "",
                  card_type: "cloze",
                  tags: item.tags,
                  due: item.dueDate,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                } as any),
                category: item.tags?.[0] ?? "flashcards",
                estimatedTime: item.estimatedTime ?? 2,
                engagementScore: item.priority ?? 5,
              } as ScrollItem;
            }

            if (item.itemType === "rss-article") {
              return {
                id: item.id.startsWith("rss-") ? item.id : `rss-${item.id}`,
                type: "rss" as const,
                documentTitle: item.documentTitle,
                rssItem: (item as any).rssItem,
                rssFeed: (item as any).rssFeed,
                category: (item as any).rssFeed?.category ?? "rss",
                estimatedTime: item.estimatedTime ?? 5,
                engagementScore: 10,
              } as ScrollItem;
            }

            // Default: document
            // Skip documents already rated/dismissed this session — without
            // this, the rebuild re-inserts them (customQueueItems is static),
            // so Dismiss looked like it advanced and then reloaded the item.
            if (item.documentId && ratedDocumentIds.has(item.documentId)) return null;
            const doc = documentsMap.get(item.documentId);
            if (doc?.isArchived || doc?.isDismissed) return null;
            return {
              id: item.id,
              type: "document" as const,
              documentId: item.documentId,
              documentTitle: item.documentTitle,
              category: doc?.category ?? item.tags?.[0] ?? "uncategorized",
              estimatedTime: item.estimatedTime ?? 10,
              engagementScore: item.priority ?? 5,
            } as ScrollItem;
          })
          .filter((item): item is ScrollItem => item !== null);

        // The sequential source is usually the already-filtered queue list, but
        // when a tab was opened without items (`documentQueueItems` fallback)
        // apply the same item-type gate so the selection is still honoured.
        const gatedSequentialItems = gateScrollItemsByType(
          sequentialItems,
          activeTabQueueData.itemTypes,
        );

        // Partition the source rows into the three composition pools. RSS
        // articles draw from the Documents share, mirroring the optimal path.
        const documentPool = gatedSequentialItems.filter(
          (item) => item.type === "document" || item.type === "rss"
        );
        const extractPool = gatedSequentialItems.filter((item) => item.type === "extract");
        const flashcardPool = gatedSequentialItems.filter((item) => item.type === "flashcard");

        // The composition targets apply here too, with the Queue item-type
        // toggles taking precedence: an unchecked type contributes no items
        // and its share is redistributed across the checked types. (The
        // zeroing matters for the top-ups below — without it, an unchecked
        // type's share would pull due items of that type back into the
        // session from outside the gated list.)
        const itemTypes = activeTabQueueData.itemTypes;
        const sequentialTargets = {
          documents: settings.scrollQueue.composition.documents,
          extracts:
            itemTypes.extracts === false ? 0 : settings.scrollQueue.composition.extracts,
          flashcards:
            itemTypes.learningItems === false ? 0 : settings.scrollQueue.composition.flashcards,
        };
        const composed = composeSession({
          targets: sequentialTargets,
          available: {
            documents: documentPool.length,
            extracts: extractPool.length,
            flashcards: flashcardPool.length,
          },
        });

        // Top up under-supplied pools from the same due pools the optimal path
        // uses, deduplicated by item id with the source rows taking priority
        // within their own type — this is what makes "reading queue +
        // Flashcards at 55%" produce flashcards. A hand-picked semantic
        // cluster (customSubset) is exempt: composition governs counts within
        // the cluster but never introduces items from outside it.
        //
        // Documents are topped up too: when the active filter returned few or
        // no documents (e.g. a flashcard-leaning "Due All" list), pull due
        // documents from the wider queue store so the Documents slider can
        // still be honoured. Without this, a flashcard-only source leaves the
        // document pool empty and the session degrades to sequential cards.
        let toppedDocuments = documentPool;
        let toppedExtracts = extractPool;
        let toppedFlashcards = flashcardPool;
        if (!customSubset) {
          if (composed.documents > documentPool.length) {
            toppedDocuments = dedupeById([
              ...documentPool,
              ...toDocumentScrollItems(
                documentQueueItems,
                documentsMap,
                getStableRandom,
              ),
            ]);
          }
          if (composed.extracts > extractPool.length) {
            toppedExtracts = dedupeById([
              ...extractPool,
              ...toExtractScrollItems(
                dueExtracts,
                documentsMap,
                t("queueScroll.unknownDocument"),
                getStableRandom,
              ),
            ]);
          }
          if (composed.flashcards > flashcardPool.length) {
            toppedFlashcards = dedupeById([
              ...flashcardPool,
              ...toFlashcardScrollItems(dueFlashcards, getStableRandom),
            ]);
          }
        }

        // When the rows came from the Queue list, that list IS the preview of
        // this session: honour the composed per-type quota by walking the rows
        // IN LIST ORDER, so Scroll Mode replays what the user was just looking
        // at instead of a differently-sorted set of the same items. The list
        // already orders by the combined criterion (`orderQueueItems`), so
        // re-sorting here only made the two surfaces disagree.
        if (customQueueItems && customQueueItems.length > 0) {
          const { selected, shortfall } = selectByQuotaInOrder(gatedSequentialItems, composed);
          // Top-ups are the tail of each `topped*` array (dedupeById keeps the
          // pool items first). They were never in the list, so no position in
          // it can be faithful — append them rather than pretend otherwise.
          const extras = [
            ...toppedDocuments.slice(documentPool.length).slice(0, shortfall.documents),
            ...toppedExtracts.slice(extractPool.length).slice(0, shortfall.extracts),
            ...toppedFlashcards.slice(flashcardPool.length).slice(0, shortfall.flashcards),
          ];
          if (!cancelled) {
            setCompositionReport(null);
            setScrollItems([...selected, ...extras]);
          }
          return;
        }

        const nonReviewItems = toppedDocuments.slice(0, composed.documents);
        const limitedExtracts = toppedExtracts.slice(0, composed.extracts);
        const limitedFlashcards = toppedFlashcards.slice(0, composed.flashcards);

        // Order by SuperMemo's combined criterion (Phase 3): priority (primary)
        // + topic/item proportion bias + stable per-id jitter. Higher-priority
        // items surface first, with a topic/item mix so a flashcard-heavy
        // source doesn't present all flashcards up front. Runs once per session
        // build (not per render), preserving resumability.
        const mixedItems = orderScrollItemsByCombinedCriterion([
          ...nonReviewItems,
          ...limitedFlashcards,
          ...limitedExtracts,
        ]);

        if (!cancelled) {
          setCompositionReport(null);
          setScrollItems(mixedItems);
        }
        return;
      }

      // When a custom semantic cluster is active, filter flashcards/extracts to only those
      // belonging to documents in the subset
      const subsetDocIds = customSubset
        ? new Set(customSubset.map(item => item.documentId))
        : null;
      const activeFlashcards = subsetDocIds
        ? dueFlashcards.filter(item => subsetDocIds.has(item.document_id))
        : dueFlashcards;
      const activeExtracts = subsetDocIds
        ? dueExtracts.filter(ex => subsetDocIds.has(ex.document_id))
        : dueExtracts;

      // Honour the composition shares: a type participates iff its share is
      // above 0. Gated at the source lists so composeSession and
      // orderScrollItemsByCombinedCriterion compute against real totals. The
      // Customize Queue toggles do not apply to the optimal path — the shares
      // are the sole control. Feed items (RSS, podcast) are not covered by
      // the shares and stay settings-driven, drawing from the Documents share.
      const compositionTargets = settings.scrollQueue.composition;
      const flashcardItems: ScrollItem[] = gateScrollItemsByComposition(
        toFlashcardScrollItems(activeFlashcards, getStableRandom),
        compositionTargets,
      );

      const docItems: ScrollItem[] = gateScrollItemsByComposition(
        toDocumentScrollItems(documentQueueItems, documentsMap, getStableRandom),
        compositionTargets,
      );

      const rssSettings = settings.rssQueue ?? defaultSettings.rssQueue;
      let rssItems: ScrollItem[] = [];

      if (customSubset) {
        // If customSubset is active, we bypass settings and ONLY load RSS items explicitly selected in the cluster!
        const rssSubsets = customSubset.filter(item => item.itemType === "rss-article" as any);
        rssItems = rssSubsets.map(item => {
          const rssItem = (item as any).rssItem as RSSFeedItem;
          const rssFeed = (item as any).rssFeed as RSSFeed;
          return {
            id: item.id,
            type: "rss" as const,
            documentTitle: item.documentTitle,
            rssItem,
            rssFeed,
            category: rssFeed?.category ?? "rss",
            estimatedTime: 5,
            engagementScore: 10, // Max priority for custom subset items
          };
        }).filter(item => !!item.rssItem && !readRssItemIds.has(item.rssItem.id));
      } else if (rssSettings.includeInQueue) {
        // Get items based on unread setting
        let rssItemsToProcess: { feed: RSSFeed; item: RSSFeedItem }[];
        if (rssSettings.unreadOnly) {
          rssItemsToProcess = await getUnreadItemsAuto();
        } else {
          const allFeeds = await getSubscribedFeedsAuto();
          rssItemsToProcess = allFeeds.flatMap(feed =>
            feed.items.map(item => ({ feed, item }))
          );
        }

        // Filter by feed inclusion/exclusion
        const filteredRssItems = rssItemsToProcess.filter(({ feed, item }) => {
          if (rssSettings.excludedFeedIds.includes(feed.id)) return false;

          // Check if feed is explicitly included (if inclusion list is not empty)
          if (rssSettings.includedFeedIds.length > 0) {
            return rssSettings.includedFeedIds.includes(feed.id);
          }

          if (rssSettings.maxItemAgeDays > 0) {
            const publishedAt = Date.parse(item.pubDate);
            if (!Number.isNaN(publishedAt)) {
              const maxAgeMs = rssSettings.maxItemAgeDays * 24 * 60 * 60 * 1000;
              if (Date.now() - publishedAt > maxAgeMs) {
                return false;
              }
            }
          }

          return true;
        });

        // Sort by date if preferRecent is enabled
        if (rssSettings.preferRecent) {
          filteredRssItems.sort((a, b) =>
            new Date(b.item.pubDate).getTime() - new Date(a.item.pubDate).getTime()
          );
        }

        // Limit items per session
        const limitedRssItems = rssSettings.maxItemsPerSession > 0
          ? filteredRssItems.slice(0, rssSettings.maxItemsPerSession)
          : filteredRssItems;

        // Score RSS items for relevance using classifiers
        const classifiers = useClassifiersStore.getState().classifiers;
        const hasClassifiers = classifiers.length > 0;

        rssItems = limitedRssItems.map(({ feed, item }) => {
          let relevanceScore: number | undefined;
          let engagementScore: number;

          if (hasClassifiers) {
            relevanceScore = scoreRssRelevance(
              {
                itemTitle: item.title,
                itemAuthor: item.author,
                itemTags: item.categories ?? [],
                feedId: feed.id,
                feedTitle: feed.title,
                pubDate: item.pubDate,
              },
              classifiers.map((c): RssClassifier => ({
                classifier_type: c.classifier_type,
                value: c.value,
                sentiment: c.sentiment,
                scope: c.scope,
                feed_id: c.feed_id,
              })),
            );
            // Scale relevance 0-1 to engagementScore 0-10
            engagementScore = relevanceScore * 10;
          } else {
            engagementScore = 4 + getStableRandom(item.id, 3);
          }

          return {
            id: `rss-${item.id}`,
            type: "rss",
            documentTitle: item.title,
            rssItem: item,
            rssFeed: feed,
            category: feed.category ?? "rss",
            estimatedTime: 5,
            engagementScore,
            relevanceScore,
          };
        });

        // Sort RSS items by relevance (highest first) — unless preferRecent is
        // enabled, in which case we keep the chronological order from above.
        if (!rssSettings.preferRecent && hasClassifiers) {
          rssItems.sort((a, b) => (b.relevanceScore ?? 0.5) - (a.relevanceScore ?? 0.5));
        } else if (rssSettings.preferRecent && hasClassifiers) {
          // Within the chronological grouping, sort by relevance as tiebreaker
          rssItems.sort((a, b) => {
            const dateDiff = new Date(b.rssItem!.pubDate).getTime() - new Date(a.rssItem!.pubDate).getTime();
            if (Math.abs(dateDiff) > 0) return dateDiff > 0 ? 1 : -1;
            return (b.relevanceScore ?? 0.5) - (a.relevanceScore ?? 0.5);
          });
        }
      }

      let podcastItems: ScrollItem[] = [];
      const podcastSettings = settings.podcastQueue ?? defaultSettings.podcastQueue;
      if (podcastSettings.includeInQueue) {
        try {
          const episodes = await getEpisodeQueue();
          // Filter to unplayed if unreadOnly is enabled
          const filteredEpisodes = podcastSettings.unreadOnly
            ? episodes.filter((ep) => !ep.played)
            : episodes;

          // Limit to maxItemsPerSession
          const limitedEpisodes = podcastSettings.maxItemsPerSession > 0
            ? filteredEpisodes.slice(0, podcastSettings.maxItemsPerSession)
            : filteredEpisodes;

          podcastItems = limitedEpisodes.map((ep) => ({
            id: `podcast-${ep.id}`,
            type: "podcast" as const,
            documentTitle: ep.title,
            podcastEpisode: ep,
            category: "podcast",
            estimatedTime: ep.duration ? Math.ceil(ep.duration / 60) : 30,
            engagementScore: 5 + getStableRandom(ep.id, 5) * 2,
          }));
        } catch (error) {
          console.warn("[QueueScroll] Failed to load podcast episodes for queue:", error);
        }
      }

      const extractItems: ScrollItem[] = gateScrollItemsByComposition(
        toExtractScrollItems(
          activeExtracts,
          documentsMap,
          t("queueScroll.unknownDocument"),
          getStableRandom,
        ),
        compositionTargets,
      );

      // Compose the session from the three composition sliders. Feed items
      // (RSS, podcast) draw from the Documents share, so they count toward the
      // documents availability alongside documents themselves. The shares are
      // passed unmodified — the composition is authoritative for this path.
      const targets = settings.scrollQueue.composition;
      const nonReviewItems = [...docItems, ...rssItems, ...podcastItems];
      const composed = composeSession({
        targets,
        available: {
          documents: nonReviewItems.length,
          extracts: extractItems.length,
          flashcards: flashcardItems.length,
        },
      });
      const limitedDocuments = nonReviewItems.slice(0, composed.documents);
      const limitedFlashcards = flashcardItems.slice(0, composed.flashcards);
      const limitedExtracts = extractItems.slice(0, composed.extracts);

      // The session's presentation order tracks the configured mix: the
      // combined-criterion sort's proportion bias targets the topic share of
      // the COMPOSED counts (documents + extracts vs flashcards), so a 60/40
      // setting reads as 60/40 while scrolling, and scarcity is handled for
      // free (a short type's deficit is already reflected in the counts). A
      // single-type session gets a 0 or 1 target, where the bias short-
      // circuits and priority alone orders the session.
      const composedTotal =
        composed.documents + composed.extracts + composed.flashcards;
      const targetTopicShare =
        composedTotal > 0
          ? (composed.documents + composed.extracts) / composedTotal
          : 0.5;
      const mixedItems = orderScrollItemsByCombinedCriterion(
        [
          ...limitedDocuments,
          ...limitedFlashcards,
          ...limitedExtracts,
        ],
        {
          ...DEFAULT_COMBINED_SORT_CONFIG,
          targetTopicShare,
        }
      );

      if (!cancelled) {
        setCompositionReport({
          counts: {
            documents: composed.documents,
            extracts: composed.extracts,
            flashcards: composed.flashcards,
          },
          shortfall: composed.shortfall,
        });
        setScrollItems(mixedItems);
      }
    };

    void buildScrollItems();
    return () => {
      cancelled = true;
    };
  }, [documentQueueItems, documentsMap, dueFlashcards, dueExtracts, isRating, isNeuralMode, readRssItemIds, settings.scrollQueue, settings.rssQueue, settings.podcastQueue, activeTabQueueData.customQueueItems, activeTabQueueData.queueScrollMode, activeTabQueueData.itemTypes, ratedFlashcardIds, ratedExtractIds, ratedDocumentIds, customSubset]);

  // Current item (for display during transition)
  const currentItem = scrollItems[currentIndex];
  const currentDocument = useMemo(() => {
    if (!currentItem || currentItem.type !== "document" || !currentItem.documentId) return null;
    return documentsMap.get(currentItem.documentId) ?? null;
  }, [currentItem, documentsMap]);

  // Idle-aware replacement for the old wall-clock dwell measurement. Only
  // documents and extracts have a cumulative time column, so only they can
  // receive time for an item the user skipped past; flashcard time travels
  // with the review itself.
  const queueTimedTarget = useMemo<QueueTimedTarget | null>(() => {
    if (!currentItem) return null;
    if (currentItem.type === "document" && currentItem.documentId) {
      return { itemType: "document", itemId: currentItem.documentId };
    }
    if (currentItem.type === "extract" && currentItem.extract) {
      return { itemType: "extract", itemId: currentItem.extract.id };
    }
    return null;
  }, [currentItem]);
  const { consumeActiveSeconds, notifyEngagement } = useQueueTimeTracker(
    currentItem?.id,
    queueTimedTarget
  );

  // Keep a small cross-device download horizon ahead of the reader. This is
  // fire-and-forget and bounded to the current item plus the next two
  // documents; queue rendering and navigation never wait for file sync.
  useEffect(() => {
    const horizonDocuments: Array<(typeof documents)[number]> = [];
    for (let index = currentIndex; index < scrollItems.length && horizonDocuments.length < 3; index += 1) {
      const item = scrollItems[index];
      if (item?.type !== "document") continue;
      const doc = documentsMap.get(item.documentId);
      if (doc) horizonDocuments.push(doc);
    }
    let cancelled = false;
    void import("../lib/autoFileSyncDownload")
      .then(({ prefetchQueuedDocuments }) => {
        if (!cancelled) return prefetchQueuedDocuments(horizonDocuments);
        return undefined;
      })
      .catch((error) => console.warn("[QueueScroll] queue file prefetch unavailable", error));
    return () => {
      cancelled = true;
    };
  }, [scrollItems, currentIndex, documentsMap]);

  const isNewDocument =
    currentDocument
      ? (currentDocument.reps ?? currentDocument.readingCount ?? 0) <= 0
      && !currentDocument.dateLastReviewed
      : false;
  const currentPrioritySlider = useMemo(() => {
    if (!currentItem) return undefined;
    if (currentItem.type === "document") {
      return currentDocument?.prioritySlider ?? 50;
    }
    if (currentItem.type === "extract" && currentItem.extract) {
      const parentDoc = documents.find((doc) => doc.id === currentItem.extract?.document_id);
      return Math.round(currentItem.extract.priority_score ?? parentDoc?.priorityScore ?? 50);
    }
    return undefined;
  }, [currentItem, currentDocument, documents]);

  const handlePriorityChange = useCallback(async (slider: number) => {
    const activeItem = currentItem;
    if (!activeItem) return;

    if (activeItem.type === "document" && activeItem.documentId) {
      await updateDocumentPriority(activeItem.documentId, prioritySliderToRating(slider), slider);
      const [documentsResult, queueResult] = await Promise.allSettled([
        loadDocuments(),
        loadQueue(),
      ]);
      if (documentsResult.status === "rejected") {
        console.warn("[QueueScroll] Failed to refresh documents after priority update:", documentsResult.reason);
      }
      if (queueResult.status === "rejected") {
        console.warn("[QueueScroll] Failed to refresh queue after priority update:", queueResult.reason);
      }
      return;
    }

    if (activeItem.type === "extract" && activeItem.extract) {
      await setExtractPriority(activeItem.extract.id, slider);
      setDueExtracts((prev) =>
        prev.map((extract) =>
          extract.id === activeItem.extract?.id
            ? { ...extract, priority_score: slider }
            : extract
        )
      );
      const queueResult = await Promise.allSettled([loadQueue()]);
      if (queueResult[0].status === "rejected") {
        console.warn("[QueueScroll] Failed to refresh queue after extract priority update:", queueResult[0].reason);
      }
    }
  }, [currentItem, loadDocuments, loadQueue]);

  // Rendered item (actual document being rendered)
  const renderedItem = scrollItems[renderedIndex];

  // When a podcast episode is the rendered queue item, ensure it has a real
  // Document row so extracts taken from its transcript persist correctly.
  // importPodcastEpisodeAsDocument is idempotent (returns the existing doc if
  // the episode was already imported), so this is safe to call on each mount.
  useEffect(() => {
    if (renderedItem?.type !== "podcast" || !renderedItem.podcastEpisode) return;
    const episodeId = renderedItem.podcastEpisode.id;
    if (podcastDocIds[episodeId]) return; // already resolved
    let cancelled = false;
    (async () => {
      try {
        const doc = await importPodcastEpisodeAsDocument(episodeId);
        if (!cancelled && doc?.id) {
          setPodcastDocIds((prev) => ({ ...prev, [episodeId]: doc.id }));
        }
      } catch (e) {
        // Non-fatal: extracts will fall back to the synthetic id (may not
        // persist), but playback + transcript still work.
        console.warn("[QueueScrollPage] Failed to import podcast episode as document:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [renderedItem, podcastDocIds]);

  useEffect(() => {
    if (!renderedItem || renderedItem.type !== "rss") {
      setRssSelectedText("");
      return;
    }

    const handleSelection = () => updateRssSelection();
    document.addEventListener("mouseup", handleSelection);
    document.addEventListener("keyup", handleSelection);

    return () => {
      document.removeEventListener("mouseup", handleSelection);
      document.removeEventListener("keyup", handleSelection);
    };
  }, [renderedItem, updateRssSelection]);

  useEffect(() => {
    setRssSelectedText("");
    setMobileRssSelection({ text: "", position: { x: 0, y: 0 }, showButton: false });
  }, [renderedItem?.id]);

  // Mobile PWA: Handle text selection for RSS content
  useEffect(() => {
    if (!isMobile) return;
    if (renderedItem?.type !== "rss") return;

    let rafId: number | null = null;

    const handleSelectionChange = () => {
      // Cancel any pending RAF to avoid multiple updates
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection) {
          setMobileRssSelection(prev => ({ ...prev, showButton: false }));
          return;
        }

        const text = selection.toString().trim();

        const anchorElement = selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode?.parentElement;
        const focusElement = selection.focusNode instanceof Element
          ? selection.focusNode
          : selection.focusNode?.parentElement;

        const container = rssContentRef.current;
        const isInRssContent = container &&
          ((anchorElement && container.contains(anchorElement)) ||
            (focusElement && container.contains(focusElement)));

        if (!text || text.length === 0 || !isInRssContent) {
          setMobileRssSelection(prev => ({ ...prev, showButton: false }));
          return;
        }

        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();

          // Position the button centered above the selection
          const x = rect.left + rect.width / 2;
          const y = rect.top - 60; // 60px above selection

          setMobileRssSelection({
            text,
            position: { x, y },
            showButton: true,
          });

          // Also update the regular RSS selection state
          setRssSelectedText(text);

          // Auto-hide after 5 seconds if not interacted with
          if (mobileRssSelectionTimeoutRef.current) {
            clearTimeout(mobileRssSelectionTimeoutRef.current);
          }
          mobileRssSelectionTimeoutRef.current = window.setTimeout(() => {
            setMobileRssSelection(prev => ({ ...prev, showButton: false }));
          }, 5000);
        } catch {
          // Range might be invalid, ignore
        }
      });
    };

    // Also handle touchend for immediate response on mobile
    const handleTouchEnd = () => {
      // Small delay to allow selection to be finalized, then use RAF
      setTimeout(handleSelectionChange, 100);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("touchend", handleTouchEnd);
      if (mobileRssSelectionTimeoutRef.current) {
        clearTimeout(mobileRssSelectionTimeoutRef.current);
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isMobile, renderedItem?.type]);

  const detailsTarget = useMemo<ItemDetailsTarget | null>(() => {
    if (!currentItem) return null;

    if (currentItem.type === "document" && currentItem.documentId) {
      const doc = documents.find(d => d.id === currentItem.documentId);
      return {
        type: "document",
        id: currentItem.documentId,
        title: currentItem.documentTitle,
        tags: doc?.tags,
        category: doc?.category,
      };
    }

    if (currentItem.type === "flashcard" && currentItem.learningItem) {
      return {
        type: "learning-item",
        id: currentItem.learningItem.id,
        title: currentItem.documentTitle,
        tags: currentItem.learningItem.tags,
      };
    }

    if (currentItem.type === "extract" && currentItem.extract) {
      return {
        type: "extract",
        id: currentItem.extract.id,
        title: currentItem.documentTitle,
        tags: currentItem.extract.tags,
        category: currentItem.extract.category,
      };
    }

    if (currentItem.type === "rss") {
      return {
        type: "rss",
        title: currentItem.documentTitle,
        source: currentItem.rssFeed?.title,
        link: currentItem.rssItem?.link,
      };
    }

    return null;
  }, [currentItem, documents]);

  // Matching QueueItem for the Details popover's postpone action — postponeItemSmart
  // needs the full queue-store shape (priority, etc.), not the lighter ScrollItem.
  // Only document/flashcard items are postponable (matches QueueContextMenu's canPostpone).
  const detailsQueueItem = useMemo(() => {
    if (!currentItem) return null;
    if (currentItem.type === "document" && currentItem.documentId) {
      return allQueueItems.find(
        (qi) => qi.itemType === "document" && qi.documentId === currentItem.documentId
      ) ?? null;
    }
    if (currentItem.type === "flashcard" && currentItem.learningItem) {
      return allQueueItems.find(
        (qi) => qi.itemType === "learning-item" && qi.learningItemId === currentItem.learningItem?.id
      ) ?? null;
    }
    return null;
  }, [currentItem, allQueueItems]);

  const handleDetailsPostpone = useCallback(async () => {
    if (!detailsQueueItem) throw new Error("Item not found in queue");
    return postponeItemSmart(detailsQueueItem);
  }, [detailsQueueItem, postponeItemSmart]);

  const handleNavigateToTaggedItem = useCallback((item: TaggedItemSummary) => {
    if (item.itemType === "document") {
      addTab({
        title: item.title,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewerTab,
        closable: true,
        data: { documentId: item.id },
      }, paneId);
      return;
    }

    if (item.itemType === "extract" && item.documentId) {
      addTab({
        title: item.title,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewerTab,
        closable: true,
        data: {
          documentId: item.documentId,
          initialViewMode: "extracts",
          focusedExtractId: item.id,
        },
      }, paneId);
      return;
    }

    if (item.itemType === "learning-item" && item.documentId) {
      addTab({
        title: item.title,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewerTab,
        closable: true,
        data: { documentId: item.documentId },
      }, paneId);
      return;
    }

    toast.error(t("itemDetails.cannotOpenItem"));
  }, [addTab, paneId, toast, t]);

  const [selection, setSelection] = useState("");
  const [scrollState, setScrollState] = useState<{ pageNumber?: number; scrollPercent?: number }>({});
  const [debouncedScrollPercent, setDebouncedScrollPercent] = useState<number | undefined>(undefined);

  const [pdfContextText, setPdfContextText] = useState<string | undefined>(undefined);
  const [pdfOcrContextText, setPdfOcrContextText] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<string | undefined>(undefined);

  const selectionRef = useRef(selection);
  const pdfContextTextRef = useRef(pdfContextText);
  const pdfOcrContextTextRef = useRef(pdfOcrContextText);
  const scrollStateRef = useRef(scrollState);
  const documentsRef = useRef(documents);
  const documentContentRef = useRef<string | undefined>(documentContent);
  const assistantContextRef = useRef<AssistantContext | undefined>(undefined);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    pdfContextTextRef.current = pdfContextText;
  }, [pdfContextText]);

  useEffect(() => {
    pdfOcrContextTextRef.current = pdfOcrContextText;
  }, [pdfOcrContextText]);

  useEffect(() => {
    scrollStateRef.current = scrollState;
  }, [scrollState]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    documentContentRef.current = documentContent;
  }, [documentContent]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedScrollPercent(scrollState.scrollPercent);
    }, 500);
    return () => clearTimeout(timer);
  }, [scrollState.scrollPercent]);

  useEffect(() => {
    setSelection("");
    setScrollState({});
    setDebouncedScrollPercent(undefined);
    setPdfContextText(undefined);
    setPdfOcrContextText(null);
    setDocumentContent(undefined);
    // Clear any open summary so a stale summary from the previous item doesn't
    // carry over to the newly-rendered item.
    setShowSummary(false);
    setSummaryText("");
    setIsSummarizing(false);
  }, [renderedItem?.id]);

  const [assistantContext, setAssistantContext] = useState<AssistantContext | undefined>(undefined);

  useEffect(() => {
    assistantContextRef.current = assistantContext;
  }, [assistantContext]);

  useEffect(() => {
    let isActive = true;
    const assistantItem = renderedItem ?? currentItem;
    if (!assistantItem || assistantItem.type !== "document" || !assistantItem.documentId) {
      setDocumentContent(undefined);
      return;
    }

    const loadDocContent = async () => {
      try {
        const doc = await getDocument(assistantItem.documentId!);
        if (isActive) {
          setDocumentContent(doc?.content ?? undefined);
        }
      } catch (err) {
        console.error("[QueueScroll] Failed to load document content for assistant:", err);
        if (isActive) {
          setDocumentContent(undefined);
        }
      }
    };

    void loadDocContent();
    return () => {
      isActive = false;
    };
  }, [renderedItem?.id, currentItem?.id]);

  const resolveContextForPrompt = useCallback(
    async (_prompt: string): Promise<ResolvedAssistantContext> => {
      const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;
      const assistantItem = renderedItem ?? currentItem;
      const activeSelection = selectionRef.current;
      const pageNumber = scrollStateRef.current.pageNumber;

      if (!assistantItem) {
        return resolveGenericAssistantContext(undefined, "none");
      }

      if (assistantItem.type === "document" && assistantItem.documentId) {
        const doc = documentsRef.current.find((d) => d.id === assistantItem.documentId);
        if (doc?.fileType === "youtube") {
          return resolveGenericAssistantContext(assistantContextRef.current?.content, "video-transcript");
        }

        if (doc?.fileType === "pdf") {
          const preferOcr = settings.documents.ocr.autoOCR || settings.documents.ocr.autoExtractOnLoad;
          const resolution = await resolvePdfAssistantContext({
            document: doc,
            liveWindowText: pdfContextTextRef.current,
            storedDocumentText: doc.content ?? documentContentRef.current,
            ocrText: pdfOcrContextTextRef.current,
            selection: activeSelection,
            pageNumber,
            contextPageWindow: 2,
            preferOcr,
            extractedTextLoader: doc.id
              ? async () => {
                  const result = await extractDocumentText(doc.id);
                  return result.content;
                }
              : undefined,
          });

          if (resolution.status !== "ready" || !resolution.content) {
            return resolution;
          }

          try {
            const trimmed = await trimToTokenWindow(resolution.content, maxTokens, aiModel, activeSelection);
            return {
              ...resolution,
              content: trimmed,
            };
          } catch {
            return {
              ...resolution,
              content: resolution.content.slice(0, maxTokens * 4),
            };
          }
        }
      }

      return resolveGenericAssistantContext(assistantContextRef.current?.content, "document");
    },
    [aiModel, contextWindowTokens, settings.documents.ocr.autoExtractOnLoad, settings.documents.ocr.autoOCR, renderedItem?.id, currentItem?.id]
  );

  useEffect(() => {
    let cancelled = false;
    const assistantItem = renderedItem ?? currentItem;
    if (!assistantItem) {
      setAssistantContext(undefined);
      return;
    }

    const buildContext = async () => {
      const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;

      if (assistantItem.type === "document" && assistantItem.documentId) {
        const doc = documents.find(d => d.id === assistantItem.documentId);
        const title = doc?.title || assistantItem.documentTitle;
        const titleLine = title ? `Title: ${title}` : null;

        if (doc?.fileType === "youtube") {
          let transcriptText = transcriptCacheRef.current.get(doc.id);
          if (!transcriptText && !transcriptFetchInFlightRef.current.has(doc.id)) {
            transcriptFetchInFlightRef.current.add(doc.id);
            try {
              const videoId = extractYouTubeId(doc.filePath);
              if (videoId) {
                const segments = await fetchYouTubeTranscript(videoId);
                if (segments.length > 0) {
                  const text = buildTranscriptText(segments);
                  if (text) {
                    transcriptCacheRef.current.set(doc.id, text);
                    transcriptText = text;
                  }
                }
              }
            } catch (error) {
              console.warn("[QueueScroll] Failed to fetch YouTube transcript for assistant context", doc.id, error);
            } finally {
              transcriptFetchInFlightRef.current.delete(doc.id);
            }
          }

          if (transcriptText) {
            const content = [titleLine, transcriptText].filter(Boolean).join("\n\n");
            const trimmed = content ? await trimToTokenWindow(content, maxTokens, aiModel, selection, debouncedScrollPercent) : undefined;
            if (!cancelled) {
              setAssistantContext({
                type: "video",
                documentId: assistantItem.documentId,
                content: trimmed || undefined,
                contextWindowTokens: maxTokens,
                selection: selection || undefined,
                status: "ready",
                source: "video-transcript",
                metadata: {
                  title: title || undefined,
                },
                resolveForPrompt: resolveContextForPrompt,
              });
            }
            return;
          }
        }

        let contentText = doc?.content ?? documentContent;
        let sourceVal = "document";
        if (doc?.fileType === "pdf") {
          const preferOcr = settings.documents.ocr.autoOCR || settings.documents.ocr.autoExtractOnLoad;
          const preferredBody = preferOcr
            ? (pdfOcrContextText || pdfContextText)
            : (pdfContextText || pdfOcrContextText);

          contentText = preferredBody || contentText || selection;
          sourceVal = preferredBody === pdfOcrContextText ? "ocr" : (preferredBody === pdfContextText ? "pdf-window" : "document");
        }

        if (!contentText) {
          if (!cancelled) {
            setAssistantContext({
              type: "document",
              documentId: assistantItem.documentId,
              content: undefined,
              contextWindowTokens: maxTokens,
              selection: selection || undefined,
              status: doc?.fileType === "pdf" ? "loading" : "unavailable",
              statusMessage: doc?.fileType === "pdf"
                ? "Document context is still loading. Try again in a moment."
                : "No text content available for this document.",
              metadata: {
                title: title || undefined,
              },
              resolveForPrompt: resolveContextForPrompt,
            });
          }
          return;
        }

        const content = [titleLine, contentText]
          .filter(Boolean)
          .join("\n\n");
        const trimmed = content ? await trimToTokenWindow(content, maxTokens, aiModel, selection, debouncedScrollPercent) : undefined;
        if (!cancelled) {
          setAssistantContext({
            type: "document",
            documentId: assistantItem.documentId,
            content: trimmed || undefined,
            contextWindowTokens: maxTokens,
            selection: selection || undefined,
            status: "ready",
            source: sourceVal,
            metadata: {
              title: title || undefined,
            },
            resolveForPrompt: resolveContextForPrompt,
          });
        }
        return;
      }

      if (assistantItem.type === "extract" && assistantItem.extract) {
        const extractContent = [assistantItem.extract.content, assistantItem.extract.notes]
          .filter(Boolean)
          .join("\n\n");
        const title = assistantItem.documentTitle ? `Title: ${assistantItem.documentTitle}` : null;
        const content = [title, extractContent].filter(Boolean).join("\n\n");
        const trimmed = content ? await trimToTokenWindow(content, maxTokens, aiModel, selection, debouncedScrollPercent) : undefined;
        if (!cancelled) {
          setAssistantContext({
            type: "document",
            documentId: `extract:${assistantItem.extract.id}`,
            content: trimmed || undefined,
            contextWindowTokens: maxTokens,
            selection: selection || undefined,
            status: "ready",
            source: "document",
            metadata: {
              title: assistantItem.documentTitle || undefined,
            },
            resolveForPrompt: resolveContextForPrompt,
          });
        }
        return;
      }

      if (assistantItem.type === "rss") {
        const title = assistantItem.rssItem?.title ? `Title: ${assistantItem.rssItem?.title}` : null;
        const rssContent = assistantItem.rssItem?.content || assistantItem.rssItem?.description;
        const content = [title, rssContent].filter(Boolean).join("\n\n");
        const trimmed = content ? await trimToTokenWindow(content, maxTokens, aiModel, rssSelectedText, debouncedScrollPercent) : undefined;
        if (!cancelled) {
          setAssistantContext({
            type: "web",
            url: assistantItem.rssItem?.link || `rss:${assistantItem.rssItem?.id}`,
            content: trimmed || undefined,
            contextWindowTokens: maxTokens,
            selection: rssSelectedText || undefined,
            status: "ready",
            source: "document",
            metadata: {
              title: assistantItem.rssItem?.title || undefined,
            },
            resolveForPrompt: resolveContextForPrompt,
          });
        }
        return;
      }

      setAssistantContext(undefined);
    };

    void buildContext();
    return () => {
      cancelled = true;
    };
  }, [
    currentItem,
    renderedItem,
    documents,
    contextWindowTokens,
    aiModel,
    selection,
    rssSelectedText,
    debouncedScrollPercent,
    pdfContextText,
    pdfOcrContextText,
    documentContent,
    resolveContextForPrompt,
    settings.documents.ocr.autoOCR,
    settings.documents.ocr.autoExtractOnLoad,
  ]);

  useEffect(() => {
    if (currentItem) {
      if (currentItem.type === "document") {
        const _docInStore = documents.find(d => d.id === currentItem.documentId);
      } else {
      }
    }
  }, [currentIndex, currentItem, scrollItems.length, documents]);

  // Reset the in-item scroll surface to the top after advancing, so the next item
  // is read from the beginning rather than at the previous item's scroll offset.
  // The RSS article scroll container is not keyed to the item, so React reconciles
  // it across items and would otherwise preserve scrollTop.
  const resetScrollToTop = useCallback(() => {
    // RSS article: its scroll parent is the overflow-y-auto wrapper around rssContentRef.
    const rssScrollParent = rssContentRef.current?.parentElement as HTMLElement | null;
    if (rssScrollParent) {
      rssScrollParent.scrollTop = 0;
    }
    // Generic fallback: any other overflow scroll surface inside the viewer.
    const viewer = containerRef.current;
    if (viewer) {
      viewer
        .querySelectorAll<HTMLElement>(".overflow-y-auto, .overflow-auto")
        .forEach((el) => {
          el.scrollTop = 0;
        });
    }
    // Document viewers (EPUB/PDF/HTML) manage their own scroll and are keyed by
    // documentId, so they remount to the top naturally.
  }, []);

  // Navigation functions
  const goToNext = useCallback(() => {
    if (currentIndex < scrollItems.length - 1 && !isTransitioning && !isRating) {
      setIsTransitioning(true);
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      // Update renderedIndex after transition completes to avoid premature unmount
      setTimeout(() => {
        setRenderedIndex(nextIndex);
        setIsTransitioning(false);
        resetScrollToTop();
      }, 300);
    }
  }, [currentIndex, scrollItems.length, isTransitioning, isRating, resetScrollToTop]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0 && !isTransitioning && !isRating) {
      setIsTransitioning(true);
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      // Update renderedIndex after transition completes to avoid premature unmount
      setTimeout(() => {
        setRenderedIndex(prevIndex);
        setIsTransitioning(false);
        resetScrollToTop();
      }, 300);
    }
  }, [currentIndex, isTransitioning, isRating, resetScrollToTop]);

  const advanceAfterRemoval = useCallback((removedItemId: string) => {
    // In neural mode, consuming the just-studied element and refilling on
    // depletion is the depletion trigger (task 4.11). Fire it alongside the
    // visual removal — it is best-effort and never blocks the advance.
    if (isNeuralMode) {
      const studied = scrollItems.find((it) => it.id === removedItemId);
      const elementId = studied?.neuralElementId;
      if (elementId !== undefined) {
        // Update the seed to the just-studied element so a refill re-seeds
        // there (true "expand from where I am" per the backend contract).
        const nextSeed = neuralSeedFromItem(studied);
        if (nextSeed) neuralSeedRef.current = nextSeed;
        void (async () => {
          try {
            await consumeNeuralQueueElement(elementId);
            if (nextSeed) {
              const refilled = await refillNeuralQueueIfDepleted(
                nextSeed.kind,
                nextSeed.refId,
                neuralEmbeddingConfigRef.current ?? undefined,
              );
              if (refilled !== null) {
                // Queue was rebuilt: fetch the new front and append any entries
                // not already shown so the session continues seamlessly.
                const fresh = await getNeuralQueueResolvedFront(NEURAL_FETCH_BATCH);
                setScrollItems((prev) => {
                  const seen = new Set(prev.map((it) => it.neuralElementId));
                  const unseen = fresh.filter((e) => !seen.has(e.element_id));
                  if (unseen.length === 0) return prev;
                  void buildNeuralScrollItems(unseen, documentsMap, t("queueScroll.unknownDocument")).then(
                    (newItems) => {
                      setScrollItems((cur) => dedupeById([...cur, ...newItems]));
                    },
                  );
                  return prev;
                });
                toast.info(t("neural.refilled"));
              }
            }
            setNeuralRemaining(await getNeuralQueueRemaining());
          } catch {
            // Non-fatal: the advance already happened visually.
          }
        })();
      }
    }

    setScrollItems((prev) => {
      const updated = prev.filter((item) => item.id !== removedItemId);
      if (updated.length === 0) {
        setCurrentIndex(0);
        setRenderedIndex(0);
        return updated;
      }

      const nextIndex = Math.min(currentIndex, updated.length - 1);
      setIsTransitioning(true);
      setCurrentIndex(nextIndex);
      setTimeout(() => {
        setRenderedIndex(nextIndex);
        setIsTransitioning(false);
        resetScrollToTop();
      }, 300);
      return updated;
    });
  }, [currentIndex, resetScrollToTop, isNeuralMode, scrollItems, documentsMap, toast, t]);

  const handleDetailsDelete = useCallback(async () => {
    if (!currentItem) return;
    if (currentItem.type === "document" && currentItem.documentId) {
      await deleteDocumentUndoable(currentItem.documentId);
    } else if (currentItem.type === "extract" && currentItem.extract) {
      await deleteExtractUndoable(currentItem.extract.id);
    } else if (currentItem.type === "flashcard" && currentItem.learningItem) {
      await deleteLearningItemUndoable(currentItem.learningItem.id);
    } else {
      return;
    }
    advanceAfterRemoval(currentItem.id);
    void loadQueue();
  }, [currentItem, deleteDocumentUndoable, deleteExtractUndoable, deleteLearningItemUndoable, advanceAfterRemoval, loadQueue]);

  // --- AI Summary (Optimal Queue) ---------------------------------------------------
  // Mirrors the RSS Scroll Mode summary experience but operates on whichever item
  // is currently rendered: a document (using its loaded text content) or an RSS
  // article. Reuses the same summary cache, LLM provider resolution, and
  // ModernSummaryPanel UI as RSS Scroll Mode for consistency.

  // Convert an HTML fragment to plain text for summarization.
  const htmlToText = useCallback((html: string): string => {
    if (typeof document === "undefined") {
      return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || "";
    return text.replace(/\s+/g, " ").trim();
  }, []);

  const closeSummary = useCallback(() => {
    setShowSummary(false);
  }, []);

  const handleSummarize = useCallback(
    async (params?: { length?: SummaryLength; focus?: SummaryFocus }) => {
      const summaryItem = renderedItem ?? currentItem;
      if (!summaryItem || isSummarizing) return;

      // Resolve the raw text content + identity for the current item.
      let rawContent = "";
      let articleId = "";
      let articleTitle = "";
      let articleUrl: string | undefined;

      if (summaryItem.type === "rss" && summaryItem.rssItem) {
        rawContent = summaryItem.rssItem.content || summaryItem.rssItem.description || "";
        articleId = `rss-${summaryItem.rssItem.id}`;
        articleTitle = summaryItem.rssItem.title;
        articleUrl = summaryItem.rssItem.link;
      } else if (summaryItem.type === "document" && summaryItem.documentId) {
        // Prefer the already-loaded assistant document content; fall back to the
        // document store's plain content if available.
        const doc = documentsRef.current.find((d) => d.id === summaryItem.documentId);
        const fromLoaded = documentContentRef.current;
        rawContent = fromLoaded ?? doc?.content ?? "";
        articleId = `doc-${summaryItem.documentId}`;
        articleTitle = summaryItem.documentTitle || doc?.title || "";
        articleUrl = undefined;
      } else {
        toast.error(t("queueScroll.noContentToSummarize"));
        return;
      }

      const content = htmlToText(rawContent);
      if (!content.trim()) {
        toast.error(t("queueScroll.noContentToSummarize"));
        return;
      }

      const length = params?.length || modernSummaryLength;
      const focus = params?.focus || modernSummaryFocus;

      // Serve from cache when params match.
      const cached = getCachedSummary(articleId, content);
      if (cached && cached.length === length && cached.focus === focus) {
        setSummaryText(cached.content);
        setShowSummary(true);
        return;
      }

      // Resolve an LLM provider (same precedence as RSS Scroll Mode).
      let providerType: string = "openrouter";
      let apiKey: string | undefined;
      let model: string | undefined;
      let baseUrl: string | undefined;

      let aiConfig: AIConfig | null = null;
      try {
        aiConfig = await getAIConfig();
      } catch {
        /* AIConfig may not be initialized yet */
      }

      if (aiConfig?.default_provider && aiConfig.api_keys) {
        const providerMap: Record<string, string> = {
          OpenAI: "openai",
          Anthropic: "anthropic",
          OpenRouter: "openrouter",
          Ollama: "ollama",
        };
        providerType = providerMap[aiConfig.default_provider] ?? "openrouter";
        apiKey = providerType === "ollama"
          ? undefined
          : (aiConfig.api_keys as Record<string, string | undefined>)[providerType] ?? undefined;
        model = String(aiConfig.models?.[`${providerType}_model` as keyof typeof aiConfig.models] ?? "");
        baseUrl = providerType === "ollama"
          ? aiConfig.local_settings?.ollama_base_url || undefined
          : undefined;
      }

      if (!apiKey) {
        const providers = useLLMProvidersStore.getState().getEnabledProviders();
        const withKey = providers.filter((p) => p.apiKey && p.apiKey.trim().length > 0 && p.provider !== "ollama");
        const chosen = withKey[0] || providers.find((p) => p.provider === "ollama");
        if (chosen) {
          providerType = chosen.provider;
          apiKey = chosen.apiKey || undefined;
          model = chosen.model || undefined;
          baseUrl = chosen.baseUrl || undefined;
        }
      }

      if (providerType !== "ollama" && !apiKey) {
        toast.error(t("queueScroll.noProviderConfigured"));
        return;
      }

      setIsSummarizing(true);
      setSummaryText("");
      setShowSummary(true);
      setLoadingStage("analyzing");
      setLoadingProgress(SUMMARY_LOADING_STAGES.analyzing.progress);

      try {
        const tokenLimit = SUMMARY_LENGTH_CONFIG[length].tokens;
        const inputWindow = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 4000;
        const trimmedContent = await trimToTokenWindow(content, inputWindow, String(model || ""));

        const focusInstruction =
          focus === "actionable"
            ? "Focus on actionable takeaways and next steps."
            : focus === "background"
              ? "Provide background context and explain why this matters."
              : "Focus on key points and main conclusions.";

        const messages: LLMMessage[] = [
          {
            role: "system",
            content: `You are a concise article summarizer. ${focusInstruction} Keep the summary under ${tokenLimit} words. Use markdown formatting. Do not include preamble — output only the summary.`,
          },
          {
            role: "user",
            content: `Summarize this article:\n\n${trimmedContent}`,
          },
        ];

        setLoadingStage("extracting");
        setLoadingProgress(SUMMARY_LOADING_STAGES.extracting.progress);

        const summary = (
          await Promise.race([
            chatWithLLM({
              provider: providerType as "openai" | "anthropic" | "gemini" | "deepseek" | "ollama" | "openrouter",
              model: model as string | undefined,
              messages,
              maxTokens: Math.max(tokenLimit * 4, 2048),
              apiKey,
              baseUrl,
              temperature: 0.3,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Summarization timed out")), 30000)
            ),
          ])
        ).content;

        setLoadingStage("synthesizing");
        setLoadingProgress(SUMMARY_LOADING_STAGES.synthesizing.progress);
        await new Promise((resolve) => setTimeout(resolve, 200));

        setSummaryText(summary);
        setLoadingStage("complete");
        setLoadingProgress(100);

        cacheSummary(articleId, content, summary, { length, focus }, {
          articleTitle,
          articleUrl,
        });
      } catch (error) {
        console.error("Failed to summarize:", error);
        toast.error(
          t("queueScroll.failedSummarize"),
          error instanceof Error ? error.message : "Unknown error"
        );
        setSummaryText("");
      } finally {
        setIsSummarizing(false);
      }
    },
    [
      renderedItem,
      currentItem,
      isSummarizing,
      htmlToText,
      documents,
      modernSummaryLength,
      modernSummaryFocus,
      getCachedSummary,
      cacheSummary,
      contextWindowTokens,
      toast,
      t,
    ]
  );

  // Mouse wheel scroll detection - only navigate when document can't scroll further
  // For EPUB documents, disable auto-advance to allow user to read through the entire book
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const now = Date.now();

      if (now - lastScrollTime.current < scrollCooldown) {
        return;
      }

      // EPUBs and PDFs can be lengthy documents, so we don't want to auto-advance when user reaches the end
      // Audio documents need the player to remain visible — wheel events shouldn't navigate away
      // User should be able to scroll through the entire document freely
      let isScrollableDocument = false;
      let isYouTubeItem = false;
      if (currentItem?.type === "document" && currentItem.documentId) {
        const doc = documents.find(d => d.id === currentItem.documentId);
        if (doc) {
          const fileType = doc.fileType || doc.filePath?.split('.').pop()?.toLowerCase();
          isScrollableDocument = fileType === "epub" || fileType === "pdf" || fileType === "audio";
          isYouTubeItem = fileType === "youtube"
            || !!doc.filePath?.includes("youtube.com")
            || !!doc.filePath?.includes("youtu.be");
        }
      }

      // For EPUB, PDF, audio documents, and extract/flashcard review items,
      // don't auto-advance on scroll — the user must rate, dismiss, or use
      // keyboard/navigation buttons to move on. Without this, residual wheel
      // momentum (e.g. trackpad inertia from the prior document) flashes the
      // card and immediately advances past it.
      if (
        isScrollableDocument ||
        currentItem?.type === "podcast" ||
        currentItem?.type === "extract" ||
        currentItem?.type === "flashcard"
      ) {
        return; // Let the document/player/card scroll normally, no auto-advance
      }

      // Find the scrollable content element
      const target = e.target as HTMLElement;
      if (target.closest(".assistant-panel")) {
        return;
      }
      const transcriptScrollElement = target.closest('[data-transcript-scroll="true"]') as HTMLElement | null;
      const extractScrollContainer = target.closest('[data-extract-scroll="true"]') as HTMLElement | null;
      // For textareas inside extract cards, the textarea itself handles scrolling
      // internally — the parent overflow container never scrolls, so we must check
      // the textarea's scroll position instead of the container's.
      const extractScrollElement = (target.tagName === 'TEXTAREA' && extractScrollContainer)
        ? (target as HTMLElement)
        : extractScrollContainer;
      const scrollableElement = transcriptScrollElement
        || extractScrollElement
        || target.closest('[class*="overflow"]') as HTMLElement
        || target.closest('.prose') as HTMLElement
        || document.documentElement;

      if (scrollableElement) {
        const canScrollDown = scrollableElement.scrollTop < (scrollableElement.scrollHeight - scrollableElement.clientHeight - 10);
        const canScrollUp = scrollableElement.scrollTop > 10;

        if (!(isYouTubeItem && !transcriptScrollElement)) {
          // If scrolling down and document can still scroll down, let it scroll
          if (e.deltaY > 0 && canScrollDown) {
            return; // Let the document scroll normally
          }
          // If scrolling up and document can still scroll up, let it scroll
          if (e.deltaY < 0 && canScrollUp) {
            return; // Let the document scroll normally
          }
        }
      }

      // Document is at edge, navigate to next/previous
      lastScrollTime.current = now;

      // Scroll down = next document
      if (e.deltaY > 0) {
        goToNext();
      }
      // Scroll up = previous document
      else if (e.deltaY < 0) {
        goToPrevious();
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: true });
      return () => container.removeEventListener("wheel", handleWheel);
    }
  }, [goToNext, goToPrevious, currentItem, documents]);

  const toggleFullscreen = useCallback(async () => {
    try {
      const appWindow = getCurrentWindow();
      if (isFullscreen) {
        await appWindow.setFullscreen(false);
        setIsFullscreen(false);
      } else {
        await appWindow.setFullscreen(true);
        setIsFullscreen(true);
      }
    } catch (error) {
      console.error("Failed to toggle fullscreen:", error);
    }
  }, [isFullscreen]);

  // Keyboard navigation for TikTok-style scroll mode:
  // Up/Down navigates queue items, Left/Right scrolls item content vertically.
  useEffect(() => {
    const getScrollableContentElement = (): HTMLElement | null => {
      if (!containerRef.current) return null;

      // Prefer transcript panel when present (YouTube items).
      const transcriptEl = containerRef.current.querySelector('[data-transcript-scroll="true"]') as HTMLElement | null;
      if (transcriptEl) {
        return transcriptEl;
      }

      // RSS item container (outer overflow wrapper around the reading surface).
      const rssScrollable = rssContentRef.current?.parentElement as HTMLElement | null;
      if (rssScrollable && rssScrollable.scrollHeight > rssScrollable.clientHeight + 4) {
        return rssScrollable;
      }

      // Document viewer's explicit scroll container (PDF and some other viewers).
      const docScrollContainer = containerRef.current.querySelector('[data-document-scroll-container]') as HTMLElement | null;
      if (docScrollContainer) {
        return docScrollContainer;
      }

      // Fallback: document content host.
      const docContentHost = containerRef.current.querySelector('[data-document-content="true"]') as HTMLElement | null;
      if (docContentHost && docContentHost.scrollHeight > docContentHost.clientHeight + 4) {
        return docContentHost;
      }

      return null;
    };

    const scrollContentVertically = (direction: "up" | "down") => {
      const scrollable = getScrollableContentElement();
      if (!scrollable) return;

      const delta = direction === "down" ? 180 : -180;
      scrollable.scrollBy({ top: delta, behavior: "smooth" });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in input
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (target?.closest(".assistant-panel")) {
        return;
      }

      const isReviewItem = currentItem?.type === "flashcard" || currentItem?.type === "extract";
      const isDocItem = currentItem?.type === "document";

      if (!isDocItem && handleVolumeRockerNavigation(
        e,
        settings.interface.volumeRockerScroll || "none",
        {
          pageUp: () => {
            if (isMobile) {
              setShowControls(false);
              setShowRatingControls(false);
            }
            goToPrevious();
          },
          pageDown: () => {
            if (isMobile) {
              setShowControls(false);
              setShowRatingControls(false);
            }
            goToNext();
          },
          scrollUp: () => {
            if (isMobile) {
              setShowControls(false);
              setShowRatingControls(false);
            }
            scrollContentVertically("up");
          },
          scrollDown: () => {
            if (isMobile) {
              setShowControls(false);
              setShowRatingControls(false);
            }
            scrollContentVertically("down");
          },
        },
      )) return;

      // Space (flashcard reveal) and 1-4 (rating) shortcuts — decided by a
      // pure, unit-tested helper. Flashcards reveal on Space only while the
      // answer is hidden, and rate on 1-4 only after it is revealed, matching
      // the card's own buttons and the review session.
      const ratingKeyAction = resolveScrollRatingKey(e.key, {
        itemType: currentItem?.type,
        flashcardRevealed: flashcardRevealedRef.current,
        isRating,
      });
      if (ratingKeyAction?.kind === "reveal-flashcard") {
        // The card's own Space handler only fires when focus is inside the
        // card; in Scroll Mode focus sits on the page, so drive the reveal
        // through the window-event bridge instead.
        e.preventDefault();
        e.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent(FLASHCARD_REVEAL_EVENT));
        return;
      }
      if (ratingKeyAction?.kind === "rate") {
        // Rate the current item with the number keys — the same action as the
        // rating buttons. stopImmediatePropagation prevents a double rating
        // when a per-item handler would also fire.
        e.preventDefault();
        e.stopImmediatePropagation();
        rateCurrentItemRef.current(ratingKeyAction.rating);
        return;
      }

      if (e.key === " ") {
        if (isReviewItem) {
          return;
        }
        e.preventDefault();
        goToNext();
      } else if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goToNext();
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goToPrevious();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollContentVertically("down");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollContentVertically("up");
      } else if (e.key === "F11") {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleFullscreen();
      } else if (e.key === "Escape") {
        // Don't close the tab if an overlay (modal/popup/dialog) is open —
        // let the overlay's own handler consume the Escape instead.
        const overlayOpen = !!(flashcardStudioSeed || activeExtractForCloze || activeExtractForQA || isExtractDialogOpen || showSettings || showRssSettings);
        if (overlayOpen) {
          // Don't stop propagation — let the modal/popup handle Escape at bubble phase
          return;
        }
        e.stopImmediatePropagation();
        if (isFullscreen) {
          toggleFullscreen();
          return;
        }
        // Exit scroll mode — close tab and return to previous tab
        if (activeTabId) {
          closeTab(activeTabId);
        }
      } else if (e.key === "h" || e.key === "?") {
        // Toggle controls
        setShowControls((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [currentItem, currentItem?.type, isRating, goToNext, goToPrevious, isFullscreen, toggleFullscreen, activeTabId, closeTab, settings.interface.volumeRockerScroll]);

  // Bridge for TikTok-style vertical paging originating inside the EPUB iframe.
  // Touches inside epub.js's iframe are isolated from the parent document, so the
  // queue's own touch handler can't see them. The EPUBViewer instead pages the
  // book internally (rendition.next/prev) and, when the user is already on the
  // first/last page, dispatches this event so the queue advances to the next item.
  // This is what makes a long EPUB feel like a Kindle: swipe to turn pages, and a
  // swipe past the final page moves on in the queue — no need to "scroll to the
  // bottom" of the whole book.
  useEffect(() => {
    const handleBridge = (e: Event) => {
      const detail = (e as CustomEvent<{ direction: "next" | "prev" }>).detail;
      if (!detail) return;
      // Flashcards and extracts require an explicit rating/dismissal — they
      // must not be skipped by a bridged swipe from the EPUB viewer (or any
      // other dispatcher). A residual/queued swipe event arriving right after
      // advancing onto a card would otherwise flash the card and advance past
      // it before the user can answer. This matches the wheel and touch
      // handlers' guards for these types.
      if (
        currentItem?.type === "flashcard" ||
        currentItem?.type === "extract"
      ) {
        return;
      }
      if (detail.direction === "next") goToNext();
      else goToPrevious();
    };
    const handleLongPressBridge = () => {
      setShowControls(true);
      setShowRatingControls(true);
    };
    const handleHideControlsBridge = () => {
      setShowControls(false);
      setShowRatingControls(false);
    };
    window.addEventListener("incrementum-queue-swipe", handleBridge as EventListener);
    window.addEventListener("incrementum-queue-long-press", handleLongPressBridge);
    window.addEventListener("incrementum-queue-hide-controls", handleHideControlsBridge);
    return () => {
      window.removeEventListener("incrementum-queue-swipe", handleBridge as EventListener);
      window.removeEventListener("incrementum-queue-long-press", handleLongPressBridge);
      window.removeEventListener("incrementum-queue-hide-controls", handleHideControlsBridge);
    };
  }, [goToNext, goToPrevious, currentItem]);

  // Auto-hide controls after 3 seconds of idle (both mobile/touch and desktop).
  //
  // The interaction listeners stay attached even while the controls are
  // hidden, so any mouse movement, touch, or keystroke brings them straight
  // back. This is essential because some content — notably the YouTube
  // <iframe> — swallows pointer events: if the idle timer fires while the
  // cursor is over the video (or after navigating to a new item), the menu
  // must still be recoverable. Earlier this effect early-returned while
  // hidden, deregistering these listeners and leaving the top-layer menu
  // (settings, item details, read/dismiss) permanently stuck invisible.
  useEffect(() => {
    let hideTimeout: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => setShowControls(false), 3000);
    };

    const handleInteraction = () => {
      setShowControls(true);
      resetTimer();
    };

    const handleTouchActivity = () => {
      // Touch scrolling counts as activity for the idle timer, but only the
      // stationary-tap classifier may change overlay visibility.
      resetTimer();
    };

    // "h"/"?" are the manual show/hide toggle handled by the keydown effect
    // below; don't let them force the controls back on through this listener.
    const handleKeyInteraction = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "?") return;
      if (isVolumeRockerNavigationKey(e.key, settings.interface.volumeRockerScroll || "none")) return;
      handleInteraction();
    };

    resetTimer();

    window.addEventListener("mousemove", handleInteraction);
    window.addEventListener("touchstart", handleTouchActivity, { passive: true });
    window.addEventListener("keydown", handleKeyInteraction);

    return () => {
      window.removeEventListener("mousemove", handleInteraction);
      window.removeEventListener("touchstart", handleTouchActivity);
      window.removeEventListener("keydown", handleKeyInteraction);
      clearTimeout(hideTimeout);
    };
  }, [settings.interface.volumeRockerScroll]);

  // Handle rating (for documents, flashcards, or mark as read for RSS)
  const handleRating = async (rating: number) => {

    if (!currentItem) {
      return;
    }

    if (isRating) {
      return;
    }

    setIsRating(true);
    const ratedItemId = currentItem.id;

    try {
      // Active seconds, not wall-clock: an item left on screen while the user
      // was elsewhere no longer inflates the recorded time. Consuming them
      // here also stops them from being sent again as unrated time.
      notifyEngagement();
      const timeTaken = Math.max(1, consumeActiveSeconds());

      if (currentItem.type === "document") {
        if (!currentItem.documentId) {
          console.error("[QueueScroll] Document item has no documentId!");
          throw new Error("Document ID is missing");
        }

        // Use the engaging FSRS-6 scheduler!
        const result = await rateDocumentEngaging(currentItem.documentId, rating, timeTaken);

        // Track rated document to prevent immediate re-appearance
        setRatedDocumentIds(prev => {
          const newSet = new Set(prev);
          newSet.add(currentItem.documentId!);
          return newSet;
        });

        // Track items reviewed this session
        setItemsReviewedThisSession(prev => prev + 1);

        advanceAfterRemoval(ratedItemId);
      } else if (currentItem.type === "flashcard" && currentItem.learningItem) {
        // Rate flashcard using FSRS/SM-20
        await submitReview(currentItem.learningItem.id, rating, timeTaken, undefined, {
          algorithm: settings.learning.algorithm,
          sm20PureM4: settings.learning.sm20PureM4,
        });

        // Track items reviewed
        setItemsReviewedThisSession(prev => prev + 1);

        // Remove the rated flashcard from both dueFlashcards and scrollItems
        setDueFlashcards(prev => prev.filter(item => item.id !== currentItem.learningItem!.id));
        // Record so the queue-list rebuild (re-derives from static customQueueItems)
        // does not re-insert this card.
        setRatedFlashcardIds(prev => {
          const next = new Set(prev);
          next.add(currentItem.learningItem!.id);
          return next;
        });
        advanceAfterRemoval(ratedItemId);
      } else if (currentItem.type === "rss" && currentItem.rssItem && currentItem.rssFeed) {
        // Mark RSS item as read
        await markItemReadAuto(currentItem.rssFeed.id, currentItem.rssItem.id, true);

        // Track read RSS item to prevent re-appearance in custom subset rebuilds
        setReadRssItemIds(prev => {
          const newSet = new Set(prev);
          newSet.add(currentItem.rssItem!.id);
          return newSet;
        });

        // Track items reviewed
        setItemsReviewedThisSession(prev => prev + 1);

        // Remove from scroll items and advance — the useEffect rebuild will
        // handle refreshing the full list (filtering out read items via readRssItemIds)
        advanceAfterRemoval(ratedItemId);
      } else if (currentItem.type === "extract" && currentItem.extract) {
        await submitExtractReview(currentItem.extract.id, rating, timeTaken);

        // Track items reviewed
        setItemsReviewedThisSession(prev => prev + 1);

        setDueExtracts(prev => prev.filter(e => e.id !== currentItem.extract!.id));
        // Record so the queue-list rebuild does not re-insert this extract.
        setRatedExtractIds(prev => {
          const next = new Set(prev);
          next.add(currentItem.extract!.id);
          return next;
        });
        advanceAfterRemoval(ratedItemId);
      } else if (currentItem.type === "podcast" && currentItem.podcastEpisode) {
        // Mark podcast episode as played
        await markEpisodePlayed(currentItem.podcastEpisode.id, true);

        // Track items reviewed
        setItemsReviewedThisSession(prev => prev + 1);

        advanceAfterRemoval(ratedItemId);
      }

      // Allow transition to complete, then release rating lock
      setTimeout(() => {
        setIsRating(false);
      }, 300);
    } catch (error) {
      console.error("[QueueScroll] Failed to handle rating:", error);
      toast.error(
        t("queueScroll.ratingFailed"),
        error instanceof Error ? error.message : t("queueScroll.pleaseTryAgain")
      );
    } finally {
      // Always reset isRating after a short delay, even on error
      setTimeout(() => {
        setIsRating(false);
      }, 500);
    }
  };

  // Keep the keydown effect's rating hook pointing at the latest handler.
  useEffect(() => {
    rateCurrentItemRef.current = handleRating;
  }, [handleRating]);

  const handleDismiss = async () => {

    if (!currentItem) {
      return;
    }

    if (isRating) {
      return;
    }

    // Supported types for dismissal: document, flashcard, extract
    if (
      currentItem.type !== "document" &&
      currentItem.type !== "flashcard" &&
      currentItem.type !== "extract"
    ) {
      toast.info(t("queueScroll.dismissNotAvailable"), t("queueScroll.onlyDismissableItems") !== "queueScroll.onlyDismissableItems" ? t("queueScroll.onlyDismissableItems") : "Only documents, flashcards, and extracts can be dismissed");
      return;
    }

    setIsRating(true);
    const dismissedItemId = currentItem.id;

    try {
      if (currentItem.type === "document" && currentItem.documentId) {

        // Call API to dismiss document
        await dismissDocument(currentItem.documentId, true);

        // Patch the local documents store so `documentsMap` reflects
        // isDismissed=true immediately. Without this, a scroll-session rebuild
        // (e.g. from a concurrent queue load) re-filters the stale document as
        // still active and resurrects the just-dismissed item.
        updateDocument(currentItem.documentId, { isDismissed: true });

        // Track dismissed document
        setRatedDocumentIds((prev) => {
          const newSet = new Set(prev);
          newSet.add(currentItem.documentId!);
          return newSet;
        });

        // Track items reviewed this session
        setItemsReviewedThisSession((prev) => prev + 1);

        toast.success(t("queueScroll.documentDismissed"), t("queueScroll.documentDismissedDesc"));
      } else if (currentItem.type === "flashcard" && currentItem.learningItem) {
        const cardId = currentItem.learningItem.id;

        // Call API to suspend flashcard
        await bulkSuspendItems([cardId]);

        // Track items reviewed this session
        setItemsReviewedThisSession((prev) => prev + 1);

        // Remove from dueFlashcards state to prevent re-populating on state recalculation
        setDueFlashcards((prev) => prev.filter((item) => item.id !== cardId));
        // Record so the queue-list rebuild does not re-insert this card.
        setRatedFlashcardIds((prev) => {
          const next = new Set(prev);
          next.add(cardId);
          return next;
        });

        toast.success(
          t("queueScroll.cardSuspended") !== "queueScroll.cardSuspended" ? t("queueScroll.cardSuspended") : "Flashcard suspended",
          t("queueScroll.cardSuspendedDesc") !== "queueScroll.cardSuspendedDesc" ? t("queueScroll.cardSuspendedDesc") : "This flashcard has been suspended and will not appear in reviews."
        );
      } else if (currentItem.type === "extract" && currentItem.extract) {
        const extractId = currentItem.extract.id;

        // Call API to delete extract
        await deleteExtract(extractId);

        // Track items reviewed this session
        setItemsReviewedThisSession((prev) => prev + 1);

        // Remove from dueExtracts state to prevent re-populating on state recalculation
        setDueExtracts((prev) => prev.filter((e) => e.id !== extractId));
        // Record so the queue-list rebuild does not re-insert this extract.
        setRatedExtractIds((prev) => {
          const next = new Set(prev);
          next.add(extractId);
          return next;
        });

        toast.success(
          t("queueScroll.extractDeleted") !== "queueScroll.extractDeleted" ? t("queueScroll.extractDeleted") : "Extract deleted",
          t("queueScroll.extractDeletedDesc") !== "queueScroll.extractDeletedDesc" ? t("queueScroll.extractDeletedDesc") : "This extract has been deleted successfully."
        );
      }

      advanceAfterRemoval(dismissedItemId);
    } catch (error) {
      console.error(`[QueueScroll] Failed to dismiss ${currentItem.type}:`, error);
      toast.error(
        t("queueScroll.dismissFailed"),
        error instanceof Error ? error.message : t("queueScroll.pleaseTryAgain")
      );
    } finally {
      setTimeout(() => {
        setIsRating(false);
      }, 500);
    }
  };

  const handleRssToggleFavorite = useCallback(async (feedId: string, itemId: string) => {
    try {
      await toggleItemFavoriteAuto(feedId, itemId);
    } catch (error) {
      console.warn("Failed to toggle RSS favorite:", error);
    }
    setScrollItems((prev) =>
      prev.map((item) =>
        item.type === "rss" && item.rssFeed?.id === feedId && item.rssItem?.id === itemId
          ? { ...item, rssItem: { ...item.rssItem!, favorite: !item.rssItem?.favorite } }
          : item
      )
    );
  }, []);

  // Touch gesture handlers — TikTok-style vertical paging plus horizontal swipe
  // ratings for RSS items.
  //
  // Vertical: a deliberate upward drag advances to the next item and a downward
  // drag returns to the previous one, but only once the current item's content is
  // already scrolled to its edge — so the user can read through a long EPUB/PDF or
  // article, then one more flick flips to the next item. For EPUB/PDF/audio (which
  // render inside iframes/canvases where event.target traversal can't reach the
  // real scroll element) we trust the scrollPercent reported by the viewer via
  // scrollStateRef instead.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let currentX = 0;
    let currentY = 0;
    let touchStartTarget: EventTarget | null = null;
    let longPressTimeout: ReturnType<typeof setTimeout> | null = null;
    let longPressTriggered = false;
    // Track the last scrollable element we found during the move so the edge
    // check at touchend stays consistent even if target changed mid-gesture.
    let trackedScrollEl: HTMLElement | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      currentX = touchStartX;
      currentY = touchStartY;
      touchStartTime = Date.now();
      touchStartTarget = e.target;
      trackedScrollEl = null;
      longPressTriggered = false;
      if (longPressTimeout) clearTimeout(longPressTimeout);
      if (isMobile && isEligibleOverlayTapTarget(touchStartTarget)) {
        longPressTimeout = setTimeout(() => {
          if (hasActiveTextSelection(window.getSelection())) return;
          longPressTriggered = true;
          setShowControls(true);
          setShowRatingControls(true);
        }, 550);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      currentX = e.touches[0].clientX;
      currentY = e.touches[0].clientY;
      if (!isStationaryTap(
        { x: touchStartX, y: touchStartY },
        { x: currentX, y: currentY },
      ) && longPressTimeout) {
        clearTimeout(longPressTimeout);
        longPressTimeout = null;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (longPressTimeout) {
        clearTimeout(longPressTimeout);
        longPressTimeout = null;
      }
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      const touchEndX = currentX;
      const touchEndY = currentY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const deltaTime = Date.now() - touchStartTime;

      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      // Pixels of movement per ms. A casual flick is ~0.4–1.0 px/ms.
      const velocity = deltaTime > 0 ? Math.sqrt(deltaX * deltaX + deltaY * deltaY) / deltaTime : 0;

      const target = e.target as HTMLElement;
      if (target.closest(".assistant-panel")) return;

      if (isStationaryTap(
        { x: touchStartX, y: touchStartY },
        { x: touchEndX, y: touchEndY },
      )) {
        if (
          isEligibleOverlayTapTarget(touchStartTarget)
          && !hasActiveTextSelection(window.getSelection())
        ) {
          setShowControls((visible) => !visible);
        }
        return;
      }

      // Horizontal swipe → RSS rate/favorite (unchanged behavior).
      if (absDeltaX > absDeltaY) {
        const minSwipeDistance = 50;
        const minVelocity = 0.3;
        if (absDeltaX > minSwipeDistance && velocity > minVelocity) {
          if (currentItem?.type === "rss" && currentItem.rssFeed && currentItem.rssItem) {
            if (deltaX > 0) {
              void handleRating(1);
            } else if (deltaX < 0) {
              void handleRssToggleFavorite(currentItem.rssFeed.id, currentItem.rssItem.id);
            }
          }
        }
        return;
      }

      // --- Vertical: TikTok-style paging ---
      // Require either a firm drag (>= 90px) or a brisk flick (>= 0.45 px/ms).
      // Lowering both thresholds makes the gesture feel responsive on phones.
      const minDragDistance = 90;
      const minFlickVelocity = 0.45;
      if (absDeltaY < minDragDistance && velocity < minFlickVelocity) return;

      // Determine document type so we can pick the right "at edge?" signal.
      let isScrollableDocument = false;
      let isYouTubeItem = false;
      if (currentItem?.type === "document" && currentItem.documentId) {
        const doc = documents.find(d => d.id === currentItem.documentId);
        if (doc) {
          const fileType = doc.fileType || doc.filePath?.split('.').pop()?.toLowerCase();
          isScrollableDocument = fileType === "epub" || fileType === "pdf" || fileType === "audio";
          isYouTubeItem = fileType === "youtube"
            || !!doc.filePath?.includes("youtube.com")
            || !!doc.filePath?.includes("youtu.be");
        }
      }

      // For EPUB/PDF/audio the real scroll element lives in an iframe/canvas, so
      // target-traversal can't see it.
      //  - EPUB: touches are fully isolated inside the epub.js iframe, so this
      //    parent handler never even fires for them. Vertical paging is handled
      //    inside EPUBViewer (turn page → dispatch "incrementum-queue-swipe" past
      //    the last page). Nothing to do here.
      //  - PDF/audio: use the viewer-reported scroll percent (>= 98% bottom,
      //    <= 2% top) since the document's own scroller isn't reachable via
      //    event.target.
      if (isScrollableDocument) {
        const doc = currentItem?.documentId ? documents.find(d => d.id === currentItem.documentId) : undefined;
        const isEpub = (doc?.fileType || doc?.filePath?.split('.').pop()?.toLowerCase()) === "epub";
        // EPUB swipes are handled entirely inside its iframe; ignore them here so
        // we don't double-advance or fight the bridge.
        if (isEpub) return;
        const pct = scrollStateRef.current.scrollPercent ?? 0;
        // Drag up (deltaY < 0) at the bottom → next; drag down at top → previous.
        if (deltaY < 0 && pct >= 98) {
          goToNext();
        } else if (deltaY > 0 && pct <= 2) {
          goToPrevious();
        }
        return;
      }

      // For everything else (RSS, extract, YouTube, flashcard, podcast), find the
      // scrollable element from the DOM and check its edges directly.
      const transcriptScrollElement = target.closest('[data-transcript-scroll="true"]') as HTMLElement | null;
      const extractScrollContainer = target.closest('[data-extract-scroll="true"]') as HTMLElement | null;
      const extractScrollElement = (target.tagName === 'TEXTAREA' && extractScrollContainer)
        ? (target as HTMLElement)
        : extractScrollContainer;
      const scrollableElement = transcriptScrollElement
        || extractScrollElement
        || trackedScrollEl
        || target.closest('[class*="overflow"]') as HTMLElement
        || target.closest('.prose') as HTMLElement
        || document.documentElement;
      trackedScrollEl = scrollableElement;

      let canScrollDown = false;
      let canScrollUp = false;
      if (scrollableElement) {
        canScrollDown = scrollableElement.scrollTop < (scrollableElement.scrollHeight - scrollableElement.clientHeight - 10);
        canScrollUp = scrollableElement.scrollTop > 10;
      }

      // YouTube: only page when the transcript isn't the active scroller (so the
      // video page itself flips), matching the prior wheel behavior.
      if (!(isYouTubeItem && !transcriptScrollElement)) {
        if (deltaY < 0 && canScrollDown) return;
        if (deltaY > 0 && canScrollUp) return;
      }

      if (deltaY < 0) {
        goToNext();
      } else if (deltaY > 0) {
        goToPrevious();
      }
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd);
    const handleTouchCancel = () => {
      if (longPressTimeout) clearTimeout(longPressTimeout);
      longPressTimeout = null;
      longPressTriggered = false;
      touchStartTarget = null;
      trackedScrollEl = null;
    };

    container.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
      if (longPressTimeout) clearTimeout(longPressTimeout);
    };
  }, [currentItem, documents, goToNext, goToPrevious, handleRating, handleRssToggleFavorite, isMobile]);

  const handleCreateRssExtract = useCallback(async () => {
    if (!renderedItem || renderedItem.type !== "rss" || !renderedItem.rssItem) return;

    const selectionText = activeRssSelection.trim();
    if (!selectionText) return;

    const rssItem = renderedItem.rssItem;
    const rssContent = rssItem.content || rssItem.description || "";
    const rssLink = rssItem.link || `rss:${rssItem.id}`;
    const existingDoc = documents.find((doc) => doc.filePath === rssLink);
    let documentId = existingDoc?.id;

    try {
      if (!documentId) {
        const created = await createDocument(
          rssItem.title || renderedItem.documentTitle,
          rssLink,
          "html"
        );
        addDocument(created);
        documentId = created.id;
      }

      if (rssContent && documentId) {
        await updateDocumentContent(documentId, rssContent);
        updateDocument(documentId, {
          content: rssContent,
          title: rssItem.title || renderedItem.documentTitle,
          filePath: rssLink,
          fileType: "html",
        });
      }

      let createdExtract: Extract | null = null;
      if (documentId) {
        createdExtract = await createExtract({ document_id: documentId, content: selectionText });
      }

      const sourceContext = documentId
        ? buildQueueExtractSourceContext({
            documentId,
            title: rssItem.title || renderedItem.documentTitle,
            sourceKind: "article",
          })
        : null;

      toast.success(
        t("queueScroll.extractCreated"),
        t("queueScroll.savedFromRSS"),
        createdExtract && sourceContext
          ? {
              action: {
                label: "View extract",
                onClick: () => openExtractInDocumentTab({
                  documentId,
                  documentTitle: rssItem.title || renderedItem.documentTitle,
                  extract: createdExtract,
                  sourceContext,
                }),
              },
            }
          : undefined
      );
      clearRssTextSelection();
    } catch (error) {
      console.error("Failed to create extract from RSS item:", error);
      toast.error(
        t("queueScroll.failedCreateExtract"),
        error instanceof Error ? error.message : t("queueScroll.anErrorOccurred")
      );
    }
  }, [renderedItem, activeRssSelection, documents, addDocument, updateDocument, toast, buildQueueExtractSourceContext, openExtractInDocumentTab, clearRssTextSelection]);

  // Mobile PWA: Handle extract creation from mobile RSS selection
  const handleMobileRssExtract = useCallback(async () => {
    if (!mobileRssSelection.text) return;

    // Set the RSS selected text and last selection ref
    setRssSelectedText(mobileRssSelection.text);
    lastRssSelectionRef.current = mobileRssSelection.text;

    // Hide the mobile button
    setMobileRssSelection(prev => ({ ...prev, showButton: false }));
    if (mobileRssSelectionTimeoutRef.current) {
      clearTimeout(mobileRssSelectionTimeoutRef.current);
    }

    // Call the regular handler
    await handleCreateRssExtract();
  }, [mobileRssSelection.text, handleCreateRssExtract]);

  // Dictionary Lookup for selected RSS text
  const handleRssDictionaryLookup = useCallback(async () => {
    const word = activeRssSelection.trim().split(/\s+/)[0] || "";
    if (!word) return;
    setIsDictionaryLoading(true);
    try {
      const result = await lookupDictionary(word);
      setDictionaryResult(result);
    } catch (error) {
      toast.error(t("viewer.lookupFailed"), error instanceof Error ? error.message : t("viewer.failedToLookupWord"));
    } finally {
      setIsDictionaryLoading(false);
    }
  }, [activeRssSelection, toast]);

  // Dismiss the floating RSS selection drawer on click away or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't dismiss when interacting with the floating button, dictionary display, dialogs, or context menus
      if (
        target.closest('[data-extract-button="true"]') ||
        target.closest('[role="dialog"]') ||
        target.closest('.context-menu') ||
        target.closest('[data-dictionary-popup="true"]')
      ) {
        return;
      }
      if (activeRssSelection) {
        clearRssTextSelection();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeRssSelection) {
        clearRssTextSelection();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeRssSelection, clearRssTextSelection]);

  const handleExit = () => {
    if (activeTabId) {
      closeTab(activeTabId);
    }
  };

  /**
   * Enter neural review ("Go neural"): build a queue by spreading activation
   * from the current item, then swap the scroll session over to it. The
   * pre-neural session is snapshotted so exit restores it exactly. The priority
   * queue is never mutated — neural mode only reads it.
   */
  const handleGoNeural = useCallback(async () => {
    const seed = neuralSeedFromItem(currentItem);
    if (!seed) return; // RSS/podcast have no element_tree node.
    setIsNeuralLoading(true);
    try {
      // Resolve the user's embedding config so semantic-similarity edges fire
      // when the collection is indexed. A failure here is non-fatal — neural
      // review still works on the tree-topology relationships alone.
      let embeddingConfig: import("../api/rag").EmbeddingConfig | null = null;
      try {
        embeddingConfig = await resolveEmbeddingConfig();
      } catch {
        // No embedding provider configured — semantic neighbors will be a no-op.
      }
      neuralEmbeddingConfigRef.current = embeddingConfig;

      const count = await buildNeuralQueue(seed.kind, seed.refId, embeddingConfig ?? undefined);
      if (count === 0) {
        toast.info(t("neural.reviewMode"), t("queueScroll.noContentToSummarize"));
        return;
      }
      neuralSeedRef.current = seed;
      const entries = await getNeuralQueueResolvedFront(NEURAL_FETCH_BATCH);
      const items = await buildNeuralScrollItems(entries, documentsMap, t("queueScroll.unknownDocument"));
      if (items.length === 0) {
        toast.info(t("neural.reviewMode"), t("queueScroll.noContentToSummarize"));
        return;
      }
      // Snapshot the reading session for a clean exit.
      setPreNeuralScrollItems(scrollItems);
      setPreNeuralIndex(currentIndex);
      setScrollItems(items);
      setCurrentIndex(0);
      setRenderedIndex(0);
      setIsNeuralMode(true);
      // The neural session is not composition-composed; clear the note so the
      // settings panel does not show a stale optimal-session report.
      setCompositionReport(null);
      setNeuralRemaining(await getNeuralQueueRemaining());
      toast.success(t("neural.reviewMode"));
    } catch (error) {
      toast.error(t("queueScroll.ratingFailed"), error instanceof Error ? error.message : t("queueScroll.pleaseTryAgain"));
    } finally {
      setIsNeuralLoading(false);
    }
  }, [currentItem, documentsMap, scrollItems, currentIndex, toast, t]);

  /**
   * Exit neural review: restore the exact reading session (items + position)
   * the user was in before entering neural mode. No backend mutation — the
   * priority queue was never touched (neural mode's contract).
   */
  const handleExitNeural = useCallback(() => {
    if (preNeuralScrollItems !== null) {
      setScrollItems(preNeuralScrollItems);
      setCurrentIndex(preNeuralIndex);
      setRenderedIndex(preNeuralIndex);
    }
    setIsNeuralMode(false);
    setPreNeuralScrollItems(null);
    setPreNeuralIndex(0);
    setNeuralRemaining(null);
    neuralSeedRef.current = null;
    neuralEmbeddingConfigRef.current = null;
  }, [preNeuralScrollItems, preNeuralIndex]);

  // Auto-exit neural review once every queued element has been consumed — the
  // session is complete. Restores the reading session the user came from.
  useEffect(() => {
    if (isNeuralMode && scrollItems.length === 0 && !isNeuralLoading) {
      handleExitNeural();
    }
  }, [isNeuralMode, scrollItems.length, isNeuralLoading, handleExitNeural]);

  if (isLoadingData) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mb-4"></div>
          <div className="text-muted-foreground">{t("common.loading")}</div>
        </div>
      </div>
    );
  }

  if (!currentItem) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4">📚</div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">{t("queueScroll.nothingToRead")}</h2>
          <p className="text-muted-foreground">
            {t("queueScroll.nothingToReadDesc")}
          </p>
          <button
            onClick={handleExit}
            className="mt-6 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            {t("queueScroll.backToQueue")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-background relative"
    >
      {/* Content Viewer - Document, Flashcard, or RSS Article */}
      <div
        className="flex h-full min-h-0 w-full overflow-hidden"
      >
        {!isMobile && isAssistantVisible && renderedItem && renderedItem.type !== "flashcard" && assistantPosition === "left" && (
          <>
            {/* Model Chooser - Above Assistant */}
            <div className="flex-shrink-0 flex flex-col items-center gap-2 p-2 border-r border-border bg-card z-10">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id as any)}
                  className={`p-2 rounded-lg transition-all ${selectedProvider === provider.id
                    ? "bg-muted ring-2 ring-primary"
                    : "hover:bg-muted"
                    }`}
                  title={provider.name}
                >
                  <provider.icon className={`w-5 h-5 ${provider.color}`} />
                </button>
              ))}
            </div>
            <div className="flex-shrink-0 h-full min-h-0 z-10">
              <AssistantPanel
                context={assistantContext}
                className="assistant-panel h-full"
                onInputHoverChange={setAssistantInputActive}
                appendContextMessages={false}
                position={assistantPosition}
                onPositionChange={(newPosition) => {
                  setAssistantPosition(newPosition);
                  localStorage.setItem("assistant-panel-position", newPosition);
                }}
                selectedProvider={selectedProvider}
                onProviderChange={setSelectedProvider}
              />
            </div>
          </>
        )}
        <div
          className={cn(
            "h-full min-h-0 flex-1 min-w-0 overflow-hidden transition-opacity duration-300 relative",
            isTransitioning ? "opacity-0" : "opacity-100"
          )}
        >
          {renderedItem?.type === "document" && scrollViewMode !== "document" ? (
            scrollViewMode === "extracts" ? (
              <QueueExtractsView documentId={renderedItem.documentId!} />
            ) : (
              <LearningCardsList documentId={renderedItem.documentId!} />
            )
          ) : renderedItem?.type === "document" ? (() => {
            const doc = documents.find(d => d.id === renderedItem.documentId);
            return (
              <DocumentViewer
                key={renderedItem.documentId}
                documentId={renderedItem.documentId!}
                embedded={true}
                hideRatingOrbs={true}
                onSelectionChange={setSelection}
                onScrollPositionChange={setScrollState}
                onPdfContextTextChange={setPdfContextText}
                onPdfOcrContextTextChange={setPdfOcrContextText}
                contextPageWindow={2}
                extractPostCreateBehavior="stay-in-reader"
                onExtractCreated={(extract, sourceContext) => {
                  const effectiveContext = sourceContext ?? buildQueueExtractSourceContext({
                    documentId: renderedItem.documentId!,
                    title: renderedItem.documentTitle,
                    sourceKind: doc?.fileType === "html" || doc?.metadata?.source === "browser_extension" ? "article" : "book",
                  });
                  toast.success(t("queueScroll.extractCreated"), t("queueScroll.savedInScrollMode"), {
                    action: {
                      label: "View extract",
                      onClick: () => openExtractInDocumentTab({
                        documentId: renderedItem.documentId!,
                        documentTitle: renderedItem.documentTitle,
                        extract,
                        sourceContext: effectiveContext,
                      }),
                    },
                  });
                }}
                onEnded={() => {
                  if (settings.scrollQueue.autoProceed) {
                    goToNext();
                  }
                }}
                onArchive={() => {
                  goToNext();
                }}
              />
            );
          })() : renderedItem?.type === "flashcard" && renderedItem.learningItem ? (
            <FlashcardScrollItem
              key={renderedItem.learningItem.id}
              learningItem={renderedItem.learningItem}
              onRate={handleRating}
              onRevealChange={handleFlashcardReveal}
              onCreateFlashcard={(excerpt, extractId, documentId) => setFlashcardStudioSeed({
                key: `scroll-${extractId || renderedItem.learningItem!.id}-${Date.now()}`,
                excerpt,
                draftCardType: "qa",
                resetDraftCards: true,
                autoEditDraft: false,
                extractId,
                documentId,
              })}
              onCreateCloze={(text, range) => {
                if (renderedItem.learningItem?.extract_id) {
                  setActiveExtractForCloze({
                    id: renderedItem.learningItem.extract_id,
                    text,
                    extractContent: renderedItem.learningItem.question,
                    range
                  });
                }
              }}
              onCreateQA={() => {
                if (renderedItem.learningItem?.extract_id) {
                  setActiveExtractForQA(renderedItem.learningItem.extract_id);
                }
              }}
            />
          ) : renderedItem?.type === "rss" ? (
            <div key={renderedItem.id} className="h-full w-full overflow-y-auto">
              <div ref={rssContentRef} className="max-w-3xl mx-auto px-8 py-12 reading-surface">
                {/* RSS Article Header */}
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3 reading-meta">
                      <span className="px-2 py-1 bg-orange-500/10 text-orange-500 rounded-md text-xs font-medium">
                        {t("queueScroll.rss")}
                      </span>
                      <span>{renderedItem.rssFeed?.title}</span>
                    </div>
                    <h1 className="text-3xl font-bold text-foreground mb-3 reading-title flex items-center gap-2">
                      {renderedItem.rssItem?.title}
                      <RelevanceIndicator score={renderedItem.relevanceScore} className="mt-1.5" />
                    </h1>
                    <div className="flex items-center flex-wrap gap-4 text-sm text-muted-foreground reading-meta">
                      {renderedItem.rssItem?.pubDate && (
                        <span>{new Date(renderedItem.rssItem.pubDate).toLocaleDateString()}</span>
                      )}
                      {renderedItem.rssItem?.author && <span>• {renderedItem.rssItem.author}</span>}
                      <a
                        href={renderedItem.rssItem?.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-foreground transition-colors mobile-density-tap"
                      >
                        <ArrowSquareOut className="w-3 h-3" />
                        {t("queueScroll.openOriginal")}
                      </a>
                      {renderedItem.rssItem?.thumbnail && (
                        <button
                          onClick={() => setIsImageExpanded(!isImageExpanded)}
                          className="flex items-center gap-1 px-2 py-1 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/40 rounded-lg text-xs transition-colors mobile-density-tap"
                        >
                          {isImageExpanded ? <EyeSlash className="w-3.5 h-3.5 mr-0.5" /> : <Eye className="w-3.5 h-3.5 mr-0.5" />}
                          {isImageExpanded ? "Hide cover image" : "Show cover image"}
                        </button>
                      )}
                      <button
                        onClick={() => setShowFullContent(!showFullContent)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-all duration-300 font-bold shadow-md cursor-pointer mobile-density-tap",
                          showFullContent
                            ? "bg-blue-600 border-blue-500 text-white shadow-blue-500/20 hover:bg-blue-700"
                            : "bg-blue-500/10 border-blue-500/40 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-400"
                        )}
                        title={showFullContent ? "Show RSS Content" : "View Full Content"}
                      >
                        <TextT className="w-3.5 h-3.5 mr-0.5" />
                        {showFullContent ? "Show RSS Content" : "View Full Content"}
                      </button>
                    </div>
                  </div>

                  {!isImageExpanded && renderedItem.rssItem?.thumbnail && (
                    <div
                      onClick={() => setIsImageExpanded(true)}
                      className="w-20 h-20 md:w-28 md:h-28 rounded-xl overflow-hidden border border-border/60 bg-muted/30 flex-shrink-0 cursor-pointer hover:scale-105 active:scale-95 transition-all duration-300 shadow-sm"
                      title="Click to expand cover image"
                    >
                      <img
                        src={renderedItem.rssItem.thumbnail}
                        alt="Cover thumbnail"
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                </div>

                {isImageExpanded && renderedItem.rssItem?.thumbnail && (
                  <div className="mb-8 overflow-hidden rounded-2xl border border-border/60 bg-muted/30 relative group">
                    <img
                      src={renderedItem.rssItem.thumbnail}
                      alt=""
                      className="h-auto max-h-[32rem] w-full object-cover"
                      loading="lazy"
                    />
                    <button
                      onClick={() => setIsImageExpanded(false)}
                      className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                      title="Collapse image"
                    >
                      <EyeSlash className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* RSS Article Content */}
                {showFullContent && loadingFullContent.has(renderedItem.rssItem.id) ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-4">
                    <CircleNotch className="w-8 h-8 animate-spin text-blue-500" />
                    <p className="text-sm text-muted-foreground animate-pulse">Fetching full article content...</p>
                  </div>
                ) : showFullContent && fullContentErrors.has(renderedItem.rssItem.id) ? (
                  <div className="flex flex-col items-center justify-center py-16 space-y-4 px-6 text-center">
                    <WarningCircle className="w-10 h-10 text-red-500 animate-bounce" />
                    <div>
                      <p className="text-sm font-semibold text-foreground mb-1">
                        Failed to load full content
                      </p>
                      <p className="text-xs text-muted-foreground max-w-md">{fullContentErrors.get(renderedItem.rssItem.id)}</p>
                    </div>
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => {
                          const itemId = renderedItem.rssItem!.id;
                          setFullContentErrors((prev) => {
                            const next = new Map(prev);
                            next.delete(itemId);
                            return next;
                          });
                          setFullContentMap((prev) => {
                            const next = new Map(prev);
                            next.delete(itemId);
                            return next;
                          });
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-xs font-semibold shadow-md shadow-blue-500/10"
                      >
                        <ArrowsClockwise className="w-3.5 h-3.5" />
                        Retry
                      </button>
                      <button
                        onClick={() => {
                          if (renderedItem.rssItem?.link) {
                            window.open(renderedItem.rssItem.link, "_blank", "noopener,noreferrer");
                          }
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded-lg transition-colors text-xs font-semibold"
                      >
                        <ArrowSquareOut className="w-3.5 h-3.5" />
                        Open Original
                      </button>
                    </div>
                  </div>
                ) : (renderedItem.rssItem?.content || renderedItem.rssItem?.description || (showFullContent && fullContentMap.get(renderedItem.rssItem.id))) ? (
                  <div
                    className="prose prose-lg max-w-none text-foreground reading-prose"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        showFullContent
                          ? cleanArticleHtml(fullContentMap.get(renderedItem.rssItem.id) || renderedItem.rssItem.fullContent || "")
                          : (renderedItem.rssItem.content || renderedItem.rssItem.description || "")
                      )
                    }}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>{t("queueScroll.noArticleContent")}</p>
                    <a
                      href={renderedItem.rssItem?.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-4 text-primary hover:underline"
                    >
                      <ArrowSquareOut className="w-4 h-4" />
                      {t("queueScroll.readOnOriginalSite")}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : renderedItem?.type === "podcast" && renderedItem.podcastEpisode ? (
            <AudiobookViewer
              key={renderedItem.podcastEpisode.id}
              document={{
                // Prefer the real Document.id (resolved via importPodcastEpisodeAsDocument)
                // so extracts taken from the transcript persist to a genuine document row.
                id: podcastDocIds[renderedItem.podcastEpisode.id] || renderedItem.podcastEpisode.id,
                title: renderedItem.podcastEpisode.title,
                filePath: "",
                fileType: "audio",
                coverImageUrl: renderedItem.podcastEpisode.imageUrl || undefined,
                content: "",
                metadata: {},
                createdAt: renderedItem.podcastEpisode.publishedDate
                  ? new Date(renderedItem.podcastEpisode.publishedDate).toISOString()
                  : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              } as any}
              remoteAudioUrl={renderedItem.podcastEpisode.audioUrl}
              episodeId={renderedItem.podcastEpisode.id}
              episodeTitle={renderedItem.podcastEpisode.title}
              onEpisodeEnded={() => {
                // Mark as played and remove from queue
                if (renderedItem.podcastEpisode) {
                  void markEpisodePlayed(renderedItem.podcastEpisode.id, true);
                }
                setItemsReviewedThisSession(prev => prev + 1);
                advanceAfterRemoval(renderedItem.id);
              }}
              onBack={handleExit}
              hideTitleHeader={true}
            />
          ) : renderedItem?.type === "extract" && renderedItem.extract ? (
            <ExtractScrollItem
              key={renderedItem.extract.id}
              extract={renderedItem.extract}
              documentTitle={renderedItem.documentTitle}
              onRate={handleRating}
              onCreateCloze={(text, range) => setActiveExtractForCloze({ id: renderedItem.extract!.id, text, extractContent: renderedItem.extract!.content, range })}
              onCreateQA={() => setActiveExtractForQA(renderedItem.extract!.id)}
              onCreateFlashcard={(_selectedText) => setFlashcardStudioSeed({
                key: `scroll-${renderedItem.extract!.id}-${Date.now()}`,
                excerpt: renderedItem.extract!.content,
                draftCardType: "qa",
                resetDraftCards: true,
                autoEditDraft: false,
                extractId: renderedItem.extract!.id,
              })}
              onUpdate={(updates) => handleExtractUpdate(renderedItem.extract!.id, updates)}
            />
          ) : (
            // Fallback for no item
            <div className="h-full flex items-center justify-center">
              <div className="text-muted-foreground">{t("common.loading")}</div>
            </div>
          )}

          {renderedItem?.type === "rss" && (
            <ReaderTTSControls
              text={stripHtmlToText(
                showFullContent
                  ? (fullContentMap.get(renderedItem.rssItem?.id || "") || renderedItem.rssItem?.fullContent || renderedItem.rssItem?.content || renderedItem.rssItem?.description || "")
                  : (renderedItem.rssItem?.content || renderedItem.rssItem?.description || "")
              )}
              className={cn(
                "absolute z-40 bottom-3 left-3 right-3",
                !isMobile && "left-1/2 right-auto -translate-x-1/2"
              )}
            />
          )}
        </div>
        {!isMobile && isAssistantVisible && renderedItem && renderedItem.type !== "flashcard" && assistantPosition === "right" && (
          <>
            <div className="flex-shrink-0 h-full min-h-0 z-10">
              <AssistantPanel
                context={assistantContext}
                className="assistant-panel h-full"
                onInputHoverChange={setAssistantInputActive}
                appendContextMessages={false}
                position={assistantPosition}
                onPositionChange={(newPosition) => {
                  setAssistantPosition(newPosition);
                  localStorage.setItem("assistant-panel-position", newPosition);
                }}
                selectedProvider={selectedProvider}
                onProviderChange={setSelectedProvider}
              />
            </div>
            {/* Model Chooser - Above Assistant */}
            <div className="flex-shrink-0 flex flex-col items-center gap-2 p-2 border-l border-border bg-card z-10">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id as any)}
                  className={`p-2 rounded-lg transition-all ${selectedProvider === provider.id
                    ? "bg-muted ring-2 ring-primary"
                    : "hover:bg-muted"
                    }`}
                  title={provider.name}
                >
                  <provider.icon className={`w-5 h-5 ${provider.color}`} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Popups */}
      {activeExtractForCloze && (
        <ClozeCreatorPopup
          extractId={activeExtractForCloze.id}
          selectedText={activeExtractForCloze.text}
          extractContent={activeExtractForCloze.extractContent}
          selectionRange={activeExtractForCloze.range}
          onCreated={(item) => {
            setActiveExtractForCloze(null);
            setDueFlashcards(prev => [item, ...prev]);
          }}
          onCancel={() => setActiveExtractForCloze(null)}
        />
      )}

      {activeExtractForQA && (
        <QACreatorPopup
          extractId={activeExtractForQA}
          onCreated={(item) => {
            setActiveExtractForQA(null);
            setDueFlashcards(prev => [item, ...prev]);
          }}
          onCancel={() => setActiveExtractForQA(null)}
        />
      )}

      {/* Create Extract Dialog for document items in scroll mode */}
      {renderedItem?.type === "document" && renderedItem.documentId && (
        <CreateExtractDialog
          documentId={renderedItem.documentId}
          isOpen={isExtractDialogOpen}
          onClose={() => setIsExtractDialogOpen(false)}
          onCreate={(extract) => {
            setIsExtractDialogOpen(false);
            const sourceContext = buildQueueExtractSourceContext({
              documentId: renderedItem.documentId!,
              title: renderedItem.documentTitle,
              sourceKind: "book",
            });
            toast.success(t("queueScroll.extractCreated"), t("queueScroll.savedInScrollMode"), {
              action: {
                label: "View extract",
                onClick: () => openExtractInDocumentTab({
                  documentId: renderedItem.documentId!,
                  documentTitle: renderedItem.documentTitle,
                  extract,
                  sourceContext,
                }),
              },
            });
          }}
        />
      )}

      {/* Flashcard Studio Modal from right-click context menu */}
      <FlashcardStudioModal
        isOpen={!!flashcardStudioSeed}
        onClose={() => setFlashcardStudioSeed(null)}
        seed={flashcardStudioSeed}
      />

      {/* AI Summary panel for the current document / RSS item (Optimal Queue). */}
      {renderedItem && (renderedItem.type === "document" || renderedItem.type === "rss") && (
        <ModernSummaryPanel
          isOpen={showSummary}
          content={summaryText}
          mode={modernSummaryMode}
          length={modernSummaryLength}
          focus={modernSummaryFocus}
          position={assistantPosition}
          width={summaryPanelWidth}
          isLoading={isSummarizing}
          loadingProgress={loadingProgress}
          loadingStage={SUMMARY_LOADING_STAGES[loadingStage].label}
          onClose={closeSummary}
          onModeChange={(mode) => {
            setModernSummaryMode(mode);
            localStorage.setItem("queue-summary-display-mode", mode);
          }}
          onLengthChange={(length) => {
            setModernSummaryLength(length);
            localStorage.setItem("queue-summary-length", length);
            if (summaryText && !isSummarizing) {
              void handleSummarize({ length, focus: modernSummaryFocus });
            }
          }}
          onFocusChange={(focus) => {
            setModernSummaryFocus(focus);
            localStorage.setItem("queue-summary-focus", focus);
            if (summaryText && !isSummarizing) {
              void handleSummarize({ length: modernSummaryLength, focus });
            }
          }}
          onPositionToggle={() => {
            const newPosition = assistantPosition === "left" ? "right" : "left";
            setAssistantPosition(newPosition);
            localStorage.setItem("assistant-panel-position", newPosition);
          }}
          onWidthChange={(width) => {
            setSummaryPanelWidth(width);
            localStorage.setItem("queue-summary-width", String(width));
          }}
          onRegenerate={() => { void handleSummarize(); }}
        />
      )}

      {/* Premium Floating Selection Drawer for RSS Items */}
      {renderedItem?.type === "rss" && activeRssSelection && (
        <div
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-[70] pointer-events-auto animate-in slide-in-from-bottom-4 duration-200"
          data-extract-button="true"
        >
          <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-background/92 p-2 shadow-2xl backdrop-blur-md">
            <button
              onClick={handleCreateRssExtract}
              className="group flex items-center gap-3 rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-lg ring-1 ring-primary/20 transition-all min-h-[52px] text-sm font-semibold hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:translate-y-0"
              title={t("viewer.createExtractFromSelection")}
              aria-label={`Create extract from selected text (${activeRssSelection.length} characters)`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-foreground/14 transition-colors group-hover:bg-primary-foreground/20">
                <Lightbulb className="w-5 h-5" aria-hidden="true" />
              </span>
              <span className="flex flex-col items-start leading-tight">
                <span>{t("viewer.createExtract")}</span>
                <span className="text-[11px] font-medium text-primary-foreground/80">
                  {t("extracts.selectedText")}
                </span>
              </span>
              <span className="rounded-full bg-primary-foreground/14 px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                {activeRssSelection.length}
              </span>
            </button>
            <button
              onClick={handleRssDictionaryLookup}
              disabled={isDictionaryLoading}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-foreground shadow-sm transition-colors min-h-[52px] hover:bg-muted disabled:opacity-60"
              title={t("viewer.lookupDictionaryThesaurus")}
            >
              <Translate className="w-4 h-4" />
              <span className="text-xs">{isDictionaryLoading ? t("viewer.lookingUp") : t("viewer.lookup")}</span>
            </button>
          </div>
        </div>
      )}

      {/* Dictionary result popup for RSS items */}
      {renderedItem?.type === "rss" && dictionaryResult && (
        <div 
          className="fixed bottom-[7.5rem] md:bottom-24 right-4 md:right-6 z-[72] w-[min(420px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 shadow-2xl"
          data-dictionary-popup="true"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{dictionaryResult.word}</p>
              {dictionaryResult.definitions[0] && (
                <p className="mt-1 text-xs text-muted-foreground">{dictionaryResult.definitions[0]}</p>
              )}
              {dictionaryResult.synonyms.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("viewer.synonyms", { synonyms: dictionaryResult.synonyms.slice(0, 5).join(", ") })}
                </p>
              )}
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setDictionaryResult(null)}
            >
              {t("viewer.close")}
            </button>
          </div>
        </div>
      )}

      {/* Mobile PWA: Lightbulb button for RSS text selection */}
      {isMobile && renderedItem?.type === "rss" && mobileRssSelection.showButton && (
        <div
          className="fixed z-[80] pointer-events-auto animate-in fade-in zoom-in-95 duration-200"
          style={{
            left: `${mobileRssSelection.position.x}px`,
            top: `${Math.max(60, mobileRssSelection.position.y)}px`,
            transform: "translateX(-50%)",
          }}
          data-extract-button="true"
        >
          <button
            onClick={handleMobileRssExtract}
            className="flex items-center justify-center w-12 h-12 bg-primary text-primary-foreground rounded-full shadow-xl hover:opacity-90 hover:scale-110 active:scale-95 transition-all"
            title={t("queueScroll.createExtractFromSelection")}
            aria-label={`Create extract from selected text (${mobileRssSelection.text.length} characters)`}
          >
            <Lightbulb className="w-6 h-6" aria-hidden="true" />
          </button>
          {/* Small arrow pointing down to the selection */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-primary" />
        </div>
      )}

      {/* Scroll Queue Settings Panel */}
      <ScrollQueueSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        composition={settings.scrollQueue.composition}
        autoProceed={settings.scrollQueue.autoProceed}
        ratingOrbsPosition={settings.scrollQueue.ratingOrbsPosition}
        onUpdateSetting={(key, value) => updateSettingsCategory('scrollQueue', { [key]: value })}
        onUpdateComposition={(composition) => updateSettingsCategory('scrollQueue', { composition })}
        compositionReport={compositionReport}
      />

      {/* Overlay Controls */}
      <ScrollOverlayControls
        showControls={showControls}
        showRatingControls={!isMobile || showRatingControls}
        isMobile={isMobile}
        ratingOrbsPosition={settings.scrollQueue.ratingOrbsPosition}
        onUpdateRatingOrbsPosition={(pos) => updateSettingsCategory('scrollQueue', { ratingOrbsPosition: pos })}
        isEpub={(() => {
          if (currentItem?.type !== "document") return false;
          const doc = documents.find(d => d.id === currentItem.documentId);
          const fileType = (doc?.fileType || doc?.filePath?.split('.').pop())?.toLowerCase();
          return fileType === "epub";
        })()}
        currentIndex={currentIndex}
        totalItems={scrollItems.length}
        sessionOffset={itemsReviewedThisSession}
        itemType={currentItem?.type ?? "document"}
        itemTitle={currentItem?.documentTitle ?? ""}
        itemDocumentId={currentItem?.documentId}
        isNewDocument={isNewDocument}
        isRating={isRating}
        scrollViewMode={scrollViewMode}
        helpText={currentItem?.type === "document" ? (() => {
          const doc = documents.find(d => d.id === currentItem?.documentId);
          const fileType = doc?.fileType || doc?.filePath?.split('.').pop()?.toLowerCase();
          return fileType === "epub" || fileType === "pdf" || fileType === "audio"
            ? t("queueScroll.helpTextDocFile")
            : t("queueScroll.helpTextDocScroll");
        })() : currentItem?.type === "podcast" ? t("queueScroll.helpTextDocFile") : currentItem ? t("queueScroll.helpTextNonDoc") : undefined}
        onExit={handleExit}
        onShowSettings={() => setShowSettings(true)}
        onShowRssSettings={() => setShowRssSettings(true)}
        onSetScrollViewMode={setScrollViewMode}
        onOpenExtractDialog={() => setIsExtractDialogOpen(true)}
        onOpenEpubToc={() => window.dispatchEvent(new CustomEvent("incrementum-epub-open-toc"))}
        onOpenEpubSettings={() => window.dispatchEvent(new CustomEvent("incrementum-epub-open-settings"))}
        onEpubPreviousPage={() => window.dispatchEvent(new CustomEvent("incrementum-epub-previous-page"))}
        onEpubNextPage={() => window.dispatchEvent(new CustomEvent("incrementum-epub-next-page"))}
        onRate={handleRating}
        onDismiss={handleDismiss}
        prioritySlider={currentPrioritySlider}
        onPriorityChange={currentPrioritySlider !== undefined ? handlePriorityChange : undefined}
        onGoToNext={goToNext}
        onGoToPrevious={goToPrevious}
        isAssistantVisible={isAssistantVisible}
        onToggleAssistant={toggleAssistantVisibility}
        isSummaryActive={showSummary}
        onToggleSummary={() => {
          if (showSummary) {
            closeSummary();
          } else {
            void handleSummarize();
          }
        }}
        isNeuralMode={isNeuralMode}
        neuralRemaining={neuralRemaining}
        isNeuralLoading={isNeuralLoading}
        canGoNeural={!!currentItem && (currentItem.type === "document" || currentItem.type === "flashcard" || currentItem.type === "extract")}
        onGoNeural={handleGoNeural}
        onExitNeural={handleExitNeural}
        detailsButton={detailsTarget ? (
          <ItemDetailsPopover
            target={detailsTarget}
            onDismissStateChange={(dismissed) => {
              if (!dismissed) return;
              if (
                detailsTarget.type === "document" &&
                currentItem?.type === "document" &&
                currentItem.documentId === detailsTarget.id
              ) {
                advanceAfterRemoval(currentItem.id);
              }
              void loadQueue();
            }}
            onPostpone={detailsQueueItem ? handleDetailsPostpone : undefined}
            onDelete={handleDetailsDelete}
            onNavigateToTaggedItem={handleNavigateToTaggedItem}
            renderTrigger={({ onClick, isOpen }) => (
              <button
                onClick={onClick}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm transition-colors hover:bg-black/60",
                  isOpen && "bg-black/60"
                )}
                title={t("queueScroll.itemDetails")}
              >
                <Info className="w-4 h-4" />
                {t("queueScroll.details")}
              </button>
            )}
          />
        ) : undefined}
        labels={{
          exit: t("queueScroll.exitScrollMode"),
          settings: t("common.settings"),
          rss: t("queueScroll.rss"),
          viewDocument: t("viewer.viewDocument"),
          viewExtracts: t("viewer.viewExtracts"),
          viewLearningCards: t("viewer.viewLearningCards"),
          createExtract: t("viewer.createExtract"),
          again: t("queueScroll.again"),
          againTitle: t("queueScroll.againTitle"),
          hard: t("queueScroll.hard"),
          hardTitle: t("queueScroll.hardTitle"),
          good: t("queueScroll.good"),
          goodTitle: t("queueScroll.goodTitle"),
          easy: t("queueScroll.easy"),
          easyTitle: t("queueScroll.easyTitle"),
          dismissLabel: t("queueScroll.dismissLabel"),
          dismissTitle: t("queueScroll.dismissTitle"),
          markAsRead: t("queueScroll.markAsRead"),
          markAsReadGood: t("queueScroll.markAsReadGood"),
          previousDocument: t("queueScroll.previousDocument"),
          nextDocument: t("queueScroll.nextDocument"),
          docShort: t("queueScroll.docShort"),
          cardShort: t("queueScroll.cardShort"),
          rssShort: t("queueScroll.rssShort"),
          extractShort: t("queueScroll.extractShort"),
          showAssistant: t("queueScroll.showAssistant"),
          hideAssistant: t("queueScroll.hideAssistant"),
          summarize: t("queueScroll.summarize"),
          closeSummary: t("queueScroll.closeSummary"),
          priority: t("priority.readingPriority"),
          priorityLowest: t("priority.lowest"),
          priorityLow: t("priority.low"),
          priorityNormal: t("priority.normal"),
          priorityHigh: t("priority.high"),
          priorityHighest: t("priority.highest"),
          priorityFineTune: t("priority.fineTune"),
          prioritySaving: t("priority.saving"),
          prioritySaveFailed: t("common.error"),
          goNeural: t("neural.goNeural"),
          goNeuralTooltip: t("neural.goNeuralTooltip"),
          exitNeural: t("neural.exitNeural"),
          reviewMode: t("neural.reviewMode"),
          refilled: t("neural.refilled"),
        }}
      />

      {/* RSS Queue Settings Modal */}
      <RSSQueueSettingsModal
        isOpen={showRssSettings}
        onClose={() => setShowRssSettings(false)}
      />
    </div>
  );
}
