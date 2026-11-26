import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  useTabsStore,
  useDashboardLayoutStore,
  isDefaultDashboardLayout,
  isDashboardWidgetId,
  DEFAULT_QUICK_ACTION_ORDER,
  type DashboardSectionId,
  type DashboardQuickActionId,
} from "../../stores";
import { useUIStore } from "../../stores/uiStore";
import { useDocumentStore } from "../../stores/documentStore";
import { useCollectionStore } from "../../stores/collectionStore";
import type { TabType } from "../../stores/tabsStore";
import { useI18n } from "../../lib/i18n";
import { formatRelativeTime } from "../../utils/relativeTime";
import { usePresentationMode } from "../../contexts/PresentationContext";
import { useIsActiveTab } from "../common/Tabs";
import { observeStartupSurface } from "../../lib/startupDiagnostics";
import { useStartupStore } from "../../stores/startupStore";
import { type DocumentWithProgress } from "../../types/position";
import type { StartupProgressItem } from "../../types/startup";
import {
  QueueTab,
  QueueScrollPage,
  ReviewTab,
  DocumentsTab,
  ContinueReadingTab,
  AnalyticsTab,
  SettingsTab,
  RSSReader,
  DocumentViewer,
  AudiobooksTab,
  ImportNeedsReviewTab,
  PodcastTab,
  ExtractsTab,
  DocumentQATab,
  NotebookLMTab,
  WebBrowserTab,
  NewsletterDirectoryTab,
  ImageRegistryTab,
  createCanonicalTab,
} from "./TabRegistry";
import { KnowledgeGraphPage } from "../../pages/KnowledgeGraphPage";
import { KnowledgeSpherePage } from "../../pages/KnowledgeSpherePage";
import { WebArticleImportDialog } from "../import/WebArticleImportDialog";
import { useQueueStore } from "../../stores/queueStore";
import { useReviewStore } from "../../stores/reviewStore";
import { usePlatformCapability } from "../../hooks/usePlatformCapability";
import { requestDestinationAction } from "../../commandPalette/destinationActions";
import { executeCommand } from "../../commandPalette/executeCommand";
import type { QueueItem } from "../../types/queue";
import { getDashboardStats, type DashboardStats } from "../../api/analytics";
import { getDueItems, submitReview, type LearningItem, type ReviewRating } from "../../api/review";
import { cardMutationCoordinator } from "../../api/learningItemMutationCoordinator";
import { reconcileScheduledReview } from "../../lib/reviewSync";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import { filterByDecks } from "../../utils/studyDecks";
import { getCaptureListingSource, type CaptureDocument } from "../../api/capture-activity";
import { useCaptureActivity } from "../../hooks/useCaptureActivity";
import { openDocumentAtLocation } from "../../utils/openDocumentAtLocation";
import { openExternal } from "../../lib/tauri";
import { validCaptureUrl } from "../../utils/captureSource";
import { useToast } from "../common/Toast";
import { useSurfaceMenu } from "../../hooks/useSurfaceMenu";
import { ContextMenu, ContextMenuItemType, type ContextMenuItem } from "../common/ContextMenu";
import { CaptureActivityCard } from "../analytics/CaptureActivityCard";
import { StudyPlansDashboardCard } from "../study-plans/StudyPlansDashboardCard";
import { SleepLearningDashboardCard } from "../health/SleepLearningDashboardCard";
import { TodaysHorizonBanner } from "../dashboard/TodaysHorizonBanner";
import { DashboardCustomizeSectionFrame } from "../dashboard/DashboardCustomizeSectionFrame";
import { QuickActionsPicker, type QuickActionCategory } from "../dashboard/QuickActionsPicker";
import { WidgetGalleryPanel } from "../dashboard/WidgetGalleryPanel";
import {
  DASHBOARD_WIDGET_CATALOG,
  FocusTimerWidget,
  StreakGoalsWidget,
  ScratchpadWidget,
  UpNextQueueWidget,
  SavedQueuesWidget,
  PinnedDocsWidget,
} from "../dashboard/widgets";
import { Button, IconButton } from "../md3";
import {
  QuickReviewWidget,
  formatLearningItemForQuickReview,
} from "../review/QuickReviewWidget";
import { ActionButton, FocusPanel, SummarySection } from "../common/UI";
import { AdaptiveContentHeader, SafeScrollContainer } from "../adaptive";
import { selectDailyFocus } from "./dashboardFocus";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsLeftRight,
  BookOpen,
  Bookmarks,
  Brain,
  CaretRight,
  ChartBar,
  Check,
  ChatDots,
  Command,
  Compass,
  Copy,
  DiceFive,
  Eye,
  EyeSlash,
  FileArrowUp,
  Files,
  FolderPlus,
  Gear,
  GraduationCap,
  Graph,
  Headphones,
  Image as ImageIcon,
  Lightning,
  Link as LinkIcon,
  Microphone,
  MoonStars,
  Newspaper,
  Planet,
  Plus,
  Rss,
  Scissors,
  Scroll,
  SlidersHorizontal,
  Sparkle,
  Stack,
  Target,
  Translate,
  TrendUp,
  Tray,
  X,
} from "@phosphor-icons/react";
import { cn } from "../../utils/cn";
import { t as translateRecentFeature } from "../../lib/i18n";


interface QuickAction {
  id: DashboardQuickActionId;
  title: string;
  description: string;
  category: Exclude<QuickActionCategory, "all">;
  shortcut?: string;
  icon: React.ElementType;
  iconBg: string;
  tabType?: TabType;
  tabTitle?: string;
  content?: React.ComponentType;
  closable?: boolean;
  primary?: boolean;
  onInvoke?: () => void;
}

// Zustand selectors must return a stable fallback while the startup snapshot
// is loading. A new `[]` on every getSnapshot call makes React think the store
// changed continuously and triggers React error #185 on slower WebViews.
const EMPTY_STARTUP_PROGRESS: StartupProgressItem[] = [];

