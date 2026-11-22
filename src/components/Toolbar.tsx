import { requestDestinationAction } from "../commandPalette/destinationActions";
import { executeCommand } from "../commandPalette/executeCommand";
import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { useTabsStore, useDocumentStore, useUIStore, useSettingsStore } from "../stores";
import { useAudioEditionGenerationStore } from "../stores/audioEditionGenerationStore";
import { captureAndSaveScreenshot } from "../utils/screenshotCaptureFlow";
import { useI18n } from "../lib/i18n";
import { TOUR_ANCHORS } from "./onboarding/tour/anchors";
import {
  ReviewTab,
  ContinueReadingTab,
  SettingsTab,
  DocumentViewer,
  WebBrowserTab,
  RSSReader,
  DocumentQATab,
  NotebookLMTab,
  PodcastTab,
  AudiobooksTab,
  ExtractsTab,
  QueueTab,
  createCanonicalTab,
} from "./tabs/TabRegistry";
import { WebArticleImportDialog } from "./import/WebArticleImportDialog";
import { KnowledgeGraphPage } from "../pages/KnowledgeGraphPage";
import { KnowledgeSpherePage } from "../pages/KnowledgeSpherePage";
import { useQueueStore } from "../stores/queueStore";
import { useReviewStore } from "../stores/reviewStore";
import { useToast } from "./common/Toast";
import type { QueueItem } from "../types/queue";

import {
  Bookmarks,
  BookOpen,
  ArrowsLeftRight,
  Brain,
  Camera,
  ChatCircle,
  ChatDots,
  Command,
  Compass,
  Desktop,
  DiceFive,
  FileArrowUp,
  Gear,
  GraduationCap,
  Graph,
  Headphones,
  Link,
  Microphone,
  MoonStars,
  Newspaper,
  Planet,
  Rss,
  Scissors,
  Sparkle,
  SquaresFour,
  Stack,
  TextT,
} from "@phosphor-icons/react";
import { CollectionSwitcher } from "./collections/CollectionSwitcher";
import { cn } from "../utils/cn";
import { handleWindowDragRequest } from "../lib/windowDrag";
import { usePlatformCapability } from "../hooks/usePlatformCapability";
import { ContextMenu, type ContextMenuItem } from "./common/ContextMenu";
import { useSurfaceMenu } from "../hooks/useSurfaceMenu";
import { toolbarMenuItemIds } from "../lib/contextMenus";
import { t as translateRecentFeature } from "../lib/i18n";


export type ToolbarPosition = "top" | "left" | "right";

interface ToolbarButton {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut: string;
  action: () => void;
  splitAction?: () => void; // Action for middle-click (open in split screen)
  backgroundAction?: () => void; // Action for context menu (open in background)
  disabled?: boolean;
  group: number;
}

interface ToolbarButtonProps {
  button: ToolbarButton;
  orientation?: "horizontal" | "vertical";
  /** When true the toolbar rail is expanded: show the visible text label next
   * to the icon and suppress the native `title` so the OS tooltip does not
   * fight the visible label. */
  expanded?: boolean;
  active?: boolean;
  /** App-wide right-click menu entry (change `app-wide-context-menus`). */
  onMenuEntry?: (button: ToolbarButton, e: React.MouseEvent) => void;
}

/**
 * Map a `Toolbar` button id to the corresponding onboarding-tour anchor
 * (`data-tour`) when one exists for that surface. Buttons that have no tour
 * representation (Read Next, Random Item, screenshot, etc.) return an empty
 * object so the spread is a no-op. This keeps the anchor surface declared in
 * one place rather than threaded through every button config entry.
 */
function tourAnchorForButton(buttonId: string): { "data-tour"?: string } {
  const map: Record<string, string> = {
    dashboard: TOUR_ANCHORS.navDashboard,
    "import-file": TOUR_ANCHORS.navImportFile,
    "import-url": TOUR_ANCHORS.navImportUrl,
    "start-review": TOUR_ANCHORS.navReview,
    "knowledge-sphere": TOUR_ANCHORS.navKnowledgeSphere,
    settings: TOUR_ANCHORS.navSettings,
    "workspace-switcher": TOUR_ANCHORS.workspaceSwitcher,
    "command-palette": TOUR_ANCHORS.commandPalette,
  };
  const id = map[buttonId];
  return id ? { "data-tour": id } : {};
}

