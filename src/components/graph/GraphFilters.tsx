/**
 * Knowledge Graph filter controls.
 *
 * The filter body is shared by two surfaces:
 * - a docked sidebar on wide layouts
 * - a modal bottom sheet on phone/tablet presentation modes
 *
 * The page owns whether the surface is open; this module owns the filter
 * content, the active-filter summary, and the pure filter helpers.
 */

import { useCallback, useMemo, useState, type RefObject } from "react";
import {
  CaretDown,
  Circle,
  Eye,
  EyeSlash,
  Funnel,
  GridFour,
  MagnifyingGlass,
  Sliders,
  TagSimple,
  X,
} from "@phosphor-icons/react";
import { useI18n, type TranslateFn } from "../../lib/i18n";
import { ResponsiveDialogSheet } from "../adaptive";
import { Button, Chip } from "../md3";
import {
  GraphNode,
  GraphEdge,
  GraphNodeType,
  LayoutAlgorithm,
} from "./KnowledgeGraph";

export interface GraphFilters {
  searchQuery: string;
  nodeTypes: GraphNodeType[];
  categories: string[];
  tags: string[];
  minConnections?: number;
  maxConnections?: number;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface GraphFilterPanelProps {
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  availableCategories: string[];
  availableTags: string[];
  layout: LayoutAlgorithm;
  onLayoutChange: (layout: LayoutAlgorithm) => void;
  nodeCounts: Record<GraphNodeType, number>;
  linkDistance?: number;
  onLinkDistanceChange?: (value: number) => void;
  nodeScale?: number;
  onNodeScaleChange?: (value: number) => void;
}

export interface GraphFilterSurfaceProps extends GraphFilterPanelProps {
  visibleCount: number;
  totalCount: number;
}

export const GRAPH_FILTER_PANEL_ID = "knowledge-graph-filter-panel";

const NODE_TYPE_CONFIG = {
  [GraphNodeType.Document]: {
    labelKey: "graph.documents",
    color: "bg-blue-500",
    borderColor: "border-blue-500",
    textColor: "text-blue-500",
    icon: "📄",
  },
  [GraphNodeType.Extract]: {
    labelKey: "graph.extracts",
    color: "bg-green-500",
    borderColor: "border-green-500",
    textColor: "text-green-500",
    icon: "💬",
  },
  [GraphNodeType.Flashcard]: {
    labelKey: "graph.flashcards",
    color: "bg-purple-500",
    borderColor: "border-purple-500",
    textColor: "text-purple-500",
    icon: "🧠",
  },
  [GraphNodeType.Category]: {
    labelKey: "graph.categories",
    color: "bg-amber-500",
    borderColor: "border-amber-500",
    textColor: "text-amber-500",
    icon: "📁",
  },
  [GraphNodeType.Tag]: {
    labelKey: "graph.tags",
    color: "bg-cyan-500",
    borderColor: "border-cyan-500",
    textColor: "text-cyan-500",
    icon: "🏷️",
  },
  [GraphNodeType.Rss]: {
    labelKey: "graph.rss",
    color: "bg-orange-500",
    borderColor: "border-orange-500",
    textColor: "text-orange-500",
    icon: "📡",
  },
  [GraphNodeType.Concept]: {
    labelKey: "Concepts",
    color: "bg-yellow-500",
    borderColor: "border-yellow-500",
    textColor: "text-yellow-500",
    icon: "🔗",
  },
};

/** Reset every filter dimension to its "show everything" value. */
export function createEmptyGraphFilters(): GraphFilters {
  return {
    searchQuery: "",
    nodeTypes: [],
    categories: [],
    tags: [],
  };
}

/** Number of filter dimensions currently active (search counts once). */
export function countActiveGraphFilters(filters: GraphFilters): number {
  return (
    (filters.searchQuery.trim() ? 1 : 0) +
    filters.nodeTypes.length +
    filters.categories.length +
    filters.tags.length
  );
}

export type ActiveGraphFilterKind = "search" | "nodeType" | "category" | "tag";

export interface ActiveGraphFilterDescriptor {
  id: string;
  kind: ActiveGraphFilterKind;
  label: string;
}

/**
 * Turn the filter object into removable chip descriptors. Node-type filters
 * are exclusions, so their labels explicitly say "Without …" instead of
 * implying that the type is selected.
 */
export function describeActiveGraphFilters(
  filters: GraphFilters,
  t: TranslateFn,
): ActiveGraphFilterDescriptor[] {
  const descriptors: ActiveGraphFilterDescriptor[] = [];

  if (filters.searchQuery.trim()) {
    descriptors.push({
      id: "search",
      kind: "search",
      label: t("graph.searchFilterChip", { query: filters.searchQuery.trim() }),
    });
  }

  for (const type of filters.nodeTypes) {
    const config = NODE_TYPE_CONFIG[type];
    descriptors.push({
      id: `nodeType:${type}`,
      kind: "nodeType",
      label: t("graph.withoutNodeType", { type: t(config.labelKey) }),
    });
  }

  for (const category of filters.categories) {
    descriptors.push({
      id: `category:${category}`,
      kind: "category",
      label: category,
    });
  }

  for (const tag of filters.tags) {
    descriptors.push({
      id: `tag:${tag}`,
      kind: "tag",
      label: `#${tag}`,
    });
  }

  return descriptors;
}

/** Remove exactly one active dimension from the filter object. */
export function removeActiveGraphFilter(filters: GraphFilters, id: string): GraphFilters {
  if (id === "search") {
    return { ...filters, searchQuery: "" };
  }

  if (id.startsWith("nodeType:")) {
    const type = id.slice("nodeType:".length) as GraphNodeType;
    return { ...filters, nodeTypes: filters.nodeTypes.filter((value) => value !== type) };
  }

  if (id.startsWith("category:")) {
    const category = id.slice("category:".length);
    return { ...filters, categories: filters.categories.filter((value) => value !== category) };
  }

  if (id.startsWith("tag:")) {
    const tag = id.slice("tag:".length);
    return { ...filters, tags: filters.tags.filter((value) => value !== tag) };
  }

  return filters;
}

export interface GraphFilterPanelBodyProps extends GraphFilterPanelProps {
  /** Search field ref used when the page opens the surface from a search action. */
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * The filter controls themselves. This component intentionally has no outer
 * header, footer, or collapse state — the page and its surface own those.
 */
export function GraphFilterPanelBody({
  filters,
  onFiltersChange,
  availableCategories,
  availableTags,
  layout,
  onLayoutChange,
  nodeCounts,
  linkDistance,
  onLinkDistanceChange,
  nodeScale,
  onNodeScaleChange,
  searchInputRef,
}: GraphFilterPanelBodyProps) {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<string | null>("types");

  const updateSearchQuery = useCallback(
    (query: string) => {
      onFiltersChange({ ...filters, searchQuery: query });
    },
    [filters, onFiltersChange],
  );

  const toggleNodeType = useCallback(
    (type: GraphNodeType) => {
      const newTypes = filters.nodeTypes.includes(type)
        ? filters.nodeTypes.filter((value) => value !== type)
        : [...filters.nodeTypes, type];
      onFiltersChange({ ...filters, nodeTypes: newTypes });
    },
    [filters, onFiltersChange],
  );

  const toggleCategory = useCallback(
    (category: string) => {
      const newCategories = filters.categories.includes(category)
        ? filters.categories.filter((value) => value !== category)
        : [...filters.categories, category];
      onFiltersChange({ ...filters, categories: newCategories });
    },
    [filters, onFiltersChange],
  );

  const toggleTag = useCallback(
    (tag: string) => {
      const newTags = filters.tags.includes(tag)
        ? filters.tags.filter((value) => value !== tag)
        : [...filters.tags, tag];
      onFiltersChange({ ...filters, tags: newTags });
    },
    [filters, onFiltersChange],
  );

  const showAllTypes = useCallback(() => {
    onFiltersChange({ ...filters, nodeTypes: [] });
  }, [filters, onFiltersChange]);

  const hideAllTypes = useCallback(() => {
    onFiltersChange({ ...filters, nodeTypes: Object.values(GraphNodeType) });
  }, [filters, onFiltersChange]);

  return (
    <div className="flex flex-col">
      {/* Search */}
      <div className="border-b border-border p-4">
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={filters.searchQuery}
            onChange={(event) => updateSearchQuery(event.target.value)}
            placeholder={t("graph.searchKnowledge")}
            aria-label={t("graph.searchKnowledge")}
            className="min-h-11 w-full rounded-xl border-0 bg-muted py-2.5 pl-10 pr-9 text-sm transition-all focus:bg-card focus:ring-2 focus:ring-primary/50"
          />
          {filters.searchQuery && (
            <button
              type="button"
              onClick={() => updateSearchQuery("")}
              aria-label={t("graph.clearSearch")}
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Node Types */}
      <div className="border-b border-border">
        <button
          type="button"
          onClick={() => setActiveSection(activeSection === "types" ? null : "types")}
          aria-expanded={activeSection === "types"}
          className="flex min-h-11 w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
        >
          <span className="flex items-center gap-2">
            <GridFour className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("graph.nodeTypes")}</span>
          </span>
          <CaretDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              activeSection === "types" ? "" : "-rotate-90"
            }`}
          />
        </button>

        {activeSection === "types" && (
          <div className="px-4 pb-4">
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={showAllTypes}
                className="min-h-9 rounded-md bg-muted px-2 py-1 text-xs transition-colors hover:bg-muted/80"
              >
                {t("graph.selectAll")}
              </button>
              <button
                type="button"
                onClick={hideAllTypes}
                className="min-h-9 rounded-md bg-muted px-2 py-1 text-xs transition-colors hover:bg-muted/80"
              >
                {t("graph.clearAll")}
              </button>
            </div>

            <div className="space-y-1">
              {Object.values(GraphNodeType).map((type) => {
                const config = NODE_TYPE_CONFIG[type];
                const isVisible = !filters.nodeTypes.includes(type);
                const count = nodeCounts[type] || 0;

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleNodeType(type)}
                    aria-pressed={isVisible}
                    className={`flex min-h-11 w-full items-center justify-between rounded-xl p-2.5 transition-all ${
                      isVisible
                        ? "border border-border bg-card shadow-sm"
                        : "opacity-50 hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-sm ${
                          isVisible ? config.color : "bg-muted"
                        }`}
                      >
                        {config.icon}
                      </span>
                      <span className="truncate text-sm">{t(config.labelKey)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">{count}</span>
                      {isVisible ? (
                        <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
                      ) : (
                        <EyeSlash className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Layout */}
      <div className="border-b border-border">
        <button
          type="button"
          onClick={() => setActiveSection(activeSection === "layout" ? null : "layout")}
          aria-expanded={activeSection === "layout"}
          className="flex min-h-11 w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
        >
          <span className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("graph.layout")}</span>
          </span>
          <CaretDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              activeSection === "layout" ? "" : "-rotate-90"
            }`}
          />
        </button>

