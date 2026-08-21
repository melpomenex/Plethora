import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { useTabsStore, useDocumentStore, useUIStore, useSettingsStore } from "../stores";
import { captureAndSaveScreenshot } from "../utils/screenshotCaptureFlow";
import { useI18n } from "../lib/i18n";
import { TOUR_ANCHORS } from "./onboarding/tour/anchors";
import {
  ReviewTab,
  DashboardTab,
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
  Graph,
  Headphones,
  Link,
  Microphone,
  Newspaper,
  Planet,
  Rss,
  Scissors,
  Sparkle,
  SquaresFour,
  TextT,
} from "@phosphor-icons/react";
import { CollectionSwitcher } from "./collections/CollectionSwitcher";
import { actionVariants } from "./common/UI";
import { cn } from "../utils/cn";
import { handleWindowDragRequest } from "../lib/windowDrag";
import { usePlatformCapability } from "../hooks/usePlatformCapability";

export type ToolbarPosition = "top" | "left" | "right";

interface ToolbarButton {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut: string;
  action: () => void;
  backgroundAction?: () => void; // Action for middle-click (open in background)
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

function ToolbarButtonItem({ button, orientation = "horizontal", expanded = false }: ToolbarButtonProps) {
  const Icon = button.icon;

  const handleAuxClick = (e: React.MouseEvent) => {
    // Middle-click (button 1)
    if (e.button === 1 && button.backgroundAction) {
      e.preventDefault();
      e.stopPropagation();
      button.backgroundAction();
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
      disabled={button.disabled}
      title={expanded ? undefined : `${button.label} (${button.shortcut})`}
      data-toolbar-orientation={orientation}
      {...tourAnchorForButton(button.id)}
      className={cn(
        actionVariants({ variant: "tertiary", size: "icon" }),
        "toolbar-button relative",
        button.disabled ? "text-muted-foreground" : "text-foreground",
        isVertical && "w-full",
      )}
      aria-label={button.label}
    >
      <span className="toolbar-button-background" aria-hidden="true" />
      <span className="toolbar-button-indicator" aria-hidden="true" />
      <span className="toolbar-button-content">
        <Icon className={isVertical ? "w-5 h-5" : "w-5 h-5"} />
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
  const openFilePickerAndImport = useDocumentStore((state) => state.openFilePickerAndImport);
  const loadDocuments = useDocumentStore((state) => state.loadDocuments);
  const setCommandPaletteOpen = useUIStore((state) => state.setCommandPaletteOpen);
  const queueFilterMode = useQueueStore((state) => state.queueFilterMode);
  const toast = useToast();
  const { t } = useI18n();

  const isVertical = position === "left" || position === "right";
  const [showUrlImportDialog, setShowUrlImportDialog] = useState(false);
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

  const handleImportFile = async () => {
    const imported = await openFilePickerAndImport();
    if (imported.length > 0) {
      addTab({
        title: imported[0].title,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: imported[0].id },
      });
    }
  };

  const handleImportUrl = () => {
    setShowUrlImportDialog(true);
  };

  // Read Next button
  const handleReadNext = async () => {
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
      await openQueueItem(nextItem);
    } catch (error) {
      toast.error(t("toolbar.readNextFailed"), error instanceof Error ? error.message : t("toolbar.couldNotOpenNext"));
    }
  };

  // Random Item button
  const handleRandomItem = async () => {
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
      await openQueueItem(randomItem);
    } catch (error) {
      toast.error(t("toolbar.randomItemFailed"), error instanceof Error ? error.message : t("toolbar.couldNotOpenRandom"));
    }
  };

  const handleStartReview = () => {
    addTab({
      title: "Review",
      icon: <Brain className="w-4 h-4" />,
      type: "review",
      content: ReviewTab,
      closable: true,
    });
  };

  const handleStartReviewBackground = () => {
    addTabInBackground({
      title: "Review",
      icon: "🎴",
      type: "review",
      content: ReviewTab,
      closable: true,
    });
  };

  // RSS button
  const handleRss = () => {
    addTab({
      title: "RSS Feeds",
      icon: <Newspaper className="w-4 h-4" />,
      type: "rss",
      content: RSSReader,
      closable: true,
    });
  };

  const handlePodcast = () => {
    addTab({
      title: "Podcasts",
      icon: <Headphones className="w-4 h-4" />,
      type: "podcast",
      content: PodcastTab,
      closable: true,
    });
  };

