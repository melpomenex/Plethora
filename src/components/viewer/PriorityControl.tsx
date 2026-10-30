/**
 * Document Priority Control
 * 
 * Allows users to set the priority of a document, which affects:
 * 1. How often it appears in the queue (higher = more frequent)
 * 2. How "Hard" ratings are handled (high priority = shorter max interval)
 * 
 * UI/UX Principles:
 * - Clean, unobtrusive design
 * - Clear visual feedback
 * - Preset buttons for quick selection
 * - Slider for fine-tuning with pointer/touch/keyboard parity
 * - Unified draft/commit lifecycle with retry on failure
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "../../utils";
import { CaretDown, CaretUp, Flag } from "@phosphor-icons/react";
import { getPriorityStanding, type PriorityStanding } from "../../api/queue";
import { useI18n } from "../../lib/i18n";
import {
  PRIORITY_PRESETS,
  getPriorityInfo,
  sliderToRating,
  usePriorityCommitState,
  type PriorityTarget,
} from "../../services/priority/priorityCommit";

/**
 * Which kind of item this control targets. Documents and learning items both
 * carry a 0-100 priority slider; this just
 * selects which update command to call.
 */
type PriorityTargetKind = "document" | "learningItem";

interface PriorityControlProps {
  /** The id of the item whose priority is being set. */
  documentId: string;
  prioritySlider?: number; // 0-100
  priorityRating?: number; // 1-5
  onPriorityChange?: (slider: number, rating: number) => void;
  className?: string;
  variant?: "compact" | "full";
  /**
   * What `documentId` refers to. Defaults to `"document"` for back-compat with
   * existing call sites; pass `"learningItem"` to set a card's priority instead
   * (Phase 3 — the priority queue treats topics and items uniformly).
   */
  targetKind?: PriorityTargetKind;
  /**
   * Overrides for the element's priority-queue standing ("Position X of N").
   * Normally omitted — the control looks its own standing up when opened, so
   * the readout is the element's live rank rather than a value a caller
   * happened to have on hand. Pass these only to render a known standing
   * without a round trip.
   */
  queuePosition?: number;
  queueSize?: number;
}

