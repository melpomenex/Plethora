import React from "react";
import {
  Brain,
  ChatCircle,
  Lightning,
  Sliders,
  Rss,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { cn } from "../../utils";
import { emitUserInteraction } from "../../lib/feedback/orchestrator";

/**
 * Shared viewport geometry constants for interleaved queue sessions so switching
 * between flashcards, extracts, documents (PDF/EPUB/HTML), podcasts, and videos
 * causes zero vertical chrome shift.
 */
export const SESSION_CHROME_BOUNDS = {
  HEADER_HEIGHT_PX: 48,
  HEADER_TOP_PX: 12,
  DOCK_BOTTOM_PX: 24,
  DOCK_MIN_HEIGHT_PX: 56,
  SAFE_CONTENT_CLASS: "pt-[68px] pb-[92px] px-4 sm:px-8",
  SAFE_TOP_PX: 68,
  SAFE_BOTTOM_PX: 92,
} as const;

export interface SessionChromeHeaderLabels {
  exit?: string;
  reviewMode?: string;
  exitNeural?: string;
  settings?: string;
  rss?: string;
  goNeural?: string;
  goNeuralTooltip?: string;
  summarize?: string;
  closeSummary?: string;
  showAssistant?: string;
  hideAssistant?: string;
}

export interface SessionChromeHeaderProps {
  headerRef?: React.RefObject<HTMLDivElement | null>;
  isMobile: boolean;
  currentIndex: number;
  totalItems: number;
  sessionOffset: number;
  itemType: string;
  itemTitle: string;
  typeLabel: string;
  typeColor: string;
  isDocOrRss: boolean;
  isNeuralMode: boolean;
  neuralRemaining: number | null;
  canGoNeural: boolean;
  isNeuralLoading: boolean;
  isSummaryActive: boolean;
  isAssistantVisible: boolean;
  priorityControl?: React.ReactNode;
  detailsButton?: React.ReactNode;
  provenanceSlot?: React.ReactNode;
  timeboxRingSlot?: React.ReactNode;
  labels?: SessionChromeHeaderLabels;
  onExit: () => void;
  onExitNeural?: () => void;
  onShowSettings: () => void;
  onShowRssSettings: () => void;
  onGoNeural?: () => void;
  onToggleSummary?: () => void;
  onToggleAssistant?: () => void;
}

/**
 * Invariant top bar rendered across every item variant in QueueScrollPage.
 * Keeps its height (48px desktop bar inside standardized header frame) and
 * anchor coordinates identical whether reviewing flashcards, extracts, docs,
 * or video slices.
 */
export function SessionChromeHeader({
  headerRef,
  isMobile,
  currentIndex,
  totalItems,
  sessionOffset,
  itemType,
  itemTitle,
  typeLabel,
  typeColor,
  isDocOrRss,
  isNeuralMode,
  neuralRemaining,
  canGoNeural,
  isNeuralLoading,
  isSummaryActive,
  isAssistantVisible,
  priorityControl,
  detailsButton,
  provenanceSlot,
  timeboxRingSlot,
  labels,
  onExit,
  onExitNeural,
  onShowSettings,
  onShowRssSettings,
  onGoNeural,
  onToggleSummary,
  onToggleAssistant,
}: SessionChromeHeaderProps) {
  return (
    <div
      ref={headerRef}
      data-queue-header
      data-chrome-standardized="true"
      data-item-type={itemType}
      className={cn(
        "absolute top-0 left-0 right-0 z-30 pb-3 bg-gradient-to-b from-black/50 to-transparent pointer-events-none",
        isMobile
          ? "queue-mobile-header"
          : "pt-[calc(12px+env(safe-area-inset-top,0px))] px-4"
      )}
    >
      <div
        data-session-chrome-row="true"
        className={cn(
          "flex items-center justify-between max-w-7xl mx-auto",
          !isMobile && "h-12 min-h-[48px]",
          isMobile && "flex-wrap gap-2 min-h-[48px]"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2.5 pointer-events-auto min-w-0",
            isMobile && "flex-wrap max-w-full gap-2"
          )}
        >
          <button
            onClick={() => {
              emitUserInteraction("queue.closed");
              onExit();
            }}
            onPointerDown={() => emitUserInteraction("queue.closed")}
            className={cn(
              "p-2 rounded-lg bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors shrink-0",
              isMobile && "min-h-11 min-w-11"
            )}
            title={labels?.exit ?? "Exit scroll mode"}
          >
            <X className="w-5 h-5 text-white" />
          </button>

          {timeboxRingSlot}

          {isNeuralMode ? (
            <div
              className={cn(
                "flex items-center gap-2 text-white font-medium text-sm bg-violet-600/70 backdrop-blur-sm px-3 py-2 rounded-lg shrink-0",
                isMobile && "flex-wrap min-w-0 max-w-full break-words"
              )}
            >
              <Lightning className="w-4 h-4 text-violet-200" weight="fill" />
              <span className="text-violet-50">
                {labels?.reviewMode ?? "Neural review"}
              </span>
              {neuralRemaining !== null && (
                <span className="text-violet-200/90">· {neuralRemaining}</span>
              )}
              <button
                onClick={onExitNeural}
                className={cn(
                  "ml-1 px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition-colors text-xs text-white",
                  isMobile && "min-h-11 min-w-11"
                )}
                title={labels?.exitNeural ?? "Exit neural review"}
              >
                {labels?.exitNeural ?? "Exit"}
              </button>
            </div>
          ) : (
            <div className="text-white font-medium text-sm bg-black/40 backdrop-blur-sm px-3 py-2 rounded-lg shrink-0 tabular-nums">
              {currentIndex + 1 + sessionOffset} / {totalItems + sessionOffset}
            </div>
          )}

          {provenanceSlot}
        </div>

        <div
          className={cn(
            "flex items-center gap-2.5 pointer-events-auto",
            isMobile && "flex-wrap min-w-0 max-w-full gap-2"
          )}
        >
          {priorityControl}
          {detailsButton}
          {!isMobile && (
            <>
              <button
                onClick={onShowSettings}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm transition-colors hover:bg-black/60 shrink-0"
                title={labels?.settings ?? "Queue Settings"}
              >
                <Sliders className="w-4 h-4" />
                {labels?.settings ?? "Settings"}
              </button>
              <button
                onClick={onShowRssSettings}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm transition-colors hover:bg-black/60 shrink-0"
                title={labels?.rss ?? "RSS Settings"}
              >
                <Rss className="w-4 h-4" />
                {labels?.rss ?? "RSS"}
              </button>
              {onGoNeural && !isNeuralMode && (
                <button
                  onClick={onGoNeural}
                  disabled={!canGoNeural || isNeuralLoading}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-sm text-white text-sm transition-colors shrink-0",
                    canGoNeural && !isNeuralLoading
                      ? "bg-violet-600/70 hover:bg-violet-600"
                      : "bg-black/40 opacity-50 cursor-not-allowed"
                  )}
                  title={
                    !canGoNeural
                      ? (labels?.goNeuralTooltip ??
                        "Open a document, card, or extract to explore related material")
                      : (labels?.goNeuralTooltip ??
                        "Explore material related to this item")
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
              {isDocOrRss && onToggleSummary && (
                <button
                  onClick={onToggleSummary}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-sm text-white text-sm transition-colors shrink-0",
                    isSummaryActive
                      ? "bg-[#ffb000] text-black hover:bg-[#ffb000]/90"
                      : "bg-black/40 hover:bg-black/60"
                  )}
                  title={
                    isSummaryActive
                      ? (labels?.closeSummary ?? "Close summary")
                      : (labels?.summarize ?? "Summarize")
                  }
                  aria-pressed={isSummaryActive}
                >
                  <Sparkle className="w-4 h-4" />
                  {isSummaryActive
                    ? (labels?.closeSummary ?? "Summary")
                    : (labels?.summarize ?? "Summarize")}
                </button>
              )}
              {itemType !== "flashcard" && onToggleAssistant && (
                <button
                  onClick={onToggleAssistant}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-sm text-white text-sm transition-colors shrink-0",
                    isAssistantVisible
                      ? "bg-primary/80 hover:bg-primary"
                      : "bg-black/40 hover:bg-black/60"
                  )}
                  title={
                    isAssistantVisible
                      ? (labels?.hideAssistant ?? "Hide Assistant")
                      : (labels?.showAssistant ?? "Show Assistant")
                  }
                  aria-pressed={isAssistantVisible}
                >
                  <ChatCircle className="w-4 h-4" />
                  {isAssistantVisible
                    ? (labels?.hideAssistant ?? "Assistant")
                    : (labels?.showAssistant ?? "Assistant")}
                </button>
              )}
              <div className="text-white text-sm bg-black/40 backdrop-blur-sm px-3 py-2 rounded-lg max-w-[200px] sm:max-w-md truncate shrink-0">
                <span className="flex items-center gap-2 truncate">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded text-xs shrink-0",
                      typeColor
                    )}
                  >
                    {typeLabel}
                  </span>
                  <span className="truncate">{itemTitle}</span>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
