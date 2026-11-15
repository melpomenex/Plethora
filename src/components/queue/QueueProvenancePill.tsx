import React, { useEffect, useId, useRef, useState } from "react";
import { CalendarPlus, CaretDown, Compass, Flag, GitBranch, Sliders } from "@phosphor-icons/react";
import { cn } from "../../utils";
import { schedulerLabel } from "../../lib/schedulerCatalog";
import { normalizeSchedulerId } from "../../lib/schedulerIdentity";
import { setQueueOrderingMode } from "../../stores/queueOrderingSettings";
import type { QueueOrderingMode } from "../../types/queue";

export interface QueueProvenanceInfo {
  itemId: string;
  itemType: "flashcard" | "extract" | "document" | "rss" | "podcast" | "video-extract" | string;
  orderingMode: QueueOrderingMode;
  algorithmType?: string;
  prioritySlider: number;
  priorityExplicitlySet: boolean;
  parentDocumentId?: string;
  parentDocumentTitle?: string;
  stability?: number;
  retrievability?: number;
}

export interface QueueProvenancePillProps {
  info: QueueProvenanceInfo;
  isMobile?: boolean;
  onSnooze?: (days: number) => void | Promise<void>;
  onPriorityChange?: (slider: number) => void | Promise<void>;
  onOrderingModeChange?: (nextMode: QueueOrderingMode) => void;
  /** Controlled open trigger incrementer (e.g., from [P] triage shortcut). */
  openRequestKey?: number;
  className?: string;
}

export function clampProvenanceSlider(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function resolveProvenanceSummary(info: QueueProvenanceInfo): {
  scheduleReason: string;
  priorityLabel: string;
  lineageLabel: string;
  fullText: string;
} {
  const scheduleReason =
    info.orderingMode === "strict_manual"
      ? "Pinned: Strict Manual"
      : info.algorithmType
        ? `Due via ${schedulerLabel(normalizeSchedulerId(info.algorithmType))}`
        : "Adaptive DAQE";

  const clampedPriority = clampProvenanceSlider(info.prioritySlider);
  const priorityLabel = `Priority ${clampedPriority}`;
  const lineageLabel =
    !info.priorityExplicitlySet && info.parentDocumentTitle?.trim()
      ? `Inherited from ${info.parentDocumentTitle.trim()}`
      : "Explicit Priority";

  return {
    scheduleReason,
    priorityLabel,
    lineageLabel,
    fullText: `${scheduleReason} • ${priorityLabel} • ${lineageLabel}`,
  };
}

/**
 * Interactive header provenance pill explaining why the current item sits
 * in the active session slot and providing 1-click Snooze, Reprioritize,
 * and Ordering Mode overrides.
 */
export const QueueProvenancePill = React.memo(function QueueProvenancePill({
  info,
  isMobile = false,
  onSnooze,
  onPriorityChange,
  onOrderingModeChange,
  openRequestKey = 0,
  className,
}: QueueProvenancePillProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftSlider, setDraftSlider] = useState(() => clampProvenanceSlider(info.prioritySlider));
  const [isBusy, setIsBusy] = useState(false);
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftSlider(clampProvenanceSlider(info.prioritySlider));
  }, [info.itemId, info.prioritySlider]);

  useEffect(() => {
    if (openRequestKey > 0) {
      setIsOpen(true);
    }
  }, [openRequestKey]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const summary = resolveProvenanceSummary({
    ...info,
    prioritySlider: draftSlider,
  });

  const commitSlider = async (target: number) => {
    const next = clampProvenanceSlider(target);
    setDraftSlider(next);
    if (!onPriorityChange) return;
    setIsBusy(true);
    try {
      await onPriorityChange(next);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSnooze = async (days: number) => {
    if (!onSnooze) return;
    setIsBusy(true);
    try {
      await onSnooze(days);
      setIsOpen(false);
    } finally {
      setIsBusy(false);
    }
  };

  const nextOrderingMode: QueueOrderingMode =
    info.orderingMode === "strict_manual" ? "adaptive" : "strict_manual";

  const handleToggleOrdering = () => {
    setQueueOrderingMode(nextOrderingMode);
    onOrderingModeChange?.(nextOrderingMode);
  };

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center min-w-0", className)}>
      <button
        type="button"
        data-queue-provenance-pill="true"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/45 px-2.5 py-1.5 text-xs font-medium text-white/95 backdrop-blur-sm transition-colors hover:bg-black/65 max-w-[360px] min-w-0",
          isMobile && "min-h-10 max-w-[230px]",
          isOpen && "bg-black/75 ring-1 ring-white/30"
        )}
        title={summary.fullText}
      >
        <Compass className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
        <span className="truncate">{summary.fullText}</span>
        <CaretDown className="h-3 w-3 shrink-0 text-white/70" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Queue scheduling provenance"
          data-provenance-popover="true"
          onKeyDown={(e) => {
            if (e.key !== "Escape") e.stopPropagation();
          }}
          className="absolute left-0 top-full mt-2 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl"
        >
          <div className="mb-3 space-y-1 border-b border-border pb-2.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>{summary.scheduleReason}</span>
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary tabular-nums">
                {summary.priorityLabel}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{summary.lineageLabel}</span>
            </div>
          </div>

          <div className="space-y-3.5">
            {/* 1-Click Snooze */}
            {onSnooze && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Snooze</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 3, 7].map((days) => (
                    <button
                      key={days}
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleSnooze(days)}
                      className="rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      Snooze {days}d
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Inline Priority Reprioritize */}
            {onPriorityChange && (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Reprioritize</span>
                  </span>
                  <span className="font-mono font-semibold text-foreground tabular-nums">
                    {draftSlider}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    aria-label="Decrease priority by 5"
                    onClick={() => void commitSlider(draftSlider - 5)}
                    className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  >
                    -5
                  </button>
                  <input
                    type="range"
                    aria-label="Item priority slider"
                    min={0}
                    max={100}
                    value={draftSlider}
                    disabled={isBusy}
                    onChange={(e) => {
                      const next = clampProvenanceSlider(Number(e.target.value));
                      setDraftSlider(next);
                      void commitSlider(next);
                    }}
                    className="w-full cursor-pointer accent-primary"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    aria-label="Increase priority by 5"
                    onClick={() => void commitSlider(draftSlider + 5)}
                    className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                  >
                    +5
                  </button>
                </div>
              </div>
            )}

            {/* Ordering Profile Switch */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleToggleOrdering}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
              >
                <Sliders className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {info.orderingMode === "strict_manual"
                    ? "Switch to Adaptive"
                    : "Switch to Strict Manual"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
