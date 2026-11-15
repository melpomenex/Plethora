import React, { useState, useEffect, useRef, useId } from "react";
import {
  Brain,
  CaretDown,
  CaretUp,
  CheckCircle,
  EyeSlash,
  Flag,
  Lightbulb,
  List,
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
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { useDialogFocus } from "../md3/Dialog";
import { cn } from "../../utils";
import { RatingOrb, type RatingOrbAction } from "../review/RatingOrb";
import { useBottomControlsGeometry } from "../mobile/BottomControlsGeometry";
import { useRatingDockBounds } from "./useRatingDockBounds";
import { emitInteractionFeedback } from "../../lib/feedback/orchestrator";
import { usePriorityCommitState } from "../../services/priority/priorityCommit";
import { SessionChromeHeader } from "./SessionChromeHeader";
import { QueueProvenancePill, type QueueProvenanceInfo } from "./QueueProvenancePill";
import { useUIStore } from "../../stores/uiStore";
import type { QueueOrderingMode } from "../../types/queue";

interface ScrollOverlayControlsProps {
  showControls: boolean;
  showRatingControls?: boolean;
  currentIndex: number;
  totalItems: number;
  sessionOffset?: number;
  itemType: string;
  itemTitle: string;
  itemDocumentId?: string;
  /** Queue identity, including extracts sharing a parent document. */
  itemId?: string;
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
  onRate: (rating: number, grade?: number) => void;
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
  /** Optional Queue Provenance Pill slot mounted in header */
  provenanceSlot?: React.ReactNode;
  /** Structured provenance info to auto-render QueueProvenancePill in header */
  provenanceInfo?: QueueProvenanceInfo;
  onSnooze?: (days: number) => void | Promise<void>;
  onOrderingModeChange?: (mode: QueueOrderingMode) => void;
  provenanceOpenRequestKey?: number;
  /** Optional Timebox completion ring slot mounted in header */
  timeboxRingSlot?: React.ReactNode;
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
    close?: string;
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

export const ScrollOverlayControls = React.memo(function ScrollOverlayControls({
  showControls,
  showRatingControls = true,
  currentIndex,
  totalItems,
  sessionOffset = 0,
  itemType,
  itemTitle,
  itemDocumentId,
  itemId,
  isNewDocument,
  isRating,
  scrollViewMode,
  helpText,
  isEpub: _isEpub = false,
  isMobile = false,
  ratingOrbsPosition = "right",
  onUpdateRatingOrbsPosition,
  onExit,
  onShowSettings,
  onShowRssSettings,
  onSetScrollViewMode,
  onOpenExtractDialog,
  onOpenEpubToc: _onOpenEpubToc,
  onOpenEpubSettings: _onOpenEpubSettings,
  onEpubPreviousPage: _onEpubPreviousPage,
  onEpubNextPage: _onEpubNextPage,
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
  provenanceSlot,
  provenanceInfo,
  onSnooze,
  onOrderingModeChange,
  provenanceOpenRequestKey,
  timeboxRingSlot,
  prioritySlider,
  labels,
}: ScrollOverlayControlsProps) {
  const bottomGeometry = useBottomControlsGeometry();
  const overlayRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useRatingDockBounds(overlayRef, headerRef, footerRef, bottomGeometry, showControls && showRatingControls);
  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  
  // Dragging and Snapping Logic for Rating Orbs
  const [showPositionMenu, setShowPositionMenu] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragTriggered, setIsDragTriggered] = useState(false);
  const lastSnapQuadrantRef = useRef<"left" | "right" | "top" | "bottom">(ratingOrbsPosition);

  const startDrag = (clientX: number, clientY: number, currentTarget: HTMLElement) => {
    lastSnapQuadrantRef.current = ratingOrbsPosition;
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

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const x = clientX;
      const y = clientY;

      const distLeft = x;
      const distRight = viewportWidth - x;
      const distTop = y;
      const distBottom = viewportHeight - y;

      const minDist = Math.min(distLeft, distRight, distTop, distBottom);
      let targetPosition: "left" | "right" | "top" | "bottom" = "right";
      
      if (minDist === distLeft) targetPosition = "left";
      else if (minDist === distRight) targetPosition = "right";
      else if (minDist === distTop) targetPosition = "top";
      else if (minDist === distBottom) targetPosition = "bottom";

      if (targetPosition !== lastSnapQuadrantRef.current) {
        lastSnapQuadrantRef.current = targetPosition;
        emitInteractionFeedback("queue.orbs-drag-threshold", { position: targetPosition }, {
          interactionId: `queue:orb-threshold:${targetPosition}:${Date.now()}`,
          origin: "user",
        });
      }
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
      emitInteractionFeedback("queue.orbs-docked", { position: newPosition }, {
        interactionId: `queue:orb-docked:${newPosition}:${Date.now()}`,
        origin: "user",
      });
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

  const densityMode = useUIStore((s) => s.densityMode);
  const priorityControl = showControls && densityMode === "architect" && onPriorityChange && typeof prioritySlider === "number" ? (
    <div data-architect-telemetry="true">
      <ScrollPriorityControl
        key={itemId ?? `${itemType}:${itemDocumentId}:${currentIndex}`}
        isMobile={isMobile}
        value={prioritySlider}
        onChange={onPriorityChange}
        labels={labels}
      />
    </div>
  ) : null;

  const resolvedProvenanceSlot =
    provenanceSlot ??
    (showControls && provenanceInfo ? (
      <QueueProvenancePill
        info={provenanceInfo}
        isMobile={isMobile}
        onSnooze={onSnooze}
        onPriorityChange={onPriorityChange}
        onOrderingModeChange={onOrderingModeChange}
        openRequestKey={provenanceOpenRequestKey}
      />
    ) : undefined);

  return (
    <>
    {/* Queue chrome fades with showControls. Rating actions have their own
        visibility gate so mobile readers can summon them with a long press. */}
    <div data-queue-overlay ref={overlayRef} inert={bottomGeometry?.blocked || undefined} aria-hidden={bottomGeometry?.blocked || undefined}
      style={bottomGeometry ? { top: bottomGeometry.viewportTop, height: bottomGeometry.viewportHeight, bottom: "auto" } : undefined}
      className={cn("fixed inset-0 pointer-events-none transition-all duration-300 z-50", showControls ? "opacity-100 visible" : "opacity-0 invisible")}>
      {/* Standardized invariant Top Bar across Flashcard, Extract, Doc & Video */}
      <SessionChromeHeader
        headerRef={headerRef}
        isMobile={isMobile}
        currentIndex={currentIndex}
        totalItems={totalItems}
        sessionOffset={sessionOffset}
        itemType={itemType}
        itemTitle={itemTitle}
        typeLabel={typeLabel}
        typeColor={typeColor}
        isDocOrRss={isDocOrRss}
        isNeuralMode={isNeuralMode}
        neuralRemaining={neuralRemaining}
        canGoNeural={canGoNeural}
        isNeuralLoading={isNeuralLoading}
        isSummaryActive={isSummaryActive}
        isAssistantVisible={isAssistantVisible}
        priorityControl={priorityControl}
        detailsButton={detailsButton}
        provenanceSlot={resolvedProvenanceSlot}
        timeboxRingSlot={timeboxRingSlot}
        labels={labels}
        onExit={onExit}
        onExitNeural={onExitNeural}
        onShowSettings={onShowSettings}
        onShowRssSettings={onShowRssSettings}
        onGoNeural={onGoNeural}
        onToggleSummary={onToggleSummary}
        onToggleAssistant={onToggleAssistant}
      />

      {/* Scroll Mode Toolbar sits cleanly below the fixed header coordinate without mutating [data-queue-header] height. */}
      {isDocOrRss && (
        <div
          data-queue-modes
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-20 flex justify-center pointer-events-none",
            isMobile ? "top-[calc(64px+env(safe-area-inset-top,0px))]" : "top-[calc(66px+env(safe-area-inset-top,0px))]"
          )}
        >
          <div className={cn("flex items-center gap-1 px-2 py-1.5 bg-black/40 backdrop-blur-sm rounded-lg pointer-events-auto", isMobile && "flex-wrap max-w-full")}>
            {itemDocumentId && (
              <div className="flex items-center gap-0.5 bg-white/10 rounded-md p-0.5">
                <button onClick={() => onSetScrollViewMode("document")} aria-pressed={scrollViewMode === "document"} className={cn("p-1.5 rounded-md transition-colors", isMobile && "min-h-11 min-w-11", scrollViewMode === "document" ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")} title={labels?.viewDocument ?? "View document"}>
                  <TextT className="w-4 h-4" />
                </button>
                <button onClick={() => onSetScrollViewMode("extracts")} aria-pressed={scrollViewMode === "extracts"} className={cn("p-1.5 rounded-md transition-colors", isMobile && "min-h-11 min-w-11", scrollViewMode === "extracts" ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")} title={labels?.viewExtracts ?? "View extracts"}>
                  <List className="w-4 h-4" />
                </button>
                <button onClick={() => onSetScrollViewMode("cards")} aria-pressed={scrollViewMode === "cards"} className={cn("p-1.5 rounded-md transition-colors", isMobile && "min-h-11 min-w-11", scrollViewMode === "cards" ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")} title={labels?.viewLearningCards ?? "View learning cards"}>
                  <Brain className="w-4 h-4" />
                </button>
              </div>
            )}
            {scrollViewMode === "document" && itemType === "document" && (
              <button onClick={onOpenExtractDialog} className={cn("p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors", isMobile && "min-h-11 min-w-11")} title={labels?.createExtract ?? "Create extract"}>
                <Lightbulb className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Shared presentation retains this reader's grading and docking handlers. */}
      {showRatingControls && (showRatingButtons || itemType === "flashcard" || itemType === "extract") && (() => {
        const isHorizontal = ratingOrbsPosition === "top" || ratingOrbsPosition === "bottom";
        const dismiss = { action: "dismiss" as RatingOrbAction, title: labels?.dismissTitle ?? "Dismiss", icon: EyeSlash, run: onDismiss };
        const actions = itemType === "flashcard" || itemType === "extract" ? [dismiss]
          : itemType === "document" && !isNewDocument ? [
            { action: "again" as RatingOrbAction, title: labels?.againTitle ?? "Again", icon: WarningCircle, run: () => onRate(1) },
            { action: "hard" as RatingOrbAction, title: labels?.hardTitle ?? "Hard", icon: Star, run: () => onRate(2) },
            { action: "good" as RatingOrbAction, title: labels?.goodTitle ?? "Good", icon: CheckCircle, run: () => onRate(3) },
            { action: "easy" as RatingOrbAction, title: labels?.easyTitle ?? "Easy", icon: Sparkle, run: () => onRate(4) },
            dismiss,
          ] : [
            { action: "good" as RatingOrbAction, title: itemType === "document" ? labels?.markAsReadGood ?? "Mark as read (Good)" : labels?.markAsRead ?? "Mark as read", icon: CheckCircle, run: () => onRate(3) },
            ...(itemType === "document" ? [dismiss] : []),
          ];
        return <div
          data-rating-dock data-edge={ratingOrbsPosition} data-horizontal={isHorizontal}
          data-dock-standardized="true"
          style={dragPos ? { position: "fixed", left: dragPos.x, top: dragPos.y, bottom: "auto", transform: "none", zIndex: 100 } : undefined}
          className={cn(
            "rating-dock absolute z-30 min-h-[56px]",
            isHorizontal ? "left-1/2 -translate-x-1/2 flex-row" : "-translate-y-1/2 flex-col",
            ratingOrbsPosition === "left" && "left-6",
            ratingOrbsPosition === "right" && "right-6",
            ratingOrbsPosition === "bottom" && "bottom-6"
          )}
        >
          <div className="rating-dock-actions">
            {actions.map(({ action, title, icon: Icon, run }) => <RatingOrb key={action} action={action} title={title}
              onClick={run} disabled={isRating}
              onPointerDown={() => emitInteractionFeedback("queue.orb-pressed", { orbType: action }, {
                interactionId: `queue:orb-press:${action}:${Date.now()}`, origin: "user",
              })}><Icon aria-hidden="true" /></RatingOrb>)}
          </div>
          <div className="rating-dock-utilities">
            <button type="button" className="rating-dock-utility rating-dock-drag" title="Drag to move panel" aria-label="Drag to move panel"
              onMouseDown={e => startDrag(e.clientX, e.clientY, e.currentTarget.closest<HTMLElement>("[data-rating-dock]")!)}
              onTouchStart={e => { if (e.touches[0]) startDrag(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget.closest<HTMLElement>("[data-rating-dock]")!); }}>
              {isHorizontal ? <DotsSix size={20} /> : <DotsSixVertical size={20} />}
            </button>
            <button type="button" className="rating-dock-utility" title="Change panel edge" aria-label="Change panel edge"
              aria-expanded={showPositionMenu} onClick={() => setShowPositionMenu(!showPositionMenu)}><ArrowsOutCardinal size={20} /></button>
          </div>
          {showPositionMenu && <div className="rating-placement-menu" role="group" aria-label="Panel edge">
            {([ ["left", ArrowLeft, "Move Left"], ["top", ArrowUp, "Move Top"], ["bottom", ArrowDown, "Move Bottom"], ["right", ArrowRight, "Move Right"] ] as const).map(([position, Icon, title]) =>
              <button key={position} type="button" title={title} aria-label={title} aria-pressed={ratingOrbsPosition === position}
                onClick={() => { onUpdateRatingOrbsPosition?.(position); setShowPositionMenu(false); emitInteractionFeedback("queue.orbs-docked", { position }, { interactionId: `queue:orb-docked:${position}:${Date.now()}`, origin: "user" }); }}><Icon size={20} /></button>)}
          </div>}
        </div>;
      })()}

      {/* Bottom Navigation (desktop/PWA layout — vertical carets) */}
      {!isMobile && (
        <div ref={footerRef} className={cn("absolute left-1/2 -translate-x-1/2 flex flex-col gap-2 pointer-events-auto", isTouchDevice ? "bottom-[calc(24px+env(safe-area-inset-bottom,0px))]" : "bottom-6")}>
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

/** Saved priority and in-flight work belong to one keyed queue item. */
function useScrollPriorityState(value: number, onChange: (slider: number) => void | Promise<void>) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    slider,
    committedValue,
    isSaving,
    saveFailed,
    sliderHandlers,
    commitPriority: commit,
  } = usePriorityCommitState({
    initialValue: value,
    customCommit: onChange,
  });

  const commitPriority = async (nextValue: number, closeAfterSave = false) => {
    await commit(nextValue, closeAfterSave ? () => setIsOpen(false) : undefined);
  };

  return { isOpen, setIsOpen, slider, committedValue, isSaving, saveFailed, sliderHandlers, commitPriority };
}

function ScrollPriorityControl({ value, onChange, labels, isMobile }: {
  value: number;
  onChange: (slider: number) => void | Promise<void>;
  labels?: ScrollOverlayControlsProps["labels"];
  isMobile: boolean;
}) {
  const { isOpen, setIsOpen, slider, committedValue, isSaving, saveFailed, sliderHandlers, commitPriority } = useScrollPriorityState(value, onChange);
  const trigger = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  const sliderId = useId();
  const panelRef = useDialogFocus(isOpen && !isMobile, () => setIsOpen(false));
  useEffect(() => {
    if (!isOpen) return;
    // The sheet portals outside the shell. Block reader, ratings and navigation
    // while preserving the reading scroll offset and the trigger for focus return.
    const button = trigger.current;
    const root = isMobile ? (button?.closest<HTMLElement>(".adaptive-shell-root")
      ?? button?.closest<HTMLElement>("[data-queue-overlay]")) : undefined;
    const wasInert = root?.inert;
    if (root) root.inert = true;
    // Dialog focus/dismissal listens on document; reader shortcuts listen on
    // window. Let the dialog and native inputs operate, then stop reader keys.
    const blockReaderKeys = (event: KeyboardEvent) => event.stopPropagation();
    document.addEventListener("keydown", blockReaderKeys);
    return () => {
      document.removeEventListener("keydown", blockReaderKeys);
      if (root) root.inert = wasInert ?? false;
      // Shared dialog cleanup can run before this shell unlock. Return focus
      // once all dismissal effects have completed, without moving the reader.
      window.requestAnimationFrame(() => { if (button?.isConnected && !root?.inert && button.getAttribute("aria-expanded") === "false") button.focus({ preventScroll: true }); });
    };
  }, [isOpen, isMobile]);

  const currentPreset = getPriorityPreset(slider);
  const presetLabels = [labels?.priorityLowest ?? "Lowest", labels?.priorityLow ?? "Low",
    labels?.priorityNormal ?? "Normal", labels?.priorityHigh ?? "High", labels?.priorityHighest ?? "Highest"];
  const savedPreset = getPriorityPreset(committedValue);
  const savedLabel = presetLabels[PRIORITY_PRESETS.indexOf(savedPreset)];
  const title = labels?.priority ?? "Reading Priority";
  const closeLabel = labels?.close ?? "Close";

  const editor = <div className="queue-priority-editor" aria-busy={isSaving}>
    <div role="status" aria-live="polite" className="text-sm text-on-surface-variant">
      {isSaving ? (labels?.prioritySaving ?? "Saving...") : null}
    </div>
    {saveFailed && <p role="alert" className="text-sm text-error">
      {labels?.prioritySaveFailed ?? "Couldn't save priority. Try again."}
    </p>}
    <div className="queue-priority-presets" role="group" aria-label={title}>
      {PRIORITY_PRESETS.map((preset, index) => {
        const selected = currentPreset.value === preset.value;
        return <button key={preset.value} type="button" disabled={isSaving}
          aria-pressed={selected} onClick={() => void commitPriority(preset.value, true)}
          className={cn("md-state queue-priority-preset", selected && "queue-priority-selected")}>
          <Flag aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: preset.color }} weight="fill" />
          <span className="min-w-0 flex-1 break-words">{presetLabels[index]}</span>
          <CheckCircle aria-hidden="true" className={cn("h-5 w-5 shrink-0", !selected && "invisible")} weight="bold" />
        </button>;
      })}
    </div>
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <label htmlFor={sliderId}>{labels?.priorityFineTune ?? "Fine-tune"}</label>
        <output htmlFor={sliderId} className="font-semibold tabular-nums">{slider}%</output>
      </div>
      <input id={sliderId} type="range" min="0" max="100" value={slider} aria-disabled={isSaving}
        {...sliderHandlers}
        className="min-h-11 w-full cursor-pointer accent-primary" />
    </div>
  </div>;

  return <div className="relative min-w-0 max-w-full">
    <button ref={trigger} type="button" onClick={() => setIsOpen(open => !open)}
      className={cn("flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm transition-colors hover:bg-black/60", isMobile && "min-h-11 min-w-11 max-w-full", isOpen && "bg-black/60")}
      title={`${title}: ${savedLabel}`} aria-label={`${title}: ${savedLabel}`}
      aria-expanded={isOpen} aria-controls={isOpen ? editorId : undefined} aria-haspopup="dialog">
      <Flag aria-hidden="true" className="w-4 h-4 shrink-0" style={{ color: savedPreset.color }} weight="fill" />
      <span className="break-words min-w-0">{savedLabel}</span>
      <CaretDown aria-hidden="true" className="w-3 h-3 shrink-0 text-white/70" />
    </button>
    {isMobile ? <ResponsiveDialogSheet open={isOpen} onClose={() => setIsOpen(false)}
      title={title} closeLabel={closeLabel} id={editorId} presentation="sheet">{editor}</ResponsiveDialogSheet>
      : isOpen && <>
        <div className="fixed inset-0 z-[var(--md-z-overlay)]" role="presentation" onClick={() => setIsOpen(false)} />
        <div ref={panelRef} id={editorId} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
          className="absolute right-0 top-full z-[var(--md-z-dialog)] mt-2 w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto rounded-xl bg-surface-container-high p-4 text-on-surface shadow-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" aria-label={closeLabel} onClick={() => setIsOpen(false)} className="adaptive-icon-button"><X size={20} /></button>
          </div>
          {editor}
        </div>
      </>}
  </div>;
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
