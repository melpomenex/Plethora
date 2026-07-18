/**
 * Knowledge Universe — shared types
 *
 * The Universe renders the collection as a galaxy: documents are stars,
 * extracts orbit them as planets, flashcards orbit extracts as moons, and
 * categories group stars into constellations.
 */

import { GraphNodeType, type GraphNode, type GraphEdge } from "../KnowledgeGraph";

/** Props contract — mirrors ObsidianSphereProps so the tab wiring is a drop-in swap. */
export interface KnowledgeUniverseProps {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onNodeContextMenu?: (node: GraphNode, position: { x: number; y: number }) => void;
  onNodeDelete?: (nodeId: string) => Promise<void> | void;
  onNodeSave?: (
    nodeId: string,
    updates: { label?: string; description?: string; category?: string; tags?: string[] }
  ) => Promise<void> | void;
  showHeader?: boolean;
}

/** Semantic zoom focus levels. */
export type FocusState =
  | { level: "universe" }
  | { level: "system"; docId: string }
  | { level: "node"; docId: string; nodeId: string };

/** Numeric node class used as a shader attribute. */
export enum NodeClass {
  Star = 0, // document
  Planet = 1, // extract
  Moon = 2, // flashcard
  Beacon = 3, // category
  Halo = 4, // tag
  Pulsar = 5, // rss
}

export const NODE_CLASS_BY_TYPE: Record<GraphNodeType, NodeClass> = {
  [GraphNodeType.Document]: NodeClass.Star,
  [GraphNodeType.Extract]: NodeClass.Planet,
  [GraphNodeType.Flashcard]: NodeClass.Moon,
  [GraphNodeType.Category]: NodeClass.Beacon,
  [GraphNodeType.Tag]: NodeClass.Halo,
  [GraphNodeType.Rss]: NodeClass.Pulsar,
};

/** Established type palette (matches the Sphere/Graph views). */
export const NODE_VISUALS: Record<NodeClass, { color: string; size: number }> = {
  [NodeClass.Star]: { color: "#3b82f6", size: 7.5 },
  [NodeClass.Planet]: { color: "#22c55e", size: 4.5 },
  [NodeClass.Moon]: { color: "#a855f7", size: 3.0 },
  [NodeClass.Beacon]: { color: "#f59e0b", size: 6.5 },
  [NodeClass.Halo]: { color: "#06b6d4", size: 3.5 },
  [NodeClass.Pulsar]: { color: "#f97316", size: 6.0 },
};

/** Per-node interaction state written into the aState buffer attribute. */
export enum NodeState {
  Normal = 0,
  Hovered = 1,
  Selected = 2,
  SearchMatch = 3,
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface UniversePlacement {
  id: string;
  nodeClass: NodeClass;
  /** Expanded position (orbit slot for planets/moons). */
  position: Vec3;
  /** Collapsed position (the parent star for planets/moons; == position otherwise). */
  origin: Vec3;
  /** Index of the owning document system, -1 when none (tags, orphan belt). */
  systemIndex: number;
  clusterKey: string;
  /** True when hidden by orbit pagination (beyond the shown ring budget). */
  paged: boolean;
}

export interface UniverseCluster {
  key: string;
  label: string;
  center: Vec3;
  radius: number;
  docCount: number;
  /** Deterministic hue (degrees) for the nebula tint. */
  hue: number;
}

export interface OrbitRing {
  radius: number;
  /** Orbital plane tilt (radians) shared by the whole system. */
  tiltX: number;
  tiltZ: number;
}

export interface UniverseSystem {
  docId: string;
  index: number;
  center: Vec3;
  clusterKey: string;
  /** Extract node ids in orbit order (paged ones excluded). */
  extractIds: string[];
  /** Flashcard ids per extract (paged ones excluded). */
  moonsByExtract: Map<string, string[]>;
  rings: OrbitRing[];
  /** Extracts beyond the ring budget (shown as "+N more"). */
  pagedExtracts: number;
  /** Flashcards beyond the moon budget across all extracts. */
  pagedMoons: number;
}

export interface UniverseLayout {
  placements: Map<string, UniversePlacement>;
  clusters: UniverseCluster[];
  /** Systems by document node id. */
  systems: Map<string, UniverseSystem>;
  systemList: UniverseSystem[];
  /** Child → parent node id (extract → doc, card → extract). */
  parentOf: Map<string, string>;
  /** Radius that encloses the whole galaxy (for camera framing). */
  bounds: number;
  /** Radius of the cluster core only (belt/halo excluded) — home view frames this. */
  coreBounds: number;
}
