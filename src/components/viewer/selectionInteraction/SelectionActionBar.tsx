/**
 * SelectionActionBar — the compact anchored toolbar shown when a selection
 * settles (change: overhaul-reader-selection-ux, design decision 3).
 *
 * The user's most-used actions as a single horizontally-scrollable chip row
 * (Summarize · Explain · Ask · Extract · Copy · ⋯), placed above/below the
 * selection via `placeAnchoredBar`. No scrim: if it appears while the user is
 * still deciding, grabbing a handle again instantly hides it — that
 * recoverability is what replaces a sluggish hard delay. The full action menu
 * sheet opens deliberately via ⋯ (the host's shared context menu); loading and
 * results stay in the sheet.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DotsThree } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { usePresentation } from "../../../contexts/PresentationContext";
import { useOverlayDismissal } from "../../../hooks/useOverlayDismissal";
import { SELECTION_INTERACTION_UI_ATTR } from "./adapters";
import type { BarPlacement } from "./geometry";
import {
  getSelectionActions,
  selectionActionLabelKey,
  type SelectionActionId,
  type SelectionBarAction,
} from "./selectionActionRegistry";

export type { SelectionBarAction };

/** Per-chip presentation details that are bar styling, not action identity. */
const BAR_CHIP_STYLE: Partial<Record<SelectionActionId, { weight: "bold" | "fill"; showcase?: string }>> = {
  explain: { weight: "bold", showcase: "explain-selection" },
  learnThis: { weight: "bold", showcase: "remember-selection" },
  extract: { weight: "fill" },
};

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
  /** Whether the "Read from here" TTS chip renders (TTS configured + surface
   *  can map the selection to an anchor). */
  canReadAloud?: boolean;
  /** Focus returns here after Escape dismissal. */
  readerContainerRef?: React.RefObject<HTMLElement | null>;
  /** Measured size flows back into the controller's placement math. */
  onMeasure?: (size: { width: number; height: number }) => void;
  /** Capture-build path to the real Learn-this proposal UI. */
  onLearnThis?: () => void;
  showLearnThis?: boolean;
}

function Chip({
  label,
  icon,
  onClick,
  reducedMotion,
  showcaseAction,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  reducedMotion: boolean;
  showcaseAction?: string;
}) {
  return (
    <button
      type="button"
      data-showcase-action={showcaseAction}
      // 44px targets; the row scrolls horizontally instead of shrinking.
      className={`md-state flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-on-surface ${
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
  canReadAloud = false,
  readerContainerRef,
  onMeasure,
  onLearnThis,
  showLearnThis = false,
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

  const actions = getSelectionActions("bar", {
    aiAvailable,
    canExtract,
    canReadAloud,
    learnThisHandlerAvailable: Boolean(showLearnThis && onLearnThis),
  });

  return createPortal(
    <div
      {...{ [SELECTION_INTERACTION_UI_ATTR]: "true" }}
      ref={barRef}
      role="toolbar"
      aria-label={t("selectionBar.toolbarLabel")}
      dir="ltr"
      className="fixed z-[var(--md-z-critical)] flex items-center overflow-x-auto rounded-full border border-outline-variant/50 bg-surface-container-high px-1.5 py-1 shadow-xl scrollbar-none"
      style={{
        top: Math.round(placement.top),
        left: Math.round(placement.left),
        maxWidth: Math.round(placement.maxWidth),
        visibility: placement.maxWidth > 0 ? undefined : "hidden",
      }}
    >
      {actions.map((action) => {
        const style = BAR_CHIP_STYLE[action.id] ?? { weight: "bold" as const };
        const Icon = action.icon;
        return (
          <Chip
            key={action.id}
            reducedMotion={reducedMotion}
            label={t(selectionActionLabelKey(action, "bar"))}
            icon={<Icon className="h-4 w-4" weight={style.weight} />}
            showcaseAction={style.showcase}
            onClick={() =>
              action.id === "learnThis" ? onLearnThis?.() : onAction(action.id as SelectionBarAction)
            }
          />
        );
      })}
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