function ToolbarButtonItem({ button, orientation = "horizontal", expanded = false, active = false, onMenuEntry }: ToolbarButtonProps) {
        useI18n();
        const Icon = button.icon;
  const isAudiobookGenerating =
    button.id === "audiobook" &&
    useAudioEditionGenerationStore((state) => state.activeJobs.length > 0);

  const handleAuxClick = (e: React.MouseEvent) => {
    // Middle-click (button 1) opens the item in split screen
    if (e.button === 1 && button.splitAction) {
      e.preventDefault();
      e.stopPropagation();
      button.splitAction();
      (e.currentTarget as HTMLElement)?.blur?.();
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    button.action();
    e.currentTarget?.blur?.();
  };

  const isVertical = orientation === "vertical";

  return (
    <button
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      onContextMenu={onMenuEntry ? (e) => onMenuEntry(button, e) : undefined}
      disabled={button.disabled}
      title={expanded ? undefined : `${button.label} (${button.shortcut})`}
      data-toolbar-orientation={orientation}
      {...tourAnchorForButton(button.id)}
      className={cn(
        "md-state toolbar-button relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-full p-2 text-on-surface-variant focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-secondary-container text-on-secondary-container"
          : button.disabled ? "text-on-surface-variant/50" : "hover:text-on-surface",
        isVertical && "w-full",
      )}
      aria-label={button.label}
    >
      <span className="toolbar-button-background" aria-hidden="true" />
      <span className="toolbar-button-indicator" aria-hidden="true" />
      <span className="toolbar-button-content relative">
        <Icon className={isVertical ? "w-5 h-5" : "w-5 h-5"} />
        {isAudiobookGenerating && (
          <span
            data-testid="audiobook-synthesis-badge"
            className="absolute -top-1 -right-1 flex h-2.5 w-2.5"
            title={translateRecentFeature("i18nAudit.ui.audio-edition-synthesis-in-p.9264f9d7")}
          >
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
          </span>
        )}
      </span>
      <span className="toolbar-button-label" aria-hidden="true">
        {button.label}
      </span>
      <span className="sr-only">{button.label}</span>
    </button>
  );
}

interface ToolbarProps {
  position?: ToolbarPosition;
}

export function Toolbar({ position = "top" }: ToolbarProps) {
  const addTab = useTabsStore((state) => state.addTab);
  const addTabInBackground = useTabsStore((state) => state.addTabInBackground);
  const openTabInSplit = useTabsStore((state) => state.openTabInSplit);
  const openFilePickerAndImport = useDocumentStore((state) => state.openFilePickerAndImport);
  const loadDocuments = useDocumentStore((state) => state.loadDocuments);
  const setCommandPaletteOpen = useUIStore((state) => state.setCommandPaletteOpen);
  const queueFilterMode = useQueueStore((state) => state.queueFilterMode);
  const toast = useToast();
  const { t } = useI18n();

  const isVertical = position === "left" || position === "right";
  const [showUrlImportDialog, setShowUrlImportDialog] = useState(false);
  const urlImportSplitRef = useRef(false);
  const openTab = useCallback(
    (tab: Parameters<typeof addTab>[0], inSplit = false) =>
      inSplit ? openTabInSplit(tab) : addTab(tab),
    [addTab, openTabInSplit],
  );
  // User-configurable expanded rail width (Settings → Appearance → Display).
  // Only the expanded width is user-controlled; the collapsed rail stays at the
  // CSS default `--toolbar-rail-w` (3rem) so icons never shrink. Mobile shells
  // don't render this component at all, so the setting is ignored there.
  const sidebarWidth = useSettingsStore((state) => state.settings.interface.sidebarWidth);
  const railWidthStyle = isVertical
    ? { "--toolbar-expanded-w": `${sidebarWidth}px` } as CSSProperties
    : undefined;

  // ---------------------------------------------------------------------------
  // Hover/focus expansion: the rail reveals each button's text label when the
  // pointer rests over it (or keyboard focus enters it) and collapses back to
  // icons when the pointer and focus both leave. Asymmetric delays stop the
  // rail flapping open when the cursor merely crosses it. The actual widening
  // is CSS-driven off the `data-expanded` attribute; this state is the only
  // JS involved.
  // ---------------------------------------------------------------------------
  const OPEN_DELAY_MS = 120;
  const CLOSE_DELAY_MS = 250;
  const [expanded, setExpanded] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerInsideRef = useRef(false);
  const focusInsideRef = useRef(false);
  const railRef = useRef<HTMLDivElement>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const collapseNow = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    pointerInsideRef.current = false;
    focusInsideRef.current = false;
    setExpanded(false);
    if (
      railRef.current &&
      typeof document !== "undefined" &&
      document.activeElement &&
      railRef.current.contains(document.activeElement)
    ) {
      (document.activeElement as HTMLElement).blur?.();
    }
  }, [clearOpenTimer, clearCloseTimer]);

  useEffect(() => {
    // Clear both timers on unmount so a pending close can't toggle state
    // (or warn) after the component is gone.
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearOpenTimer, clearCloseTimer]);

  // Synchronize active tab navigation: collapse the rail whenever the active tab changes.
  const activeTabHistory = useTabsStore((state) => state.activeTabHistory);
  const activeTabId = activeTabHistory[activeTabHistory.length - 1] ?? null;
  const activeTabType = useTabsStore((state) => state.tabs.find((tab) => tab.id === activeTabId)?.type);
  const prevActiveTabIdRef = useRef<string | null>(activeTabId);

  useEffect(() => {
    if (prevActiveTabIdRef.current !== activeTabId) {
      prevActiveTabIdRef.current = activeTabId;
      collapseNow();
    }
  }, [activeTabId, collapseNow]);

  // Outside pointerdown: collapse expanded toolbar if user clicks anywhere outside the rail.
  useEffect(() => {
    if (!expanded) return;
    const handleOutsideInteraction = (e: MouseEvent | PointerEvent) => {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        collapseNow();
      }
    };
    document.addEventListener("pointerdown", handleOutsideInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideInteraction, true);
    };
  }, [expanded, collapseNow]);

  const handlePointerEnter = () => {
    pointerInsideRef.current = true;
    // Pointer re-entering cancels a pending collapse.
    clearCloseTimer();
    if (openTimerRef.current !== null) return;
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      setExpanded(true);
    }, OPEN_DELAY_MS);
  };

  const handlePointerLeave = () => {
    pointerInsideRef.current = false;
    clearOpenTimer();
    if (closeTimerRef.current !== null) return;
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setExpanded(false);
      focusInsideRef.current = false;
      if (
        railRef.current &&
        typeof document !== "undefined" &&
        document.activeElement &&
        railRef.current.contains(document.activeElement)
      ) {
        (document.activeElement as HTMLElement).blur?.();
      }
    }, CLOSE_DELAY_MS);
  };

  // Focus parity: entering any toolbar button expands immediately (no open
  // delay — keyboard users should not have to wait). Leaving the whole toolbar
  // collapses immediately, unless the pointer still rests over it.
  const handleFocusIn = () => {
    focusInsideRef.current = true;
    clearOpenTimer();
    clearCloseTimer();
    setExpanded(true);
  };

  const handleFocusOut = (e: React.FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    focusInsideRef.current = false;
    clearOpenTimer();
    clearCloseTimer();
    if (!pointerInsideRef.current) {
      setExpanded(false);
    }
  };

  const handleImportFile = async (inSplit = false) => {
    const imported = await openFilePickerAndImport();
    if (imported.length > 0) {
      openTab({
        title: imported[0].title,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: imported[0].id },
      }, inSplit);
    }
  };

  const handleImportUrl = (inSplit = false) => {
    urlImportSplitRef.current = inSplit;
    setShowUrlImportDialog(true);
  };

  // Read Next button
  const handleReadNext = async (inSplit = false) => {
    try {
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
      const queueItems = filteredItems.length > 0 ? filteredItems : items;
      const nextItem = queueItems[0];
      if (!nextItem) {
        toast.info(t("toolbar.noItemsReady"), t("toolbar.noItemAvailable"));
        return;
      }
      await openQueueItem(nextItem, inSplit);
    } catch (error) {
      toast.error(t("toolbar.readNextFailed"), error instanceof Error ? error.message : t("toolbar.couldNotOpenNext"));
    }
  };

  // Random Item button
  const handleRandomItem = async (inSplit = false) => {
    try {
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
      const queueItems = filteredItems.length > 0 ? filteredItems : items;
      if (queueItems.length === 0) {
        toast.info(t("toolbar.noItemsReady"), t("toolbar.noItemAvailable"));
        return;
      }
      const randomItem = queueItems[Math.floor(Math.random() * queueItems.length)];
      await openQueueItem(randomItem, inSplit);
    } catch (error) {
      toast.error(t("toolbar.randomItemFailed"), error instanceof Error ? error.message : t("toolbar.couldNotOpenRandom"));
    }
  };

  const handleStartReview = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("tabs.review"),
      icon: <Brain className="w-4 h-4" />,
      type: "review",
      content: ReviewTab,
      closable: true,
    }, inSplit);
  };

  const handleStartReviewBackground = () => {
    addTabInBackground({
      title: translateRecentFeature("tabs.review"),
      icon: "🎴",
      type: "review",
      content: ReviewTab,
      closable: true,
    });
  };

  // RSS button
  const handleRss = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.rss-feeds.b2e0b3bb"),
      icon: <Newspaper className="w-4 h-4" />,
      type: "rss",
      content: RSSReader,
      closable: true,
    }, inSplit);
  };

  const handlePodcast = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.podcasts.8a64829c"),
      icon: <Headphones className="w-4 h-4" />,
      type: "podcast",
      content: PodcastTab,
      closable: true,
    }, inSplit);
  };

  const handleAudiobooks = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.audiobooks.0104e6dd"),
      icon: <Headphones className="w-4 h-4" />,
      type: "audiobook",
      content: AudiobooksTab,
      closable: true,
    }, inSplit);
  };

  // Dashboard button
  const handleDashboard = (inSplit = false) => {
    openTab(createCanonicalTab("dashboard"), inSplit);
  };

  const healthInsightsAvailable = usePlatformCapability("tab_learning_insights").available;
  const handleStudyPlans = (inSplit = false) => {
    openTab(createCanonicalTab("study-plans"), inSplit);
  };

  const handleLearningInsights = (inSplit = false) => {
    openTab(createCanonicalTab("learning-insights"), inSplit);
  };

  const handleContinueReading = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.continue-reading.25d33750"),
      icon: <Bookmarks className="w-4 h-4" />,
      type: "continue-reading",
      content: ContinueReadingTab,
      closable: true,
    }, inSplit);
  };

  const handleQueue = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.queue.cbc295a6"),
      icon: <Stack className="w-4 h-4" />,
      type: "queue",
      content: QueueTab,
      closable: true,
    }, inSplit);
  };

  const handleSavedQueues = (inSplit = false) => {
    if (inSplit) {
      handleQueue(true);
      void requestDestinationAction({ destination: "queue", action: "manage" });
      return;
    }
    void executeCommand({ id: "manage-saved-queues", label: t("savedQueues.manageQueues"),
      action: () => requestDestinationAction({ destination: "queue", action: "manage" }) });
  };

  // Knowledge Graph button
  const handleKnowledgeGraph = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.knowledge-graph.94c23b23"),
      icon: <Graph className="w-4 h-4" />,
      type: "knowledge-network",
      content: KnowledgeGraphPage,
      closable: true,
    }, inSplit);
  };

  const handleKnowledgeGraphBackground = () => {
    addTabInBackground({
      title: translateRecentFeature("i18nAudit.ui.knowledge-graph.94c23b23"),
      icon: "🕸️",
      type: "knowledge-network",
      content: KnowledgeGraphPage,
      closable: true,
    });
  };

  // Knowledge Sphere button (3D)
  const handleKnowledgeSphere = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.knowledge-sphere.77a508a6"),
      icon: <Planet className="w-4 h-4" />,
      type: "knowledge-sphere",
      content: KnowledgeSpherePage,
      closable: true,
    }, inSplit);
  };

  const handleKnowledgeSphereBackground = () => {
    addTabInBackground({
      title: translateRecentFeature("i18nAudit.ui.knowledge-sphere.77a508a6"),
      icon: "🌐",
      type: "knowledge-sphere",
      content: KnowledgeSpherePage,
      closable: true,
    });
  };

  // Web Browser button
  const handleWebBrowser = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.web-browser.e6cc7829"),
      icon: <Desktop className="w-4 h-4" />,
      type: "web-browser",
      content: WebBrowserTab,
      closable: true,
    }, inSplit);
  };

  const handleWebBrowserBackground = () => {
    addTabInBackground({
      title: translateRecentFeature("i18nAudit.ui.web-browser.e6cc7829"),
      icon: "🌐",
      type: "web-browser",
      content: WebBrowserTab,
      closable: true,
    });
  };

  // Doc Q&A button
  const handleDocQA = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.document-q-a.1e7a5150"),
      icon: <ChatCircle className="w-4 h-4" />,
      type: "doc-qa",
      content: DocumentQATab,
      closable: true,
    }, inSplit);
  };

  const handleDocQABackground = () => {
    addTabInBackground({
      title: translateRecentFeature("i18nAudit.ui.document-q-a.1e7a5150"),
      icon: "🤖",
      type: "doc-qa",
      content: DocumentQATab,
      closable: true,
    });
  };

  // NotebookLM button
  const handleNotebookLM = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.notebooklm.32ae2995"),
      icon: <Sparkle className="w-4 h-4" />,
      type: "notebooklm",
      content: NotebookLMTab,
      closable: true,
    }, inSplit);
  };

  const handleNotebookLMBackground = () => {
    addTabInBackground({
      title: translateRecentFeature("i18nAudit.ui.notebooklm.32ae2995"),
      icon: "✨",
      type: "notebooklm",
      content: NotebookLMTab,
      closable: true,
    });
  };

  // Extracts button (library-wide extracts tab)
  const handleExtracts = (inSplit = false) => {
    openTab({
      title: t("extractsTab.title"),
      icon: <Scissors className="w-4 h-4 text-muted-foreground" />,
      type: "extracts",
      content: ExtractsTab,
      closable: true,
    }, inSplit);
  };

  const handleExtractsBackground = () => {
    addTabInBackground({
      title: t("extractsTab.title"),
      icon: "✂️",
      type: "extracts",
      content: ExtractsTab,
      closable: true,
    });
  };

  // Screenshot button
  const handleScreenshot = () => {
    void captureAndSaveScreenshot()
      .then((asset) => {
        if (asset) {
          toast.success(
            t("imageRegistry.assetsAdded"),
            t("imageRegistry.assetsAddedDesc", { count: 1 })
          );
        }
      })
      .catch((error) => {
        console.error("Failed to capture screenshot:", error);
        toast.error(
          t("toolbar.screenshotFailed"),
          error instanceof Error ? error.message : undefined
        );
      });
  };

  const handleSettings = (inSplit = false) => {
    openTab({
      title: translateRecentFeature("i18nAudit.ui.settings.f49d4b34"),
      icon: <Gear className="w-4 h-4" />,
      type: "settings",
      content: SettingsTab,
      closable: true,
    }, inSplit);
  };

  const handleSettingsBackground = () => {
    addTabInBackground({
      title: translateRecentFeature("i18nAudit.ui.settings.f49d4b34"),
      icon: "⚙️",
      type: "settings",
      content: SettingsTab,
      closable: true,
    });
  };

  // Command Palette button
  const handleCommandPalette = () => {
    setCommandPaletteOpen(true);
  };

  const openQueueItem = async (item: QueueItem, inSplit = false) => {
    if (item.itemType === "document") {
      openTab({
        title: item.documentTitle,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId },
      }, inSplit);
      return;
    }

    if (item.itemType === "extract") {
      openTab({
        title: item.documentTitle,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId, initialViewMode: "extracts" },
      }, inSplit);
      return;
    }

    if (item.itemType === "learning-item") {
      openTab({
        title: translateRecentFeature("tabs.review"),
        icon: <Brain className="w-4 h-4" />,
        type: "review",
        content: ReviewTab,
        closable: true,
      }, inSplit);
      const { startReviewAtItem } = useReviewStore.getState();
      if (item.learningItemId || item.id) {
        await startReviewAtItem(item.learningItemId || item.id);
      }
      return;
    }

    if (item.documentId) {
      openTab({
        title: item.documentTitle,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId },
      }, inSplit);
      return;
    }

    console.warn("Unsupported queue item type for toolbar open:", item.itemType, item);
  };

  // §2.5: NotebookLM depends on the external `notebooklm-py` CLI — the
  // toolbar button is desktop-only via the platform capability registry.
  const notebooklmAvailable = usePlatformCapability("tab_notebooklm").available;
  const buttons: ToolbarButton[] = [
    // Group 1: File Operations
    {
      id: "import-file",
      icon: FileArrowUp,
      label: t("toolbar.importFile"),
      shortcut: "Ctrl+O",
      action: () => handleImportFile(),
      splitAction: () => handleImportFile(true),
      group: 1,
    },
    {
      id: "import-url",
      icon: Link,
      label: t("toolbar.importUrl"),
      shortcut: "Ctrl+Shift+O",
      action: () => handleImportUrl(),
      splitAction: () => handleImportUrl(true),
      group: 1,
    },
    {
      id: "read-next",
      icon: Bookmarks,
      label: t("toolbar.readNext"),
      shortcut: "",
      action: () => handleReadNext(),
      splitAction: () => handleReadNext(true),
      group: 1,
    },
    {
      id: "random-item",
      icon: DiceFive,
      label: t("toolbar.randomItem"),
      shortcut: "",
      action: () => handleRandomItem(),
      splitAction: () => handleRandomItem(true),
      group: 1,
    },
    {
      id: "start-review",
      icon: Brain,
      label: t("toolbar.startReview"),
      shortcut: "",
      action: () => handleStartReview(),
      splitAction: () => handleStartReview(true),
      backgroundAction: handleStartReviewBackground,
      group: 1,
    },
    {
      id: "study-plans",
      icon: GraduationCap,
      label: t("studyPlans.title"),
      shortcut: "",
      action: () => handleStudyPlans(),
      splitAction: () => handleStudyPlans(true),
      group: 1,
    },
    ...(healthInsightsAvailable ? [{
      id: "learning-insights",
      icon: MoonStars,
      label: t("health.learningInsights"),
      shortcut: "",
      action: () => handleLearningInsights(),
      splitAction: () => handleLearningInsights(true),
      group: 1,
    }] : []),
    // Group 2: RSS
    {
      id: "rss",
      icon: Rss,
      label: t("toolbar.rssFeeds"),
      shortcut: "",
      action: () => handleRss(),
      splitAction: () => handleRss(true),
      group: 2,
    },
    {
      id: "podcast",
      icon: Microphone,
      label: t("toolbar.podcasts"),
      shortcut: "",
      action: () => handlePodcast(),
      splitAction: () => handlePodcast(true),
      group: 2,
    },
    {
      id: "audiobook",
      icon: Headphones,
      label: t("toolbar.audiobooks"),
      shortcut: "",
      action: () => handleAudiobooks(),
      splitAction: () => handleAudiobooks(true),
      group: 2,
    },
    // Group 3: Navigation
    {
      id: "dashboard",
      icon: SquaresFour,
      label: t("toolbar.dashboard"),
      shortcut: "Ctrl+D",
      action: () => handleDashboard(),
      splitAction: () => handleDashboard(true),
      group: 3,
    },
    {
      id: "continue-reading",
      icon: BookOpen,
      label: t("toolbar.continueReading"),
      shortcut: "Ctrl+2",
      action: () => handleContinueReading(),
      splitAction: () => handleContinueReading(true),
      group: 3,
    },
    {
      id: "queue",
      icon: Stack,
      label: t("toolbar.goToQueue") || "Queue",
      shortcut: "Ctrl+3",
      action: () => handleQueue(),
      splitAction: () => handleQueue(true),
      group: 3,
    },
    {
      id: "saved-queues",
      icon: Bookmarks,
      label: t("savedQueues.title") || "Saved Queues",
      shortcut: "",
      action: () => handleSavedQueues(),
      splitAction: () => handleSavedQueues(true),
      group: 3,
    },
    {
      id: "knowledge-graph",
      icon: Graph,
      label: t("toolbar.knowledgeGraph"),
      shortcut: "Ctrl+4",
      action: () => handleKnowledgeGraph(),
      splitAction: () => handleKnowledgeGraph(true),
      backgroundAction: handleKnowledgeGraphBackground,
      group: 3,
    },
    {
      id: "knowledge-sphere",
      icon: Planet,
      label: t("toolbar.knowledgeSphere"),
      shortcut: "Ctrl+5",
      action: () => handleKnowledgeSphere(),
      splitAction: () => handleKnowledgeSphere(true),
      backgroundAction: handleKnowledgeSphereBackground,
      group: 3,
    },
    {
      id: "web-browser",
      icon: Compass,
      label: t("toolbar.webBrowser"),
      shortcut: "Ctrl+6",
      action: () => handleWebBrowser(),
      splitAction: () => handleWebBrowser(true),
      backgroundAction: handleWebBrowserBackground,
      group: 3,
    },
    {
      id: "doc-qa",
      icon: ChatDots,
      label: t("toolbar.documentQA"),
      shortcut: "",
      action: () => handleDocQA(),
      splitAction: () => handleDocQA(true),
      backgroundAction: handleDocQABackground,
      group: 3,
    },
    ...(notebooklmAvailable
      ? [
          {
            id: "notebooklm",
            icon: Sparkle,
            label: t("toolbar.notebooklm"),
            shortcut: "",
            action: () => handleNotebookLM(),
            splitAction: () => handleNotebookLM(true),
            backgroundAction: handleNotebookLMBackground,
            group: 3,
          },
        ]
      : []),
    {
      id: "extracts",
      icon: Scissors,
      label: t("toolbar.extracts"),
      shortcut: "",
      action: () => handleExtracts(),
      splitAction: () => handleExtracts(true),
      backgroundAction: handleExtractsBackground,
      group: 3,
    },
    /* {
      id: "screenshot",
      icon: Camera,
      label: t("toolbar.screenshot"),
      shortcut: "Ctrl+Shift+S",
      action: handleScreenshot,
      group: 3,
    }, */
    // Group 4: Settings & Tools
    {
      id: "settings",
      icon: Gear,
      label: t("toolbar.settings"),
      shortcut: "Ctrl+,",
      action: () => handleSettings(),
      splitAction: () => handleSettings(true),
      backgroundAction: handleSettingsBackground,
      group: 4,
    },
    {
      id: "command-palette",
      icon: Command,
      label: t("toolbar.commandPalette"),
      shortcut: "Ctrl+K",
      action: handleCommandPalette,
      group: 4,
    },
    {
      id: "workspace-switcher",
      icon: ArrowsLeftRight,
      label: t("workspace.switchWorkspace"),
      shortcut: "",
      action: () => window.dispatchEvent(new CustomEvent("open-workspace-switcher")),
      group: 4,
    },
  ];

  const groups = Array.from(new Set(buttons.map((b) => b.group))).sort();
  const activeButtonTypes: Record<string, string[]> = {
    dashboard: ["dashboard"],
    "start-review": ["review"],
    "study-plans": ["study-plans"],
    "learning-insights": ["learning-insights"],
    "continue-reading": ["continue-reading"],
    settings: ["settings"],
    documents: ["documents"],
    "knowledge-graph": ["knowledge-network"],
    "knowledge-sphere": ["knowledge-sphere"],
    rss: ["rss", "newsletter"],
    "web-browser": ["web-browser"],
    "doc-qa": ["doc-qa"],
    notebooklm: ["notebooklm"],
    podcast: ["podcast"],
    audiobook: ["audiobook", "audiobook-epub-sync"],
    extracts: ["extracts", "document-extracts", "extract-reader"],
  };
  const isActiveButton = (button: ToolbarButton) => activeTabType != null && activeButtonTypes[button.id]?.includes(activeTabType) === true;

  // ---- App-wide context menu (change `app-wide-context-menus`) ----
  // Rail buttons expose only safe actions the view already supports:
  // Open (the click itself, with its shortcut) plus Open in background
  // where the button defines one. Never destructive.
  const railMenu = useSurfaceMenu("toolbar-rail-menu");
  const buildToolbarItems = (button: ToolbarButton): ContextMenuItem[] => {
    const byId: Record<string, ContextMenuItem> = {
      open: {
        id: "open",
        label: button.label,
        shortcut: button.shortcut || undefined,
        onClick: () => button.action(),
      },
      "open-background": {
        id: "open-background",
        label: t("contextMenu.openInBackground"),
        onClick: () => button.backgroundAction?.(),
      },
    };
    return toolbarMenuItemIds(Boolean(button.backgroundAction)).map((id) => byId[id]);
  };
  const openRailMenu = (button: ToolbarButton, e: React.MouseEvent) => {
    if (button.disabled) return;
    railMenu.openEvent(e, buildToolbarItems(button));
  };

  const railHandlers = {
    onPointerEnter: handlePointerEnter,
    onPointerLeave: handlePointerLeave,
    onFocus: handleFocusIn,
    onBlur: handleFocusOut,
  };

  const toolbarContent = (
    <div
      ref={railRef}
      data-toolbar-position={position}
      data-expanded={expanded || undefined}
      {...railHandlers}
      style={railWidthStyle}
      className={cn("toolbar-rail relative", isVertical && "h-full")}
    >
      <div className={cn("toolbar-surface", isVertical && "h-full")}>
        {isVertical ? (
          <div className={`h-full bg-surface-container flex flex-col`}>
            <CollectionSwitcher />
            <div className="flex-1 overflow-y-auto py-2 px-1">
              <div className="flex flex-col gap-1">
                {groups.map((group, groupIndex) => (
                  <div key={group} className="flex flex-col">
                    {buttons
                      .filter((b) => b.group === group)
                      .map((button) => (
                        <ToolbarButtonItem key={button.id} button={button} orientation="vertical" expanded={expanded} active={isActiveButton(button)} onMenuEntry={openRailMenu} />
                      ))}
                    {groupIndex < groups.length - 1 && (
                      <div className="w-6 h-px bg-outline-variant/60 mx-auto my-1" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-surface-container" data-paper-surface="chrome">
            <div
              onMouseDown={handleWindowDragRequest}
              className="flex items-center px-2 py-1 gap-1"
            >
              <CollectionSwitcher />
              {groups.map((group, groupIndex) => (
                <div key={group} className="flex items-center gap-1">
                  {buttons
                    .filter((b) => b.group === group)
                      .map((button) => (
                        <ToolbarButtonItem key={button.id} button={button} expanded={expanded} active={isActiveButton(button)} onMenuEntry={openRailMenu} />
                      ))}
                  {groupIndex < groups.length - 1 && (
                    <div className="w-px h-6 bg-outline-variant/60 mx-1" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {toolbarContent}
      <ContextMenu
        menuId="toolbar-rail-menu"
        items={railMenu.items}
        visible={railMenu.visible}
        position={railMenu.position}
        onClose={railMenu.closeToTrigger}
      />
      <WebArticleImportDialog
        isOpen={showUrlImportDialog}
        onClose={() => {
          urlImportSplitRef.current = false;
          setShowUrlImportDialog(false);
        }}
        onOpenDocument={(doc) => {
          const inSplit = urlImportSplitRef.current;
          urlImportSplitRef.current = false;
          openTab({
            title: doc.title,
            icon: <TextT className="w-4 h-4 text-muted-foreground" />,
            type: "document-viewer",
            content: DocumentViewer,
            closable: true,
            data: { documentId: doc.id },
          }, inSplit);
        }}
      />
    </>
  );
}

export function ToolbarWithSettings() {
  const toolbarPosition = useSettingsStore((state) => state.settings.interface.toolbarPosition);
  return <Toolbar position={toolbarPosition} />;
}
