import { executeCommand } from "../../commandPalette/executeCommand";
import { useSavedQueueStore } from "../../stores/savedQueueStore";
import { usePaletteSelectionStore, getPaletteSelection } from "../../commandPalette/selectionTranslation";
import { useState, useCallback, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { GlobalSearch, SearchResult, SearchQuery, SearchResultType } from "./GlobalSearch";
import { useDocumentStore } from "../../stores/documentStore";
import { useTabsStore, type TabsState } from "../../stores/tabsStore";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import { useUIStore } from "../../stores/uiStore";
import { useExtractStore } from "../../stores/extractStore";
import { calculateRelevanceScore, extractSearchTerms, fuzzyMatch, highlightSearchTerms } from "./SearchUtils";
import { getDocuments as fetchDocuments } from "../../api/documents";
import { isTauri } from "../../lib/tauri";
import { classifyPaletteInput } from "../../features/help/helpIntent";
import { defaultHelpRetrieval } from "../../features/help/helpRetrieval";
import { dispatchRegisteredHelpAction } from "../../features/help/registeredHelpActions";
import type { HelpAppContext } from "../../features/help/helpTypes";

const HelpDocViewer = lazy(() =>
  import("../../features/help/HelpDocViewer").then((m) => ({ default: m.HelpDocViewer }))
);
const AskPlethoraModal = lazy(() =>
  import("../../features/help/AskPlethoraModal").then((m) => ({ default: m.AskPlethoraModal }))
);

import { urlDetectorUtils } from "../../hooks/useURLDetector";
import { useI18n } from "../../lib/i18n";
import type { Document, Extract } from "../../types/document";
import type { StudyDeck } from "../../types/study-decks";
import { fetchYouTubeTranscript } from "../../api/youtube";
import { getTranscript, type TranscriptSegment as WhisperTranscriptSegment } from "../../api/transcription";
import { useTheme } from "../../contexts/ThemeContext";
import { findMatchingSections } from "./sectionRegistry";
import type { ExactSearchHitLocation, SearchHit } from "../../types/searchHit";
import { registerCommandPaletteOpenEvents } from "../../utils/commandPaletteEvents";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import { getSubscribedFeedsAuto, type FeedItem } from "../../api/rss";
import { useRssStudyStore } from "../../stores/rssStudyStore";
import { getSubscribedPodcasts, getPodcastEpisodes, getPodcastTranscript } from "../../api/podcast";
import {
  actionMatchesQuery,
  getActionsForView,
  type ActionContext,
  type ContextualViewType,
  type ViewAction,
  type ViewActionId,
} from "../../commandPalette/contextualActions";
import { dispatchPaletteAction, getLiveContext } from "../../commandPalette/paletteActionEvents";
import { buildCommandCatalogue, navigateTo } from "../../commandPalette/catalogue";
import { filterResultsByScope } from "../../commandPalette/facets";
import {
  buildResumeItem,
  deriveExpandedExamples,
  deriveResumeTopic,
  deriveSuggestions,
  isEligibleDocument,
  selectRecentCandidate,
  selectResumeCandidate,
  type PaletteDocumentLike,
} from "../../commandPalette/homeModel";
import { getRecentOpens } from "../../commandPalette/recentOpens";
import type {
  PaletteActionInvocation,
  PaletteContextualAction,
  PaletteDueState,
  PaletteHomeModel,
  PaletteRecentItem,
  PaletteResumeItem,
  PaletteResumeState,
} from "../../commandPalette/types";
import { usePaletteNoteDraftStore, type PaletteNoteDraft } from "../../commandPalette/noteDraft";
import { savePaletteNote } from "../../commandPalette/noteSaver";
import { useLibraryAskHandoffStore } from "../../commandPalette/libraryAskHandoff";
import type { PaletteHubController } from "./GlobalSearch";
import { useCollectionStore } from "../../stores/collectionStore";
import { useStartupStore } from "../../stores/startupStore";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import { getDueItems as fetchDueItems } from "../../api/review";
import { filterByDecks } from "../../utils/studyDecks";
import { getAllLearningItems, type LearningItem } from "../../api/learning-items";
import { getExtracts } from "../../api/extracts";
import {
  createDocument,
  deleteDocument,
  getDocument,
  updateDocumentContent,
} from "../../api/documents";
import { useToast } from "../common/Toast";
import { useReviewStore } from "../../stores/reviewStore";
import type { StartupProgressItem } from "../../types/startup";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "will",
  "with",
  "you",
  "your",
]);

const SHORT_MEANINGFUL_TERMS = new Set(["ai", "ml", "ui", "ux", "vr", "ar", "3d"]);

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

const isMeaningfulTerm = (term: string): boolean => {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return false;

  if (normalized.includes(" ")) {
    const parts = normalized.split(/\s+/).filter(Boolean);
    return parts.some((part) => !STOPWORDS.has(part));
  }

  if (STOPWORDS.has(normalized)) return false;
  if (/^\d+$/.test(normalized)) return normalized.length >= 2;
  if (normalized.length >= 3) return true;

  return SHORT_MEANINGFUL_TERMS.has(normalized);
};

