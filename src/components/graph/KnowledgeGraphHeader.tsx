/**
 * Responsive page chrome for the Knowledge Graph / Universe workspace.
 *
 * Phone and tablet layouts use two compact rows so the title never wraps under
 * a fixed-height header. Desktop layouts keep the inline search and export
 * actions; compact desktop windows move secondary actions into the overflow
 * menu and leave search to the docked filter sidebar.
 */

import { useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Download,
  DotsThree,
  Funnel,
  Graph,
  MagnifyingGlass,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { usePresentation } from "../../contexts/PresentationContext";
import { cn } from "../../utils/cn";
import { Button } from "../md3/Button";
import { IconButton } from "../md3/IconButton";
import { Menu, type MenuItemSpec } from "../md3/Menu";
import { SegmentedButton } from "../md3/SegmentedButton";

export type KnowledgeGraphViewMode = "graph" | "universe";

export interface KnowledgeGraphHeaderProps {
  visibleCount: number;
  totalCount: number;
  viewMode: KnowledgeGraphViewMode;
  onViewModeChange: (mode: KnowledgeGraphViewMode) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onOpenSearch: () => void;
  activeFilterCount: number;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onExport: () => void;
  onResetFilters: () => void;
}

export function KnowledgeGraphHeader({
  visibleCount,
  totalCount,
  viewMode,
  onViewModeChange,
  filtersOpen,
  onToggleFilters,
  onOpenSearch,
  activeFilterCount,
  searchQuery,
  onSearchQueryChange,
  onExport,
  onResetFilters,
}: KnowledgeGraphHeaderProps) {
  const { t } = useI18n();
  const { mode } = usePresentation();
  const isStacked = mode === "phone" || mode === "tablet";
  const showInlineSearch = mode === "desktop";
  const showDirectExport = mode === "desktop";

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLButtonElement>(null);

  const overflowItems: MenuItemSpec[] = [
    ...(activeFilterCount > 0
      ? [
          {
            key: "reset-filters",
            label: t("graph.resetFilters"),
            icon: ArrowCounterClockwise,
            onSelect: onResetFilters,
          },
        ]
      : []),
    {
      key: "export",
      label: t("knowledgeGraph.exportGraph"),
      icon: Download,
      onSelect: onExport,
    },
  ];

  const viewModeControl = (
    <SegmentedButton<KnowledgeGraphViewMode>
      label={t("graph.viewMode")}
      value={viewMode}
      onChange={(value) => {
        if (value === "graph" || value === "universe") onViewModeChange(value);
      }}
      options={[
        { value: "graph", label: t("knowledgeGraph.graph"), icon: Graph },
        { value: "universe", label: t("knowledgeGraph.universe"), icon: Sparkle },
      ]}
      className="min-h-11 min-w-0"
    />
  );

  const filtersControl = (
    <Button
      variant={filtersOpen ? "tonal" : "outlined"}
      size="md"
      onClick={onToggleFilters}
      aria-expanded={filtersOpen}
      aria-controls="knowledge-graph-filter-panel"
      aria-label={
        activeFilterCount > 0
          ? t("graph.toggleFiltersWithCount", { count: activeFilterCount })
          : t("graph.toggleFilters")
      }
      className={cn(
        "glass-button min-h-11 shrink-0 gap-2 px-3",
        filtersOpen && "bg-primary/15 text-primary",
      )}
    >
      <Funnel className="h-4 w-4" aria-hidden="true" />
      <span className={cn(isStacked && "hidden min-[360px]:inline")}>
        {t("knowledgeGraph.filters")}
      </span>
      {activeFilterCount > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
          {activeFilterCount}
        </span>
      )}
    </Button>
  );

  const searchButton = (
    <IconButton
      icon={MagnifyingGlass}
      aria-label={t("graph.openSearch")}
      onClick={onOpenSearch}
      className="glass-button shrink-0"
    />
  );

  const overflowButton = (
    <IconButton
      ref={overflowRef}
      icon={DotsThree}
      aria-label={t("graph.moreActions")}
      onClick={() => setOverflowOpen((open) => !open)}
      className="glass-button shrink-0"
    />
  );

  const titleBlock = (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl glass-panel">
        <Graph className="h-5 w-5 text-primary-400" />
      </div>
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold leading-tight text-foreground sm:text-lg">
          {t("knowledgeGraph.title")}
        </h1>
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="truncate text-xs text-muted-foreground"
        >
          {t("knowledgeGraph.visibleOfTotal", {
            visible: visibleCount,
            total: totalCount,
          })}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <header
        data-testid="knowledge-graph-header"
        data-layout={isStacked ? "stacked" : "single"}
        className={cn(
          "glass-panel-light flex min-h-16 shrink-0 border-b border-border/60",
          isStacked
            ? "flex-col gap-2 px-3 py-2"
            : "flex-row items-center justify-between gap-3 px-4 py-2",
        )}
      >
        {isStacked ? (
          <>
            <div className="flex w-full min-w-0 items-center gap-2">
              {titleBlock}
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {searchButton}
                {overflowButton}
              </div>
            </div>
            <div className="flex w-full min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">{viewModeControl}</div>
              {filtersControl}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-3">
              {titleBlock}
              <div className="shrink-0">{viewModeControl}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {showInlineSearch && (
                <div className="relative min-w-0">
                  <MagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    placeholder={t("knowledgeGraph.searchNodes")}
                    aria-label={t("knowledgeGraph.searchNodes")}
                    className="glass-input min-h-10 w-56 pr-9 pl-10 text-sm lg:w-64"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => onSearchQueryChange("")}
                      aria-label={t("graph.clearSearch")}
                      className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {!showInlineSearch && searchButton}
              {filtersControl}
              {showDirectExport ? (
                <IconButton
                  icon={Download}
                  aria-label={t("knowledgeGraph.exportGraph")}
                  onClick={onExport}
                  className="glass-button shrink-0"
                />
              ) : (
                overflowButton
              )}
            </div>
          </>
        )}
      </header>

      <Menu
        items={overflowItems}
        anchorRef={overflowRef}
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        label={t("graph.moreActions")}
        align="end"
      />
    </>
  );
}