  const handleAudiobooks = () => {
    addTab({
      title: "Audiobooks",
      icon: <Headphones className="w-4 h-4" />,
      type: "audiobook",
      content: AudiobooksTab,
      closable: true,
    });
  };

  // Dashboard button
  const handleDashboard = () => {
    addTab({
      title: "Dashboard",
      icon: <SquaresFour className="w-4 h-4" />,
      type: "dashboard",
      content: DashboardTab,
      closable: false,
    });
  };

  const handleContinueReading = () => {
    addTab({
      title: "Continue Reading",
      icon: <Bookmarks className="w-4 h-4" />,
      type: "continue-reading",
      content: ContinueReadingTab,
      closable: true,
    });
  };

  // Dashboard is already the default tab, so middle-click doesn't make much sense
  // But we'll still add the handler for consistency

  // Knowledge Graph button
  const handleKnowledgeGraph = () => {
    addTab({
      title: "Knowledge Graph",
      icon: <Graph className="w-4 h-4" />,
      type: "knowledge-network",
      content: KnowledgeGraphPage,
      closable: true,
    });
  };

  const handleKnowledgeGraphBackground = () => {
    addTabInBackground({
      title: "Knowledge Graph",
      icon: "🕸️",
      type: "knowledge-network",
      content: KnowledgeGraphPage,
      closable: true,
    });
  };

  // Knowledge Sphere button (3D)
  const handleKnowledgeSphere = () => {
    addTab({
      title: "Knowledge Sphere",
      icon: <Planet className="w-4 h-4" />,
      type: "knowledge-sphere",
      content: KnowledgeSpherePage,
      closable: true,
    });
  };

  const handleKnowledgeSphereBackground = () => {
    addTabInBackground({
      title: "Knowledge Sphere",
      icon: "🌐",
      type: "knowledge-sphere",
      content: KnowledgeSpherePage,
      closable: true,
    });
  };

  // Web Browser button
  const handleWebBrowser = () => {
    addTab({
      title: "Web Browser",
      icon: <Desktop className="w-4 h-4" />,
      type: "web-browser",
      content: WebBrowserTab,
      closable: true,
    });
  };

  const handleWebBrowserBackground = () => {
    addTabInBackground({
      title: "Web Browser",
      icon: "🌐",
      type: "web-browser",
      content: WebBrowserTab,
      closable: true,
    });
  };

  // Doc Q&A button
  const handleDocQA = () => {
    addTab({
      title: "Document Q&A",
      icon: <ChatCircle className="w-4 h-4" />,
      type: "doc-qa",
      content: DocumentQATab,
      closable: true,
    });
  };

  const handleDocQABackground = () => {
    addTabInBackground({
      title: "Document Q&A",
      icon: "🤖",
      type: "doc-qa",
      content: DocumentQATab,
      closable: true,
    });
  };

  // NotebookLM button
  const handleNotebookLM = () => {
    addTab({
      title: "NotebookLM",
      icon: <Sparkle className="w-4 h-4" />,
      type: "notebooklm",
      content: NotebookLMTab,
      closable: true,
    });
  };

  const handleNotebookLMBackground = () => {
    addTabInBackground({
      title: "NotebookLM",
      icon: "✨",
      type: "notebooklm",
      content: NotebookLMTab,
      closable: true,
    });
  };

