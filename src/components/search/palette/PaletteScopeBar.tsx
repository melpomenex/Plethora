/**
 * Scope pills + View all control (reference row).
 *
 * Six exclusive scopes in reference order with exactly one selected; the
 * trailing cluster holds the palette-local View all shortcut, the advanced
 * filter toggle (browse/search modes only), and Save search (only when the
 * caller supports saving). Chips are native buttons so Tab focus and
 * Enter/Space activation belong to the focused chip.
 */

import {
  BookOpen,
  Cards,
  FileText,
  Gear,
  Lightning,
  SlidersHorizontal,
  SquaresFour,
  Star,
} from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { PALETTE_SCOPES, type PaletteScope } from "../../../commandPalette/types";
import { paletteViewAllShortcutLabel } from "./paletteUi";

const SCOPE_ICONS: Record<PaletteScope, React.ReactNode> = {
  all: <SquaresFour className="ch-scope-icon" weight="fill" aria-hidden="true" />,
  actions: <Lightning className="ch-scope-icon" weight="fill" aria-hidden="true" />,
  documents: <FileText className="ch-scope-icon" aria-hidden="true" />,
  library: <BookOpen className="ch-scope-icon" aria-hidden="true" />,
  cards: <Cards className="ch-scope-icon" aria-hidden="true" />,
  settings: <Gear className="ch-scope-icon" weight="fill" aria-hidden="true" />,
};

export interface PaletteScopeBarProps {
  scope: PaletteScope;
  onScopeChange: (scope: PaletteScope) => void;
  onViewAll: () => void;
  viewAllActive: boolean;
  /** Advanced filters/save-search only exist in browse/search modes. */
  showAdvanced: boolean;
  filtersOpen: boolean;
  hasActiveFilters: boolean;
  onToggleFilters: () => void;
  canSaveSearch: boolean;
  onSaveSearch?: () => void;
}

export function PaletteScopeBar({
  scope,
  onScopeChange,
  onViewAll,
  viewAllActive,
  showAdvanced,
  filtersOpen,
  hasActiveFilters,
  onToggleFilters,
  canSaveSearch,
  onSaveSearch,
}: PaletteScopeBarProps) {
  const { t } = useI18n();

  return (
    <div className="ch-scope-row">
      <div className="ch-scope-tabs" role="tablist" aria-label={t("palette.scopeLabel")}>
        {PALETTE_SCOPES.map((candidate) => {
          const selected = candidate === scope;
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={selected}
              data-selected={selected || undefined}
              className={`ch-scope${selected ? " ch-scope--selected" : ""}`}
              onClick={() => onScopeChange(candidate)}
            >
              {SCOPE_ICONS[candidate]}
              <span>{t(`palette.scope.${candidate}`)}</span>
            </button>
          );
        })}
      </div>

      <div className="ch-scope-trailing">
        {showAdvanced && canSaveSearch && onSaveSearch && (
          <button
            type="button"
            className="ch-icon-button"
            onClick={onSaveSearch}
            aria-label={t("palette.saveSearch")}
            title={t("palette.saveSearch")}
          >
            <Star className="ch-scope-icon" aria-hidden="true" />
          </button>
        )}
        {showAdvanced && (
          <button
            type="button"
            className="ch-icon-button"
            data-active={hasActiveFilters || filtersOpen || undefined}
            onClick={onToggleFilters}
            aria-expanded={filtersOpen}
            aria-label={t("palette.filters")}
            title={t("palette.filters")}
          >
            <SlidersHorizontal className="ch-scope-icon" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={`ch-view-all${viewAllActive ? " ch-view-all--active" : ""}`}
          onClick={onViewAll}
          aria-pressed={viewAllActive}
        >
          <kbd className="ch-kbd" aria-hidden="true">
            {paletteViewAllShortcutLabel()}
          </kbd>
          <span>{t("palette.viewAll")}</span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}
