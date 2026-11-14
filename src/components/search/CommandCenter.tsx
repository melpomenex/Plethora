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
import { extractSearchTerms, highlightSearchTerms } from "./SearchUtils";
import { getDocuments as fetchDocuments } from "../../api/documents";
import { paletteSearch } from "../../api/ftsSearch";
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
import { useTheme } from "../../contexts/ThemeContext";
import type { ExactSearchHitLocation, SearchHit } from "../../types/searchHit";
import { registerCommandPaletteOpenEvents } from "../../utils/commandPaletteEvents";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import { getSubscribedFeedsAuto, type FeedItem } from "../../api/rss";
import { useRssStudyStore } from "../../stores/rssStudyStore";
import { getSubscribedPodcasts, getPodcastEpisodes, getPodcastTranscript } from "../../api/podcast";
import {
  mapPaletteSearchItemToSearchResult,
  matchDocumentTitlesSync,
  mergeStageResults,
  searchInMemoryFallback,
  stripHtmlLight,
} from "../../commandPalette/paletteSearchAdapter";
import {
  actionMatchesQuery,
  getActionsForView,
  type ActionContext,
  type ContextualViewType,
  type ViewAction,
  type ViewActionId,
} from "../../commandPalette/contextualActions";
import { dispatchPaletteAction, getLiveContext } from "../../commandPalette/paletteActionEvents";
import { buildCommandRegistry, matchCommands, navigateTo } from "../../commandPalette/registry";
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

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

  // Pre-fetch RSS articles on open only in non-Tauri web mode; Tauri queries rss_articles_fts directly.
  useEffect(() => {
    if (isTauri()) return;
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

  const selectedDocumentTitle = useMemo(
    () => resolveActivePaletteView(documents).documentTitle,
    [documents, paletteRootPane, paletteNavigationPane]
  );

  const registryCommands = useMemo(
    () =>
      buildCommandRegistry({
        translate: t,
        theme,
        themes,
        setTheme,
        isWeb: !isTauri(),
        selectedDocumentTitle,
        savedQueues,
      }),
    [
      t,
      theme,
      themes,
      setTheme,
      selectedDocumentTitle,
      savedQueues,
      savedQueueLoading,
      savedQueueError,
      paletteSelection,
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
    const isWeb = !isTauri();
    if (isWeb && meaningfulTerms.length > 0 && !extractsLoadedRef.current) {
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

    const maxResults = 50;

    // Active-view resolution (shared by contextual actions and Stage A/B).
    const activeViewState = resolveActivePaletteView(docs);
    const contextualView = activeViewState.view;
    const contextualContext = activeViewState.context;
    const isRssView = contextualView === "rss";
    const isPodcastView = contextualView === "podcast";

    const contextualActions: ViewAction[] = contextualView
      ? getActionsForView(contextualView, { ...contextualContext, ...getLiveContext(contextualView) })
      : [];

    const buildContextualResults = (q: string): SearchResult[] => {
      if (!contextualView) return [];
      const matched = contextualActions.filter((a) => actionMatchesQuery(a, q));
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

    if (contextualView && contextualView !== "rss" && contextualView !== "podcast") {
      results.push(...buildContextualResults(query.query));
    }

    if (!term) return results;

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
      platform: "desktop-macos",
    };

    const rawQuery = query.query.trim();
    const intent = classifyPaletteInput(rawQuery, helpAppContext);

    if (intent.kind === "product_help" && intent.forcedPrefix) {
      const cleanQ = intent.query;
      const helpResults = defaultHelpRetrieval.search(cleanQ, { context: helpAppContext, limit: 6 });
      const matches: SearchResult[] = [
        {
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
        },
      ];

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

    const matchedContextualIds = new Set(
      contextualActions
        .filter((action) => actionMatchesQuery(action, query.query))
        .map((action) => action.id)
    );
    const commandMatches = matchCommands(registryCommands, query.query).filter(({ command }) =>
      !(command.suppressedByContextual ?? []).some((id) => matchedContextualIds.has(id))
    );
    const buildCommandResults = (): SearchResult[] =>
      commandMatches.map(({ command: cmd, score }) => ({
        id: `cmd-${cmd.id}`,
        type: SearchResultType.Command,
        title: cmd.label,
        excerpt: cmd.description,
        score,
        metadata: {
          action: cmd.action,
          resultKind: "command",
          shortcut: cmd.shortcut,
          scopes: cmd.scopes,
          intentId: cmd.intentId,
        },
      }));

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

    if (isRssView || isPodcastView) {
      results.push(...buildContextualResults(query.query));
    }
    results.push(...buildCommandResults());

    // Actions/Settings are pure command/destination catalogues.
    if (paletteScope === "actions" || paletteScope === "settings") {
      return filterResultsByScope(results, paletteScope)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

    // Native Tauri Stage B: delegate full-corpus search (documents, semantic chunks,
    // transcripts, extracts, RSS, podcasts, learning items) to SQLite FTS5 `palette_search`.
    if (isTauri()) {
      let backendItems: SearchResult[] = [];
      let backendError: unknown = null;
      try {
        if (paletteScope === "cards") {
          const [cardRes, extractRes] = await Promise.all([
            paletteSearch({
              query: query.query,
              scope: "cards",
              limit: maxResults,
              collectionId: activeCollectionId || undefined,
              categories: query.categories,
              tags: query.tags,
            }),
            paletteSearch({
              query: query.query,
              scope: "documents",
              resultTypes: ["extract"],
              limit: maxResults,
              collectionId: activeCollectionId || undefined,
              categories: query.categories,
              tags: query.tags,
            }),
          ]);
          const mappedCards = cardRes.items.map((item) =>
            mapPaletteSearchItemToSearchResult(item, query.query)
          );
          const mappedExtracts = extractRes.items.map((item) => {
            const converted = mapPaletteSearchItemToSearchResult(item, query.query);
            return {
              ...converted,
              metadata: {
                ...converted.metadata,
                scopes: ["documents" as const, "cards" as const],
              },
            };
          });
          backendItems = [...mappedCards, ...mappedExtracts];
        } else {
          const response = await paletteSearch({
            query: query.query,
            scope: paletteScope ?? "all",
            limit: maxResults,
            collectionId: activeCollectionId || undefined,
            categories: query.categories,
            tags: query.tags,
            resultTypes: query.types?.map((item) => String(item)),
          });
          backendItems = response.items.map((item) =>
            mapPaletteSearchItemToSearchResult(item, query.query)
          );
        }
      } catch (err) {
        backendError = err;
        console.warn("[CommandCenter] palette_search IPC failed", err);
      }

      if (backendError && results.length === 0) {
        throw backendError;
      }

      const titleMatches =
        paletteScope === "library" || paletteScope === "cards"
          ? []
          : matchDocumentTitlesSync(docs, query, {
              activeCollectionId,
              limit: 30,
            });
      const stageAWithTitles = mergeStageResults(results, titleMatches);
      const merged = mergeStageResults(stageAWithTitles, backendItems);
      return filterResultsByScope(merged, paletteScope)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

    // Web / non-Tauri fallback (also powers DOM tests without Rust backend)
    if (paletteScope === "library") {
      return filterResultsByScope(results, paletteScope)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

    if (isRssView) {
      try {
        const lowerQuery = query.query.toLowerCase().trim();
        let cachedArticles = rssArticlesCacheRef.current;
        if (cachedArticles.length === 0) {
          const feeds = await getSubscribedFeedsAuto();
          const cached: Array<{ item: FeedItem; feedId: string; feedTitle: string }> = [];
          feeds.forEach((feed) => {
            (feed.items || []).forEach((item) => {
              cached.push({ item, feedId: feed.id, feedTitle: feed.title });
            });
          });
          rssArticlesCacheRef.current = cached;
          cachedArticles = cached;
        }
        cachedArticles.forEach(({ item, feedId }) => {
          const title = item.title || "";
          const desc = stripHtmlLight(item.description || "");
          const content = stripHtmlLight(item.content || "");
          const titleMatch = title.toLowerCase().includes(lowerQuery);
          const descMatch = desc.toLowerCase().includes(lowerQuery);
          const contentMatch = content.toLowerCase().includes(lowerQuery);
          if (titleMatch || descMatch || contentMatch) {
            const score = titleMatch ? 0.9 : descMatch ? 0.7 : 0.5;
            const excerpt = desc.length > 150 ? desc.slice(0, 150) + "..." : desc;
            results.push({
              id: `rss-${item.id}`,
              type: SearchResultType.Document,
              title: item.title,
              excerpt: excerpt || "Read article",
              score,
              metadata: {
                resultKind: "rss-article",
                articleId: item.id,
                feedId,
                category: "RSS Article",
              },
            });
          }
        });
        return filterResultsByScope(results, paletteScope)
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
        const episodesLists = await Promise.all(
          podcasts.map((feed) => getPodcastEpisodes(feed.id, true).catch(() => []))
        );
        for (let fIdx = 0; fIdx < podcasts.length; fIdx++) {
          const feed = podcasts[fIdx];
          for (const ep of episodesLists[fIdx]) {
            const title = ep.title || "";
            const desc = stripHtmlLight(ep.description || "");
            const transcriptText = ep.transcriptText || "";
            const titleMatch = title.toLowerCase().includes(lowerQuery);
            const descMatch = desc.toLowerCase().includes(lowerQuery);
            const transcriptMatch = transcriptText.toLowerCase().includes(lowerQuery);
            if (titleMatch || descMatch || transcriptMatch) {
              const score = titleMatch ? 0.9 : descMatch ? 0.7 : 0.6;
              let excerpt = desc.length > 150 ? desc.slice(0, 150) + "..." : desc;
              let primaryHit: SearchHit | undefined;
              const secondaryHits: SearchHit[] = [];
              if (transcriptMatch) {
                try {
                  const transcriptData = await getPodcastTranscript(ep.id);
                  if (transcriptData?.segments) {
                    const matchingSegments = transcriptData.segments.filter((seg) =>
                      seg.text.toLowerCase().includes(lowerQuery)
                    );
                    matchingSegments.slice(0, 6).forEach((seg, sIdx) => {
                      const startSec = seg.start / 1000;
                      const label = formatTimestamp(startSec);
                      const { excerpt: marked } = highlightSearchTerms(seg.text, query.query, 200);
                      const hit: SearchHit = {
                        id: `pod-hit-${ep.id}-${sIdx}`,
                        location: {
                          kind: "audio",
                          timeSeconds: startSec,
                          textQuote: seg.text,
                        },
                        label,
                        excerptHtml: marked,
                      };
                      if (!primaryHit) primaryHit = hit;
                      else secondaryHits.push(hit);
                    });
                  }
                } catch (e) {
                  console.warn("[PodcastSearch] Failed to fetch transcript segments", ep.id, e);
                }
              }
              if (primaryHit) {
                excerpt = `Transcript match: ${primaryHit.excerptHtml}`;
              }
              results.push({
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
                },
              });
            }
          }
        }
        return filterResultsByScope(results, paletteScope)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);
      } catch (err) {
        console.error("Podcast search error:", err);
      }
    }

    if (paletteScope === "cards") {
      const cardMatches: SearchResult[] = [];
      try {
        if (!learningItemsPromiseRef.current) {
          learningItemsPromiseRef.current = getAllLearningItems().catch((error) => {
            learningItemsPromiseRef.current = null;
            console.warn("[CommandCenter] Failed to load learning items for Cards search", error);
            return [] as LearningItem[];
          });
        }
        const learningItems = await learningItemsPromiseRef.current;
        for (const item of learningItems) {
          if (cardMatches.length >= maxResults) break;
          if (item.is_suspended) continue;
          const question = (item.question ?? "").toLowerCase();
          const answer = (item.answer ?? "").toLowerCase();
          const cloze = (item.cloze_text ?? "").toLowerCase();
          const qMatch = matchesTerms(question, searchTerms);
          const aMatch = answer ? matchesTerms(answer, searchTerms) : false;
          const cMatch = cloze ? matchesTerms(cloze, searchTerms) : false;
          if (!qMatch && !aMatch && !cMatch) continue;
          const { excerpt } = highlightSearchTerms(item.question ?? "", query.query, 200);
          cardMatches.push({
            id: `card-${item.id}`,
            type: SearchResultType.Flashcard,
            title: item.question || t("palette.cardFallbackTitle"),
            excerpt,
            score: qMatch ? 0.9 : cMatch ? 0.8 : 0.7,
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

      const fallbackExtracts = await searchInMemoryFallback({
        documents: [],
        extracts: exts,
        query: { ...query, types: [SearchResultType.Extract] },
        activeCollectionId,
        limit: maxResults,
        allowContentSearch,
        isWeb,
      });
      return [...cardMatches, ...fallbackExtracts]
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    }

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

    const docFallbackResults = await searchInMemoryFallback({
      documents: docsForSearch,
      extracts: exts,
      query,
      activeCollectionId,
      limit: maxResults,
      allowContentSearch,
      isWeb,
    });

    const combined = mergeStageResults(results, docFallbackResults);
    return filterResultsByScope(combined, paletteScope)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }, [registryCommands, documentsLoading, activeCollectionId, t, openDocumentInTab]);

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

  const handleFastSearch = useCallback(
    (query: SearchQuery): SearchResult[] => {
      const term = query.query.trim().toLowerCase();
      const paletteScope = query.paletteScope;
      const maxResults = 50;
      const results: SearchResult[] = [];

      const activeViewState = resolveActivePaletteView(documentsRef.current);
      const contextualView = activeViewState.view;
      const contextualActions: ViewAction[] = contextualView
        ? getActionsForView(contextualView, {
            ...activeViewState.context,
            ...getLiveContext(contextualView),
          })
        : [];

      const buildContextualResults = (q: string): SearchResult[] => {
        if (!contextualView) return [];
        return contextualActions
          .filter((a) => actionMatchesQuery(a, q))
          .slice(0, 10)
          .map((action) => ({
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

      if (contextualView && contextualView !== "rss" && contextualView !== "podcast") {
        results.push(...buildContextualResults(query.query));
      }

      if (!term) return results;

      if (urlDetectorUtils.isTwitterURL(query.query.trim())) {
        const targetUrl = query.query.trim();
        const statusId = urlDetectorUtils.extractTwitterStatusID(targetUrl);
        const username = urlDetectorUtils.extractTwitterUsername(targetUrl);
        return [
          {
            id: `x-thread-${statusId || "action"}`,
            type: SearchResultType.Command,
            title: "X Thread: Open and analyze this thread",
            excerpt: username
              ? `Open thread by @${username} with summary and learning tools`
              : "Open and analyze thread in reader",
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

      const rawQuery = query.query.trim();
      const liveCtx = contextualView ? getLiveContext(contextualView) : {};
      const helpAppContext: Partial<HelpAppContext> = {
        activeView: contextualView || "dashboard",
        documentFormat: (liveCtx.viewerKind as any) || undefined,
        ttsActive: false,
        activeAlgorithm: "fsrs",
        platform: "desktop-macos",
      };
      const intent = classifyPaletteInput(rawQuery, helpAppContext);

      if (intent.kind === "product_help" && intent.forcedPrefix) {
        const cleanQ = intent.query;
        const helpResults = defaultHelpRetrieval.search(cleanQ, { context: helpAppContext, limit: 6 });
        const matches: SearchResult[] = [
          {
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
          },
        ];
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

      const matchedContextualIds = new Set(
        contextualActions
          .filter((action) => actionMatchesQuery(action, query.query))
          .map((action) => action.id)
      );
      const commandMatches = matchCommands(registryCommands, query.query).filter(({ command }) =>
        !(command.suppressedByContextual ?? []).some((id) => matchedContextualIds.has(id))
      );

      if (contextualView === "rss" || contextualView === "podcast") {
        results.push(...buildContextualResults(query.query));
      }

      commandMatches.forEach(({ command: cmd, score }) => {
        results.push({
          id: `cmd-${cmd.id}`,
          type: SearchResultType.Command,
          title: cmd.label,
          excerpt: cmd.description,
          score,
          metadata: {
            action: cmd.action,
            resultKind: "command",
            shortcut: cmd.shortcut,
            scopes: cmd.scopes,
            intentId: cmd.intentId,
          },
        });
      });

      if (
        paletteScope !== "actions" &&
        paletteScope !== "settings" &&
        paletteScope !== "library" &&
        paletteScope !== "cards"
      ) {
        const docs =
          documentsRef.current.length > 0
            ? documentsRef.current
            : documentsSnapshotRef.current;
        results.push(
          ...matchDocumentTitlesSync(docs, query, {
            activeCollectionId,
            limit: 30,
          })
        );
      }

      return filterResultsByScope(results, paletteScope)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
    },
    [registryCommands, activeCollectionId, openDocumentInTab]
  );

  const hubController = useMemo<PaletteHubController>(() => {
    return {
      home: hubHome,
      commands: registryCommands,
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
    registryCommands,
    savedQueues,
    savedQueueLoading,
    savedQueueError,
    paletteSelection,
    executePaletteAction,
    hubHome,
    saveNoteDraft,
    t,
  ]);

  return (
    <>
      <GlobalSearch
        onSearch={handleSearch}
        onSearchFast={handleFastSearch}
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
