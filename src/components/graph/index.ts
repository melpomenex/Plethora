/**
 * Knowledge Graph Components
 * Beautiful visualization of your knowledge network
 */

export { KnowledgeGraph, GraphNodeType, LayoutAlgorithm } from "./KnowledgeGraph";
export type { GraphNode, GraphEdge, GraphData, KnowledgeGraphProps } from "./KnowledgeGraph";

// New Obsidian-inspired components
export { ObsidianGraph } from "./ObsidianGraph";
export type { ObsidianGraphProps, ObsidianGraphHandle } from "./ObsidianGraph";

export { ObsidianSphere } from "./ObsidianSphere";
export type { ObsidianSphereProps } from "./ObsidianSphere";

// Knowledge Universe (WebGL galaxy; ObsidianSphere is its no-WebGL fallback)
export { KnowledgeUniverseLazy } from "./KnowledgeUniverseLazy";
export type { KnowledgeUniverseProps } from "./universe/types";
export { NodeDetailPanel } from "./NodeDetailPanel";

// Legacy sphere (for backwards compatibility)
export { KnowledgeSphere, useSphereThemess } from "./KnowledgeSphere";
export type { KnowledgeSphereProps } from "./KnowledgeSphere";

// Filter controls
export {
  GRAPH_FILTER_PANEL_ID,
  GraphActiveFilterSummary,
  GraphFilterPanelBody,
  GraphFilterSheet,
  GraphFilterSidebar,
  applyGraphFilters,
  countActiveGraphFilters,
  createEmptyGraphFilters,
  describeActiveGraphFilters,
  removeActiveGraphFilter,
  extractGraphMetadata,
  calculateGraphStatistics,
} from "./GraphFilters";
export type {
  ActiveGraphFilterDescriptor,
  ActiveGraphFilterKind,
  GraphFilters,
  GraphFilterPanelBodyProps,
  GraphFilterPanelProps,
  GraphFilterSurfaceProps,
} from "./GraphFilters";
export {
  GRAPH_FILTER_SIDEBAR_STORAGE_KEY,
  defaultGraphFilterSidebarOpen,
  readGraphFilterSidebarOpen,
  writeGraphFilterSidebarOpen,
} from "./graphFilterPersistence";
export {
  KnowledgeGraphHeader,
} from "./KnowledgeGraphHeader";
export type {
  KnowledgeGraphHeaderProps,
  KnowledgeGraphViewMode,
} from "./KnowledgeGraphHeader";

export { NodeDetailView, NodePreviewCard, NodeTooltip } from "./NodeDetailView";
export type { NodeDetailViewProps } from "./NodeDetailView";

export {
  GraphExportButton,
  exportGraph,
  GraphExportFormat,
  exportGraphToPNG,
  exportGraphToSVG,
  exportGraphToJSON,
  exportGraphToGEXF,
  exportGraphToGraphML,
  exportGraphToCSV,
  exportGraphToDOT,
} from "./GraphExport";
export type { GraphExportOptions } from "./GraphExport";
