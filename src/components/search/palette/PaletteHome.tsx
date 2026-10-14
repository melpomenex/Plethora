/**
 * Home body composition: applicable "Actions in this view" first, then the
 * reference Quick Actions row, Resume reading card, and Ask Plethora grid.
 * Unsupported views simply omit the contextual section — the reference
 * dashboard frame is unchanged.
 */

import { Lightning } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import type { ContextualViewType, ViewActionId } from "../../../commandPalette/contextualActions";
import type {
  PaletteActionId,
  PaletteHomeModel,
  PaletteSuggestion,
} from "../../../commandPalette/types";
import { PaletteQuickActions } from "./PaletteQuickActions";
import { PaletteResumeCard } from "./PaletteResumeCard";
import { PaletteSuggestions } from "./PaletteSuggestions";

export interface PaletteHomeProps {
  home: PaletteHomeModel;
  /** Keyboard-highlighted contextual action index (-1 when none/not selected). */
  selectedContextualIndex: number;
  /** Keyboard-highlighted tile index (-1 when none). */
  selectedTileIndex: number;
  onSelectContextualIndex: (index: number) => void;
  onSelectTileIndex: (index: number) => void;
  onAction: (id: PaletteActionId, documentId?: string) => void;
  onContextualAction: (view: ContextualViewType, actionId: ViewActionId) => void;
  onSuggestion: (suggestion: PaletteSuggestion) => void;
  onSeeAllActions: () => void;
  expandedExamples: PaletteSuggestion[];
  examplesOpen: boolean;
  onToggleExamples: () => void;
}

export function PaletteHome({
  home,
  selectedContextualIndex,
  selectedTileIndex,
  onSelectContextualIndex,
  onSelectTileIndex,
  onAction,
  onContextualAction,
  onSuggestion,
  onSeeAllActions,
  expandedExamples,
  examplesOpen,
  onToggleExamples,
}: PaletteHomeProps) {
  const { t } = useI18n();

  return (
    <div className="ch-home">
      {home.contextualActions.length > 0 && (
        <section className="ch-section" aria-label={t("palette.actionsInView")}>
          <div className="ch-section-head">
            <h3 className="ch-section-title">
              <Lightning className="ch-section-glyph" weight="fill" aria-hidden="true" />
              {t("palette.actionsInView")}
            </h3>
            <button type="button" className="ch-link" onClick={onSeeAllActions}>
              {t("palette.seeAllActions")}
              <span aria-hidden="true">→</span>
            </button>
          </div>
          <div className="ch-contextual">
            {home.contextualActions.map((action, index) => {
              const selected = index === selectedContextualIndex;
              return (
                <button
                  key={`${action.view}-${action.actionId}`}
                  type="button"
                  className={`ch-action-row${selected ? " ch-action-row--selected" : ""}`}
                  data-selected={selected || undefined}
                  onMouseEnter={() => onSelectContextualIndex(index)}
                  onClick={() => onContextualAction(action.view, action.actionId)}
                >
                  <span className="ch-action-row-title">{action.title}</span>
                  {action.subtitle && (
                    <span className="ch-action-row-subtitle">{action.subtitle}</span>
                  )}
                  {action.shortcutHint && (
                    <kbd className="ch-kbd">{action.shortcutHint}</kbd>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <PaletteQuickActions
        home={home}
        selectedIndex={selectedTileIndex}
        onSelectIndex={onSelectTileIndex}
        onAction={onAction}
      />

      <PaletteResumeCard home={home} onAction={onAction} />

      <PaletteSuggestions
        suggestions={home.suggestions}
        expandedExamples={expandedExamples}
        examplesOpen={examplesOpen}
        onToggleExamples={onToggleExamples}
        onSuggestion={onSuggestion}
      />
    </div>
  );
}
