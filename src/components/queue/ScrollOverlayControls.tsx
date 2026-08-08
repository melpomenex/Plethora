import React, { useState, useEffect } from "react";
import {
  Brain,
  CaretDown,
  CaretUp,
  ChatCircle,
  CheckCircle,
  EyeSlash,
  Flag,
  Lightbulb,
  Lightning,
  List,
  Rss,
  Sliders,
  Sparkle,
  Star,
  TextT,
  WarningCircle,
  X,
  DotsSixVertical,
  DotsSix,
  ArrowsOutCardinal,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
} from "@phosphor-icons/react";
import { cn } from "../../utils";

interface ScrollOverlayControlsProps {
  showControls: boolean;
  showRatingControls?: boolean;
  currentIndex: number;
  totalItems: number;
  sessionOffset?: number;
  itemType: string;
  itemTitle: string;
  itemDocumentId?: string;
  isNewDocument: boolean;
  isRating: boolean;
  scrollViewMode: string;
  helpText?: string;
  isEpub?: boolean;
  /** When true, use compact mobile top-bar navigation. */
  isMobile?: boolean;
  ratingOrbsPosition?: "left" | "right" | "top" | "bottom";
  onUpdateRatingOrbsPosition?: (position: "left" | "right" | "top" | "bottom") => void;
  onExit: () => void;
  onShowSettings: () => void;
  onShowRssSettings: () => void;
  onSetScrollViewMode: (mode: "document" | "extracts" | "cards") => void;
  onOpenExtractDialog: () => void;
  onOpenEpubToc?: () => void;
  onOpenEpubSettings?: () => void;
  onEpubPreviousPage?: () => void;
  onEpubNextPage?: () => void;
  onRate: (rating: number) => void;
  onDismiss: () => void;
  onPriorityChange?: (slider: number) => void | Promise<void>;
  onGoToNext: () => void;
  onGoToPrevious: () => void;
  /** Toggle the AI assistant panel visibility (desktop only). */
  isAssistantVisible?: boolean;
  onToggleAssistant?: () => void;
  /** Toggle the AI summary panel visibility (document/rss items). */
  isSummaryActive?: boolean;
  onToggleSummary?: () => void;
  /**
   * Neural review mode ("Go neural"). When true, the overlay shows the neural
   * banner instead of the normal position pill, and ratings/consume drive the
   * spreading-activation queue rather than the priority queue.
   */
  isNeuralMode?: boolean;
  /** Remaining elements in the neural queue (shown in the banner). */
  neuralRemaining?: number | null;
  /** Whether the current item can seed a neural build (documents/cards/extracts; not RSS/podcast). */
  canGoNeural?: boolean;
  /** True while a neural queue is being built (disables the button, shows a spinner). */
  isNeuralLoading?: boolean;
  /** Enter neural review, seeded at the current item. */
  onGoNeural?: () => void;
  /** Exit neural review, restoring the prior reading session. */
  onExitNeural?: () => void;
  /** Render slot for ItemDetailsPopover in top bar */
  detailsButton?: React.ReactNode;
  prioritySlider?: number;
  /** i18n labels (optional — falls back to English) */
  labels?: {
    exit?: string;
    settings?: string;
    itemDetails?: string;
    rss?: string;
    viewDocument?: string;
    viewExtracts?: string;
    viewLearningCards?: string;
    createExtract?: string;
    again?: string;
    againTitle?: string;
    hard?: string;
    hardTitle?: string;
    good?: string;
    goodTitle?: string;
    easy?: string;
    easyTitle?: string;
    dismissLabel?: string;
    dismissTitle?: string;
    markAsRead?: string;
    markAsReadGood?: string;
    previousDocument?: string;
    nextDocument?: string;
    docShort?: string;
    cardShort?: string;
    rssShort?: string;
    extractShort?: string;
    showAssistant?: string;
    hideAssistant?: string;
    summarize?: string;
    closeSummary?: string;
    priority?: string;
    priorityLowest?: string;
    priorityLow?: string;
    priorityNormal?: string;
    priorityHigh?: string;
    priorityHighest?: string;
    priorityFineTune?: string;
    prioritySaving?: string;
    prioritySaveFailed?: string;
    /** Neural review ("Go neural") labels. */
    goNeural?: string;
    goNeuralTooltip?: string;
    exitNeural?: string;
    reviewMode?: string;
    refilled?: string;
  };
}

