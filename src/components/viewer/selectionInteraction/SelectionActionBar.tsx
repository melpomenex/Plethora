/**
 * SelectionActionBar — the compact anchored toolbar shown when a selection
 * settles (change: overhaul-reader-selection-ux, design decision 3).
 *
 * A single horizontally-scrollable chip row (Summarize · Explain · Ask ·
 * Extract · ⋯) placed above/below the selection via `placeAnchoredBar`. No
 * scrim: if it appears while the user is still deciding, grabbing a handle
 * again instantly hides it — that recoverability is what replaces a sluggish
 * hard delay. Lower-priority actions live behind ⋯, which opens the existing
 * `SelectionActionsSheet` in menu mode; loading/results stay in the sheet.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DotsThree, Lightbulb, Question, TextAlignLeft } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { usePresentation } from "../../../contexts/PresentationContext";
import { useOverlayDismissal } from "../../../hooks/useOverlayDismissal";
import { SELECTION_INTERACTION_UI_ATTR } from "./adapters";
import type { BarPlacement } from "./geometry";

export type SelectionBarAction = "summarize" | "explain" | "ask" | "extract";

export interface SelectionActionBarProps {
  placement: BarPlacement | null;
  /** Chip activation — the host routes it through captureForAction(). */
  onAction: (action: SelectionBarAction) => void;
  /** ⋯ opens the full actions sheet in menu mode. */
  onOverflow: () => void;
  onDismiss: () => void;
  /** Whether AI chips render (bar shows Extract + ⋯ alone otherwise). */
  aiAvailable?: boolean;
  /** Whether the Extract chip renders (transcripts have no extract path). */
  canExtract?: boolean;
  /** Focus returns here after Escape dismissal. */
  readerContainerRef?: React.RefObject<HTMLElement | null>;
  /** Measured size flows back into the controller's placement math. */
  onMeasure?: (size: { width: number; height: number }) => void;
}

function Chip({
  label,
  icon,
  onClick,
  reducedMotion,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  reducedMotion: boolean;
}) {
  return (
    <button
      type="button"
      // 44px targets; the row scrolls horizontally instead of shrinking.
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-foreground active:bg-muted ${
        reducedMotion ? "" : "transition-colors"
      }`}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

export function SelectionActionBar({
  placement,
  onAction,
  onOverflow,
  onDismiss,
  aiAvailable = true,
  canExtract = true,
  readerContainerRef,
  onMeasure,
}: SelectionActionBarProps) {
  const { t } = useI18n();
  const { reducedMotion } = usePresentation();
  const barRef = useRef<HTMLDivElement>(null);

  // Back-button dismissal (overlayStack) + Escape with focus return.
  useOverlayDismissal(Boolean(placement), () => {
    onDismiss();
    readerContainerRef?.current?.focus?.();
  });

  // Report the real size once so placement math uses it from now on.
  useEffect(() => {
    if (!placement || !onMeasure || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      onMeasure({ width: rect.width, height: rect.height });
    }
  }, [placement, onMeasure]);

  if (!placement) return null;

  return createPortal(
    <div
      {...{ [SELECTION_INTERACTION_UI_ATTR]: "true" }}
      ref={barRef}
      role="toolbar"
      aria-label={t("selectionBar.toolbarLabel")}
      dir="ltr"
      className="fixed z-[9998] flex items-center overflow-x-auto rounded-full border border-border bg-card/95 px-1.5 py-1 shadow-md backdrop-blur-sm scrollbar-none"
      style={{
        top: Math.round(placement.top),
        left: Math.round(placement.left),
        maxWidth: Math.round(placement.maxWidth),
        visibility: placement.maxWidth > 0 ? undefined : "hidden",
      }}
    >
      {aiAvailable && (
        <>
          <Chip
            reducedMotion={reducedMotion}
            label={t("selectionSheet.summarize")}
            icon={<TextAlignLeft className="h-4 w-4" weight="bold" />}
            onClick={() => onAction("summarize")}
          />
          <Chip
            reducedMotion={reducedMotion}
            label={t("selectionSheet.explain")}
            icon={<Lightbulb className="h-4 w-4" weight="bold" />}
            onClick={() => onAction("explain")}
          />
          <Chip
            reducedMotion={reducedMotion}
            label={t("selectionBar.ask")}
            icon={<Question className="h-4 w-4" weight="bold" />}
            onClick={() => onAction("ask")}
          />
        </>
      )}
      {canExtract && (
        <Chip
          reducedMotion={reducedMotion}
          label={t("selectionSheet.createExtract")}
          icon={<Lightbulb className="h-4 w-4" weight="fill" />}
          onClick={() => onAction("extract")}
        />
      )}
      <Chip
        reducedMotion={reducedMotion}
        label={t("selectionBar.more")}
        icon={<DotsThree className="h-4 w-4" weight="bold" />}
        onClick={onOverflow}
      />
    </div>,
    document.body,
  );
}