        {activeSection === "layout" && (
          <div className="px-4 pb-4">
            <select
              value={layout}
              onChange={(event) => onLayoutChange(event.target.value as LayoutAlgorithm)}
              className="min-h-11 w-full rounded-xl border-0 bg-muted px-3 py-2.5 text-sm transition-all focus:ring-2 focus:ring-primary/50"
            >
              <option value={LayoutAlgorithm.Force}>{t("graph.layoutForceDirected")}</option>
              <option value={LayoutAlgorithm.Circular}>{t("graph.layoutCircular")}</option>
              <option value={LayoutAlgorithm.Hierarchical}>{t("graph.layoutHierarchical")}</option>
              <option value={LayoutAlgorithm.Grid}>{t("graph.layoutGrid")}</option>
            </select>

            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("graph.nodeSize")}</span>
                  <span className="font-medium">
                    {nodeScale !== undefined ? `${Math.round(nodeScale * 100)}%` : t("graph.auto")}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={nodeScale ?? 1}
                  onChange={(event) => onNodeScaleChange?.(Number(event.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("graph.linkDistance")}</span>
                  <span className="font-medium">{linkDistance ?? 120}px</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="300"
                  value={linkDistance ?? 120}
                  onChange={(event) => onLinkDistanceChange?.(Number(event.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Categories */}
      {availableCategories.length > 0 && (
        <div className="border-b border-border">
          <button
            type="button"
            onClick={() => setActiveSection(activeSection === "categories" ? null : "categories")}
            aria-expanded={activeSection === "categories"}
            className="flex min-h-11 w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-2">
              <Circle className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("graph.categories")}</span>
              {filters.categories.length > 0 && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  {filters.categories.length}
                </span>
              )}
            </span>
            <CaretDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                activeSection === "categories" ? "" : "-rotate-90"
              }`}
            />
          </button>

          {activeSection === "categories" && (
            <div className="px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                {availableCategories.map((category) => {
                  const isSelected = filters.categories.includes(category);
                  return (
                    <Chip
                      key={category}
                      variant="filter"
                      selected={isSelected}
                      label={category}
                      onClick={() => toggleCategory(category)}
                      className="min-h-11 max-w-full"
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      {availableTags.length > 0 && (
        <div className="border-b border-border">
          <button
            type="button"
            onClick={() => setActiveSection(activeSection === "tags" ? null : "tags")}
            aria-expanded={activeSection === "tags"}
            className="flex min-h-11 w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50"
          >
            <span className="flex items-center gap-2">
              <TagSimple className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t("graph.tags")}</span>
              {filters.tags.length > 0 && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  {filters.tags.length}
                </span>
              )}
            </span>
            <CaretDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                activeSection === "tags" ? "" : "-rotate-90"
              }`}
            />
          </button>

          {activeSection === "tags" && (
            <div className="px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => {
                  const isSelected = filters.tags.includes(tag);
                  return (
                    <Chip
                      key={tag}
                      variant="filter"
                      selected={isSelected}
                      label={`#${tag}`}
                      onClick={() => toggleTag(tag)}
                      className="min-h-11 max-w-full"
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Docked filter surface for desktop and compact-desktop layouts. */
export function GraphFilterSidebar({
  filters,
  onFiltersChange,
  visibleCount,
  totalCount,
  ...panelProps
}: GraphFilterSurfaceProps) {
  const { t } = useI18n();
  const activeCount = countActiveGraphFilters(filters);

  return (
    <aside
      id={GRAPH_FILTER_PANEL_ID}
      aria-label={t("graph.filterPanel")}
      className="flex h-full min-h-0 flex-col border-r border-border bg-card/95 backdrop-blur-xl"
    >
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Funnel className="h-4 w-4 text-primary" />
          </span>
          <span className="truncate text-sm font-semibold">{t("graph.filters")}</span>
          {activeCount > 0 && (
            <span
              data-testid="graph-filter-active-count"
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground"
            >
              {activeCount}
            </span>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <GraphFilterPanelBody
          filters={filters}
          onFiltersChange={onFiltersChange}
          {...panelProps}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {t("knowledgeGraph.visibleOfTotal", { visible: visibleCount, total: totalCount })}
        </span>
        <Button
          variant="text"
          size="sm"
          onClick={() => onFiltersChange(createEmptyGraphFilters())}
          disabled={activeCount === 0}
          className="shrink-0"
        >
          {t("graph.resetFilters")}
        </Button>
      </div>
    </aside>
  );
}

/** Modal filter surface for phone/tablet presentation modes. */
export function GraphFilterSheet({
  open,
  onClose,
  filters,
  onFiltersChange,
  visibleCount,
  totalCount,
  searchInputRef,
  ...panelProps
}: GraphFilterSurfaceProps & {
  open: boolean;
  onClose: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useI18n();
  const activeCount = countActiveGraphFilters(filters);

  return (
    <ResponsiveDialogSheet
      open={open}
      onClose={onClose}
      presentation="sheet"
      id={GRAPH_FILTER_PANEL_ID}
      title={t("graph.filters")}
      description={
        <span>
          {t("graph.filterSheetDescription")}{" "}
          {t("knowledgeGraph.visibleOfTotal", { visible: visibleCount, total: totalCount })}
        </span>
      }
      closeLabel={t("graph.closeFilters")}
      initialFocusRef={searchInputRef}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="text"
            size="md"
            onClick={() => onFiltersChange(createEmptyGraphFilters())}
            disabled={activeCount === 0}
          >
            {t("graph.resetFilters")}
          </Button>
          <Button variant="filled" size="md" onClick={onClose} className="min-h-11">
            {t("graph.showNodeResults", { count: visibleCount })}
          </Button>
        </div>
      }
    >
      <GraphFilterPanelBody
        filters={filters}
        onFiltersChange={onFiltersChange}
        searchInputRef={searchInputRef}
        {...panelProps}
      />
    </ResponsiveDialogSheet>
  );
}

/** Removable summary of active filters, shown while the surface is closed. */
export function GraphActiveFilterSummary({
  filters,
  onFiltersChange,
  className,
}: {
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const descriptors = useMemo(
    () => describeActiveGraphFilters(filters, t),
    [filters, t],
  );

  if (descriptors.length === 0) return null;

  return (
    <div
      role="group"
      aria-label={t("graph.activeFilters")}
      className={`flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card/70 px-3 py-2 ${className ?? ""}`}
    >
      {descriptors.map((descriptor) => (
        <Chip
          key={descriptor.id}
          variant="input"
          label={descriptor.label}
          onRemove={() => onFiltersChange(removeActiveGraphFilter(filters, descriptor.id))}
          onClick={() => onFiltersChange(removeActiveGraphFilter(filters, descriptor.id))}
          aria-label={t("graph.removeFilter", { filter: descriptor.label })}
          className="min-h-11 shrink-0"
        />
      ))}
      <Button
        variant="text"
        size="sm"
        onClick={() => onFiltersChange(createEmptyGraphFilters())}
        className="shrink-0"
      >
        {t("graph.clearAllFilters")}
      </Button>
    </div>
  );
}

/**
 * Apply filters to graph data
 */
export function applyGraphFilters(
  nodes: GraphNode[],
  edges: GraphEdge[],
  filters: GraphFilters,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  let filteredNodes = [...nodes];

  // Filter by search query
  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    filteredNodes = filteredNodes.filter(
      (node) =>
        node.label.toLowerCase().includes(query) ||
        node.description?.toLowerCase().includes(query) ||
        node.tags?.some((tag) => tag.toLowerCase().includes(query)),
    );
  }

  // Filter by node types (inverted - we show types NOT in the filter list)
  if (filters.nodeTypes.length > 0) {
    filteredNodes = filteredNodes.filter(
      (node) => !filters.nodeTypes.includes(node.type),
    );
  }

  // Filter by categories
  if (filters.categories.length > 0) {
    filteredNodes = filteredNodes.filter(
      (node) => node.category && filters.categories.includes(node.category),
    );
  }

  // Filter by tags
  if (filters.tags.length > 0) {
    filteredNodes = filteredNodes.filter((node) =>
      node.tags?.some((tag) => filters.tags.includes(tag)),
    );
  }

  // Filter by connections
  if (filters.minConnections !== undefined || filters.maxConnections !== undefined) {
    filteredNodes = filteredNodes.filter((node) => {
      const connectionCount = edges.filter(
        (edge) => edge.source === node.id || edge.target === node.id,
      ).length;

      if (filters.minConnections !== undefined && connectionCount < filters.minConnections) {
        return false;
      }
      if (filters.maxConnections !== undefined && connectionCount > filters.maxConnections) {
        return false;
      }
      return true;
    });
  }

  // Filter edges to only include connections between filtered nodes
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );

  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Extract available categories and tags from nodes
 */
export function extractGraphMetadata(nodes: GraphNode[]): {
  categories: string[];
  tags: string[];
} {
  const categories = new Set<string>();
  const tags = new Set<string>();

  nodes.forEach((node) => {
    if (node.category) {
      categories.add(node.category);
    }
    node.tags?.forEach((tag) => tags.add(tag));
  });

  return {
    categories: Array.from(categories).sort(),
    tags: Array.from(tags).sort(),
  };
}

/**
 * Calculate graph statistics
 */
export function calculateGraphStatistics(
  nodes: GraphNode[],
  edges: GraphEdge[],
): {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<GraphNodeType, number>;
  averageConnections: number;
  isolatedNodes: number;
} {
  const nodesByType: Record<GraphNodeType, number> = {
    [GraphNodeType.Document]: 0,
    [GraphNodeType.Extract]: 0,
    [GraphNodeType.Flashcard]: 0,
    [GraphNodeType.Category]: 0,
    [GraphNodeType.Tag]: 0,
    [GraphNodeType.Rss]: 0,
    [GraphNodeType.Concept]: 0,
  };

  nodes.forEach((node) => {
    nodesByType[node.type]++;
  });

  const connectionCounts = new Map<string, number>();
  nodes.forEach((node) => connectionCounts.set(node.id, 0));

  edges.forEach((edge) => {
    connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
    connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
  });

  const totalConnections = Array.from(connectionCounts.values()).reduce((a, b) => a + b, 0);
  const averageConnections = nodes.length > 0 ? totalConnections / nodes.length : 0;

  const isolatedNodes = Array.from(connectionCounts.values()).filter((c) => c === 0).length;

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodesByType,
    averageConnections,
    isolatedNodes,
  };
}