const PRIORITY_PRESETS = [
  { value: 10, color: "#6B7280", label: "Lowest" },
  { value: 30, color: "#9CA3AF", label: "Low" },
  { value: 50, color: "#3B82F6", label: "Normal" },
  { value: 70, color: "#F59E0B", label: "High" },
  { value: 90, color: "#EF4444", label: "Highest" },
] as const;

function getPriorityPreset(slider: number) {
  if (slider >= 81) return PRIORITY_PRESETS[4];
  if (slider >= 61) return PRIORITY_PRESETS[3];
  if (slider >= 41) return PRIORITY_PRESETS[2];
  if (slider >= 21) return PRIORITY_PRESETS[1];
  return PRIORITY_PRESETS[0];
}

const getTooltipClass = (pos: "left" | "right" | "top" | "bottom") => {
  switch (pos) {
    case "left":
      return "absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0 whitespace-nowrap shadow-md border border-white/10 z-50 pointer-events-none";
    case "top":
      return "absolute top-full mt-3 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-[-4px] group-hover:translate-y-0 whitespace-nowrap shadow-md border border-white/10 z-50 pointer-events-none";
    case "bottom":
      return "absolute bottom-full mb-3 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-[4px] group-hover:translate-y-0 whitespace-nowrap shadow-md border border-white/10 z-50 pointer-events-none";
    case "right":
    default:
      return "absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-black/90 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-[4px] group-hover:translate-x-0 whitespace-nowrap shadow-md border border-white/10 z-50 pointer-events-none";
  }
};