const buildTranscriptText = (segments: Array<{ text: string }>): string =>
  segments
    .map((segment) => segment.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

type SearchableTranscriptSegment = {
  id: string;
  startSeconds: number;
  text: string;
};

const normalizeAudioTranscriptSegments = (segments: unknown[]): SearchableTranscriptSegment[] =>
  segments
    .map((segment, index) => {
      const value = segment as {
        id?: string | number;
        text?: string;
        startTime?: number;
        start_ms?: number;
      };
      const text = typeof value.text === "string" ? value.text.trim() : "";
      const startSeconds =
        typeof value.startTime === "number"
          ? value.startTime
          : typeof value.start_ms === "number"
            ? value.start_ms / 1000
            : 0;

      if (!text || !Number.isFinite(startSeconds)) return null;

      return {
        id: value.id != null ? String(value.id) : `seg-${index}`,
        startSeconds: Math.max(0, startSeconds),
        text,
      };
    })
    .filter((segment): segment is SearchableTranscriptSegment => segment != null);

const readStoredAudioTranscript = (documentId: string): SearchableTranscriptSegment[] => {
  try {
    const data = window.localStorage.getItem(`audiobook-${documentId}`);
    if (!data) return [];
    const parsed = JSON.parse(data) as { transcript?: { segments?: unknown[] } };
    const segments = parsed.transcript?.segments;
    return Array.isArray(segments) ? normalizeAudioTranscriptSegments(segments) : [];
  } catch {
    return [];
  }
};

const readWhisperTranscript = async (documentId: string): Promise<SearchableTranscriptSegment[]> => {
  try {
    const response = await getTranscript(documentId, "default");
    const segments: WhisperTranscriptSegment[] = response?.segments ?? [];
    return normalizeAudioTranscriptSegments(segments);
  } catch (error) {
    console.warn("[CommandCenter] Failed to load audio transcript", documentId, error);
    return [];
  }
};

// Stable selectors defined outside component to avoid infinite re-renders
const selectAddTab = (state: TabsState) => state.addTab;
const selectActiveDeckIds = (state: { activeDeckIds: string[] }) => state.activeDeckIds;
const selectCommandPaletteOpen = (state: { commandPaletteOpen: boolean }) => state.commandPaletteOpen;
const selectSetCommandPaletteOpen = (state: { setCommandPaletteOpen: (open: boolean) => void }) => state.setCommandPaletteOpen;
const selectDocuments = (state: { documents: Document[] }) => state.documents;
const selectDocumentsLoading = (state: { isLoading: boolean }) => state.isLoading;
const selectDocumentsLoaded = (state: { hasCompletedFirstLoad: boolean }) =>
  state.hasCompletedFirstLoad;
const selectLoadDocuments = (state: { loadDocuments: () => Promise<void> }) => state.loadDocuments;
const selectDecks = (state: { decks: StudyDeck[] }) => state.decks;
const selectExtracts = (state: { extracts: Extract[] }) => state.extracts;
const selectExtractsLoading = (state: { isLoading: boolean }) => state.isLoading;
const selectLoadExtracts = (state: { loadExtracts: (documentId?: string) => Promise<void> }) =>
  state.loadExtracts;
const selectAddDocument = (state: { addDocument: (doc: Document) => void }) => state.addDocument;
const selectUpdateDocument = (
  state: { updateDocument: (id: string, updates: Partial<Document>) => void }
) => state.updateDocument;
const selectActiveCollectionId = (state: { activeCollectionId: string }) =>
  state.activeCollectionId;
const selectContinueReading = (
  state: { snapshot: { continueReading: StartupProgressItem[] } | null }
) => state.snapshot?.continueReading ?? null;

/* ------------------------------------------------------------------------- */
/* Hub controller helpers (revamp-command-palette)                            */
/* ------------------------------------------------------------------------- */

/**
 * Active view resolution shared by the hub home model and `handleSearch`.
 * Uses the navigation pane's active tab (the palette's established rule), so
 * the home's "Actions in this view" and typed results cannot disagree.
 */
function resolveActivePaletteView(documents: Document[]): {
  view: ContextualViewType | null;
  context: ActionContext;
  documentTitle: string | null;
} {
  const state = useTabsStore.getState();
  const paneIds = state.getTabPaneIds();
  if (paneIds.length === 0) return { view: null, context: {}, documentTitle: null };
  const pane = state.findPaneById(state.navigationPaneId ?? paneIds[0]);
  if (!pane || pane.type !== "tabs" || !pane.activeTabId) {
    return { view: null, context: {}, documentTitle: null };
  }
  const activeTab = state.tabs.find((t) => t.id === pane.activeTabId) ?? null;

  const view: ContextualViewType | null =
    activeTab?.type === "document-viewer" || activeTab?.type === "audiobook-epub-sync"
      ? "document-viewer"
      : activeTab?.type === "rss"
        ? "rss"
        : activeTab?.type === "podcast"
          ? "podcast"
          : activeTab?.type === "audiobook"
            ? "audiobook"
            : null;

  const documentTitle =
    activeTab?.type === "document-viewer" && activeTab.data?.documentId
      ? documents.find((d) => d.id === activeTab.data!.documentId)?.title ?? null
      : null;

  const context: ActionContext = (() => {
    if (view === "document-viewer" && activeTab?.data?.documentId) {
      const doc = documents.find((d) => d.id === activeTab.data!.documentId);
      const ft = (doc?.fileType || "").toLowerCase();
      const viewerKind =
        ft === "pdf"
          ? "pdf"
          : ft === "epub"
            ? "epub"
            : ft === "markdown"
              ? "markdown"
              : ft === "html"
                ? "html"
                : ft === "youtube"
                  ? "youtube"
                  : ft === "audio"
                    ? "audio"
                    : "other";
      return { viewerKind, vimAvailable: true, hasSelection: Boolean(getPaletteSelection()) };
    }
    // For RSS/Podcast, target-item-dependent actions are shown by default;
    // the listener hides them at runtime if there is no current item.
    return { hasTargetItem: true };
  })();

  return { view, context, documentTitle };
}

/** Pure descriptors for the home's "Actions in this view" section. */
function resolveContextualActionDescriptors(
  view: ContextualViewType | null,
  context: ActionContext
): PaletteContextualAction[] {
  if (!view) return [];
  return getActionsForView(view, { ...context, ...getLiveContext(view) }).map((action) => ({
    view: action.view,
    actionId: action.id,
    title: action.title,
    subtitle: action.subtitle,
    shortcutHint: action.shortcutHint,
  }));
}

/** The document open in the navigation pane's reader, when one is active. */
function getActiveReaderDocumentId(): string | null {
  const workspace = useTabsStore.getState().getWorkspaceTabs();
  const viewers = workspace.filter(
    (entry) => entry.tab.type === "document-viewer" && entry.tab.data?.documentId
  );
  if (viewers.length === 0) return null;
  const active = viewers.find((entry) => entry.isActive) ?? viewers[0];
  return (active.tab.data?.documentId as string | undefined) ?? null;
}

/** Structural adapter into the pure home-model selectors. */
function toPaletteDocumentLike(doc: Document): PaletteDocumentLike {
  return {
    id: doc.id,
    title: doc.title,
    fileType: doc.fileType,
    collectionId: doc.collectionId ?? null,
    isArchived: doc.isArchived,
    isDismissed: doc.isDismissed,
    progressPercent: doc.progressPercent ?? null,
    dateModified: doc.dateModified ?? null,
    coverImageUrl: doc.coverImageUrl ?? null,
    totalPages: doc.totalPages ?? null,
    currentPage: doc.currentPage ?? null,
    currentScrollPercent: doc.currentScrollPercent ?? null,
    currentCfi: doc.currentCfi ?? null,
    currentViewState: doc.currentViewState,
    positionJson: doc.positionJson ?? null,
    category: doc.category ?? null,
    tags: doc.tags ?? null,
    filePath: doc.filePath ?? null,
    metadata: doc.metadata ?? null,
  };
}

export function CommandCenter() {
  const documents = useDocumentStore(selectDocuments);
  const documentsLoading = useDocumentStore(selectDocumentsLoading);
  const documentsLoaded = useDocumentStore(selectDocumentsLoaded);
  const loadDocuments = useDocumentStore(selectLoadDocuments);
  const addTab = useTabsStore(selectAddTab);
  const paletteRootPane = useTabsStore((state) => state.rootPane);
  const paletteNavigationPane = useTabsStore((state) => state.navigationPaneId);
  const decks = useStudyDeckStore(selectDecks);
  const activeDeckIds = useStudyDeckStore(selectActiveDeckIds);
  const commandPaletteOpen = useUIStore(selectCommandPaletteOpen);
  const setCommandPaletteOpen = useUIStore(selectSetCommandPaletteOpen);
  const extracts = useExtractStore(selectExtracts);
  const _extractsLoading = useExtractStore(selectExtractsLoading);
  const loadExtracts = useExtractStore(selectLoadExtracts);
  const extractsLoadedRef = useRef(false);
  const documentsSnapshotRef = useRef<Document[]>([]);
  const documentsFetchInFlight = useRef<Promise<Document[]> | null>(null);
  const transcriptCacheRef = useRef<Map<string, { text: string; lower: string }>>(new Map());
  const transcriptFetchInFlightRef = useRef<Set<string>>(new Set());
  const audioTranscriptCacheRef = useRef<Map<string, SearchableTranscriptSegment[]>>(new Map());
  const htmlTextCacheRef = useRef<Map<string, { text: string; lower: string }>>(new Map());
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const extractsRef = useRef(extracts);
  extractsRef.current = extracts;
  const { theme, themes, setTheme } = useTheme();
  const { t } = useI18n();

  const rssArticlesCacheRef = useRef<Array<{ item: FeedItem; feedId: string; feedTitle: string }>>([]);
  const isRssCacheLoadingRef = useRef(false);
  const [helpViewerDocId, setHelpViewerDocId] = useState<string | null>(null);
  const [askPlethoraModalOpen, setAskPlethoraModalOpen] = useState(false);
  const [askPlethoraInitialQuery, setAskPlethoraInitialQuery] = useState("");

  /* ----------------------------------------------------------------------- */
  /* Command hub controller state (revamp-command-palette)                   */
  /* ----------------------------------------------------------------------- */

  const addDocumentToStore = useDocumentStore(selectAddDocument);
  const updateDocumentInStore = useDocumentStore(selectUpdateDocument);
  const activeCollectionId = useCollectionStore(selectActiveCollectionId);
  const continueReading = useStartupStore(selectContinueReading);
  const assistantAvailability = useAiAvailability("prompt");
  const requestLibraryAsk = useLibraryAskHandoffStore((state) => state.requestAsk);
  const clearNoteDraft = usePaletteNoteDraftStore((state) => state.clearDraft);
  const toast = useToast();
  const savedQueues = useSavedQueueStore((state) => state.savedQueues);
  const savedQueueLoading = useSavedQueueStore((state) => state.isLoading);
  const savedQueueError = useSavedQueueStore((state) => state.error);
  const paletteSelection = usePaletteSelectionStore((state) => state.selection);

  // Due-card state for the active collection/deck. Sourced from the same
  // eligible set the review workflow uses (`getDueItems` + active-deck
  // filter), so the badge and the Start-review target cannot disagree.
  const [dueState, setDueState] = useState<PaletteDueState>({ status: "loading", dueCount: 0 });
  const [enrichedResume, setEnrichedResume] = useState<PaletteResumeItem | null>(null);
  const enrichmentRef = useRef<{ documentId: string; collectionId: string } | null>(null);
  const learningItemsPromiseRef = useRef<Promise<LearningItem[]> | null>(null);

  useEffect(() => {
    // Ensure the palette has documents once per mount, without re-fetching
    // after every completed load: an empty library must not loop (each
    // completion would otherwise re-trigger this effect forever).
    if (!documentsLoading && !documentsLoaded && documents.length === 0) {
      void loadDocuments();
    }
  }, [documents.length, documentsLoading, documentsLoaded, loadDocuments]);

  // Pre-fetch all RSS articles once when command palette opens in RSS view
  useEffect(() => {
    const getActiveTab = () => {
      const state = useTabsStore.getState();
      const paneIds = state.getTabPaneIds();
      if (paneIds.length === 0) return null;
      const pane = state.findPaneById(state.navigationPaneId ?? paneIds[0]);
      if (!pane || pane.type !== "tabs" || !pane.activeTabId) return null;
      return state.tabs.find(t => t.id === pane.activeTabId) || null;
    };
    const activeTab = getActiveTab();
    const isRssView = activeTab?.type === "rss";

    if (commandPaletteOpen && isRssView) {
      const loadRssArticlesToCache = async () => {
        if (isRssCacheLoadingRef.current) return;
        isRssCacheLoadingRef.current = true;
        try {
          const feeds = await getSubscribedFeedsAuto();
          const cached: Array<{ item: FeedItem; feedId: string; feedTitle: string }> = [];
          feeds.forEach((feed) => {
            (feed.items || []).forEach((item) => {
              cached.push({
                item,
                feedId: feed.id,
                feedTitle: feed.title,
              });
            });
          });
          rssArticlesCacheRef.current = cached;
        } catch (err) {
          console.warn("[CommandCenter] Failed to pre-fetch RSS articles for cache", err);
        } finally {
          isRssCacheLoadingRef.current = false;
        }
      };
      
      void loadRssArticlesToCache();
    } else if (!commandPaletteOpen) {
      rssArticlesCacheRef.current = [];
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (documents.length > 0) {
      documentsSnapshotRef.current = documents;
    }
  }, [documents]);

  // Extracts are loaded lazily inside handleSearch when a content search is performed.
  // This avoids fetching ALL extracts (potentially thousands) on every palette open.

  // Document content extraction is NOT triggered on palette open.
  // Content is fetched lazily per-document during search if needed,
  // or the user can trigger extraction through other UI flows.
  // This prevents blocking the main thread with sequential I/O on large collections.

  const activeDeck = useMemo(
    () => {
      if (activeDeckIds.length === 0) return null;
      return decks.find((item) => item.id === activeDeckIds[0]) ?? null;
    },
    [decks, activeDeckIds]
  );
  const shouldFilterByDeck = false;

  const openDocumentInTab = useCallback(
    (
      documentId: string,
      options?: { highlightQuery?: string; initialJump?: ExactSearchHitLocation }
    ) => {
      openDocumentAtLocation(documentId, options ?? {}, addTab);
    },
    [addTab]
  );

  /* ----------------------------------------------------------------------- */
  /* Hub home model (bounded, honest data)                                   */
  /* ----------------------------------------------------------------------- */

  // Due-card fetch: only while the palette is open, cancelled on close and
  // collection change so a stale collection's count can never render.
  useEffect(() => {
    if (!commandPaletteOpen) return;
    let cancelled = false;
    const collectionId = activeCollectionId;
    setDueState({ status: "loading", dueCount: 0 });
    void fetchDueItems(collectionId)
      .then((items) => {
        if (cancelled) return;
        if (useCollectionStore.getState().activeCollectionId !== collectionId) return;
        const { activeDeckIds: deckIds, decks: deckList } = useStudyDeckStore.getState();
        const activeDecks = deckIds
          .map((id) => deckList.find((deck) => deck.id === id))
          .filter((deck): deck is StudyDeck => deck != null);
        const scoped = activeDecks.length > 0 ? filterByDecks(items, activeDecks) : items;
        setDueState({ status: "ready", dueCount: scoped.length });
      })
      .catch((error) => {
        console.warn("[CommandCenter] Failed to load due cards for the palette", error);
        if (!cancelled) setDueState({ status: "unavailable", dueCount: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [commandPaletteOpen, activeCollectionId, activeDeckIds, decks]);

  const hubHome = useMemo<PaletteHomeModel>(() => {
    const paletteDocs = (documents.length > 0 ? documents : documentsSnapshotRef.current).map(
      toPaletteDocumentLike
    );
    const activeView = resolveActivePaletteView(documents);

    const resumeCandidate = selectResumeCandidate({
      continueReading,
      documents: paletteDocs,
      activeCollectionId,
      activeReaderDocumentId: getActiveReaderDocumentId(),
    });
    const resumeDoc = resumeCandidate
      ? paletteDocs.find((doc) => doc.id === resumeCandidate.documentId) ?? null
      : null;
    const resumeSource: PaletteDocumentLike | null = resumeCandidate
      ? resumeDoc ?? {
          id: resumeCandidate.documentId,
          title: resumeCandidate.title,
          fileType: resumeCandidate.fileType,
          progressPercent: resumeCandidate.progressPercent,
          dateModified:
            resumeCandidate.dateModifiedMs != null
              ? new Date(resumeCandidate.dateModifiedMs).toISOString()
              : null,
        }
      : null;
    const baseResume =
      resumeCandidate && resumeSource
        ? buildResumeItem({ candidate: resumeCandidate, document: resumeSource, translate: t })
        : null;
    const resumeItem =
      enrichedResume && enrichedResume.documentId === baseResume?.documentId
        ? enrichedResume
        : baseResume;

    const recentCandidate = selectRecentCandidate({
      documents: paletteDocs,
      activeCollectionId,
      recentOpens: getRecentOpens(activeCollectionId),
    });
    const recentItem: PaletteRecentItem | null = recentCandidate
      ? {
          documentId: recentCandidate.documentId,
          title: recentCandidate.title ?? t("palette.untitled"),
          fileType: recentCandidate.fileType ?? "other",
          openedAt: recentCandidate.openedAt,
          source: recentCandidate.source,
        }
      : null;

    const suggestions = deriveSuggestions({
      resume: resumeItem,
      topic: deriveResumeTopic(resumeDoc),
      translate: t,
    });

    const resumeState: PaletteResumeState = {
      status: resumeItem ? "ready" : documentsLoading ? "loading" : "none",
      item: resumeItem,
    };

    return {
      collectionId: activeCollectionId,
      firstUse: !documentsLoading && documents.length === 0,
      resume: resumeState,
      recent: {
        status: recentItem ? "ready" : documentsLoading ? "loading" : "none",
        item: recentItem,
      },
      due: dueState,
      assistant: assistantAvailability.available
        ? { available: true }
        : { available: false, unavailableReasonKey: "palette.assistant.unavailable" },
      suggestions,
      contextualActions: resolveContextualActionDescriptors(activeView.view, activeView.context),
    };
    // The model recomputes on palette open so the active view/reader are current.
  }, [
    activeCollectionId,
    assistantAvailability.available,
    commandPaletteOpen,
    continueReading,
    documents,
    documentsLoading,
    dueState,
    enrichedResume,
    t,
    paletteSelection,
    paletteRootPane,
    paletteNavigationPane,
  ]);

  // Enrich exactly one resume document (cover/metadata/position/passage).
  // Never runs for All/home browsing beyond this bounded item, and stale
  // responses cannot replace a newer collection's resume.
  const hubResumeDocumentId = hubHome.resume.item?.documentId ?? null;
  useEffect(() => {
    if (!commandPaletteOpen || !hubResumeDocumentId) return;
    const collectionId = activeCollectionId;
    const already = enrichmentRef.current;
    if (already && already.documentId === hubResumeDocumentId && already.collectionId === collectionId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const doc = await getDocument(hubResumeDocumentId);
        if (!doc) return;
        if (cancelled || useCollectionStore.getState().activeCollectionId !== collectionId) return;
        if (!isEligibleDocument(toPaletteDocumentLike(doc))) return;

        // A saved passage is shown only when a real extract sits at the
        // persisted page — never arbitrary document text.
        let passage: string | null = null;
        if (
          doc.fileType === "pdf" &&
          typeof doc.currentPage === "number" &&
          doc.currentPage > 0
        ) {
          try {
            const extracts = await getExtracts(doc.id);
            if (cancelled) return;
            const atPage = extracts
              .filter(
                (extract) =>
                  extract.page_number === doc.currentPage && Boolean(extract.content?.trim())
              )
              .sort((a, b) => (b.date_modified ?? "").localeCompare(a.date_modified ?? ""));
            if (atPage.length > 0) passage = atPage[0].content.trim().slice(0, 280);
          } catch (error) {
            console.warn("[CommandCenter] Failed to load resume passage", error);
          }
        }
        if (cancelled) return;

        const item = buildResumeItem({
          candidate: {
            documentId: doc.id,
            title: doc.title,
            fileType: doc.fileType,
            progressPercent: doc.progressPercent ?? null,
            dateModifiedMs: doc.dateModified ? Date.parse(doc.dateModified) : null,
            source: "active-reader",
          },
          document: toPaletteDocumentLike(doc),
          translate: t,
          passage,
        });
        enrichmentRef.current = { documentId: doc.id, collectionId };
        setEnrichedResume(item);
      } catch (error) {
        // Enrichment failure keeps the bounded cached item with honest fallbacks.
        console.warn("[CommandCenter] Resume enrichment failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commandPaletteOpen, hubResumeDocumentId, activeCollectionId, t]);

  // A collection change invalidates the previous collection's enriched resume.
  useEffect(() => {
    enrichmentRef.current = null;
    setEnrichedResume(null);
    learningItemsPromiseRef.current = null;
  }, [activeCollectionId]);

  /* ----------------------------------------------------------------------- */
  /* Shared hub executor                                                     */
  /* ----------------------------------------------------------------------- */

  const hubDocumentForAction = useCallback((documentId: string | undefined) => {
    if (!documentId) return null;
    return documentsRef.current.find((doc) => doc.id === documentId) ?? null;
  }, []);

  const executePaletteAction = useCallback(
    (invocation: PaletteActionInvocation) => {
      const { id, documentId, suggestion } = invocation;
      const closePalette = () => useUIStore.getState().setCommandPaletteOpen(false);

      switch (id) {
        case "palette.resume": {
          const target = documentId ?? hubHome.resume.item?.documentId;
          if (!target) return;
          closePalette();
          // Canonical opener; a normal resume carries no search-hit highlight.
          void openDocumentInTab(target);
          return;
        }
        case "palette.openRecent": {
          const target = documentId ?? hubHome.recent.item?.documentId;
          if (!target) return;
          closePalette();
          void openDocumentInTab(target);
          return;
        }
        case "palette.reviewDue": {
          closePalette();
          navigateTo("/review");
          // The normal review-start flow: same queue load (collection + active
          // deck) the Review tab's own Start review button runs.
          void useReviewStore.getState().loadQueue();
          return;
        }
        case "palette.openReviewOverview": {
          closePalette();
          useReviewStore.getState().setReviewTabMode("home");
          navigateTo("/review");
          return;
        }
        case "palette.askLibrary": {
          closePalette();
          if (suggestion) {
            requestLibraryAsk({ question: suggestion.label, documentId: suggestion.documentId });
          } else {
            useLibraryAskHandoffStore.getState().requestOpen();
          }
          return;
        }
        case "palette.openSettings":
          closePalette();
          navigateTo("/settings");
          return;
        case "palette.importDocument":
          closePalette();
          navigateTo("/documents");
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("import-document"));
          }, 100);
          return;
        case "palette.openLibrary":
          closePalette();
          navigateTo("/documents");
          return;
        case "doc.viewInLibrary": {
          const target = documentId ?? hubHome.resume.item?.documentId;
          if (!target) return;
          const doc = hubDocumentForAction(target);
          closePalette();
          navigateTo("/documents");
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("plethora:reveal-document", {
                detail: { documentId: target, title: doc?.title },
              })
            );
          }, 100);
          return;
        }
        case "doc.openDetails": {
          const target = documentId ?? hubHome.resume.item?.documentId;
          if (!target) return;
          const doc = hubDocumentForAction(target);
          closePalette();
          navigateTo("/documents");
          window.setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("plethora:reveal-document", {
                detail: { documentId: target, title: doc?.title, openDetails: true },
              })
            );
          }, 100);
          return;
        }
        case "doc.copyTitle": {
          const target = documentId ?? hubHome.resume.item?.documentId;
          const title =
            hubDocumentForAction(target)?.title ?? hubHome.resume.item?.title ?? null;
          if (!title) return;
          void navigator.clipboard
            ?.writeText(title)
            .then(() => toast.success(t("palette.copiedTitle"), title))
            .catch(() => toast.error(t("palette.copyFailed")));
          return;
        }
        case "doc.copySourceLink": {
          const target = documentId ?? hubHome.resume.item?.documentId;
          const filePath = hubDocumentForAction(target)?.filePath ?? null;
          const sourceUrl =
            filePath && /^https?:\/\//i.test(filePath)
              ? filePath
              : hubHome.resume.item?.sourceUrl ?? null;
          if (!sourceUrl) return;
          void navigator.clipboard
            ?.writeText(sourceUrl)
            .then(() => toast.success(t("palette.copiedSourceLink"), sourceUrl))
            .catch(() => toast.error(t("palette.copyFailed")));
          return;
        }
        default:
          return;
      }
    },
    [
      hubDocumentForAction,
      hubHome.recent.item?.documentId,
      hubHome.resume.item?.documentId,
      hubHome.resume.item?.sourceUrl,
      hubHome.resume.item?.title,
      openDocumentInTab,
      requestLibraryAsk,
      t,
      toast,
    ]
  );

  const saveNoteDraft = useCallback(
    async (draft: PaletteNoteDraft): Promise<string | null> => {
      const result = await savePaletteNote(draft, {
        createDocument: (title, filePath, fileType) =>
          createDocument(title, filePath, fileType, activeCollectionId),
        updateDocumentContent,
        deleteDocument,
        addDocument: addDocumentToStore,
        updateDocument: updateDocumentInStore,
        refreshLibrary: () => {
          void loadDocuments();
        },
        openDocument: (documentId) => {
          useUIStore.getState().setCommandPaletteOpen(false);
          void openDocumentInTab(documentId);
        },
        clearDraft: clearNoteDraft,
        fallbackTitle: t("palette.note.untitled"),
        onSaved: (title) => toast.success(t("palette.note.saved"), title),
        onCleanupError: (cleanupError) =>
          console.warn("[CommandCenter] Failed to clean up partial note", cleanupError),
      });
      return result.error ?? null;
    },
    [
      activeCollectionId,
      addDocumentToStore,
      clearNoteDraft,
      loadDocuments,
      openDocumentInTab,
      t,
      toast,
      updateDocumentInStore,
    ]
  );

  const handleSearch = useCallback(async (query: SearchQuery): Promise<SearchResult[]> => {
    const term = query.query.toLowerCase().trim();
    const results: SearchResult[] = [];
    // Palette scope intent: enforced at the provider boundary so early RSS/
    // podcast/help branches cannot leak unrelated kinds into a scope.
    const paletteScope = query.paletteScope ?? "all";

    // Lazy-load extracts for content search (once per session)
    const queryTerms = extractSearchTerms(query.query)
      .map((item) => item.toLowerCase().trim())
      .filter(Boolean);
    const meaningfulTerms = queryTerms.filter(isMeaningfulTerm);
    if (meaningfulTerms.length > 0 && !extractsLoadedRef.current) {
      extractsLoadedRef.current = true;
      void loadExtracts();
    }
    const searchTerms = meaningfulTerms.length > 0 ? meaningfulTerms : [term];
    const allowContentSearch = meaningfulTerms.length > 0;

    // Read from refs for stable closure
    const docs = documentsRef.current;
    const exts = extractsRef.current;

    const matchesTerms = (text: string, terms: string[]): boolean =>
      terms.some((value) => text.includes(value));

    const fuzzyMatches = (text: string): boolean => {
      if (!allowContentSearch) return false;
      if (term.length < 3) return false;
      if (text.length > 80) return false;
      const { match, score } = fuzzyMatch(text, term, 2);
      return match && score >= 0.6;
    };

    const isWeb = !isTauri();
    const maxResults = 50;
    const maxDocsToScan = 500;
    const maxExtractsToScan = 500;
    const maxTranscriptFetches = 3;
    let _transcriptFetches = 0;

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

    const findAllOccurrences = (haystackLower: string, needleLower: string, limit: number): number[] => {
      if (!needleLower) return [];
      const out: number[] = [];
      let idx = 0;
      while (idx >= 0 && out.length < limit) {
        idx = haystackLower.indexOf(needleLower, idx);
        if (idx >= 0) {
          out.push(idx);
          idx += Math.max(1, needleLower.length);
        }
      }
      return out;
    };

    const excerptFromIndex = (source: string, index: number, rawQuery: string): string => {
      const context = 90;
      const start = Math.max(0, index - context);
      const end = Math.min(source.length, index + context);
      const slice = source.slice(start, end);
      const { excerpt } = highlightSearchTerms(slice, rawQuery, 200);
      return excerpt;
    };

    const exactQuoteFromIndex = (source: string, index: number, matchedText: string): string => {
      if (!matchedText) return "";
      return source
        .slice(index, index + matchedText.length)
        .replace(/\s+/g, " ")
        .trim();
    };

    const quoteContextFromIndex = (source: string, index: number, matchedText: string): string => {
      const context = 120;
      const start = Math.max(0, index - context);
      const end = Math.min(source.length, index + matchedText.length + context);
      return source
        .slice(start, end)
        .replace(/\s+/g, " ")
        .trim();
    };

    const buildPdfPageFromIndex = (doc: Document, index: number, contentLength: number): number => {
      const totalPages = doc.totalPages ?? doc.metadata?.pageCount ?? 1;
      if (!contentLength || totalPages <= 1) return 1;
      const pct = clamp(index / contentLength, 0, 1);
      return clamp(Math.round(pct * (totalPages - 1)) + 1, 1, totalPages);
    };

    const getHtmlText = (doc: Document): { text: string; lower: string } => {
      const cached = htmlTextCacheRef.current.get(doc.id);
      if (cached) return cached;
      const html = doc.content ?? "";
      if (!html) {
        const empty = { text: "", lower: "" };
        htmlTextCacheRef.current.set(doc.id, empty);
        return empty;
      }
      try {
        const parser = new DOMParser();
        const parsed = parser.parseFromString(html, "text/html");
        parsed.querySelectorAll("script, style").forEach((el) => el.remove());
        const text = (parsed.body?.textContent ?? "").replace(/\s+/g, " ").trim();
        const entry = { text, lower: text.toLowerCase() };
        htmlTextCacheRef.current.set(doc.id, entry);
        return entry;
      } catch {
        const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const entry = { text, lower: text.toLowerCase() };
        htmlTextCacheRef.current.set(doc.id, entry);
        return entry;
      }
    };

    const groupedDocs = new Map<string, {
      doc: Document;
      score: number;
      excerpt?: string;
      highlights?: string[];
      transcriptMatch?: boolean;
      hits: SearchHit[];
    }>();

    let docsForSearch = docs.length > 0 ? docs : documentsSnapshotRef.current;
    if (docsForSearch.length === 0 && !documentsLoading) {
      if (!documentsFetchInFlight.current) {
        documentsFetchInFlight.current = fetchDocuments().catch((error) => {
          console.warn("[CommandCenter] Failed to fetch documents for search", error);
          return [];
        });
      }
      docsForSearch = await documentsFetchInFlight.current;
      documentsFetchInFlight.current = null;
      if (docsForSearch.length > 0) {
        documentsSnapshotRef.current = docsForSearch;
      }
    }

    // Active-view resolution (shared by contextual actions and the catalogue).
    const getActiveTab = () => {
      const state = useTabsStore.getState();
      const paneIds = state.getTabPaneIds();
      if (paneIds.length === 0) return null;
      const pane = state.findPaneById(state.navigationPaneId ?? paneIds[0]);
      if (!pane || pane.type !== "tabs" || !pane.activeTabId) return null;
      return state.tabs.find(t => t.id === pane.activeTabId) || null;
    };
    const activeTab = getActiveTab();
    const selectedDocumentTitle = activeTab?.type === "document-viewer" && activeTab.data?.documentId
      ? (documents.find(d => d.id === activeTab.data.documentId)?.title ?? null)
      : null;
    const isRssView = activeTab?.type === "rss";
    const isPodcastView = activeTab?.type === "podcast";

    // ---- Contextual palette actions -----------------------------------
    // Resolve the active view (if supported) and the context the action
    // `applies()` predicates need, then build the contextual-action results.
    const contextualView: ContextualViewType | null =
      activeTab?.type === "document-viewer" || activeTab?.type === "audiobook-epub-sync"
        ? "document-viewer"
      : activeTab?.type === "rss" ? "rss"
      : activeTab?.type === "podcast" ? "podcast"
      : activeTab?.type === "audiobook" ? "audiobook"
      : null;

    const contextualContext: ActionContext = (() => {
      if (contextualView === "document-viewer" && activeTab?.data?.documentId) {
        const doc = documents.find(d => d.id === activeTab.data!.documentId);
        const ft = (doc?.fileType || "").toLowerCase();
        const viewerKind =
          ft === "pdf" ? "pdf"
          : ft === "epub" ? "epub"
          : ft === "markdown" ? "markdown"
          : ft === "html" ? "html"
          : ft === "youtube" ? "youtube"
          : ft === "audio" ? "audio"
          : "other";
        return { viewerKind, vimAvailable: true, hasSelection: Boolean(getPaletteSelection()) };
      }
      // For RSS/Podcast, target-item-dependent actions are shown by default;
      // the listener hides them at runtime if there is no current item.
      return { hasTargetItem: true };
    })();

    const contextualActions: ViewAction[] = contextualView
      ? getActionsForView(contextualView, { ...contextualContext, ...getLiveContext(contextualView) })
      : [];

    // Convert matching contextual actions into palette results. Ranked above
    // global commands (score 0.95 vs 0.8) so in-context actions win ties.
    // Empty query shows all applicable actions (the "Actions in this view"
    // group). Results carry the dispatch target for the click handler.
    const buildContextualResults = (q: string): SearchResult[] => {
      if (!contextualView) return [];
      const matched = contextualActions.filter((a) => actionMatchesQuery(a, q));
      // Cap to keep the contextual section focused; the rest remain reachable
      // by typing a more specific query.
      return matched.slice(0, 10).map((action) => ({
        id: `ctx-${action.view}-${action.id}`,
        type: SearchResultType.Command,
        title: action.title,
        excerpt: action.subtitle,
        score: 0.95,
        metadata: {
          resultKind: "contextual-action",
          contextualView: action.view,
          contextualActionId: action.id,
          shortcut: action.shortcutHint,
          category: "Action",
          groupLabel: "Actions in this view",
        },
      }));
    };

    // Push contextual-action results into the main result set. They are ranked
    // above global commands (0.95 > 0.8) by the final sort. This runs for the
    // document-viewer path (the main branch); RSS/Podcast branches seed their
    // own `matches` arrays via buildContextualResults above.
    if (contextualView && contextualView !== "rss" && contextualView !== "podcast") {
      results.push(...buildContextualResults(query.query));
    }

    // Empty query: contextual actions are the default palette content (global
    // commands and content search require a term). Return early here so we
    // don't run the term-dependent search below.
    if (!term) return results;

    // §3.3: platform gating applied to the single shared catalogue (registry
    // actions, navigation, themes and palette-owned commands live in
    // `commandPalette/catalogue`; the palette browses this same list).
    const allCommands = buildCommandCatalogue({
      translate: t,
      theme,
      themes,
      setTheme,
      isWeb,
      selectedDocumentTitle,
    });

    if (urlDetectorUtils.isTwitterURL(query.query.trim())) {
      const targetUrl = query.query.trim();
      const statusId = urlDetectorUtils.extractTwitterStatusID(targetUrl);
      const username = urlDetectorUtils.extractTwitterUsername(targetUrl);
      return [
        {
          id: `x-thread-${statusId || "action"}`,
          type: SearchResultType.Command,
          title: "X Thread: Open and analyze this thread",
          excerpt: username ? `Open thread by @${username} with summary and learning tools` : `Open and analyze thread in reader`,
          score: 10.0,
          metadata: {
            resultKind: "contextual-action",
            action: async () => {
              useUIStore.getState().setCommandPaletteOpen(false);
              const doc = await useDocumentStore.getState().openTwitterThread(targetUrl);
              openDocumentInTab(doc.id);
            },
          },
        },
      ];
    }

    const liveCtx = contextualView ? getLiveContext(contextualView) : {};
    const helpAppContext: Partial<HelpAppContext> = {
      activeView: contextualView || "dashboard",
      documentFormat: (liveCtx.viewerKind as any) || undefined,
      ttsActive: false,
      activeAlgorithm: "fsrs",
      platform: isTauri() ? "desktop-macos" : "desktop-macos",
    };

    const rawQuery = query.query.trim();
    const intent = classifyPaletteInput(rawQuery, helpAppContext);

    if (intent.kind === "product_help" && intent.forcedPrefix) {
      const cleanQ = intent.query;
      const helpResults = defaultHelpRetrieval.search(cleanQ, { context: helpAppContext, limit: 6 });
      const matches: SearchResult[] = [];

      matches.push({
        id: "ask-plethora-action",
        type: SearchResultType.Command,
        title: `✨ Ask Plethora: "${cleanQ}"`,
        excerpt: "Launch intelligent grounded assistant across all 75 product docs",
        score: 10.0,
        metadata: {
          groupLabel: "Ask Plethora Assistant",
          resultKind: "ask-plethora",
          action: () => {
            setAskPlethoraInitialQuery(cleanQ);
            setAskPlethoraModalOpen(true);
          },
        },
      });

      helpResults.forEach((hr) => {
        matches.push({
          id: `help-doc-${hr.chunk.id}`,
          type: SearchResultType.Command,
          title: `📖 ${hr.chunk.title}`,
          excerpt: hr.chunk.content.slice(0, 220) + "...",
          score: 8.0 * (hr.score / 10),
          metadata: {
            groupLabel: "Product Documentation",
            resultKind: "help-article",
            category: hr.chunk.domain.toUpperCase(),
            action: () => {
              setHelpViewerDocId(hr.chunk.docId);
            },
          },
        });
      });

      return matches;
    }

    if (isRssView) {
      try {
        const lowerQuery = query.query.toLowerCase().trim();
        const matches: SearchResult[] = [...buildContextualResults(query.query)];

        if (lowerQuery) {
          let cachedArticles = rssArticlesCacheRef.current;
          if (cachedArticles.length === 0) {
            // Fallback if cache is not loaded yet
            const feeds = await getSubscribedFeedsAuto();
            const cached: Array<{ item: FeedItem; feedId: string; feedTitle: string }> = [];
            feeds.forEach((feed) => {
              (feed.items || []).forEach((item) => {
                cached.push({
                  item,
                  feedId: feed.id,
                  feedTitle: feed.title,
                });
              });
            });
            rssArticlesCacheRef.current = cached;
            cachedArticles = cached;
          }

          cachedArticles.forEach(({ item, feedId }) => {
            const title = item.title || "";
            const desc = item.description || "";
            const content = item.content || "";
            
            const titleMatch = title.toLowerCase().includes(lowerQuery);
            const descMatch = desc.toLowerCase().includes(lowerQuery);
            const contentMatch = content.toLowerCase().includes(lowerQuery);
            
            if (titleMatch || descMatch || contentMatch) {
              let score = 0.5;
              if (titleMatch) score = 0.9;
              else if (descMatch) score = 0.7;
              
              const cleanDesc = desc.replace(/<[^>]+>/g, " ").trim();
              const excerpt = cleanDesc.length > 150 ? cleanDesc.slice(0, 150) + "..." : cleanDesc;
              
              matches.push({
                id: `rss-${item.id}`,
                type: SearchResultType.Document,
                title: item.title,
                excerpt: excerpt || "Read article",
                score,
                metadata: {
                  resultKind: "rss-article",
                  articleId: item.id,
                  feedId: feedId,
                  category: "RSS Article",
                } as any
              });
            }
          });
        }
        
        const matchedCommands = allCommands.filter((cmd) => {
          const label = cmd.label.toLowerCase();
          const description = cmd.description?.toLowerCase() ?? "";
          const keywords = cmd.keywords?.map((keyword) => keyword.toLowerCase()) ?? [];
          return label.includes(lowerQuery) || description.includes(lowerQuery) || keywords.some((keyword) => keyword.includes(lowerQuery));
        });
        
        matchedCommands.forEach((cmd) => {
          matches.push({
            id: `cmd-${cmd.id}`,
            type: SearchResultType.Command,
            title: cmd.label,
            excerpt: cmd.description,
            score: 0.8,
            metadata: {
              action: cmd.action,
              resultKind: "command",
              shortcut: cmd.shortcut,
            },
          });
        });
        
        const sectionMatches = findMatchingSections(query.query);
        sectionMatches.forEach(({ section, score }) => {
          matches.push({
            id: `section-${section.id}`,
            type: SearchResultType.Command,
            title: section.label,
            excerpt: `Open ${section.label}`,
            score,
            metadata: {
              category: "Section",
              sectionId: section.id,
              targetPath: section.path,
              resultKind: "section",
              action: () => navigateTo(section.path),
            },
          });
        });
        
        return filterResultsByScope(matches, paletteScope)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);
      } catch (err) {
        console.error("RSS Search error:", err);
      }
    }

    if (isPodcastView) {
      try {
        const podcasts = await getSubscribedPodcasts();
        const lowerQuery = query.query.toLowerCase().trim();
        const matches: SearchResult[] = [...buildContextualResults(query.query)];

        const episodesLists = await Promise.all(
          podcasts.map(feed => getPodcastEpisodes(feed.id, true).catch(() => []))
        );
        
        for (let fIdx = 0; fIdx < podcasts.length; fIdx++) {
          const feed = podcasts[fIdx];
          const eps = episodesLists[fIdx];
          
          for (const ep of eps) {
            const title = ep.title || "";
            const desc = ep.description || "";
            const transcriptText = ep.transcriptText || "";
            
            const titleMatch = title.toLowerCase().includes(lowerQuery);
            const descMatch = desc.toLowerCase().includes(lowerQuery);
            const transcriptMatch = transcriptText.toLowerCase().includes(lowerQuery);
            
            if (titleMatch || descMatch || transcriptMatch) {
              let score = 0.5;
              if (titleMatch) score = 0.9;
              else if (descMatch) score = 0.7;
              else if (transcriptMatch) score = 0.6;
              
              const cleanDesc = desc.replace(/<[^>]+>/g, " ").trim();
              let excerpt = cleanDesc.length > 150 ? cleanDesc.slice(0, 150) + "..." : cleanDesc;
              
              let primaryHit: SearchHit | undefined = undefined;
              const secondaryHits: SearchHit[] = [];
              
              if (transcriptMatch) {
                try {
                  const transcriptData = await getPodcastTranscript(ep.id);
                  if (transcriptData?.segments) {
                    const matchingSegments = transcriptData.segments.filter(
                      (seg) => seg.text.toLowerCase().includes(lowerQuery)
                    );
                    
                    matchingSegments.forEach((seg, sIdx) => {
                      const startSec = seg.start / 1000;
                      const mm = String(Math.floor(startSec / 60)).padStart(2, "0");
                      const ss = String(Math.floor(startSec % 60)).padStart(2, "0");
                      const label = `${mm}:${ss}`;
                      
                      const hit: SearchHit = {
                        id: `pod-hit-${ep.id}-${sIdx}`,
                        location: {
                          kind: "audio",
                          timeSeconds: startSec,
                          textQuote: seg.text,
                        },
                        label,
                        excerptHtml: seg.text.replace(new RegExp(`(${lowerQuery})`, "ig"), "<mark class='bg-amber-200 dark:bg-amber-800 text-foreground'>$1</mark>"),
                      };
                      
                      if (!primaryHit) {
                        primaryHit = hit;
                      } else {
                        secondaryHits.push(hit);
                      }
                    });
                  }
                } catch (e) {
                  console.warn("[PodcastSearch] Failed to fetch transcript segments", ep.id, e);
                }
              }
              
              if (primaryHit) {
                excerpt = `Transcript match: ${primaryHit.excerptHtml}`;
              }
              
              matches.push({
                id: `podcast-ep-${ep.id}`,
                type: SearchResultType.Document,
                title: ep.title,
                excerpt: excerpt || "Listen to episode",
                score,
                metadata: {
                  resultKind: "podcast-episode",
                  episodeId: ep.id,
                  feedId: feed.id,
                  category: "Podcast Episode",
                  transcriptMatch,
                  primaryHit,
                  secondaryHits: secondaryHits.length > 0 ? secondaryHits : undefined,
                } as any
              });
            }
          }
        }
        
        const matchedCommands = allCommands.filter((cmd) => {
          const label = cmd.label.toLowerCase();
          const description = cmd.description?.toLowerCase() ?? "";
          const keywords = cmd.keywords?.map((keyword) => keyword.toLowerCase()) ?? [];
          return label.includes(lowerQuery) || description.includes(lowerQuery) || keywords.some((keyword) => keyword.includes(lowerQuery));
        });
        
        matchedCommands.forEach((cmd) => {
          matches.push({
            id: `cmd-${cmd.id}`,
            type: SearchResultType.Command,
            title: cmd.label,
            excerpt: cmd.description,
            score: 0.8,
            metadata: {
              action: cmd.action,
              resultKind: "command",
              shortcut: cmd.shortcut,
            },
          });
        });
        
        const sectionMatches = findMatchingSections(query.query);
        sectionMatches.forEach(({ section, score }) => {
          matches.push({
            id: `section-${section.id}`,
            type: SearchResultType.Command,
            title: section.label,
            excerpt: `Open ${section.label}`,
            score,
            metadata: {
              category: "Section",
              sectionId: section.id,
              targetPath: section.path,
              resultKind: "section",
              action: () => navigateTo(section.path),
            },
          });
        });
        
        return filterResultsByScope(matches, paletteScope)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);
      } catch (err) {
        console.error("Podcast search error:", err);
      }
    }

    const matchedCommands = allCommands.filter((cmd) => {
      const label = cmd.label.toLowerCase();
      const description = cmd.description?.toLowerCase() ?? "";
      const keywords = cmd.keywords?.map((keyword) => keyword.toLowerCase()) ?? [];
      const termMatch = matchesTerms(label, searchTerms) || matchesTerms(description, searchTerms);
      const keywordMatch = keywords.some((keyword) => matchesTerms(keyword, searchTerms));

      if (termMatch || keywordMatch) return true;
      return fuzzyMatches(label) || (description ? fuzzyMatches(description) : false);
    });

    const sectionMatches = findMatchingSections(query.query);
    sectionMatches.forEach(({ section, score }) => {
      results.push({
        id: `section-${section.id}`,
        type: SearchResultType.Command,
        title: section.label,
        excerpt: `Open ${section.label}`,
        score,
        metadata: {
          category: "Section",
          sectionId: section.id,
          targetPath: section.path,
          resultKind: "section",
          action: () => navigateTo(section.path),
        },
      });
    });

    // Handle Direct Canonical Lookup and Natural Language Help
    if (intent.kind === "direct_lookup") {
      const direct = intent.directResult;
      results.unshift({
        id: `direct-help-${direct.featureId}`,
        type: SearchResultType.Command,
        title: `💡 ${direct.title}`,
        excerpt: `${direct.summary}\n• How to: ${direct.how_to}`,
        score: 1.0,
        metadata: {
          groupLabel: "Canonical Guide",
          resultKind: "help-article",
          category: "Guide",
          shortcut: direct.primaryAction?.shortcut,
          action: () => {
            if (direct.primaryAction) {
              dispatchRegisteredHelpAction(direct.primaryAction.id);
            } else {
              setHelpViewerDocId(direct.featureId);
            }
          },
        },
      });
    } else if (intent.kind === "product_help") {
      results.unshift({
        id: "ask-plethora-prompt",
        type: SearchResultType.Command,
        title: `✨ Ask Plethora: "${intent.query}"`,
        excerpt: "Get instant grounded answer with source citations",
        score: 0.99,
        metadata: {
          groupLabel: "Ask Plethora Assistant",
          resultKind: "ask-plethora",
          action: () => {
            setAskPlethoraInitialQuery(intent.query);
            setAskPlethoraModalOpen(true);
          },
        },
      });

      const helpMatches = defaultHelpRetrieval.search(intent.query, { context: helpAppContext, limit: 3 });
      helpMatches.forEach((hm) => {
        results.push({
          id: `help-${hm.chunk.id}`,
          type: SearchResultType.Command,
          title: `📖 ${hm.chunk.title}`,
          excerpt: hm.chunk.content.slice(0, 200) + "...",
          score: 0.85,
          metadata: {
            groupLabel: "Product Documentation",
            resultKind: "help-article",
            category: hm.chunk.domain.toUpperCase(),
            action: () => setHelpViewerDocId(hm.chunk.docId),
          },
        });
      });
    } else if (rawQuery.length >= 3) {
      // General search: include top matching canonical doc if high score
      const generalHelp = defaultHelpRetrieval.search(rawQuery, { context: helpAppContext, limit: 2 });
      generalHelp.forEach((gh) => {
        if (gh.score > 2.0) {
          results.push({
            id: `help-gen-${gh.chunk.id}`,
            type: SearchResultType.Command,
            title: `📖 ${gh.chunk.title}`,
            excerpt: gh.chunk.content.slice(0, 180) + "...",
            score: 0.75,
            metadata: {
              groupLabel: "Product Documentation",
              resultKind: "help-article",
              category: gh.chunk.domain.toUpperCase(),
              action: () => setHelpViewerDocId(gh.chunk.docId),
            },
          });
        }
      });
    }

    matchedCommands.forEach((cmd) => {
      results.push({
        id: `cmd-${cmd.id}`,
        type: SearchResultType.Command,
        title: cmd.label,
        excerpt: cmd.description,
        score: 0.8,
        metadata: {
          action: cmd.action,
          resultKind: "command",
          shortcut: cmd.shortcut,
        },
      });
    });

    /* --------------------------------------------------------------------- */
    /* Scope enforcement (revamp-command-palette)                             */
    /* --------------------------------------------------------------------- */

    // Actions/Settings/Library are command/destination catalogues: everything
    // needed is already assembled above (contextual actions, commands,
    // sections, help). No document/extract/card content scan runs for them.
    if (
      paletteScope === "actions" ||
      paletteScope === "settings" ||
      paletteScope === "library"
    ) {
      return filterResultsByScope(results, paletteScope)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

    // Cards: bounded lookup over real learning items plus extracts (which
    // retain their source jump). Loaded only when Cards is actually searched —
    // All/home never fetches all cards.
    if (paletteScope === "cards") {
      const matches: SearchResult[] = [];
      const isCardDocumentEligible = (documentId: string | undefined | null): boolean => {
        if (!documentId) return true;
        const doc = docs.find((d) => d.id === documentId);
        if (!doc) return true; // outside the bounded cache; still real user data
        if (!isEligibleDocument(toPaletteDocumentLike(doc))) return false;
        if (activeCollectionId && doc.collectionId && doc.collectionId !== activeCollectionId) {
          return false;
        }
        return true;
      };

      try {
        if (!learningItemsPromiseRef.current) {
          learningItemsPromiseRef.current = getAllLearningItems().catch((error) => {
            learningItemsPromiseRef.current = null;
            console.warn("[CommandCenter] Failed to load learning items for Cards search", error);
            return [] as LearningItem[];
          });
        }
        const learningItems = await learningItemsPromiseRef.current;

        let scannedCards = 0;
        const maxCardScans = 5000;
        for (const item of learningItems) {
          if (scannedCards >= maxCardScans || matches.length >= maxResults) break;
          scannedCards += 1;
          if (item.is_suspended) continue;
          if (!isCardDocumentEligible(item.document_id)) continue;

          const question = (item.question ?? "").toLowerCase();
          const answer = (item.answer ?? "").toLowerCase();
          const cloze = (item.cloze_text ?? "").toLowerCase();
          const questionMatch = matchesTerms(question, searchTerms);
          const answerMatch = answer ? matchesTerms(answer, searchTerms) : false;
          const clozeMatch = cloze ? matchesTerms(cloze, searchTerms) : false;
          if (!questionMatch && !answerMatch && !clozeMatch) continue;

          const { excerpt } = highlightSearchTerms(item.question ?? "", query.query, 200);
          matches.push({
            id: `card-${item.id}`,
            type: SearchResultType.Flashcard,
            title: item.question || t("palette.cardFallbackTitle"),
            excerpt,
            score: questionMatch ? 0.9 : clozeMatch ? 0.8 : 0.7,
            metadata: {
              resultKind: "learning-item",
              cardId: item.id,
              documentId: item.document_id,
              category: "Flashcard",
              scopes: ["cards"],
            },
          });
        }
      } catch (error) {
        console.warn("[CommandCenter] Cards search failed", error);
      }

      let scannedExtracts = 0;
      for (const extract of exts) {
        if (scannedExtracts >= maxExtractsToScan || matches.length >= maxResults) break;
        scannedExtracts += 1;
        const content = extract.content ?? "";
        if (!allowContentSearch || !matchesTerms(content.toLowerCase(), searchTerms)) continue;
        const parentDoc = docs.find((d) => d.id === extract.documentId);
        if (!parentDoc) continue;
        if (!isEligibleDocument(toPaletteDocumentLike(parentDoc))) continue;
        if (
          activeCollectionId &&
          parentDoc.collectionId &&
          parentDoc.collectionId !== activeCollectionId
        ) {
          continue;
        }

        const { excerpt } = highlightSearchTerms(content, query.query, 200);
        const pageNum = extract.pageNumber && extract.pageNumber > 0 ? extract.pageNumber : 1;
        matches.push({
          id: `extract-${extract.id}`,
          type: SearchResultType.Extract,
          title: parentDoc.title,
          excerpt,
          score: 0.75,
          metadata: {
            documentId: parentDoc.id,
            resultKind: "extract",
            highlightQuery: query.query,
            primaryHit: {
              id: `extract-hit-${extract.id}`,
              location: {
                kind: "pdf",
                pageNumber: pageNum,
                textQuote: query.query.trim() || undefined,
              },
              label: `Page ${pageNum}`,
              excerptHtml: excerpt,
            },
            category: "Extract",
            scopes: ["cards"],
          },
        });
      }

      return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
    }

    // 2. Search Documents (grouped: one row per document)
    if (!query.types || query.types.includes(SearchResultType.Document)) {
      const scopedDocs = docsForSearch;

      // Pre-fetch YouTube transcripts concurrently (up to maxTranscriptFetches)
      // instead of sequential await-in-loop inside the per-document scan
      if (allowContentSearch) {
        const youtubeDocsNeedingFetch: Document[] = [];
        for (const doc of scopedDocs) {
          if (youtubeDocsNeedingFetch.length >= maxTranscriptFetches) break;
          if (doc.fileType !== "youtube") continue;
          if (transcriptCacheRef.current.has(doc.id)) continue;
          if (transcriptFetchInFlightRef.current.has(doc.id)) continue;
          youtubeDocsNeedingFetch.push(doc);
        }
        if (youtubeDocsNeedingFetch.length > 0) {
          youtubeDocsNeedingFetch.forEach((doc) => transcriptFetchInFlightRef.current.add(doc.id));
          await Promise.allSettled(
            youtubeDocsNeedingFetch.map(async (doc) => {
              try {
                const videoId = extractYouTubeId(doc.filePath);
                if (!videoId) return;
                const segments = await fetchYouTubeTranscript(videoId);
                if (segments.length > 0) {
                  const text = buildTranscriptText(segments);
                  if (text) {
                    transcriptCacheRef.current.set(doc.id, { text, lower: text.toLowerCase() });
                  }
                }
              } catch (error) {
                console.warn("[CommandCenter] Failed to pre-fetch YouTube transcript", doc.id, error);
              } finally {
                transcriptFetchInFlightRef.current.delete(doc.id);
              }
            })
          );
        }
      }

      let scanned = 0;
      for (const doc of scopedDocs) {
        if (scanned >= maxDocsToScan || groupedDocs.size >= maxResults) break;
        scanned += 1;

        const titleLower = doc.title.toLowerCase();
        const titleMatch = matchesTerms(titleLower, searchTerms) || (!allowContentSearch && titleLower.includes(term)) || fuzzyMatches(titleLower);

        let content = doc.content ?? "";
        let contentLower = content.toLowerCase();
        if (doc.fileType === "html") {
          const htmlText = getHtmlText(doc);
          content = htmlText.text;
          contentLower = htmlText.lower;
        }

        const contentMatch = !isWeb && allowContentSearch && matchesTerms(contentLower, searchTerms);

        const hits: SearchHit[] = [];

        // Transcript hits (YouTube) — read from cache; pre-fetched concurrently above
        let transcriptMatch = false;
        if (allowContentSearch && doc.fileType === "youtube" && groupedDocs.size < maxResults) {
          const cached = transcriptCacheRef.current.get(doc.id);
          let transcriptLower: string | null = cached?.lower ?? null;

          if (transcriptLower) {
            transcriptMatch = matchesTerms(transcriptLower, searchTerms);

            // Re-fetch segments for timestamp-level hits when we have a transcript match
            try {
              const videoId = extractYouTubeId(doc.filePath);
              if (videoId) {
                const segments = await fetchYouTubeTranscript(videoId);
                const matchingSegments = segments
                  .map((seg, idx) => ({ seg, idx }))
                  .filter(({ seg }) => {
                    const segLower = seg.text.toLowerCase();
                    return matchesTerms(segLower, searchTerms);
                  })
                  .slice(0, 6);

                matchingSegments.forEach(({ seg, idx }, i) => {
                  const { excerpt } = highlightSearchTerms(seg.text, query.query, 200);
                  hits.push({
                    id: `yt-hit-${doc.id}-${i}`,
                    location: {
                      kind: "youtube",
                      timeSeconds: seg.start,
                      segmentId: `seg-${idx}`,
                      textQuote: seg.text,
                    },
                    label: formatTimestamp(seg.start),
                    excerptHtml: excerpt,
                  });
                });
              }
            } catch (error) {
              console.warn("[CommandCenter] Failed to fetch YouTube segments for hits", doc.id, error);
            }
          }
        }

        // Transcript hits (local audio)
        if (allowContentSearch && doc.fileType === "audio" && groupedDocs.size < maxResults) {
          let segments = audioTranscriptCacheRef.current.get(doc.id) ?? readStoredAudioTranscript(doc.id);
          if (segments.length > 0) {
            audioTranscriptCacheRef.current.set(doc.id, segments);
          } else {
            segments = await readWhisperTranscript(doc.id);
            if (segments.length > 0) {
              audioTranscriptCacheRef.current.set(doc.id, segments);
            }
          }

          if (segments.length > 0) {
            const transcriptText = segments.map((segment) => segment.text).join(" ");
            const transcriptLower = transcriptText.toLowerCase();
            transcriptMatch = matchesTerms(transcriptLower, searchTerms);

            const matchingSegments = segments
              .filter((segment) => matchesTerms(segment.text.toLowerCase(), searchTerms))
              .slice(0, 6);

            matchingSegments.forEach((segment, i) => {
              const { excerpt } = highlightSearchTerms(segment.text, query.query, 200);
              hits.push({
                id: `audio-hit-${doc.id}-${i}`,
                location: {
                  kind: "audio",
                  timeSeconds: segment.startSeconds,
                  segmentId: segment.id,
                  textQuote: segment.text,
                },
                label: formatTimestamp(segment.startSeconds),
                excerptHtml: excerpt,
              });
            });
          }
        }

        // Text hits (EPUB): preserve document-order match indexes so secondary
        // match clicks navigate to the selected quote, not the first occurrence.
        if (allowContentSearch && doc.fileType === "epub") {
          const epubOccurrences = searchTerms
            .flatMap((t) => findAllOccurrences(contentLower, t, 50).map((index) => ({ term: t, index })))
            .sort((a, b) => a.index - b.index)
            .filter((occurrence, index, list) =>
              index === 0 || occurrence.index !== list[index - 1].index
            );

          epubOccurrences.slice(0, 6).forEach(({ term, index }, matchIndex) => {
            hits.push({
              id: `hit-${doc.id}-${term}-${index}`,
              location: {
                kind: "epub",
                cfi: "",
                textQuote: quoteContextFromIndex(content, index, term),
                matchIndex,
              },
              label: "EPUB",
              excerptHtml: excerptFromIndex(content, index, query.query),
            });
          });
        }

        // Text hits (PDF/HTML/Markdown/etc)
        if (allowContentSearch && doc.fileType !== "youtube" && doc.fileType !== "audio") {
          for (const t of searchTerms) {
            if (hits.length >= 6) break;
            const occ = findAllOccurrences(contentLower, t, 6 - hits.length);
            occ.forEach((index, _occIndex) => {
              if (doc.fileType === "pdf") {
                const pageNum = buildPdfPageFromIndex(doc, index, Math.max(1, contentLower.length));
                hits.push({
                  id: `hit-${doc.id}-${t}-${index}`,
                  location: {
                    kind: "pdf",
                    pageNumber: pageNum,
                    textQuote: exactQuoteFromIndex(content, index, t),
                    textOffsetHint: index,
                  },
                  label: `Page ${pageNum}`,
                  excerptHtml: excerptFromIndex(content, index, query.query),
                });
              } else if (doc.fileType === "epub") {
                return;
              } else if (doc.fileType === "html") {
                const pct = clamp(Math.round((index / Math.max(1, contentLower.length)) * 100), 0, 100);
                hits.push({
                  id: `hit-${doc.id}-${t}-${index}`,
                  location: {
                    kind: "html",
                    scrollPercent: pct,
                    textQuote: exactQuoteFromIndex(content, index, t),
                  },
                  label: `${pct}%`,
                  excerptHtml: excerptFromIndex(content, index, query.query),
                });
              } else if (doc.fileType === "markdown") {
                const pct = clamp(Math.round((index / Math.max(1, contentLower.length)) * 100), 0, 100);
                hits.push({
                  id: `hit-${doc.id}-${t}-${index}`,
                  location: {
                    kind: "markdown",
                    scrollPercent: pct,
                    textQuote: exactQuoteFromIndex(content, index, t),
                  },
                  label: `${pct}%`,
                  excerptHtml: excerptFromIndex(content, index, query.query),
                });
              } else {
                const pct = clamp(Math.round((index / Math.max(1, contentLower.length)) * 100), 0, 100);
                hits.push({
                  id: `hit-${doc.id}-${t}-${index}`,
                  location: {
                    kind: "html",
                    scrollPercent: pct,
                    textQuote: exactQuoteFromIndex(content, index, t),
                  },
                  label: `${pct}%`,
                  excerptHtml: excerptFromIndex(content, index, query.query),
                });
              }
            });
          }
        }

        const isMatch = titleMatch || contentMatch || transcriptMatch || hits.length > 0;
        if (!isMatch) continue;

        const score = calculateRelevanceScore(
          { title: doc.title, content: content },
          query.query,
          SearchResultType.Document
        ) / 100;

        groupedDocs.set(doc.id, {
          doc,
          score,
          transcriptMatch,
          hits,
        });
      }
    }

    // 3. Search Extracts and attach as secondary hits to their parent document.
    if (!query.types || query.types.includes(SearchResultType.Extract)) {
      let scanned = 0;
      for (const extract of exts) {
        if (scanned >= maxExtractsToScan) break;
        scanned += 1;

        const content = extract.content ?? "";
        const contentLower = content.toLowerCase();
        if (!allowContentSearch || !matchesTerms(contentLower, searchTerms)) continue;

        const docId = extract.documentId;
        const parentDoc = docs.find((d) => d.id === docId);
        if (!parentDoc) continue;

        if (!groupedDocs.has(docId) && groupedDocs.size < maxResults) {
          groupedDocs.set(docId, { doc: parentDoc, score: 0.5, hits: [], transcriptMatch: false });
        }

        const entry = groupedDocs.get(docId);
        if (!entry) continue;

        const { excerpt } = highlightSearchTerms(content, query.query, 200);
        const pageNum = extract.pageNumber && extract.pageNumber > 0 ? extract.pageNumber : 1;
        entry.hits.push({
          id: `extract-hit-${extract.id}`,
          location: {
            kind: "pdf",
            pageNumber: pageNum,
            textQuote: query.query.trim() || undefined,
          },
          label: `Page ${pageNum}`,
          excerptHtml: excerpt,
        });
      }
    }

    // Materialize grouped results: one row per document.
    groupedDocs.forEach((entry) => {
      const doc = entry.doc;
      const sortedHits = entry.hits.slice(0);

      // Prefer timestamped transcript hits first, then extract hits, then others.
      sortedHits.sort((a, b) => {
        const ak = a.location.kind;
        const bk = b.location.kind;
        const pri = (k: string) => k === "youtube" || k === "audio" ? 0 : k === "pdf" ? 1 : 2;
        return pri(ak) - pri(bk);
      });

      const primaryHit = sortedHits[0];
      const secondaryHits = sortedHits.slice(1, 6);

      results.push({
        id: doc.id,
        type: SearchResultType.Document,
        title: doc.title,
        excerpt: primaryHit?.excerptHtml
          ? (entry.transcriptMatch ? `Transcript — ${primaryHit.excerptHtml}` : primaryHit.excerptHtml)
          : undefined,
        highlights: [],
        score: entry.score,
        metadata: {
          documentId: doc.id,
          fileType: doc.fileType,
          category: doc.category,
          tags: doc.tags ?? [],
          transcriptMatch: entry.transcriptMatch,
          highlightQuery: query.query,
          primaryHit,
          secondaryHits: secondaryHits.length > 0 ? secondaryHits : undefined,
        },
      });
    });

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }, [loadExtracts, activeDeck, shouldFilterByDeck, theme.id, theme.name, theme.variant, themes, setTheme, activeCollectionId, t, savedQueues, savedQueueLoading, savedQueueError, paletteSelection]);

  const handleResultClick = useCallback((result: SearchResult) => {
    if (result.metadata?.resultKind === "rss-article") {
      const articleId = result.metadata.articleId;
      useRssStudyStore.getState().setActiveArticleToView(articleId);
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/rss" }));
      return;
    }

    if (result.metadata?.resultKind === "podcast-episode") {
      const feedId = result.metadata.feedId;
      const episodeId = result.metadata.episodeId;
      const primaryHit = result.metadata.primaryHit;
      const location = primaryHit?.location;
      const seekTime = (location && (location.kind === "audio" || location.kind === "youtube"))
        ? location.timeSeconds
        : 0;

      window.dispatchEvent(new CustomEvent("play-podcast-episode", {
        detail: { feedId, episodeId, seekTime }
      }));
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/podcast" }));
      return;
    }

    if (result.metadata?.resultKind === "contextual-action") {
      const view = result.metadata.contextualView;
      const actionId = result.metadata.contextualActionId;
      if (view && actionId) {
        // Close the palette first so the view (newly uncovered) can take focus
        // — e.g. to focus a search input or receive a highlight selection.
        useUIStore.getState().setCommandPaletteOpen(false);
        dispatchPaletteAction(view, actionId as ViewActionId);
      }
      return;
    }

    if (result.metadata?.resultKind === "learning-item") {
      const cardId = result.metadata.cardId;
      useUIStore.getState().setCommandPaletteOpen(false);
      if (cardId) {
        // Same pending-card handoff the assistant/chat card links use: the
        // review tab opens Deck Manager with the real card selected.
        sessionStorage.setItem("plethora:pending-flashcard-id", cardId);
        window.dispatchEvent(new CustomEvent("plethora:open-flashcard", { detail: { cardId } }));
      }
      return;
    }

    if (result.metadata?.resultKind === "help-article") {
      useUIStore.getState().setCommandPaletteOpen(false);
      const action = result.metadata.action;
      if (typeof action === "function") {
        action();
      } else if (result.metadata.sectionId) {
        setHelpViewerDocId(result.metadata.sectionId);
      }
      return;
    }

    if (result.metadata?.resultKind === "ask-plethora") {
      useUIStore.getState().setCommandPaletteOpen(false);
      const action = result.metadata.action;
      if (typeof action === "function") {
        action();
      }
      return;
    }

    if (result.type === SearchResultType.Command) {
      const action = result.metadata?.action;
      if (typeof action === 'function') {
        void executeCommand({ id: result.id.replace(/^cmd-/, ""), label: result.title, action });
      }
    } else if (result.type === SearchResultType.Document || result.type === SearchResultType.Extract) {
      const docId = result.type === SearchResultType.Extract ? result.metadata?.documentId : result.id;
      if (!docId) return;
      openDocumentInTab(docId, {
        highlightQuery: result.metadata?.highlightQuery,
        initialJump: result.metadata?.primaryHit?.location,
      });
    }
  }, [addTab]);

  useEffect(() => {
    return registerCommandPaletteOpenEvents(
      setCommandPaletteOpen,
      () => useUIStore.getState().commandPaletteOpen
    );
  }, [setCommandPaletteOpen]);

  /* ----------------------------------------------------------------------- */
  /* Hub controller handed to the palette shell                              */
  /* ----------------------------------------------------------------------- */

  const hubController = useMemo<PaletteHubController>(() => {
    const selectedDocumentTitle = resolveActivePaletteView(documents).documentTitle;
    const commands = buildCommandCatalogue({
      translate: t,
      theme,
      themes,
      setTheme,
      isWeb: !isTauri(),
      selectedDocumentTitle,
    });
    return {
      home: hubHome,
      commands,
      expandedExamples: deriveExpandedExamples(t),
      dispatch: executePaletteAction,
      onContextualAction: (view, actionId) => {
        // Close first so the newly uncovered view can take focus/deliver the
        // highlight, then dispatch to the active view's existing handler.
        useUIStore.getState().setCommandPaletteOpen(false);
        dispatchPaletteAction(view, actionId);
      },
      saveNote: saveNoteDraft,
    };
  }, [
    documents,
    savedQueues,
    savedQueueLoading,
    savedQueueError,
    paletteSelection,
    paletteRootPane,
    paletteNavigationPane,
    executePaletteAction,
    hubHome,
    saveNoteDraft,
    setTheme,
    t,
    theme,
    themes,
  ]);

  return (
    <>
      <GlobalSearch
        onSearch={handleSearch}
        onResultClick={handleResultClick}
        onNavigateToDocument={openDocumentInTab}
        hideTrigger={true}
        isOpen={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        controller={hubController}
      />
      {helpViewerDocId && (
        <Suspense fallback={null}>
          <HelpDocViewer
            initialDocId={helpViewerDocId}
            isOpen={!!helpViewerDocId}
            onClose={() => setHelpViewerDocId(null)}
          />
        </Suspense>
      )}
      {askPlethoraModalOpen && (
        <Suspense fallback={null}>
          <AskPlethoraModal
            isOpen={askPlethoraModalOpen}
            onClose={() => setAskPlethoraModalOpen(false)}
            initialQuery={askPlethoraInitialQuery}
            context={{
              activeView: "dashboard",
            }}
          />
        </Suspense>
      )}
    </>
  );
}
