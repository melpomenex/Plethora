import { useEffect, useMemo, useRef, useState } from "react";
import { useTabsStore } from "../../stores";
import { useDocumentStore } from "../../stores/documentStore";
import { useCollectionStore } from "../../stores/collectionStore";
import type { TabType } from "../../stores/tabsStore";
import { useI18n } from "../../lib/i18n";
import { formatRelativeTime } from "../../utils/relativeTime";
import { usePresentationMode } from "../../contexts/PresentationContext";
import { useIsActiveTab } from "../common/Tabs";
import { useStartupStore } from "../../stores/startupStore";
import { type DocumentWithProgress } from "../../types/position";
import type { StartupProgressItem } from "../../types/startup";
import {
  QueueTab,
  ReviewTab,
  DocumentsTab,
  ContinueReadingTab,
  AnalyticsTab,
  SettingsTab,
  RSSReader,
  DocumentViewer,
  AudiobooksTab,
} from "./TabRegistry";
import { getDashboardStats, type DashboardStats } from "../../api/analytics";
import { QuickReviewWidget } from "../review/QuickReviewWidget";
import { ActionButton, FocusPanel, SummarySection } from "../common/UI";
import { AdaptiveContentHeader, SafeScrollContainer } from "../adaptive";
import { selectDailyFocus } from "./dashboardFocus";
import {
  BookOpen,
  Brain,
  CaretRight,
  ChartBar,
  Files,
  Gear,
  Headphones,
  Lightning,
  Rss,
  Target,
  TrendUp,
} from "@phosphor-icons/react";

interface QuickAction {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  tabType: TabType;
  tabTitle: string;
  content: React.ComponentType;
  closable: boolean;
  primary?: boolean;
}

// Zustand selectors must return a stable fallback while the startup snapshot
// is loading. A new `[]` on every getSnapshot call makes React think the store
// changed continuously and triggers React error #185 on slower WebViews.
const EMPTY_STARTUP_PROGRESS: StartupProgressItem[] = [];