export function PriorityControl({
  documentId,
  prioritySlider = 50,
  priorityRating: _priorityRating = 3,
  onPriorityChange,
  className,
  variant = "compact",
  targetKind = "document",
  queuePosition,
  queueSize,
}: PriorityControlProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [standing, setStanding] = useState<PriorityStanding | null>(null);
  const { t } = useI18n();

  const target: PriorityTarget = useMemo(
    () => ({ kind: targetKind, id: documentId }),
    [targetKind, documentId],
  );

  const {
    slider,
    isSaving,
    saveFailed,
    errorMessage,
    sliderHandlers,
    commitPriority,
    cancelDraft,
  } = usePriorityCommitState({
    target,
    initialValue: prioritySlider,
    onCommitted: (result) => {
      onPriorityChange?.(result.slider, result.rating ?? sliderToRating(result.slider));
    },
  });

  const currentInfo = getPriorityInfo(slider);

  // Prop overrides win; otherwise show the standing we looked up.
  const shownPosition = queuePosition ?? standing?.position;
  const shownQueueSize = queueSize ?? standing?.queueSize;

  // Priority is a rank, so the readout is only true at the moment it is read:
  // refresh it whenever the popup opens and after each save. Skipped entirely
  // when the caller supplies its own standing.
  useEffect(() => {
    if (!isExpanded || (queuePosition !== undefined && queueSize !== undefined)) return;
    let cancelled = false;
    getPriorityStanding(documentId)
      .then((result) => {
        if (!cancelled) setStanding(result);
      })
      .catch(() => {
        if (!cancelled) setStanding(null);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, isExpanded, isSaving, queuePosition, queueSize]);

  const handlePresetClick = useCallback(
    (presetValue: number) => {
      void commitPriority(presetValue);
      if (variant === "compact") {
        setIsExpanded(false);
      }
    },
    [commitPriority, variant],
  );

  const handleCloseCompact = useCallback(() => {
    setIsExpanded(false);
    cancelDraft();
  }, [cancelDraft]);

  if (variant === "compact") {
    return (
      <div className={cn("relative", className)}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
            "bg-muted hover:bg-muted/80 border border-border",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isExpanded && "bg-muted/80 ring-1 ring-border"
          )}
          title={`Priority: ${t(currentInfo.labelKey)} - ${t(currentInfo.descKey)}`}
        >
          <Flag
            className="h-4 w-4"
            style={{ color: currentInfo.color }}
            fill={currentInfo.color}
          />
          <span className="text-foreground">{t(currentInfo.labelKey)}</span>
          {isExpanded ? (
            <CaretUp className="h-3 w-3 text-muted-foreground" />
          ) : (
            <CaretDown className="h-3 w-3 text-muted-foreground" />
          )}
        </button>

        {isExpanded && (
          <>
            <div 
              className="fixed inset-0 z-40"
              role="presentation"
              onClick={handleCloseCompact}
            />
            <div className="absolute top-full right-0 mt-2 w-64 bg-popover border border-border rounded-lg shadow-lg z-50 p-3 animate-in fade-in zoom-in-95 duration-100">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{t("priority.setTitle")}</span>
                  {isSaving && (
                    <span className="text-xs text-muted-foreground">{t("priority.saving")}</span>
                  )}
                </div>

                {saveFailed && (
                  <p role="alert" className="text-xs text-error font-medium">
                    {t("priority.saveFailed")}{errorMessage ? ` (${errorMessage})` : ""}
                  </p>
                )}
                
                {/* Preset buttons */}
                <div className="grid grid-cols-5 gap-1">
                  {PRIORITY_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      disabled={isSaving}
                      onClick={() => handlePresetClick(preset.value)}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-md transition-all",
                        "bg-muted hover:bg-muted/70 border border-border",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        slider === preset.value && "bg-primary/10 ring-1 ring-primary/30"
                      )}
                      title={t(preset.descKey)}
                    >
                      <Flag
                        className="h-4 w-4"
                        style={{ color: preset.color }}
                        fill={preset.color}
                      />
                      <span className="text-[10px] text-muted-foreground leading-none">
                        {t(preset.labelKey)}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Fine-tune slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{t("priority.fineTune")}</span>
                    <span className="font-medium" style={{ color: currentInfo.color }}>
                      {slider}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={slider}
                    disabled={isSaving}
                    {...sliderHandlers}
                    aria-label={t("priority.fineTune")}
                    className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{ accentColor: currentInfo.color }}
                  />
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground text-center">
                  {t(currentInfo.descKey)}
                </p>

                {/* The element's live rank in the global priority queue.
                    Position 1 is the most important element. */}
                {typeof shownQueueSize === "number" && shownQueueSize > 0 && typeof shownPosition === "number" ? (
                  <p className="text-[10px] text-muted-foreground text-center">
                    {t("priority.queuePosition", { position: shownPosition, size: shownQueueSize })}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <Flag className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t("priority.readingPriority")}</span>
        {isSaving && (
          <span className="text-xs text-muted-foreground ml-auto">{t("priority.saving")}</span>
        )}
      </div>

      {saveFailed && (
        <p role="alert" className="text-xs text-error font-medium">
          {t("priority.saveFailed")}{errorMessage ? ` (${errorMessage})` : ""}
        </p>
      )}

      {/* Preset buttons */}
      <div className="flex gap-2">
        {PRIORITY_PRESETS.map((preset) => (
          <button
            key={preset.value}
            disabled={isSaving}
            onClick={() => handlePresetClick(preset.value)}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 p-2 rounded-lg border transition-all",
              "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              slider === preset.value 
                ? "border-ring bg-muted" 
                : "border-border bg-card"
            )}
          >
            <Flag 
              className="h-4 w-4" 
              style={{ color: preset.color }}
              fill={preset.color}
            />
            <span className="text-xs font-medium">{t(preset.labelKey)}</span>
          </button>
        ))}
      </div>

      {/* Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("priority.adjust")}</span>
          <span className="font-medium" style={{ color: currentInfo.color }}>
            {slider}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={slider}
          disabled={isSaving}
          {...sliderHandlers}
          aria-label={t("priority.adjust")}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
          style={{ accentColor: currentInfo.color }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {t(currentInfo.descKey)}. {t("priority.higherPriorityNote")}
      </p>
    </div>
  );
}
