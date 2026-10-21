/**
 * Browser harness for the Knowledge Graph layout regression test.
 *
 * It mounts the real page chrome and filter surfaces in the same flex chain as
 * KnowledgeGraphPage so Playwright can measure actual layout at phone, tablet,
 * and desktop widths without needing the Tauri backend.
 */

import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { PresentationProvider, usePresentation } from "../contexts/PresentationContext";
import { KnowledgeGraphHeader } from "../components/graph/KnowledgeGraphHeader";
import {
  GraphFilterSheet,
  GraphFilterSidebar,
  createEmptyGraphFilters,
  type GraphFilters,
} from "../components/graph/GraphFilters";
import { GraphNodeType, LayoutAlgorithm } from "../components/graph/KnowledgeGraph";

const nodeCounts = {
  [GraphNodeType.Document]: 10,
  [GraphNodeType.Extract]: 5,
  [GraphNodeType.Flashcard]: 2,
  [GraphNodeType.Category]: 0,
  [GraphNodeType.Tag]: 0,
  [GraphNodeType.Rss]: 0,
  [GraphNodeType.Concept]: 1,
};

function LayoutHarness() {
  const { mode } = usePresentation();
  const isSheetSurface = mode === "phone" || mode === "tablet";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<GraphFilters>(createEmptyGraphFilters());
  const safeTop = Number(new URLSearchParams(window.location.search).get("safeTop") ?? 0) || 0;

  const panelProps = {
    filters,
    onFiltersChange: setFilters,
    availableCategories: ["Research", "Personal"],
    availableTags: ["ai", "memory"],
    layout: LayoutAlgorithm.Force,
    onLayoutChange: () => {},
    nodeCounts,
    linkDistance: 120,
    onLinkDistanceChange: () => {},
    nodeScale: 1,
    onNodeScaleChange: () => {},
  };

  return (
    <div
      className="app-shell flex min-h-0 flex-col bg-background"
      style={{ height: "100dvh", paddingTop: safeTop, boxSizing: "border-box" }}
    >
      <KnowledgeGraphHeader
        visibleCount={18}
        totalCount={18}
        viewMode="graph"
        onViewModeChange={() => {}}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        onOpenSearch={() => setFiltersOpen(true)}
        activeFilterCount={0}
        searchQuery={filters.searchQuery}
        onSearchQueryChange={(searchQuery) => setFilters((current) => ({ ...current, searchQuery }))}
        onExport={() => {}}
        onResetFilters={() => setFilters(createEmptyGraphFilters())}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!isSheetSurface && filtersOpen && (
          <div className="w-72 shrink-0">
            <GraphFilterSidebar {...panelProps} visibleCount={18} totalCount={18} />
          </div>
        )}

        <div
          data-testid="knowledge-graph-canvas"
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted"
        >
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Canvas
          </div>
        </div>
      </div>

      {isSheetSurface && (
        <GraphFilterSheet
          {...panelProps}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          visibleCount={18}
          totalCount={18}
        />
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <PresentationProvider>
      <LayoutHarness />
    </PresentationProvider>,
  );
}