  // Extracts button (library-wide extracts tab)
  const handleExtracts = () => {
    addTab({
      title: t("extractsTab.title"),
      icon: <Scissors className="w-4 h-4 text-muted-foreground" />,
      type: "extracts",
      content: ExtractsTab,
      closable: true,
    });
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

  const handleSettings = () => {
    addTab({
      title: "Settings",
      icon: <Gear className="w-4 h-4" />,
      type: "settings",
      content: SettingsTab,
      closable: true,
    });
  };

  const handleSettingsBackground = () => {
    addTabInBackground({
      title: "Settings",
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

  const openQueueItem = async (item: QueueItem) => {
    if (item.itemType === "document") {
      addTab({
        title: item.documentTitle,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
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
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId, initialViewMode: "extracts" },
      });
      return;
    }

    if (item.itemType === "learning-item") {
      addTab({
        title: "Review",
        icon: <Brain className="w-4 h-4" />,
        type: "review",
        content: ReviewTab,
        closable: true,
      });
      const { startReviewAtItem } = useReviewStore.getState();
      if (item.learningItemId || item.id) {
        await startReviewAtItem(item.learningItemId || item.id);
      }
      return;
    }

    if (item.documentId) {
      addTab({
        title: item.documentTitle,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: { documentId: item.documentId },
      });
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
      action: handleImportFile,
      group: 1,
    },
    {
      id: "import-url",
      icon: Link,
      label: t("toolbar.importUrl"),
      shortcut: "Ctrl+Shift+O",
      action: handleImportUrl,
      group: 1,
    },
    {
      id: "read-next",
      icon: Bookmarks,
      label: t("toolbar.readNext"),
      shortcut: "",
      action: handleReadNext,
      group: 1,
    },
    {
      id: "random-item",
      icon: DiceFive,
      label: t("toolbar.randomItem"),
      shortcut: "",
      action: handleRandomItem,
      group: 1,
    },
    {
      id: "start-review",
      icon: Brain,
      label: t("toolbar.startReview"),
      shortcut: "",
      action: handleStartReview,
      backgroundAction: handleStartReviewBackground,
      group: 1,
    },
    // Group 2: RSS
    {
      id: "rss",
      icon: Rss,
      label: t("toolbar.rssFeeds"),
      shortcut: "",
      action: handleRss,
      group: 2,
    },
    {
      id: "podcast",
      icon: Microphone,
      label: t("toolbar.podcasts"),
      shortcut: "",
      action: handlePodcast,
      group: 2,
    },
    {
      id: "audiobook",
      icon: Headphones,
      label: t("toolbar.audiobooks"),
      shortcut: "",
      action: handleAudiobooks,
      group: 2,
    },
    // Group 3: Navigation
    {
      id: "dashboard",
      icon: SquaresFour,
      label: t("toolbar.dashboard"),
      shortcut: "Ctrl+1",
      action: handleDashboard,
      group: 3,
    },
    {
      id: "continue-reading",
      icon: BookOpen,
      label: t("toolbar.continueReading"),
      shortcut: "Ctrl+2",
      action: handleContinueReading,
      group: 3,
    },
    {
      id: "knowledge-graph",
      icon: Graph,
      label: t("toolbar.knowledgeGraph"),
      shortcut: "Ctrl+4",
      action: handleKnowledgeGraph,
      backgroundAction: handleKnowledgeGraphBackground,
      group: 3,
    },
    {
      id: "knowledge-sphere",
      icon: Planet,
      label: t("toolbar.knowledgeSphere"),
      shortcut: "Ctrl+5",
      action: handleKnowledgeSphere,
      backgroundAction: handleKnowledgeSphereBackground,
      group: 3,
    },
    {
      id: "web-browser",
      icon: Compass,
      label: t("toolbar.webBrowser"),
      shortcut: "Ctrl+6",
      action: handleWebBrowser,
      backgroundAction: handleWebBrowserBackground,
      group: 3,
    },
    {
      id: "doc-qa",
      icon: ChatDots,
      label: t("toolbar.documentQA"),
      shortcut: "",
      action: handleDocQA,
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
            action: handleNotebookLM,
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
      action: handleExtracts,
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
      action: handleSettings,
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
          <div className={`h-full bg-card ${position === "left" ? "border-r border-border" : "border-l border-border"} flex flex-col`}>
            <CollectionSwitcher />
            <div className="flex-1 overflow-y-auto py-2 px-1">
              <div className="flex flex-col gap-1">
                {groups.map((group, groupIndex) => (
                  <div key={group} className="flex flex-col">
                    {buttons
                      .filter((b) => b.group === group)
                      .map((button) => (
                        <ToolbarButtonItem key={button.id} button={button} orientation="vertical" expanded={expanded} />
                      ))}
                    {groupIndex < groups.length - 1 && (
                      <div className="w-6 h-px bg-border mx-auto my-1" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-card border-b border-border">
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
                      <ToolbarButtonItem key={button.id} button={button} expanded={expanded} />
                    ))}
                  {groupIndex < groups.length - 1 && (
                    <div className="w-px h-6 bg-border mx-1" />
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
      <WebArticleImportDialog
        isOpen={showUrlImportDialog}
        onClose={() => setShowUrlImportDialog(false)}
        onOpenDocument={(doc) => {
          addTab({
            title: doc.title,
            icon: <TextT className="w-4 h-4 text-muted-foreground" />,
            type: "document-viewer",
            content: DocumentViewer,
            closable: true,
            data: { documentId: doc.id },
          });
        }}
      />
    </>
  );
}

export function ToolbarWithSettings() {
  const toolbarPosition = useSettingsStore((state) => state.settings.interface.toolbarPosition);
  return <Toolbar position={toolbarPosition} />;
}
