import React from "react";
import { ArrowCounterClockwise, FloppyDisk, Sliders } from "@phosphor-icons/react";
import {
  INLINE_PERSONALIZATION_CHIPS,
  type InlineAdjustmentId,
} from "../../../lib/study-plans/studyMode/inlinePersonalization";

export interface InlinePersonalizationChipsProps {
  activeAdjustmentId: InlineAdjustmentId | null;
  subjectLabel: string;
  isBusy: boolean;
  savedNotice: { adjustmentLabel: string; subjectLabel: string } | null;
  onApplyAdjustment: (id: InlineAdjustmentId) => void;
  onSaveAsDefault: (id: InlineAdjustmentId) => void;
  onUndoSavedDefault: () => void;
}

export const InlinePersonalizationChips: React.FC<InlinePersonalizationChipsProps> = ({
  activeAdjustmentId,
  subjectLabel,
  isBusy,
  savedNotice,
  onApplyAdjustment,
  onSaveAsDefault,
  onUndoSavedDefault,
}) => {
  const activeOption = activeAdjustmentId
    ? INLINE_PERSONALIZATION_CHIPS.find((c) => c.id === activeAdjustmentId) ?? null
    : null;

  return (
    <div
      data-testid="inline-personalization-chips"
      className="pt-2 border-t border-border/60 space-y-2"
    >
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Adjust explanation style">
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mr-1">
          <Sliders className="w-3 h-3" aria-hidden="true" />
          Adjust:
        </span>
        {INLINE_PERSONALIZATION_CHIPS.map((chip) => {
          const selected = activeAdjustmentId === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              disabled={isBusy}
              aria-pressed={selected}
              onClick={() => onApplyAdjustment(chip.id)}
              className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors disabled:opacity-50 ${
                selected
                  ? "border-primary bg-primary/15 text-primary font-medium"
                  : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {activeOption && !savedNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">
            Using <strong>{activeOption.label}</strong> style for this explanation.
          </span>
          <button
            type="button"
            onClick={() => onSaveAsDefault(activeOption.id)}
            className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
          >
            <FloppyDisk className="w-3 h-3" aria-hidden="true" />
            Save as default for {subjectLabel}
          </button>
        </div>
      )}

      {savedNotice && (
        <div
          role="status"
          data-testid="inline-personalization-saved-notice"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px]"
        >
          <span>
            Saved <strong>{savedNotice.adjustmentLabel}</strong> as default for{" "}
            <strong>{savedNotice.subjectLabel}</strong>.
          </span>
          <button
            type="button"
            onClick={onUndoSavedDefault}
            className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
          >
            <ArrowCounterClockwise className="w-3 h-3" aria-hidden="true" />
            Undo
          </button>
        </div>
      )}
    </div>
  );
};