export function DashboardTab() {
  const { t } = useI18n();
  const { addTab, addTabInBackground } = useTabsStore();
  const dashboardMenu = useSurfaceMenu("dashboard-surface-menu");
  const documents = useDocumentStore((state) => state.documents);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const activeDeckIds = useStudyDeckStore((s) => s.activeDeckIds);
  const studyDecks = useStudyDeckStore((s) => s.decks);
  const mode = usePresentationMode();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [dueLearningItems, setDueLearningItems] = useState<LearningItem[]>([]);
  const cardShownAtRef = useRef<number>(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isActiveTab = useIsActiveTab();
  const captureSource = getCaptureListingSource();
  const { activity, captures, reload: reloadCaptureActivity } = useCaptureActivity(isActiveTab, captureSource);
  const toast = useToast();
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [showQuickActionPicker, setShowQuickActionPicker] = useState(false);
  const [showWidgetGallery, setShowWidgetGallery] = useState(false);
  const [showUrlImportDialog, setShowUrlImportDialog] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [dragState, setDragState] = useState<{
    draggingId: DashboardSectionId;
    dropTargetId: DashboardSectionId | null;
    dropPosition: "before" | "after" | null;
    pointerId: number;
  } | null>(null);
  const sectionsContainerRef = useRef<HTMLDivElement>(null);
  const sectionOrder = useDashboardLayoutStore((s) => s.sectionOrder);
  const hiddenSections = useDashboardLayoutStore((s) => s.hiddenSections);
  const quickActionOrder = useDashboardLayoutStore((s) => s.quickActionOrder);
  const hiddenQuickActions = useDashboardLayoutStore((s) => s.hiddenQuickActions);
  const moveSection = useDashboardLayoutStore((s) => s.moveSection);
  const reorderSection = useDashboardLayoutStore((s) => s.reorderSection);
  const setSectionVisible = useDashboardLayoutStore((s) => s.setSectionVisible);
  const moveQuickAction = useDashboardLayoutStore((s) => s.moveQuickAction);
  const setQuickActionVisible = useDashboardLayoutStore((s) => s.setQuickActionVisible);
  const addQuickAction = useDashboardLayoutStore((s) => s.addQuickAction);
  const removeQuickAction = useDashboardLayoutStore((s) => s.removeQuickAction);
  const addWidget = useDashboardLayoutStore((s) => s.addWidget);
  const removeWidget = useDashboardLayoutStore((s) => s.removeWidget);
  const resetDashboardLayout = useDashboardLayoutStore((s) => s.resetToDefault);
  const openFilePickerAndImport = useDocumentStore((s) => s.openFilePickerAndImport);
  const queueFilterMode = useQueueStore((s) => s.queueFilterMode);
  const healthInsightsAvailable = usePlatformCapability("tab_learning_insights").available;
  const notebooklmAvailable = usePlatformCapability("tab_notebooklm").available;
  const isDefaultLayout = useMemo(
    () =>
      isDefaultDashboardLayout({
        sectionOrder,
        hiddenSections,
        quickActionOrder,
        hiddenQuickActions,
      }),
    [sectionOrder, hiddenSections, quickActionOrder, hiddenQuickActions],
  );
  const ensureStartup = useStartupStore((state) => state.ensureStartup);
  const startupLoadedForCollection = useRef<string | null>(null);
  const startupProgress = useStartupStore(
    (state) => state.snapshot?.continueReading ?? EMPTY_STARTUP_PROGRESS,
  );
  const resumableDocs = useMemo(
    () => startupProgress.filter((item) => item.progress > 0 && item.progress < 100).slice(0, 3),
    [startupProgress],
  );
  const hasResumableReading = resumableDocs.length > 0;

  useEffect(() => {
    if (isActiveTab && stats && !isLoading && !error) return observeStartupSurface({ surface: "dashboard" });
  }, [activeCollectionId, error, isActiveTab, isLoading, stats]);

  useEffect(() => {
    if (!isActiveTab) return;
    // The tab can remain mounted while its parent/store updates. Keep the
    // startup effect one-shot per collection once settled so loading stats
    // cannot create a render/effect feedback loop on slower WebViews, while
    // still retrying if the startup watchdog timed out (null snapshot).
    const startupKey = activeCollectionId || "default";
    if (startupLoadedForCollection.current === startupKey) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 3_000;

    const attempt = () => {
      if (cancelled) return;
      void ensureStartup("dashboard").then((snapshot) => {
        if (cancelled) return;
        const status = useStartupStore.getState().status;
        if (snapshot == null && status !== "ready" && status !== "error") {
          retryTimer = setTimeout(attempt, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15_000);
          return;
        }
        startupLoadedForCollection.current = startupKey;
        void loadStats();
        void loadDueQuickReviewItems();
      });
    };

    attempt();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [activeCollectionId, ensureStartup, isActiveTab]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  const loadDueQuickReviewItems = async () => {
    try {
      const items = await getDueItems(activeCollectionId ?? undefined);
      if (Array.isArray(items)) {
        const unsuspended = items.filter((item) => !item.is_suspended);
        setDueLearningItems(unsuspended);
        cardShownAtRef.current = Date.now();
      } else {
        setDueLearningItems([]);
      }
    } catch (err) {
      console.warn("Failed to load due items for dashboard quick review:", err);
      setDueLearningItems([]);
    }
  };

  const loadStats = async () => {
    try {
      setError(null);
      setIsLoading(true);
      const data = await getDashboardStats(activeCollectionId ?? undefined);
      setStats(data);
    } catch (error) {
      console.error("Failed to load dashboard stats:", error);
      setError(error instanceof Error ? error.message : t("dashboard.failedLoadAnalytics"));
    } finally {
      setIsLoading(false);
    }
  };

  const openCapture = async (document: CaptureDocument) => {
    if (!await openDocumentAtLocation(document.documentId, { ensureExists: true }, addTab)) {
      toast.error(t(captureSource === "share-target" ? "dashboard.sharedCaptures.openFailed" : "dashboard.browserSaves.openFailed"));
      void captures.reload();
    }
  };

  const openCaptureOriginal = async (document: CaptureDocument) => {
    const url = validCaptureUrl(document.sourceUrl);
    if (!url) return;
    try { await openExternal(url); } catch { toast.error(t(captureSource === "share-target" ? "dashboard.sharedCaptures.originalFailed" : "dashboard.browserSaves.originalFailed")); }
  };

  const openCaptureLibrary = () => {
    const data = { initialCaptureSource: captureSource, libraryScope: "all", captureViewRequest: Date.now() };
    const existing = useTabsStore.getState().tabs.find(tab => tab.type === "documents" && tab.data?.libraryScope === "all");
    if (existing) useTabsStore.getState().updateTab(existing.id, { data });
    addTab({ title: t("nav.documents"), icon: null, type: "documents", content: DocumentsTab, closable: true, data });
  };

  const openImportNeedsReview = () => {
    addTab({
      title: translateRecentFeature("i18nAudit.ui.import-needs-review.fba4f59c"),
      icon: null,
      type: "import-needs-review",
      content: ImportNeedsReviewTab,
      closable: true,
    });
  };

  const openQueueItem = async (item: QueueItem) => {
    if (item.itemType === "document") {
      addTab({
        title: item.documentTitle,
        icon: null,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId },
      });
      return;
    }
    if (item.itemType === "extract") {
      addTab({
        title: item.documentTitle,
        icon: null,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId, initialViewMode: "extracts" },
      });
      return;
    }
    if (item.itemType === "learning-item") {
      addTab({
        title: translateRecentFeature("tabs.review"),
        icon: null,
        type: "review",
        content: ReviewTab,
        closable: true,
      });
      if (item.learningItemId || item.id) {
        await useReviewStore.getState().startReviewAtItem(item.learningItemId || item.id);
      }
      return;
    }
    if (item.documentId) {
      addTab({
        title: item.documentTitle,
        icon: null,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId },
      });
    }
  };

  const handleImportFileAction = async () => {
    const imported = await openFilePickerAndImport();
    if (imported.length > 0) {
      addTab({
        title: imported[0].title,
        icon: null,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: imported[0].id },
      });
    }
  };

  const loadQueueByFilterMode = async () => {
    const { loadQueue, loadDueDocumentsOnly, loadDueQueueItems } = useQueueStore.getState();
    switch (queueFilterMode) {
      case "due-today":
        await loadDueDocumentsOnly();
        break;
      case "due-all":
        await loadDueQueueItems();
        break;
      case "all-items":
      case "new-only":
      default:
        await loadQueue();
        break;
    }
    const { filteredItems, items } = useQueueStore.getState();
    return filteredItems.length > 0 ? filteredItems : items;
  };

  const handleReadNextAction = async () => {
    try {
      const queueItems = await loadQueueByFilterMode();
      const nextItem = queueItems[0];
      if (!nextItem) {
        toast.info(t("toolbar.noItemsReady"), t("toolbar.noItemAvailable"));
        return;
      }
      await openQueueItem(nextItem);
    } catch (err) {
      toast.error(t("toolbar.readNextFailed"), err instanceof Error ? err.message : t("toolbar.couldNotOpenNext"));
    }
  };

  const handleRandomItemAction = async () => {
    try {
      const queueItems = await loadQueueByFilterMode();
      if (queueItems.length === 0) {
        toast.info(t("toolbar.noItemsReady"), t("toolbar.noItemAvailable"));
        return;
      }
      const randomItem = queueItems[Math.floor(Math.random() * queueItems.length)];
      await openQueueItem(randomItem);
    } catch (err) {
      toast.error(t("toolbar.randomItemFailed"), err instanceof Error ? err.message : t("toolbar.couldNotOpenRandom"));
    }
  };

  const quickActions: QuickAction[] = [
    {
      id: "continue-reading",
      title: t("continueReading.title"),
      description: t("dashboard.continueReading"),
      category: "media",
      shortcut: "Ctrl+2",
      icon: BookOpen,
      iconBg: "bg-primary/10 text-primary",
      tabType: "continue-reading",
      tabTitle: t("tabs.continueReading"),
      content: ContinueReadingTab,
      closable: true,
    },
    {
      id: "queue",
      title: t("dashboard.readingQueue"),
      description: t("dashboard.continueReading"),
      category: "study",
      shortcut: "Ctrl+3",
      icon: BookOpen,
      iconBg: "bg-blue-500/10 text-blue-500",
      tabType: "queue",
      tabTitle: t("nav.queue"),
      content: QueueTab,
      closable: true,
      primary: true,
    },
    {
      id: "review",
      title: t("dashboard.flashcards"),
      description: t("dashboard.reviewDueCards"),
      category: "study",
      icon: Brain,
      iconBg: "bg-purple-500/10 text-purple-500",
      tabType: "review",
      tabTitle: t("tabs.review"),
      content: ReviewTab,
      closable: true,
      primary: true,
    },
    {
      id: "documents",
      title: t("dashboard.library"),
      description: t("dashboard.browseDocuments"),
      category: "media",
      icon: Files,
      iconBg: "bg-green-500/10 text-green-500",
      tabType: "documents",
      tabTitle: t("nav.documents"),
      content: DocumentsTab,
      closable: true,
    },
    {
      id: "rss",
      title: t("dashboard.rssFeeds"),
      description: t("dashboard.latestArticles"),
      category: "media",
      icon: Rss,
      iconBg: "bg-orange-500/10 text-orange-500",
      tabType: "rss",
      tabTitle: t("tabs.rssFeeds"),
      content: RSSReader,
      closable: true,
    },
    {
      id: "audiobooks",
      title: translateRecentFeature("i18nAudit.ui.audiobooks.0104e6dd"),
      description: translateRecentFeature("i18nAudit.ui.manage-and-listen-to-audiobo.94d92d5b"),
      category: "media",
      icon: Headphones,
      iconBg: "bg-amber-500/10 text-amber-500",
      tabType: "audiobook",
      tabTitle: "Audiobooks",
      content: AudiobooksTab,
      closable: true,
    },
    {
      id: "analytics",
      title: t("dashboard.analytics"),
      description: t("dashboard.trackProgress"),
      category: "tools",
      icon: ChartBar,
      iconBg: "bg-cyan-500/10 text-cyan-500",
      tabType: "analytics",
      tabTitle: t("nav.analytics"),
      content: AnalyticsTab,
      closable: true,
    },
    {
      id: "settings",
      title: t("nav.settings"),
      description: t("dashboard.appPreferences"),
      category: "tools",
      shortcut: "Ctrl+,",
      icon: Gear,
      iconBg: "bg-slate-500/10 text-slate-500",
      tabType: "settings",
      tabTitle: t("nav.settings"),
      content: SettingsTab,
      closable: true,
    },
    // Toolbar actions
    {
      id: "import-file",
      title: t("toolbar.importFile"),
      description: "Import PDF, EPUB, or document",
      category: "import",
      shortcut: "Ctrl+O",
      icon: FileArrowUp,
      iconBg: "bg-indigo-500/10 text-indigo-500",
      onInvoke: () => void handleImportFileAction(),
    },
    {
      id: "import-url",
      title: t("toolbar.importUrl"),
      description: "Save a web article or URL",
      category: "import",
      shortcut: "Ctrl+Shift+O",
      icon: LinkIcon,
      iconBg: "bg-sky-500/10 text-sky-500",
      onInvoke: () => setShowUrlImportDialog(true),
    },
    {
      id: "read-next",
      title: t("toolbar.readNext"),
      description: "Open the next due item in queue",
      category: "study",
      icon: Bookmarks,
      iconBg: "bg-blue-500/10 text-blue-500",
      onInvoke: () => void handleReadNextAction(),
    },
    {
      id: "random-item",
      title: t("toolbar.randomItem"),
      description: "Jump into a random queued item",
      category: "study",
      icon: DiceFive,
      iconBg: "bg-fuchsia-500/10 text-fuchsia-500",
      onInvoke: () => void handleRandomItemAction(),
    },
    {
      id: "study-plans",
      title: t("studyPlans.title"),
      description: "Manage guided study plans",
      category: "study",
      icon: GraduationCap,
      iconBg: "bg-emerald-500/10 text-emerald-500",
      onInvoke: () => addTab(createCanonicalTab("study-plans")),
    },
    ...(healthInsightsAvailable
      ? [{
          id: "learning-insights" as const,
          title: t("health.learningInsights"),
          description: "Sleep & cognitive insights",
          category: "study" as const,
          icon: MoonStars,
          iconBg: "bg-violet-500/10 text-violet-500",
          onInvoke: () => addTab(createCanonicalTab("learning-insights")),
        }]
      : []),
    {
      id: "language-learning",
      title: t("languageLearning.title"),
      description: "Vocabulary & language practice",
      category: "study",
      icon: Translate,
      iconBg: "bg-teal-500/10 text-teal-500",
      onInvoke: () => addTab(createCanonicalTab("language-learning")),
    },
    {
      id: "podcast",
      title: t("toolbar.podcasts"),
      description: "Listen & transcribe podcasts",
      category: "media",
      icon: Microphone,
      iconBg: "bg-rose-500/10 text-rose-500",
      tabType: "podcast",
      tabTitle: translateRecentFeature("i18nAudit.ui.podcasts.8a64829c"),
      content: PodcastTab,
      closable: true,
    },
    {
      id: "saved-queues",
      title: t("savedQueues.title") || "Saved Queues",
      description: "Manage filtered reading queues",
      category: "study",
      icon: Bookmarks,
      iconBg: "bg-cyan-500/10 text-cyan-500",
      onInvoke: () => {
        void executeCommand({
          id: "manage-saved-queues",
          label: t("savedQueues.manageQueues"),
          action: () => requestDestinationAction({ destination: "queue", action: "manage" }),
        });
      },
    },
    {
      id: "knowledge-graph",
      title: t("toolbar.knowledgeGraph"),
      description: "Explore 2D concept connections",
      category: "knowledge",
      shortcut: "Ctrl+4",
      icon: Graph,
      iconBg: "bg-violet-500/10 text-violet-500",
      tabType: "knowledge-network",
      tabTitle: translateRecentFeature("i18nAudit.ui.knowledge-graph.94c23b23"),
      content: KnowledgeGraphPage,
      closable: true,
    },
    {
      id: "knowledge-sphere",
      title: t("toolbar.knowledgeSphere"),
      description: "Explore 3D knowledge sphere",
      category: "knowledge",
      shortcut: "Ctrl+5",
      icon: Planet,
      iconBg: "bg-indigo-500/10 text-indigo-500",
      tabType: "knowledge-sphere",
      tabTitle: translateRecentFeature("i18nAudit.ui.knowledge-sphere.77a508a6"),
      content: KnowledgeSpherePage,
      closable: true,
    },
    {
      id: "web-browser",
      title: t("toolbar.webBrowser"),
      description: "Browse & clip web pages",
      category: "media",
      shortcut: "Ctrl+6",
      icon: Compass,
      iconBg: "bg-blue-500/10 text-blue-500",
      tabType: "web-browser",
      tabTitle: translateRecentFeature("i18nAudit.ui.web-browser.e6cc7829"),
      content: WebBrowserTab,
      closable: true,
    },
    {
      id: "doc-qa",
      title: t("toolbar.documentQA"),
      description: "Ask AI about your documents",
      category: "knowledge",
      icon: ChatDots,
      iconBg: "bg-emerald-500/10 text-emerald-500",
      tabType: "doc-qa",
      tabTitle: translateRecentFeature("i18nAudit.ui.document-q-a.1e7a5150"),
      content: DocumentQATab,
      closable: true,
    },
    ...(notebooklmAvailable
      ? [{
          id: "notebooklm" as const,
          title: t("toolbar.notebooklm"),
          description: "Open NotebookLM workspace",
          category: "knowledge" as const,
          icon: Sparkle,
          iconBg: "bg-amber-500/10 text-amber-500",
          tabType: "notebooklm" as TabType,
          tabTitle: translateRecentFeature("i18nAudit.ui.notebooklm.32ae2995"),
          content: NotebookLMTab,
          closable: true,
        }]
      : []),
    {
      id: "extracts",
      title: t("toolbar.extracts"),
      description: "Browse all saved extracts",
      category: "knowledge",
      icon: Scissors,
      iconBg: "bg-pink-500/10 text-pink-500",
      tabType: "extracts",
      tabTitle: t("extractsTab.title"),
      content: ExtractsTab,
      closable: true,
    },
    {
      id: "command-palette",
      title: t("toolbar.commandPalette"),
      description: "Run any command or search",
      category: "tools",
      shortcut: "Ctrl+K",
      icon: Command,
      iconBg: "bg-slate-500/10 text-slate-500",
      onInvoke: () => useUIStore.getState().setCommandPaletteOpen(true),
    },
    {
      id: "workspace-switcher",
      title: t("workspace.switchWorkspace"),
      description: "Switch or manage workspaces",
      category: "tools",
      icon: ArrowsLeftRight,
      iconBg: "bg-slate-500/10 text-slate-500",
      onInvoke: () => window.dispatchEvent(new CustomEvent("open-workspace-switcher")),
    },
    // Extra dashboard actions
    {
      id: "scroll-mode",
      title: "Scroll Mode",
      description: "Feed-style incremental reading",
      category: "study",
      icon: Scroll,
      iconBg: "bg-violet-500/10 text-violet-500",
      tabType: "queue-scroll",
      tabTitle: "Scroll Mode",
      content: QueueScrollPage,
      closable: true,
    },
    {
      id: "newsletters",
      title: "Newsletters",
      description: "Browse newsletter directory",
      category: "media",
      icon: Newspaper,
      iconBg: "bg-orange-500/10 text-orange-500",
      tabType: "newsletter",
      tabTitle: "Newsletters",
      content: NewsletterDirectoryTab,
      closable: true,
    },
    {
      id: "image-registry",
      title: "Images",
      description: "View saved images & screenshots",
      category: "import",
      icon: ImageIcon,
      iconBg: "bg-teal-500/10 text-teal-500",
      tabType: "image-registry",
      tabTitle: "Images",
      content: ImageRegistryTab,
      closable: true,
    },
    {
      id: "import-needs-review",
      title: "Needs Review",
      description: "Triage captured & imported items",
      category: "import",
      icon: Tray,
      iconBg: "bg-amber-500/10 text-amber-500",
      tabType: "import-needs-review",
      tabTitle: translateRecentFeature("i18nAudit.ui.import-needs-review.fba4f59c"),
      content: ImportNeedsReviewTab,
      closable: true,
    },
    {
      id: "refresh-dashboard",
      title: "Refresh Dashboard",
      description: "Reload stats, due cards & captures",
      category: "tools",
      icon: ArrowClockwise,
      iconBg: "bg-sky-500/10 text-sky-500",
      onInvoke: () => refreshDashboard(),
    },
  ];

  const openTab = (action: QuickAction) => {
    if (action.onInvoke) {
      action.onInvoke();
      return;
    }
    if (!action.tabType || !action.content || !action.tabTitle) return;
    if (action.tabType === "queue") {
      // "Queue" can mean either the list view or Scroll Mode — reactivate
      // whichever was more recently active instead of always the list.
      const { getMostRecentTabOfTypes, findPaneContainingTab, setActiveTab } = useTabsStore.getState();
      const recentQueueTab = getMostRecentTabOfTypes(["queue", "queue-scroll"]);
      if (recentQueueTab) {
        const pane = findPaneContainingTab(recentQueueTab.id);
        if (pane) {
          setActiveTab(pane.id, recentQueueTab.id);
          return;
        }
      }
    }

    addTab({
      title: action.tabTitle,
      // TabBar derives the icon from `type` via getTabIcon(); this field is
      // kept for the store's ReactNode requirement but no longer rendered.
      icon: null,
      type: action.tabType,
      content: action.content,
      closable: action.closable ?? true,
    });
  };


  const importDocument = () => {
    const documentsAction = quickActions.find((action) => action.id === "documents")!;
    openTab(documentsAction);
    // DocumentsView owns the native/mobile picker. On a fresh installation it
    // is not mounted yet, so wait until React has committed the newly opened
    // library tab before asking it to import.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("import-document"));
    }, 100);
  };

  const openDocument = (doc: DocumentWithProgress) => {
    const full = documents.find((d) => d.id === doc.id);
    const fileType = full?.fileType;
    const icon = fileType === "pdf"
      ? "📕"
      : fileType === "epub"
        ? "📖"
        : fileType === "youtube"
          ? "📺"
          : fileType === "image"
            ? "🖼️"
            : "📄";

    addTab({
      title: doc.title,
      icon,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: { documentId: doc.id },
    });
  };

  const openSourceDocumentById = (documentId: string) => {
    const full = documents.find((d) => d.id === documentId);
    const title = full?.title || t("dashboardTab.untitled");
    const fileType = full?.fileType;
    const icon = fileType === "pdf"
      ? "📕"
      : fileType === "epub"
        ? "📖"
        : fileType === "youtube"
          ? "📺"
          : fileType === "image"
            ? "🖼️"
            : "📄";

    addTab({
      title,
      icon,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: { documentId },
    });
  };

  const quickReviewCards = useMemo(() => {
    const activeDecks = (activeDeckIds || [])
      .map((id) => (studyDecks || []).find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => d != null);
    const filteredItems =
      activeDecks.length > 0
        ? filterByDecks(dueLearningItems, activeDecks)
        : dueLearningItems;

    const sortedItems = [...filteredItems].sort((a, b) => {
      const aTs = a.due_date ? new Date(a.due_date).getTime() : 0;
      const bTs = b.due_date ? new Date(b.due_date).getTime() : 0;
      return (Number.isNaN(aTs) ? 0 : aTs) - (Number.isNaN(bTs) ? 0 : bTs);
    });

    return sortedItems.map((item) => formatLearningItemForQuickReview(item, documents));
  }, [dueLearningItems, activeDeckIds, studyDecks, documents]);

  const handleQuickRate = async (
    cardId: string,
    rating: "again" | "hard" | "good" | "easy"
  ) => {
    const ratingMap: Record<"again" | "hard" | "good" | "easy", ReviewRating> = {
      again: 1,
      hard: 2,
      good: 3,
      easy: 4,
    };
    const numericRating = ratingMap[rating];
    const elapsedSeconds = Math.max(
      1,
      Math.round((Date.now() - cardShownAtRef.current) / 1000)
    );
    cardShownAtRef.current = Date.now();

    const token = cardMutationCoordinator.acquireMutationToken(cardId, "rate");
    if (!token) {
      return;
    }

    try {
      const updated = await submitReview(cardId, numericRating, elapsedSeconds);
      token.release();
      if (updated) {
        reconcileScheduledReview(updated, { source: "quickReview" });
      }
      setStats((prev) =>
        prev
          ? {
              ...prev,
              cards_due_today: Math.max(0, (prev.cards_due_today ?? 1) - 1),
              reviews_today: (prev.reviews_today ?? 0) + 1,
              cards_reviewed_today: (prev.cards_reviewed_today ?? 0) + 1,
            }
          : prev
      );
      void loadStats();
    } catch (err) {
      token.rollback(err instanceof Error ? err : new Error(String(err)));
      console.error("Failed to submit quick review rating:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save review rating"
      );
      throw err;
    }
  };

  const focusKind = selectDailyFocus({
    cardsDue: stats?.cards_due_today ?? 0,
    dueDocuments: stats?.due_documents ?? 0,
    hasResumableReading,
    documentCount: stats?.total_documents ?? documents.length,
  });
  const focusAction = quickActions.find((action) => action.id === focusKind)!;

  const focusCount = focusAction.id === "review"
    ? stats?.cards_due_today ?? 0
    : focusAction.id === "queue"
      ? stats?.due_documents ?? 0
      : stats?.total_documents ?? documents.length;
  const FocusIcon = focusAction.icon;
  const hasNoDocuments = (stats?.total_documents ?? documents.length) === 0;

  const openTabInBackground = (action: QuickAction) => {
    if (!action.tabType || !action.content || !action.tabTitle) return;
    addTabInBackground({
      title: action.tabTitle,
      icon: null,
      type: action.tabType,
      content: action.content,
      closable: action.closable ?? true,
    });
  };

  const openDocumentInBackground = (doc: DocumentWithProgress) => {
    const full = documents.find((d) => d.id === doc.id);
    const fileType = full?.fileType;
    const icon = fileType === "pdf"
      ? "📕"
      : fileType === "epub"
        ? "📖"
        : fileType === "youtube"
          ? "📺"
          : fileType === "image"
            ? "🖼️"
            : "📄";

    addTabInBackground({
      title: doc.title,
      icon,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: { documentId: doc.id },
    });
  };

  const refreshDashboard = () => {
    void loadStats();
    void loadDueQuickReviewItems();
    reloadCaptureActivity();
  };

  const copyText = (text: string, errorLabel: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("contextMenu.copiedToClipboard")),
      () => toast.error(errorLabel),
    );
  };

  const buildSurfaceMenuItems = (): ContextMenuItem[] => [
    {
      id: "customize-dashboard",
      label: isCustomizing ? t("dashboard.customize.done") : t("dashboard.customize.contextMenu"),
      icon: <SlidersHorizontal className="h-4 w-4 text-primary" />,
      onClick: () => setIsCustomizing((prev) => !prev),
    },
    { id: "sep:0", type: ContextMenuItemType.Separator, label: "" },
    {
      id: "refresh-dashboard",
      label: t("contextMenu.refreshDashboard"),
      icon: <ArrowClockwise className="h-4 w-4 text-muted-foreground" />,
      onClick: refreshDashboard,
    },
    {
      id: "open-command-palette",
      label: t("contextMenu.openCommandPalette"),
      icon: <Command className="h-4 w-4 text-muted-foreground" />,
      onClick: () => useUIStore.getState().setCommandPaletteOpen(true),
    },
    { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
    {
      id: "import-document",
      label: t("contextMenu.importDocument"),
      icon: <FolderPlus className="h-4 w-4 text-muted-foreground" />,
      onClick: importDocument,
    },
    {
      id: "open-library",
      label: t("contextMenu.openInLibrary"),
      icon: <Files className="h-4 w-4 text-muted-foreground" />,
      onClick: () => openTab(quickActions.find((a) => a.id === "documents")!),
    },
    {
      id: "open-settings",
      label: t("nav.settings"),
      icon: <Gear className="h-4 w-4 text-muted-foreground" />,
      onClick: () => openTab(quickActions.find((a) => a.id === "settings")!),
    },
  ];

  const buildFocusPanelMenuItems = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: "open-focus",
        label: hasNoDocuments
          ? t("dashboard.import")
          : focusAction.id === "review"
            ? t("dashboard.startReview")
            : t("common.open"),
        icon: <FocusIcon className="h-4 w-4 text-primary" />,
        onClick: () => {
          if (hasNoDocuments) {
            importDocument();
          } else {
            openTab(focusAction);
          }
        },
      },
    ];
    if (!hasNoDocuments) {
      items.push({
        id: "open-focus-background",
        label: t("contextMenu.openInBackground"),
        icon: <ArrowSquareOut className="h-4 w-4 text-muted-foreground" />,
        onClick: () => openTabInBackground(focusAction),
      });
    }
    items.push(
      { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
      {
        id: "refresh-dashboard",
        label: t("contextMenu.refreshDashboard"),
        icon: <ArrowClockwise className="h-4 w-4 text-muted-foreground" />,
        onClick: refreshDashboard,
      },
    );
    return items;
  };

  const buildQuickActionMenuItems = (action: QuickAction): ContextMenuItem[] => {
    const ActionIcon = action.icon;
    const items: ContextMenuItem[] = [
      {
        id: "open",
        label: action.tabType ? t("contextMenu.open") : action.title,
        icon: <ActionIcon className="h-4 w-4 text-primary" />,
        onClick: () => openTab(action),
      },
    ];
    if (action.tabType && action.content) {
      items.push({
        id: "open-background",
        label: t("contextMenu.openInBackground"),
        icon: <ArrowSquareOut className="h-4 w-4 text-muted-foreground" />,
        onClick: () => openTabInBackground(action),
      });
    }
    if (action.id === "documents") {
      items.push(
        { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
        {
          id: "import-document",
          label: t("contextMenu.importDocument"),
          icon: <FolderPlus className="h-4 w-4 text-muted-foreground" />,
          onClick: importDocument,
        },
      );
    }
    return items;
  };

  const buildContinueReadingMenuItems = (doc: DocumentWithProgress): ContextMenuItem[] => [
    {
      id: "resume",
      label: t("continueReading.resume"),
      icon: <BookOpen className="h-4 w-4 text-primary" />,
      onClick: () => openDocument(doc),
    },
    {
      id: "open-background",
      label: t("contextMenu.openInBackground"),
      icon: <ArrowSquareOut className="h-4 w-4 text-muted-foreground" />,
      onClick: () => openDocumentInBackground(doc),
    },
    { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
    {
      id: "copy-title",
      label: t("contextMenu.copyTitle"),
      icon: <Copy className="h-4 w-4 text-muted-foreground" />,
      onClick: () => copyText(doc.title, t("contextMenu.copyTitle")),
    },
    {
      id: "open-library",
      label: t("contextMenu.openInLibrary"),
      icon: <Files className="h-4 w-4 text-muted-foreground" />,
      onClick: () => openTab(quickActions.find((a) => a.id === "documents")!),
    },
  ];

  const buildStatsCardMenuItems = (): ContextMenuItem[] => [
    {
      id: "view-analytics",
      label: t("contextMenu.viewAnalytics"),
      icon: <ChartBar className="h-4 w-4 text-primary" />,
      onClick: () => openTab(quickActions.find((a) => a.id === "analytics")!),
    },
    {
      id: "start-review",
      label: t("contextMenu.startReview"),
      icon: <Brain className="h-4 w-4 text-muted-foreground" />,
      onClick: () => openTab(quickActions.find((a) => a.id === "review")!),
    },
    { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
    {
      id: "refresh-stats",
      label: t("common.refresh"),
      icon: <ArrowClockwise className="h-4 w-4 text-muted-foreground" />,
      onClick: () => void loadStats(),
    },
  ];

  const buildStatTileMenuItems = (target: "documents" | "review" | "analytics"): ContextMenuItem[] => {
    const primary =
      target === "documents"
        ? {
            id: "open-library",
            label: t("contextMenu.openInLibrary"),
            icon: <Files className="h-4 w-4 text-primary" />,
            onClick: () => openTab(quickActions.find((a) => a.id === "documents")!),
          }
        : target === "review"
          ? {
              id: "start-review",
              label: t("contextMenu.startReview"),
              icon: <Brain className="h-4 w-4 text-primary" />,
              onClick: () => openTab(quickActions.find((a) => a.id === "review")!),
            }
          : {
              id: "view-analytics",
              label: t("contextMenu.viewAnalytics"),
              icon: <ChartBar className="h-4 w-4 text-primary" />,
              onClick: () => openTab(quickActions.find((a) => a.id === "analytics")!),
            };

    return [
      primary,
      { id: "sep:1", type: ContextMenuItemType.Separator, label: "" },
      {
        id: "refresh-stats",
        label: t("common.refresh"),
        icon: <ArrowClockwise className="h-4 w-4 text-muted-foreground" />,
        onClick: () => void loadStats(),
      },
    ];
  };

  const buildTipMenuItems = (): ContextMenuItem[] => [
    {
      id: "open-command-palette",
      label: t("contextMenu.openCommandPalette"),
      icon: <Command className="h-4 w-4 text-primary" />,
      onClick: () => useUIStore.getState().setCommandPaletteOpen(true),
    },
    {
      id: "copy-tip",
      label: t("contextMenu.copyTip"),
      icon: <Copy className="h-4 w-4 text-muted-foreground" />,
      onClick: () => copyText(t("dashboard.commandPaletteHint"), t("contextMenu.copyTip")),
    },
  ];

  const sectionLabels: Record<DashboardSectionId, string> = {
    focus: t("dashboard.customize.section.focus"),
    "quick-actions": t("dashboard.quickActions"),
    "continue-reading": t("continueReading.title"),
    "capture-activity": t("dashboard.captureActivity"),
    "todays-horizon": t("dashboard.customize.section.todaysHorizon"),
    "study-plans": t("dashboard.customize.section.studyPlans"),
    progress: t("dashboard.progress"),
    "quick-tip": t("dashboard.quickTip"),
    "quick-review": t("dashboard.customize.section.quickReview"),
    "widget-focus-timer": "Focus Timer",
    "widget-streak-goals": "Streak & Daily Goal",
    "widget-scratchpad": "Quick Scratchpad",
    "widget-up-next": "Up Next in Queue",
    "widget-saved-queues": "Saved Queues & Decks",
    "widget-pinned-docs": "Pinned Documents",
  };

  const quickActionMap = useMemo(
    () => new Map<DashboardQuickActionId, QuickAction>(quickActions.map((a) => [a.id as DashboardQuickActionId, a])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const orderedQuickActions = useMemo(
    () =>
      quickActionOrder
        .map((id) => quickActionMap.get(id))
        .filter((action): action is QuickAction => action != null),
    [quickActionOrder, quickActionMap],
  );

  const visibleQuickActions = useMemo(
    () => orderedQuickActions.filter((action) => !hiddenQuickActions.includes(action.id as DashboardQuickActionId)),
    [orderedQuickActions, hiddenQuickActions],
  );

  const visibleSectionsCount = sectionOrder.filter((id) => !hiddenSections.includes(id)).length;

  useEffect(() => {
    if (!isCustomizing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dragState) {
          setDragState(null);
          return;
        }
        if (!dashboardMenu.visible) {
          setIsCustomizing(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCustomizing, dragState, dashboardMenu.visible]);

  useEffect(() => {
    if (!dragState) return;
    const activeDrag = dragState;

    const resolveDropTarget = (clientY: number): { targetId: DashboardSectionId | null; position: "before" | "after" | null } => {
      const container = sectionsContainerRef.current;
      if (!container) return { targetId: null, position: null };
      const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-dashboard-section-id]"));
      for (const node of nodes) {
        const id = node.dataset.dashboardSectionId as DashboardSectionId | undefined;
        if (!id) continue;
        const rect = node.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (clientY < midY) {
          return id === activeDrag.draggingId ? { targetId: null, position: null } : { targetId: id, position: "before" };
        }
      }
      const last = nodes[nodes.length - 1];
      const lastId = last?.dataset.dashboardSectionId as DashboardSectionId | undefined;
      if (lastId && lastId !== activeDrag.draggingId) {
        return { targetId: lastId, position: "after" };
      }
      return { targetId: null, position: null };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activeDrag.pointerId) return;
      const { targetId, position } = resolveDropTarget(event.clientY);
      setDragState((prev) =>
        prev && prev.pointerId === event.pointerId
          ? { ...prev, dropTargetId: targetId, dropPosition: position }
          : prev,
      );
    };

    const finishDrag = (event: PointerEvent, commitDrop: boolean) => {
      if (event.pointerId !== activeDrag.pointerId) return;
      if (commitDrop && activeDrag.dropTargetId && activeDrag.dropPosition) {
        const currentIdx = sectionOrder.indexOf(activeDrag.draggingId);
        const targetIdx = sectionOrder.indexOf(activeDrag.dropTargetId);
        if (currentIdx !== -1 && targetIdx !== -1) {
          let insertIdx = activeDrag.dropPosition === "before" ? targetIdx : targetIdx + 1;
          if (currentIdx < insertIdx) insertIdx -= 1;
          if (insertIdx !== currentIdx) {
            reorderSection(activeDrag.draggingId, insertIdx);
            setLiveAnnouncement(
              t("dashboard.customize.moved", {
                section: sectionLabels[activeDrag.draggingId],
                position: insertIdx + 1,
                total: sectionOrder.length,
              }),
            );
          }
        }
      }
      setDragState(null);
    };

    const onPointerUp = (event: PointerEvent) => finishDrag(event, true);
    const onPointerCancel = (event: PointerEvent) => finishDrag(event, false);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [dragState, reorderSection, sectionLabels, sectionOrder, t]);

  const handleSectionDragStart = (sectionId: DashboardSectionId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ignore in test environments without full pointer capture support
    }
    setDragState({
      draggingId: sectionId,
      dropTargetId: null,
      dropPosition: null,
      pointerId: event.pointerId,
    });
  };

  const handleMoveSection = (sectionId: DashboardSectionId, direction: "up" | "down") => {
    const currentIdx = sectionOrder.indexOf(sectionId);
    const nextIdx = direction === "up" ? currentIdx - 1 : currentIdx + 1;
    if (nextIdx < 0 || nextIdx >= sectionOrder.length) return;
    moveSection(sectionId, direction);
    setLiveAnnouncement(
      t("dashboard.customize.moved", {
        section: sectionLabels[sectionId],
        position: nextIdx + 1,
        total: sectionOrder.length,
      }),
    );
  };

  const renderSectionBody = (sectionId: DashboardSectionId): ReactNode => {
    switch (sectionId) {
      case "focus":
        return (
          <FocusPanel
            className={isCustomizing ? "mb-0" : "mb-6 md:mb-8"}
            onContextMenu={(e) => dashboardMenu.openEvent(e, buildFocusPanelMenuItems())}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-primary">{t("dashboard.quickActions")}</p>
                <h2 className="mt-1 text-xl font-semibold text-foreground">
                  {hasNoDocuments
                    ? t("dashboard.importFirst")
                    : focusAction.id === "review"
                    ? t("dashboard.startReview")
                    : focusAction.id === "continue-reading"
                      ? t("continueReading.title")
                    : focusAction.id === "queue"
                      ? t("dashboard.continueReading")
                      : t("dashboard.browseDocuments")}
                </h2>
                <p className={error ? "mt-1 text-sm text-destructive" : "mt-1 text-sm text-muted-foreground"} role={error ? "alert" : undefined}>
                  {error
                    ? `${t("dashboard.failedLoadAnalytics")}: ${error}`
                    : isLoading
                    ? t("dashboard.loadingAnalytics")
                    : focusCount > 0
                      ? t("dashboard.due", { count: focusCount })
                      : t("dashboard.importFirst")}
                </p>
              </div>
              <ActionButton
                variant="primary"
                size="large"
                onClick={() => {
                  if (hasNoDocuments) {
                    importDocument();
                  } else {
                    openTab(focusAction);
                  }
                }}
              >
                <FocusIcon className="h-5 w-5" aria-hidden="true" />
                {hasNoDocuments ? t("dashboard.import") : focusAction.id === "review" ? t("dashboard.startReview") : t("common.open")}
              </ActionButton>
            </div>
          </FocusPanel>
        );

      case "quick-actions": {
        const actionsToRender = isCustomizing ? orderedQuickActions : visibleQuickActions;
        const defaultQuickActionSet = new Set<string>(DEFAULT_QUICK_ACTION_ORDER);
        return (
          <SummarySection title={t("dashboard.quickActions")}>
            {isCustomizing && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {visibleQuickActions.length === 0
                    ? t("dashboard.customize.quickAction.empty")
                    : `${visibleQuickActions.length} of ${orderedQuickActions.length} actions shown`}
                </p>
                <Button
                  type="button"
                  variant="tonal"
                  size="sm"
                  onClick={() => setShowQuickActionPicker((prev) => !prev)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {showQuickActionPicker ? "Hide Action Picker" : "Add Quick Action"}
                </Button>
              </div>
            )}
            <div className={cn("grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3 md:gap-4", !isCustomizing && "mb-6 md:mb-8")}>
              {actionsToRender.map((action, actionIndex) => {
                const Icon = action.icon;
                const actionId = action.id as DashboardQuickActionId;
                const isActionVisible = !hiddenQuickActions.includes(actionId);
                const isDefaultAction = defaultQuickActionSet.has(actionId);

                if (isCustomizing) {
                  return (
                    <div
                      key={action.id}
                      data-quick-action-id={action.id}
                      className={cn(
                        "flex min-h-[130px] flex-col justify-between rounded-xl border p-3 text-left transition-colors",
                        isActionVisible
                          ? "border-outline-variant bg-card"
                          : "border-dashed border-outline-variant/80 bg-muted/30 opacity-75",
                      )}
                    >
                      <div>
                        <div className="mb-2 flex items-center justify-between gap-1">
                          <div className={`${action.iconBg} rounded-lg p-2`}>
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setQuickActionVisible(actionId, !isActionVisible)}
                              aria-pressed={isActionVisible}
                              aria-label={t("dashboard.customize.quickAction.toggle", { action: action.title })}
                              className={cn(
                                "inline-flex min-h-8 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                isActionVisible
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-outline-variant bg-surface-container text-on-surface-variant",
                              )}
                            >
                              {isActionVisible ? (
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <EyeSlash className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>
                                {isActionVisible
                                  ? t("dashboard.customize.quickAction.visible")
                                  : t("dashboard.customize.quickAction.hidden")}
                              </span>
                            </button>
                            {!isDefaultAction && (
                              <button
                                type="button"
                                onClick={() => removeQuickAction(actionId)}
                                aria-label={`Remove ${action.title} from Quick Actions`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-destructive/10 hover:text-destructive"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                        <h3 className="line-clamp-1 text-xs font-semibold text-foreground">
                          {action.title}
                        </h3>
                      </div>

                      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                        <IconButton
                          type="button"
                          variant="standard"
                          size="sm"
                          icon={ArrowLeft}
                          aria-label={t("dashboard.customize.quickAction.moveLeft", { action: action.title })}
                          disabled={actionIndex === 0}
                          onClick={() => moveQuickAction(actionId, "left")}
                        />
                        <IconButton
                          type="button"
                          variant="standard"
                          size="sm"
                          icon={ArrowRight}
                          aria-label={t("dashboard.customize.quickAction.moveRight", { action: action.title })}
                          disabled={actionIndex === actionsToRender.length - 1}
                          onClick={() => moveQuickAction(actionId, "right")}
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    key={action.id}
                    onClick={() => openTab(action)}
                    onContextMenu={(e) => dashboardMenu.openEvent(e, buildQuickActionMenuItems(action))}
                    onKeyDown={(e) => dashboardMenu.handleRowKeyDown(e, () => buildQuickActionMenuItems(action))}
                    className="group relative flex min-h-[110px] md:min-h-[130px] flex-col items-start rounded-xl border border-border bg-card p-3 md:p-4 text-left transition-all hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div
                      className={`${action.iconBg} p-2 md:p-3 rounded-lg mb-2 md:mb-3 transition-transform group-hover:scale-110`}
                    >
                      <Icon className="w-4 h-4 md:w-5 md:h-5" />
                    </div>
                    <h3 className="font-semibold text-xs md:text-sm text-foreground mb-0.5 line-clamp-1">
                      {action.title}
                    </h3>
                    <p className="text-[10px] md:text-xs text-muted-foreground line-clamp-2 md:line-clamp-none">
                      {action.description}
                    </p>
                    {action.primary && stats && (
                      <div className="absolute top-2 right-2 md:top-3 md:right-3">
                        <div className="flex items-center gap-1 text-[10px] font-medium text-primary">
                          {action.id === "queue" && (stats.due_documents || stats.cards_due_today || 0) > 0 && (
                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {mode === "phone" ? (stats.due_documents || stats.cards_due_today || 0) : t("dashboard.due", { count: stats.due_documents || stats.cards_due_today || 0 })}
                            </span>
                          )}
                          {action.id === "review" && stats.cards_due_today > 0 && (
                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                              {mode === "phone" ? stats.cards_due_today : t("dashboard.due", { count: stats.cards_due_today })}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {isCustomizing && showQuickActionPicker && (
              <QuickActionsPicker
                catalog={quickActions.map((a) => ({
                  id: a.id,
                  title: a.title,
                  description: a.description,
                  category: a.category,
                  shortcut: a.shortcut,
                  icon: a.icon,
                  iconBg: a.iconBg,
                  isDefault: (DEFAULT_QUICK_ACTION_ORDER as readonly string[]).includes(a.id),
                }))}
                activeOrder={quickActionOrder}
                hiddenIds={hiddenQuickActions}
                onAdd={(id) => addQuickAction(id)}
                onRemove={(id) => removeQuickAction(id)}
                onClose={() => setShowQuickActionPicker(false)}
              />
            )}
          </SummarySection>
        );
      }

      case "continue-reading":
        if (!hasResumableReading || resumableDocs.length === 0) {
          if (!isCustomizing) return null;
          return (
            <p className="text-sm text-muted-foreground">
              {t("dashboard.continueReading")}
            </p>
          );
        }
        return (
          <SummarySection title={t("continueReading.title")}>
            <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4", !isCustomizing && "mb-6 md:mb-8")}>
              {resumableDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => openDocument(doc)}
                  onContextMenu={(e) => dashboardMenu.openEvent(e, buildContinueReadingMenuItems(doc))}
                  onKeyDown={(e) => dashboardMenu.handleRowKeyDown(e, () => buildContinueReadingMenuItems(doc))}
                  className="group text-left p-4 bg-card rounded-xl border border-border transition-all hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary flex flex-col justify-between min-h-[110px]"
                >
                  <div className="flex items-start justify-between gap-2 mb-2 w-full">
                    <h4 className="font-semibold text-xs md:text-sm text-foreground line-clamp-2 flex-1 group-hover:text-primary transition-colors">
                      {doc.title}
                    </h4>
                    <span
                      className="text-[10px] text-muted-foreground whitespace-nowrap"
                      title={t("continueReading.lastUpdated", {
                        relative: formatRelativeTime(doc.date_modified),
                      })}
                      aria-label={t("continueReading.lastUpdated", {
                        relative: formatRelativeTime(doc.date_modified),
                      })}
                    >
                      {formatRelativeTime(doc.date_modified)}
                    </span>
                  </div>
                  <div className="w-full space-y-1.5 mt-auto">
                    <div className="relative h-1.5 bg-muted rounded-full overflow-hidden w-full">
                      <div
                        className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.min(doc.progress, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{Math.round(doc.progress)}% {t("continueReading.complete")}</span>
                      <span className="text-primary font-medium group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                        {t("continueReading.resume")} →
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </SummarySection>
        );

      case "capture-activity":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <CaptureActivityCard
              data={activity.data}
              isLoading={activity.isLoading}
              error={activity.error}
              onRetry={reloadCaptureActivity}
              captureShelf={{ ...captures, source: captureSource, onRetry: captures.reload, onOpen: document => void openCapture(document), onOpenOriginal: document => void openCaptureOriginal(document), onViewAll: openCaptureLibrary }}
              onOpenNeedsReview={openImportNeedsReview}
            />
          </div>
        );

      case "todays-horizon":
        return (
          <TodaysHorizonBanner
            activePlansCount={0}
            pendingAssessmentsCount={0}
            dueReviewsCount={stats?.cards_due_today ?? 0}
            highPriorityExtractsCount={stats?.due_documents ?? 0}
            unreadDiscoveryCount={resumableDocs.length}
            onResumeMilestone={() => {
              const studyPlansSection = document.querySelector('[data-study-plans-card="true"]');
              studyPlansSection?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onLaunchQueue={() => {
              const queueAction = quickActions.find((a) => a.id === "queue");
              if (queueAction) openTab(queueAction);
            }}
          />
        );

      case "study-plans":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"} data-study-plans-card="true">
            <StudyPlansDashboardCard />
          </div>
        );

      case "progress":
        return (
          <SummarySection title={t("dashboard.progress")}>
            <div className={cn("grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6", !isCustomizing && "mb-6 md:mb-8")}>
              {/* Main Stats Card */}
              <div
                onContextMenu={(e) => dashboardMenu.openEvent(e, buildStatsCardMenuItems())}
                className="md:col-span-2 border border-border rounded-xl p-4 md:p-6"
              >
                <div className="flex items-center justify-between mb-4 md:mb-6">
                  <div className="flex items-center gap-2">
                    <TrendUp className="w-5 h-5 text-muted-foreground" />
                    <h2 className="text-lg md:text-xl font-semibold text-foreground">
                      {t("dashboard.yourProgress")}
                    </h2>
                  </div>
                  <button
                    onClick={() => openTab(quickActions.find(a => a.id === "analytics")!)}
                    className="text-xs md:text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                  >
                    {t("dashboard.viewAll")}
                    <CaretRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-4 md:gap-6">
                  <div
                    onContextMenu={(e) => dashboardMenu.openEvent(e, buildStatTileMenuItems("documents"))}
                    className="text-center md:text-left flex flex-col items-center md:items-start p-2 bg-muted/20 rounded-lg md:bg-transparent md:p-0"
                  >
                    <div className="flex items-center justify-center md:justify-start gap-1.5 mb-1 text-muted-foreground w-full">
                      <Files className="w-3.5 h-3.5 md:w-4 md:h-4 text-muted-foreground" />
                      <span className="text-[10px] sm:text-xs md:text-sm font-medium line-clamp-1">
                        {t("dashboard.documents")}
                      </span>
                    </div>
                    <span className="text-lg sm:text-2xl md:text-3xl font-bold text-foreground">
                      {isLoading ? (
                        <span className="animate-pulse">...</span>
                      ) : (
                        stats?.total_documents ?? 0
                      )}
                    </span>
                  </div>

                  <div
                    onContextMenu={(e) => dashboardMenu.openEvent(e, buildStatTileMenuItems("review"))}
                    className="text-center md:text-left flex flex-col items-center md:items-start p-2 bg-muted/20 rounded-lg md:bg-transparent md:p-0"
                  >
                    <div className="flex items-center justify-center md:justify-start gap-1.5 mb-1 text-muted-foreground w-full">
                      <Target className="w-3.5 h-3.5 md:w-4 md:h-4 text-muted-foreground" />
                      <span className="text-[10px] sm:text-xs md:text-sm font-medium line-clamp-1">
                        {t("layout.dueToday")}
                      </span>
                    </div>
                    <span className="text-lg sm:text-2xl md:text-3xl font-bold text-foreground">
                      {isLoading ? (
                        <span className="animate-pulse">...</span>
                      ) : (
                        stats?.cards_due_today ?? 0
                      )}
                    </span>
                  </div>

                  <div
                    onContextMenu={(e) => dashboardMenu.openEvent(e, buildStatTileMenuItems("analytics"))}
                    className="text-center md:text-left flex flex-col items-center md:items-start p-2 bg-muted/20 rounded-lg md:bg-transparent md:p-0"
                  >
                    <div className="flex items-center justify-center md:justify-start gap-1.5 mb-1 text-muted-foreground w-full">
                      <Lightning className="w-3.5 h-3.5 md:w-4 md:h-4 text-muted-foreground" />
                      <span className="text-[10px] sm:text-xs md:text-sm font-medium line-clamp-1">
                        {t("dashboard.cardsLearned")}
                      </span>
                    </div>
                    <span className="text-lg sm:text-2xl md:text-3xl font-bold text-foreground">
                      {isLoading ? (
                        <span className="animate-pulse">...</span>
                      ) : (
                        stats?.cards_learned ?? 0
                      )}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-4 md:mt-6 pt-4 md:pt-6 border-t border-border">
                  <div className="flex items-center justify-between text-xs md:text-sm mb-2">
                    <span className="text-muted-foreground">{t("dashboard.dailyGoalProgress")}</span>
                    <span className="font-medium text-foreground">
                      {Math.min(
                        100,
                        Math.round(
                          ((stats?.reviews_today || stats?.cards_reviewed_today || 0) /
                            Math.max(1, stats?.daily_goal || 20)) *
                            100
                        )
                      )}
                      %
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((stats?.reviews_today || stats?.cards_reviewed_today || 0) /
                              Math.max(1, stats?.daily_goal || 20)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <SleepLearningDashboardCard />
            </div>
          </SummarySection>
        );

      case "quick-tip":
        return (
          <div
            onContextMenu={(e) => dashboardMenu.openEvent(e, buildTipMenuItems())}
            className={cn("p-4 md:p-5 bg-muted/50 border border-border rounded-xl", !isCustomizing && "mb-6 md:mb-8")}
          >
            <h3 className="font-medium text-sm text-foreground mb-2">
              💡 {t("dashboard.quickTip")}
            </h3>
            <p className="text-xs md:text-sm text-muted-foreground">
              {t("dashboard.commandPaletteHint")}
            </p>
          </div>
        );

      case "quick-review":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <QuickReviewWidget
              cards={quickReviewCards}
              onRate={handleQuickRate}
              onOpenDocument={openSourceDocumentById}
              onExpand={() => {
                const reviewAction = quickActions.find((action) => action.id === "review");
                if (reviewAction) openTab(reviewAction);
              }}
              maxCards={5}
            />
          </div>
        );

      case "widget-focus-timer":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <FocusTimerWidget />
          </div>
        );

      case "widget-streak-goals":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <StreakGoalsWidget
              stats={stats}
              isLoading={isLoading}
              onStartReview={() => openTab(quickActions.find((a) => a.id === "review")!)}
              onOpenAnalytics={() => openTab(quickActions.find((a) => a.id === "analytics")!)}
            />
          </div>
        );

      case "widget-scratchpad":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <ScratchpadWidget />
          </div>
        );

      case "widget-up-next":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <UpNextQueueWidget
              onOpenQueue={() => openTab(quickActions.find((a) => a.id === "queue")!)}
              onOpenScrollMode={() => openTab(quickActions.find((a) => a.id === "scroll-mode")!)}
              onOpenItem={(item) => void openQueueItem(item)}
            />
          </div>
        );

      case "widget-saved-queues":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <SavedQueuesWidget
              onOpenQueue={() => openTab(quickActions.find((a) => a.id === "queue")!)}
            />
          </div>
        );

      case "widget-pinned-docs":
        return (
          <div className={isCustomizing ? "" : "mb-6 md:mb-8"}>
            <PinnedDocsWidget onOpenDocument={openSourceDocumentById} />
          </div>
        );
    }
  };

  return (
    <SafeScrollContainer
      className="bg-background"
      data-responsive-surface="dashboard"
      data-paper-surface="chrome"
      onContextMenu={(e) => dashboardMenu.openEvent(e, buildSurfaceMenuItems())}
    >
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 pb-24 md:pb-8">
        <AdaptiveContentHeader
          className="px-0 pt-5 pb-5 md:pt-7 md:pb-7"
          title={t("dashboard.welcomeBack")}
          description={t("dashboard.companion")}
          secondaryActions={
            isCustomizing ? (
              <Button
                type="button"
                variant="outlined"
                size="sm"
                disabled={isDefaultLayout}
                onClick={resetDashboardLayout}
              >
                <ArrowCounterClockwise className="h-4 w-4" aria-hidden="true" />
                {t("dashboard.customize.reset")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="tonal"
                size="sm"
                onClick={() => setIsCustomizing(true)}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                {t("dashboard.customize.button")}
              </Button>
            )
          }
          primaryAction={
            isCustomizing ? (
              <Button
                type="button"
                variant="filled"
                size="sm"
                onClick={() => setIsCustomizing(false)}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {t("dashboard.customize.done")}
              </Button>
            ) : undefined
          }
        />

        {isCustomizing && (
          <div
            role="status"
            className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface"
          >
            <span>{t("dashboard.customize.banner")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-medium text-on-surface-variant">
                {t("dashboard.customize.visibleCount", {
                  visible: visibleSectionsCount,
                  total: sectionOrder.length,
                })}
              </span>
              <Button
                type="button"
                variant="tonal"
                size="sm"
                onClick={() => setShowWidgetGallery((prev) => !prev)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {showWidgetGallery ? "Hide Widgets" : "Add Widget"}
              </Button>
            </div>
          </div>
        )}

        {isCustomizing && showWidgetGallery && (
          <WidgetGalleryPanel
            sectionOrder={sectionOrder}
            hiddenSections={hiddenSections}
            onAddWidget={(id) => {
              addWidget(id);
              const meta = DASHBOARD_WIDGET_CATALOG.find((w) => w.id === id);
              if (meta) {
                setLiveAnnouncement(`Added ${meta.title} widget to Dashboard`);
              }
            }}
            onRemoveWidget={(id) => removeWidget(id)}
            onClose={() => setShowWidgetGallery(false)}
          />
        )}

        <div className="sr-only" aria-live="polite">
          {liveAnnouncement}
        </div>

        {!isCustomizing && visibleSectionsCount === 0 ? (
          <div className="rounded-xl border border-outline-variant bg-surface-container-low p-6 text-center">
            <h2 className="text-lg font-semibold text-on-surface">
              {t("dashboard.customize.allHiddenTitle")}
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              {t("dashboard.customize.allHiddenBody")}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                variant="filled"
                size="sm"
                onClick={() => setIsCustomizing(true)}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                {t("dashboard.customize.button")}
              </Button>
              <Button
                type="button"
                variant="outlined"
                size="sm"
                onClick={resetDashboardLayout}
              >
                <ArrowCounterClockwise className="h-4 w-4" aria-hidden="true" />
                {t("dashboard.customize.reset")}
              </Button>
            </div>
          </div>
        ) : (
          <div ref={sectionsContainerRef}>
            {sectionOrder.map((sectionId, index) => {
              const isVisible = !hiddenSections.includes(sectionId);
              const label = sectionLabels[sectionId];
              const content = renderSectionBody(sectionId);
              if (!isCustomizing && (!isVisible || content == null)) {
                return null;
              }
              return (
                <DashboardCustomizeSectionFrame
                  key={sectionId}
                  sectionId={sectionId}
                  label={label}
                  isCustomizing={isCustomizing}
                  isVisible={isVisible}
                  isFirst={index === 0}
                  isLast={index === sectionOrder.length - 1}
                  isDragging={dragState?.draggingId === sectionId}
                  dropIndicator={
                    dragState?.dropTargetId === sectionId ? dragState.dropPosition : null
                  }
                  onMoveUp={() => handleMoveSection(sectionId, "up")}
                  onMoveDown={() => handleMoveSection(sectionId, "down")}
                  onToggleVisible={(visible) => setSectionVisible(sectionId, visible)}
                  onRemove={isDashboardWidgetId(sectionId) ? () => removeWidget(sectionId) : undefined}
                  removeLabel={isDashboardWidgetId(sectionId) ? `Remove ${label}` : undefined}
                  onDragHandlePointerDown={(event) => handleSectionDragStart(sectionId, event)}
                  moveUpLabel={t("dashboard.customize.moveUp", { section: label })}
                  moveDownLabel={t("dashboard.customize.moveDown", { section: label })}
                  visibilityLabel={t("dashboard.customize.toggleSection", { section: label })}
                  dragHandleLabel={t("dashboard.customize.dragHandle", { section: label })}
                  hiddenBadgeLabel={t("dashboard.customize.hiddenBadge")}
                >
                  {content}
                </DashboardCustomizeSectionFrame>
              );
            })}
          </div>
        )}
      </div>
      <ContextMenu
        menuId="dashboard-surface-menu"
        items={dashboardMenu.items}
        visible={dashboardMenu.visible}
        position={dashboardMenu.position}
        onClose={dashboardMenu.closeToTrigger}
      />
      <WebArticleImportDialog
        isOpen={showUrlImportDialog}
        onClose={() => setShowUrlImportDialog(false)}
        onOpenDocument={(doc) => {
          addTab({
            title: doc.title,
            icon: null,
            type: "document-viewer",
            content: DocumentViewer,
            closable: true,
            data: { documentId: doc.id },
          });
        }}
      />
    </SafeScrollContainer>
  );
}