export function DashboardTab() {
  const { t } = useI18n();
  const { addTab } = useTabsStore();
  const documents = useDocumentStore((state) => state.documents);
  const activeCollectionId = useCollectionStore((s) => s.activeCollectionId);
  const mode = usePresentationMode();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isActiveTab = useIsActiveTab();
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
    if (!isActiveTab) return;
    // The tab can remain mounted while its parent/store updates. Keep the
    // startup effect one-shot per collection so loading stats cannot create a
    // render/effect feedback loop on slower WebViews.
    const startupKey = activeCollectionId || "default";
    if (startupLoadedForCollection.current === startupKey) return;
    startupLoadedForCollection.current = startupKey;
    void ensureStartup("dashboard").finally(() => {
      if (isActiveTab) void loadStats();
    });
  }, [activeCollectionId, ensureStartup, isActiveTab]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
   

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

  const quickActions: QuickAction[] = [
    {
      id: "continue-reading",
      title: t("continueReading.title"),
      description: t("dashboard.continueReading"),
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
      icon: Rss,
      iconBg: "bg-orange-500/10 text-orange-500",
      tabType: "rss",
      tabTitle: t("tabs.rssFeeds"),
      content: RSSReader,
      closable: true,
    },
    {
      id: "audiobooks",
      title: "Audiobooks",
      description: "Manage and listen to audiobooks",
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
      icon: Gear,
      iconBg: "bg-slate-500/10 text-slate-500",
      tabType: "settings",
      tabTitle: t("nav.settings"),
      content: SettingsTab,
      closable: true,
    },
  ];

  const openTab = (action: QuickAction) => {
    addTab({
      title: action.tabTitle,
      
      // TabBar derives the icon from `type` via getTabIcon(); this field is
      // kept for the store's ReactNode requirement but no longer rendered.
      icon: null,
      type: action.tabType,
      content: action.content,
      closable: action.closable,
    });
  };

  const openSyncSettings = () => {
    localStorage.setItem("incrementum_settings_initial_tab", "sync");
    addTab({
      title: t("nav.settings"),
      icon: null,
      type: "settings",
      content: SettingsTab,
      closable: true,
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

  const quickReviewCards = useMemo(
    () =>
      documents.slice(0, 10).map((doc) => ({
        id: doc.id,
        front: doc.title || "Untitled",
        back: doc.content?.slice(0, 220) || t("dashboardTab.noExtractedContent"),
        documentTitle: doc.title || t("dashboardTab.untitled"),
      })),
    [documents]
  );

  const handleQuickRate = async (
    _cardId: string,
    _rating: "again" | "hard" | "good" | "easy"
  ) => {
    // Placeholder until dashboard quick-review is wired to review queue ratings.
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

  return (
    <SafeScrollContainer className="bg-background" data-responsive-surface="dashboard">
      <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 pb-24 md:pb-8">
        <AdaptiveContentHeader
          className="px-0 pt-5 pb-5 md:pt-7 md:pb-7"
          title={t("dashboard.welcomeBack")}
          description={t("dashboard.companion")}
        />

        <FocusPanel className="mb-6 md:mb-8">
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

        {/* Quick Actions Grid - 2 columns mobile, 3 columns tablet+, adaptive rows */}
        <SummarySection title={t("dashboard.quickActions")}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3 md:gap-4 mb-6 md:mb-8">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                onClick={() => openTab(action)}
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
        </SummarySection>

        {/* Continue Reading Section */}
        {hasResumableReading && resumableDocs.length > 0 && (
          <SummarySection title={t("continueReading.title")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
              {resumableDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => openDocument(doc)}
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
        )}

        {/* Stats Section */}
        <SummarySection title={t("dashboard.progress")}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          {/* Main Stats Card */}
          <div className="md:col-span-2 border border-border rounded-xl p-4 md:p-6">
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
              <div className="text-center md:text-left flex flex-col items-center md:items-start p-2 bg-muted/20 rounded-lg md:bg-transparent md:p-0">
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

              <div className="text-center md:text-left flex flex-col items-center md:items-start p-2 bg-muted/20 rounded-lg md:bg-transparent md:p-0">
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

              <div className="text-center md:text-left flex flex-col items-center md:items-start p-2 bg-muted/20 rounded-lg md:bg-transparent md:p-0">
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

          {/* Sync Card */}
          <div className="border border-primary/20 bg-primary/[0.04] rounded-xl p-4 md:p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <svg
                  className="w-5 h-5 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v4m0 0l-2-2m2 2l2-2M8 8h8v8H8V8zm0 8l2 2m-2-2l2 2m4-2l-2 2m2-2l-2 2"
                  />
                </svg>
              </div>
              <h3 className="font-semibold text-foreground">{t("dashboard.deviceSync")}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t("dashboard.syncDescription")}
            </p>
            <button
              onClick={openSyncSettings}
              className="w-full py-2.5 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {t("dashboard.setupSync")}
            </button>
          </div>
        </div>
        </SummarySection>

        {/* Tips Section */}
        <div className="mt-6 md:mt-8 p-4 md:p-5 bg-muted/50 border border-border rounded-xl">
          <h3 className="font-medium text-sm text-foreground mb-2">
            💡 {t("dashboard.quickTip")}
          </h3>
          <p className="text-xs md:text-sm text-muted-foreground">
            {t("dashboard.commandPaletteHint")}
          </p>
        </div>

        {/* Quick Review */}
        <div className="mt-6 md:mt-8">
          <QuickReviewWidget
            cards={quickReviewCards}
            onRate={handleQuickRate}
            onExpand={() => {
              const reviewAction = quickActions.find((action) => action.id === "review");
              if (reviewAction) openTab(reviewAction);
            }}
            maxCards={5}
          />
        </div>
      </div>
    </SafeScrollContainer>
  );
}