export const ScrollOverlayControls = React.memo(function ScrollOverlayControls({
  showControls,
  showRatingControls = true,
  currentIndex,
  totalItems,
  sessionOffset = 0,
  itemType,
  itemTitle,
  itemDocumentId,
  isNewDocument,
  isRating,
  scrollViewMode,
  helpText,
  isEpub = false,
  isMobile = false,
  ratingOrbsPosition = "right",
  onUpdateRatingOrbsPosition,
  onExit,
  onShowSettings,
  onShowRssSettings,
  onSetScrollViewMode,
  onOpenExtractDialog,
  onOpenEpubToc,
  onOpenEpubSettings,
  onEpubPreviousPage,
  onEpubNextPage,
  onRate,
  onDismiss,
  onPriorityChange,
  onGoToNext,
  onGoToPrevious,
  isAssistantVisible = true,
  onToggleAssistant,
  isSummaryActive = false,
  onToggleSummary,
  isNeuralMode = false,
  neuralRemaining = null,
  canGoNeural = false,
  isNeuralLoading = false,
  onGoNeural,
  onExitNeural,
  detailsButton,
  prioritySlider,
  labels,
}: ScrollOverlayControlsProps) {
  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  
  // Dragging and Snapping Logic for Rating Orbs
  const [showPositionMenu, setShowPositionMenu] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragTriggered, setIsDragTriggered] = useState(false);

  const startDrag = (clientX: number, clientY: number, currentTarget: HTMLElement) => {
    const rect = currentTarget.getBoundingClientRect();
    setDragOffset({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
    setDragPos({
      x: rect.left,
      y: rect.top,
    });
    setIsDragTriggered(true);
  };

  useEffect(() => {
    if (!isDragTriggered) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      setDragPos({
        x: clientX - dragOffset.x,
        y: clientY - dragOffset.y,
      });
    };

    const handleUp = (e: MouseEvent | TouchEvent) => {
      setIsDragTriggered(false);
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const releaseX = 'changedTouches' in e && e.changedTouches[0]
        ? e.changedTouches[0].clientX 
        : ('touches' in e && e.touches[0] 
            ? e.touches[0].clientX 
            : (e as MouseEvent).clientX);
      const releaseY = 'changedTouches' in e && e.changedTouches[0]
        ? e.changedTouches[0].clientY 
        : ('touches' in e && e.touches[0] 
            ? e.touches[0].clientY 
            : (e as MouseEvent).clientY);

      const x = releaseX ?? (dragPos ? dragPos.x + 30 : viewportWidth / 2);
      const y = releaseY ?? (dragPos ? dragPos.y + 150 : viewportHeight / 2);

      const distLeft = x;
      const distRight = viewportWidth - x;
      const distTop = y;
      const distBottom = viewportHeight - y;

      const minDist = Math.min(distLeft, distRight, distTop, distBottom);
      let newPosition: "left" | "right" | "top" | "bottom" = "right";
      
      if (minDist === distLeft) newPosition = "left";
      else if (minDist === distRight) newPosition = "right";
      else if (minDist === distTop) newPosition = "top";
      else if (minDist === distBottom) newPosition = "bottom";

      if (onUpdateRatingOrbsPosition) {
        onUpdateRatingOrbsPosition(newPosition);
      }
      setDragPos(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
  }, [isDragTriggered, dragOffset, dragPos, onUpdateRatingOrbsPosition]);

  const isDocOrRss = itemType === "document" || itemType === "rss";
  const showRatingButtons = itemType !== "flashcard" && itemType !== "extract";

  // The help hint ("Rate or use Alt+Arrows…") auto-hides a few seconds after the
  // item changes. On mobile/touch the whole overlay stays visible (controls are
  // always reachable), but the hint was covering the podcast controls — so it
  // fades on its own after 3.5s, and re-shows briefly whenever the item changes.
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    setShowHint(true);
    const id = setTimeout(() => setShowHint(false), 3500);
    return () => clearTimeout(id);
  }, [itemDocumentId, itemType, currentIndex]);

  const typeLabel = itemType === "document"
    ? labels?.docShort ?? "doc"
    : itemType === "flashcard"
      ? labels?.cardShort ?? "card"
      : itemType === "rss"
        ? labels?.rssShort ?? "rss"
        : itemType === "podcast"
          ? "podcast"
          : labels?.extractShort ?? "extract";

  const typeColor = itemType === "document"
    ? "bg-blue-500/30"
    : itemType === "flashcard"
      ? "bg-purple-500/30"
      : itemType === "rss"
        ? "bg-orange-500/30"
        : itemType === "podcast"
          ? "bg-emerald-500/30"
        : "bg-yellow-500/30";

  const priorityControl = onPriorityChange && typeof prioritySlider === "number" ? (
    <ScrollPriorityControl
      value={prioritySlider}
      onChange={onPriorityChange}
      labels={labels}
    />
  ) : null;

  return (
    <>
    {/* Queue chrome fades with showControls. Rating actions have their own
        visibility gate so mobile readers can summon them with a long press. */}
    <div className={cn("fixed inset-0 pointer-events-none transition-all duration-300 z-50", showControls ? "opacity-100 visible" : "opacity-0 invisible")}>
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 pt-[calc(16px+env(safe-area-inset-top,0px))] px-4 pb-4 bg-gradient-to-b from-black/50 to-transparent pointer-events-none">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3 pointer-events-auto">
            <button onClick={onExit} className="p-2 rounded-lg bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors" title={labels?.exit ?? "Exit scroll mode"}>
              <X className="w-5 h-5 text-white" />
            </button>
            {isNeuralMode ? (
              // Neural banner: distinct violet color signals the creative mode.
              // Shows the remaining count and an exit that restores the reading
              // session (does not close the tab).
              <div className="flex items-center gap-2 text-white font-medium text-sm bg-violet-600/70 backdrop-blur-sm px-3 py-2 rounded-lg">
                <Lightning className="w-4 h-4 text-violet-200" weight="fill" />
                <span className="text-violet-50">{labels?.reviewMode ?? "Neural review"}</span>
                {neuralRemaining !== null && (
                  <span className="text-violet-200/90">· {neuralRemaining}</span>
                )}
                <button
                  onClick={onExitNeural}
                  className="ml-1 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition-colors text-xs text-white"
                  title={labels?.exitNeural ?? "Exit neural review"}
                >
                  {labels?.exitNeural ?? "Exit"}
                </button>
              </div>
            ) : (
              <div className="text-white font-medium text-sm bg-black/40 backdrop-blur-sm px-3 py-2 rounded-lg">
                {currentIndex + 1 + sessionOffset} / {totalItems + sessionOffset}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pointer-events-auto">
            {/* Disable EPUB reader buttons on mobile overlay to reduce clutter */}
            {false && isEpub && (
              <div className="flex items-center gap-1 rounded-lg bg-black/40 p-1 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={onOpenEpubToc}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  title="Table of contents"
                >
                  TOC
                </button>
                <button
                  type="button"
                  onClick={onOpenEpubSettings}
                  className="rounded-md px-2 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  title="Reading settings"
                >
                  Aa
                </button>
                <button
                  type="button"
                  onClick={onEpubPreviousPage}
                  className="rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  title="Previous EPUB page"
                >
                  <CaretUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onEpubNextPage}
                  className="rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  title="Next EPUB page"
                >
                  <CaretDown className="h-4 w-4" />
                </button>
              </div>
            )}
            {priorityControl}
            {detailsButton}
            {!isMobile && (
              <>
                <button onClick={onShowSettings} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm transition-colors hover:bg-black/60" title={labels?.settings ?? "Queue Settings"}>
                  <Sliders className="w-4 h-4" />
                  {labels?.settings ?? "Settings"}
                </button>
                <button onClick={onShowRssSettings} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm transition-colors hover:bg-black/60" title={labels?.rss ?? "RSS Settings"}>
                  <Rss className="w-4 h-4" />
                  {labels?.rss ?? "RSS"}
                </button>
                {/* Go neural — explore related material via spreading activation
                    from the current item. Disabled for RSS/podcast (no element_tree
                    node) and while a queue is building. Desktop-only to match the
                    other action buttons. */}
                {onGoNeural && !isNeuralMode && (
                  <button
                    onClick={onGoNeural}
                    disabled={!canGoNeural || isNeuralLoading}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-sm text-white text-sm transition-colors",
                      canGoNeural && !isNeuralLoading
                        ? "bg-violet-600/70 hover:bg-violet-600"
                        : "bg-black/40 opacity-50 cursor-not-allowed",
                    )}
                    title={
                      !canGoNeural
                        ? (labels?.goNeuralTooltip ?? "Open a document, card, or extract to explore related material")
                        : (labels?.goNeuralTooltip ?? "Explore material related to this item")
                    }
                  >
                    {isNeuralLoading ? (
                      <span className="inline-block animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                    ) : (
                      <Brain className="w-4 h-4" />
                    )}
                    {labels?.goNeural ?? "Go neural"}
                  </button>
                )}
                {/* AI Summary toggle (document / rss items only). */}
                {isDocOrRss && onToggleSummary && (
                  <button
                    onClick={onToggleSummary}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-sm text-white text-sm transition-colors",
                      isSummaryActive
                        ? "bg-[#ffb000] text-black hover:bg-[#ffb000]/90"
                        : "bg-black/40 hover:bg-black/60"
                    )}
                    title={isSummaryActive ? (labels?.closeSummary ?? "Close summary") : (labels?.summarize ?? "Summarize")}
                    aria-pressed={isSummaryActive}
                  >
                    <Sparkle className="w-4 h-4" />
                    {isSummaryActive ? (labels?.closeSummary ?? "Summary") : (labels?.summarize ?? "Summarize")}
                  </button>
                )}
                {/* Assistant Show/Hide toggle (desktop; not for flashcard items). */}
                {itemType !== "flashcard" && onToggleAssistant && (
                  <button
                    onClick={onToggleAssistant}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-sm text-white text-sm transition-colors",
                      isAssistantVisible
                        ? "bg-primary/80 hover:bg-primary"
                        : "bg-black/40 hover:bg-black/60"
                    )}
                    title={isAssistantVisible ? (labels?.hideAssistant ?? "Hide Assistant") : (labels?.showAssistant ?? "Show Assistant")}
                    aria-pressed={isAssistantVisible}
                  >
                    <ChatCircle className="w-4 h-4" />
                    {isAssistantVisible ? (labels?.hideAssistant ?? "Assistant") : (labels?.showAssistant ?? "Assistant")}
                  </button>
                )}
                <div className="text-white text-sm bg-black/40 backdrop-blur-sm px-3 py-2 rounded-lg max-w-[200px] sm:max-w-md truncate">
                  <span className="flex items-center gap-2 truncate">
                    <span className={cn("px-1.5 py-0.5 rounded text-xs shrink-0", typeColor)}>{typeLabel}</span>
                    <span className="truncate">{itemTitle}</span>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scroll Mode Toolbar */}
      {isDocOrRss && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-auto">
          <div className="flex items-center gap-1 px-2 py-1.5 bg-black/40 backdrop-blur-sm rounded-lg">
            {itemDocumentId && (
              <div className="flex items-center gap-0.5 bg-white/10 rounded-md p-0.5">
                <button onClick={() => onSetScrollViewMode("document")} className={cn("p-1.5 rounded-md transition-colors", scrollViewMode === "document" ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")} title={labels?.viewDocument ?? "View document"}>
                  <TextT className="w-4 h-4" />
                </button>
                <button onClick={() => onSetScrollViewMode("extracts")} className={cn("p-1.5 rounded-md transition-colors", scrollViewMode === "extracts" ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")} title={labels?.viewExtracts ?? "View extracts"}>
                  <List className="w-4 h-4" />
                </button>
                <button onClick={() => onSetScrollViewMode("cards")} className={cn("p-1.5 rounded-md transition-colors", scrollViewMode === "cards" ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")} title={labels?.viewLearningCards ?? "View learning cards"}>
                  <Brain className="w-4 h-4" />
                </button>
              </div>
            )}
            {scrollViewMode === "document" && itemType === "document" && (
              <button onClick={onOpenExtractDialog} className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors" title={labels?.createExtract ?? "Create extract"}>
                <Lightbulb className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Side/Floating Rating Controls */}
      {showRatingControls && (showRatingButtons || itemType === "flashcard" || itemType === "extract") && (() => {
        const isDraggingActive = dragPos !== null;
        
        let snapClasses = "";
        let layoutClasses = "";
        
        if (!isDraggingActive) {
          switch (ratingOrbsPosition) {
            case "left":
              snapClasses = "left-6 top-1/2 -translate-y-1/2";
              layoutClasses = "flex-col";
              break;
            case "top":
              snapClasses = "top-28 left-1/2 -translate-x-1/2";
              layoutClasses = "flex-row items-center";
              break;
            case "bottom":
              snapClasses = "bottom-28 left-1/2 -translate-x-1/2";
              layoutClasses = "flex-row items-center";
              break;
            case "right":
            default:
              snapClasses = "right-6 top-1/2 -translate-y-1/2";
              layoutClasses = "flex-col";
              break;
          }
        }

        const isHorizontal = ratingOrbsPosition === "top" || ratingOrbsPosition === "bottom";

        const DragHandle = () => (
          <div
            onMouseDown={(e) => startDrag(e.clientX, e.clientY, e.currentTarget.parentElement!)}
            onTouchStart={(e) => {
              if (e.touches && e.touches[0]) {
                startDrag(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget.parentElement!);
              }
            }}
            className={cn(
              "flex items-center justify-center p-2 text-white/40 hover:text-white cursor-grab active:cursor-grabbing rounded-lg hover:bg-white/10 transition-colors",
              isHorizontal ? "mr-1 border-r border-white/10 pr-2" : "mb-1 border-b border-white/10 pb-2"
            )}
            title="Drag to move panel"
          >
            {isHorizontal ? <DotsSix className="w-5 h-5" /> : <DotsSixVertical className="w-5 h-5" />}
          </div>
        );

        const PositionConfig = () => (
          <div className={cn("relative flex items-center justify-center", isHorizontal ? "ml-1 pl-2 border-l border-white/10" : "mt-1 pt-2 border-t border-white/10")}>
            <button
              onClick={() => setShowPositionMenu(!showPositionMenu)}
              className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              title="Change panel edge"
            >
              <ArrowsOutCardinal className="w-5 h-5" />
            </button>
            {showPositionMenu && (
              <div
                className={cn(
                  "absolute bg-slate-900/95 border border-white/10 rounded-xl p-2 flex gap-1.5 shadow-xl z-50 backdrop-blur-md",
                  ratingOrbsPosition === "left" && "left-full ml-2 top-1/2 -translate-y-1/2 flex-col",
                  ratingOrbsPosition === "right" && "right-full mr-2 top-1/2 -translate-y-1/2 flex-col",
                  ratingOrbsPosition === "top" && "top-full mt-2 left-1/2 -translate-x-1/2 flex-row",
                  ratingOrbsPosition === "bottom" && "bottom-full mb-2 left-1/2 -translate-x-1/2 flex-row"
                )}
              >
                <button onClick={() => { onUpdateRatingOrbsPosition?.("left"); setShowPositionMenu(false); }} className={cn("p-1.5 rounded-md hover:bg-white/10 text-white/70 hover:text-white transition-colors", ratingOrbsPosition === "left" && "bg-white/20 text-white")} title="Move Left"><ArrowLeft className="w-4 h-4" /></button>
                <button onClick={() => { onUpdateRatingOrbsPosition?.("top"); setShowPositionMenu(false); }} className={cn("p-1.5 rounded-md hover:bg-white/10 text-white/70 hover:text-white transition-colors", ratingOrbsPosition === "top" && "bg-white/20 text-white")} title="Move Top"><ArrowUp className="w-4 h-4" /></button>
                <button onClick={() => { onUpdateRatingOrbsPosition?.("bottom"); setShowPositionMenu(false); }} className={cn("p-1.5 rounded-md hover:bg-white/10 text-white/70 hover:text-white transition-colors", ratingOrbsPosition === "bottom" && "bg-white/20 text-white")} title="Move Bottom"><ArrowDown className="w-4 h-4" /></button>
                <button onClick={() => { onUpdateRatingOrbsPosition?.("right"); setShowPositionMenu(false); }} className={cn("p-1.5 rounded-md hover:bg-white/10 text-white/70 hover:text-white transition-colors", ratingOrbsPosition === "right" && "bg-white/20 text-white")} title="Move Right"><ArrowRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        );

        const getOrbClass = (colorFromTo: string, glowColor: string, hoverColors: string) => {
          return cn(
            "group relative p-3 rounded-full border border-white/20 border-t-white/40 border-b-white/5",
            "backdrop-blur-md shadow-lg disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-all duration-300 ease-out hover:scale-115 active:scale-95",
            `bg-gradient-to-br ${colorFromTo} hover:${hoverColors}`,
            `shadow-[0_0_15px_${glowColor}] hover:shadow-[0_0_25px_${glowColor}]`
          );
        };

        const topHighlight = (
          <div className="absolute top-1 left-1/2 -translate-x-1/2 w-8 h-3 bg-white/20 rounded-full filter blur-[0.5px] pointer-events-none" />
        );

        const style = isDraggingActive
          ? { position: "fixed" as const, left: dragPos.x, top: dragPos.y, transform: "none", zIndex: 100 }
          : undefined;

        return (
          <div
            style={style}
            className={cn(
              "absolute flex gap-3 pointer-events-auto p-2 bg-gradient-to-br from-slate-900/75 to-slate-900/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] transition-all duration-200 ease-out select-none",
              snapClasses,
              layoutClasses
            )}
          >
            {/* Drag Handle */}
            <DragHandle />

            {/* Ratings Orbs */}
            <div className={cn("flex gap-3", layoutClasses)}>
              {itemType === "flashcard" || itemType === "extract" ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={isRating}
                  className={getOrbClass("from-slate-500/80 to-slate-600/80", "rgba(148,163,184,0.3)", "from-slate-400 to-slate-500")}
                  title={labels?.dismissTitle ?? "Dismiss"}
                >
                  {topHighlight}
                  <EyeSlash className="w-6 h-6 text-white" />
                  <span className={getTooltipClass(ratingOrbsPosition)}>{labels?.dismissLabel ?? "Dismiss"}</span>
                </button>
              ) : itemType === "document" && !isNewDocument ? (
                <>
                  <button
                    type="button"
                    onClick={() => onRate(1)}
                    disabled={isRating}
                    className={getOrbClass("from-red-500/85 to-red-600/85", "rgba(239,68,68,0.4)", "from-red-400 to-red-500")}
                    title={labels?.againTitle ?? "Again"}
                  >
                    {topHighlight}
                    <WarningCircle className="w-6 h-6 text-white" />
                    <span className={getTooltipClass(ratingOrbsPosition)}>{labels?.again ?? "Again"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRate(2)}
                    disabled={isRating}
                    className={getOrbClass("from-orange-500/85 to-orange-600/85", "rgba(249,115,22,0.4)", "from-orange-400 to-orange-500")}
                    title={labels?.hardTitle ?? "Hard"}
                  >
                    {topHighlight}
                    <Star className="w-6 h-6 text-white" />
                    <span className={getTooltipClass(ratingOrbsPosition)}>{labels?.hard ?? "Hard"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRate(3)}
                    disabled={isRating}
                    className={getOrbClass("from-blue-500/85 to-blue-600/85", "rgba(59,130,246,0.4)", "from-blue-400 to-blue-500")}
                    title={labels?.goodTitle ?? "Good"}
                  >
                    {topHighlight}
                    <CheckCircle className="w-6 h-6 text-white" />
                    <span className={getTooltipClass(ratingOrbsPosition)}>{labels?.good ?? "Good"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRate(4)}
                    disabled={isRating}
                    className={getOrbClass("from-green-500/85 to-green-600/85", "rgba(34,197,94,0.4)", "from-green-400 to-green-500")}
                    title={labels?.easyTitle ?? "Easy"}
                  >
                    {topHighlight}
                    <Sparkle className="w-6 h-6 text-white" />
                    <span className={getTooltipClass(ratingOrbsPosition)}>{labels?.easy ?? "Easy"}</span>
                  </button>
                  {itemType === "document" && (
                    <button
                      type="button"
                      onClick={onDismiss}
                      disabled={isRating}
                      className={getOrbClass("from-slate-500/80 to-slate-600/80", "rgba(148,163,184,0.3)", "from-slate-400 to-slate-500")}
                      title={labels?.dismissTitle ?? "Dismiss"}
                    >
                      {topHighlight}
                      <EyeSlash className="w-6 h-6 text-white" />
                      <span className={getTooltipClass(ratingOrbsPosition)}>{labels?.dismissLabel ?? "Dismiss"}</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onRate(3)}
                    disabled={isRating}
                    className={getOrbClass("from-orange-500/85 to-orange-600/85", "rgba(249,115,22,0.4)", "from-orange-400 to-orange-500")}
                    title={itemType === "document" ? (labels?.markAsReadGood ?? "Mark as read (Good)") : (labels?.markAsRead ?? "Mark as read")}
                  >
                    {topHighlight}
                    <CheckCircle className="w-6 h-6 text-white" />
                    <span className={getTooltipClass(ratingOrbsPosition)}>
                      {itemType === "document" ? (labels?.markAsReadGood ?? "Mark as read (Good)") : (labels?.markAsRead ?? "Mark as read")}
                    </span>
                  </button>
                  {itemType === "document" && (
                    <button
                      type="button"
                      onClick={onDismiss}
                      disabled={isRating}
                      className={getOrbClass("from-slate-500/80 to-slate-600/80", "rgba(148,163,184,0.3)", "from-slate-400 to-slate-500")}
                      title={labels?.dismissTitle ?? "Dismiss"}
                    >
                      {topHighlight}
                      <EyeSlash className="w-6 h-6 text-white" />
                      <span className={getTooltipClass(ratingOrbsPosition)}>{labels?.dismissLabel ?? "Dismiss"}</span>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Quick Position Snapper */}
            <PositionConfig />
          </div>
        );
      })()}

      {/* Bottom Navigation (desktop/PWA layout — vertical carets) */}
      {!isMobile && (
        <div className={cn("absolute left-1/2 -translate-x-1/2 flex flex-col gap-2 pointer-events-auto", isTouchDevice ? "bottom-[calc(24px+env(safe-area-inset-bottom,0px))]" : "bottom-6")}>
          <button onClick={onGoToPrevious} disabled={currentIndex === 0} className={cn("p-3 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-all shadow-lg", currentIndex === 0 && "opacity-30 cursor-not-allowed")} title={labels?.previousDocument ?? "Previous"}>
            <CaretUp className="w-6 h-6 text-white" />
          </button>
          <button onClick={onGoToNext} disabled={currentIndex === totalItems - 1} className={cn("p-3 rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-all shadow-lg", currentIndex === totalItems - 1 && "opacity-30 cursor-not-allowed")} title={labels?.nextDocument ?? "Next"}>
            <CaretDown className="w-6 h-6 text-white" />
          </button>
        </div>
      )}

      {/* Mobile Bottom Action Bar */}
      {/* Mobile Bottom Action Bar (disabled per user preference) */}
      {false && isMobile && (
        <div className="absolute left-0 right-0 pointer-events-auto bottom-[calc(56px+env(safe-area-inset-bottom,0px))] px-3 pb-2">
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/70 px-3 py-2 shadow-2xl backdrop-blur-md">
            <button
              onClick={onGoToPrevious}
              disabled={currentIndex === 0}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-w-[44px] py-1.5 px-2 rounded-xl text-white text-[10px] font-medium transition-colors",
                currentIndex === 0 ? "opacity-30" : "active:bg-white/10"
              )}
              title={labels?.previousDocument ?? "Previous"}
            >
              <CaretUp className="w-6 h-6" weight="bold" />
            </button>
            <div className="text-white/60 text-xs font-mono select-none px-4">
              {currentIndex + 1} / {totalItems}
            </div>
            <button
              onClick={onGoToNext}
              disabled={currentIndex === totalItems - 1}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-w-[44px] py-1.5 px-2 rounded-xl text-white text-[10px] font-medium transition-colors",
                currentIndex === totalItems - 1 ? "opacity-30" : "active:bg-white/10"
              )}
              title={labels?.nextDocument ?? "Next"}
            >
              <CaretDown className="w-6 h-6" weight="bold" />
            </button>
          </div>
        </div>
      )}

      {/* Progress Bar (sits at the very bottom on desktop; raised just above the safe area on touch devices) */}
      <div className={cn("absolute left-0 right-0 h-1 bg-black/20 pointer-events-none", isMobile ? "bottom-[calc(56px+env(safe-area-inset-bottom,0px))]" : isTouchDevice ? "bottom-[env(safe-area-inset-bottom,0px)]" : "bottom-0")}>
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${((currentIndex + 1 + sessionOffset) / (totalItems + sessionOffset)) * 100}%` }} />
      </div>

      {/* Help Text (auto-hides after a few seconds; see showHint) */}
      {helpText && showHint && (
        <div className={cn("absolute left-1/2 -translate-x-1/2 text-white text-xs bg-black/40 backdrop-blur-sm px-3 py-1 rounded-lg pointer-events-none transition-opacity duration-500", isMobile ? "bottom-[calc(126px+env(safe-area-inset-bottom,0px))]" : isTouchDevice ? "bottom-[calc(80px+env(safe-area-inset-bottom,0px))]" : "bottom-20")}>
          {helpText}
        </div>
      )}
    </div>
    </>
  );
});

function ScrollPriorityControl({
  value,
  onChange,
  labels,
}: {
  value: number;
  onChange: (slider: number) => void | Promise<void>;
  labels?: ScrollOverlayControlsProps["labels"];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [slider, setSlider] = useState(value);
  const [committedValue, setCommittedValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    setSlider(value);
    setCommittedValue(value);
  }, [value]);

  const currentPreset = getPriorityPreset(slider);
  const presetLabels = [
    labels?.priorityLowest ?? "Lowest",
    labels?.priorityLow ?? "Low",
    labels?.priorityNormal ?? "Normal",
    labels?.priorityHigh ?? "High",
    labels?.priorityHighest ?? "Highest",
  ];
  const currentLabel = presetLabels[PRIORITY_PRESETS.indexOf(currentPreset)];

  const commitPriority = async (nextValue: number, closeAfterSave = false) => {
    const normalized = Math.max(0, Math.min(100, Math.round(nextValue)));
    setSlider(normalized);
    if (normalized === committedValue && !saveFailed) {
      if (closeAfterSave) setIsOpen(false);
      return;
    }

    setIsSaving(true);
    setSaveFailed(false);
    try {
      await onChange(normalized);
      setCommittedValue(normalized);
      if (closeAfterSave) setIsOpen(false);
    } catch (error) {
      console.error("[ScrollPriorityControl] Failed to update priority:", error);
      setSaveFailed(true);
      setSlider(committedValue);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm transition-colors hover:bg-black/60",
          isOpen && "bg-black/60"
        )}
        title={`${labels?.priority ?? "Priority"}: ${currentLabel}`}
        aria-label={`${labels?.priority ?? "Priority"}: ${currentLabel}`}
        aria-expanded={isOpen}
      >
        <Flag className="w-4 h-4" style={{ color: currentPreset.color }} weight="fill" />
        <span className="hidden sm:inline">{currentLabel}</span>
        <CaretDown className={cn("w-3 h-3 text-white/70 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[55]"
            role="presentation"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 top-full z-[60] mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-neutral-950/95 p-3 text-white shadow-2xl backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{labels?.priority ?? "Priority"}</span>
              {isSaving && <span className="text-xs text-white/60">{labels?.prioritySaving ?? "Saving..."}</span>}
              {saveFailed && !isSaving && <span className="text-xs text-red-300">{labels?.prioritySaveFailed ?? "Couldn't save"}</span>}
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {PRIORITY_PRESETS.map((preset, index) => {
                const isSelected = getPriorityPreset(slider).value === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => void commitPriority(preset.value, true)}
                    className={cn(
                      "flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] transition-colors",
                      isSelected
                        ? "border-white/50 bg-white/15 text-white"
                        : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                    )}
                    title={presetLabels[index]}
                  >
                    <Flag className="h-4 w-4" style={{ color: preset.color }} weight="fill" />
                    <span className="max-w-full truncate">{presetLabels[index]}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/65">{labels?.priorityFineTune ?? "Fine-tune"}</span>
                <span className="font-semibold tabular-nums" style={{ color: currentPreset.color }}>{slider}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={slider}
                onChange={(event) => {
                  setSaveFailed(false);
                  setSlider(Number(event.target.value));
                }}
                onMouseUp={(event) => void commitPriority(Number(event.currentTarget.value))}
                onTouchEnd={(event) => void commitPriority(Number(event.currentTarget.value))}
                onBlur={(event) => void commitPriority(Number(event.currentTarget.value))}
                aria-label={labels?.priorityFineTune ?? "Fine-tune priority"}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-primary"
                style={{ accentColor: currentPreset.color }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Compact touch-friendly rating button for the mobile bottom action bar. */
function MobileRateButton({
  label,
  title,
  color,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  color: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-white text-[11px] font-medium shadow transition-colors disabled:opacity-50",
        color
      )}
    >
      <span className="leading-tight">{label.split(" ")[0]}</span>
    </button>
  );
}
