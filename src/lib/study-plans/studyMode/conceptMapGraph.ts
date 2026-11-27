import type { ConceptProgressBreakdown } from "./evidenceProgress";

export type ConceptNodeMasteryBadge =
  | "demonstrated"
  | "needs_practice"
  | "not_assessed";

export interface ConceptMapNodeView {
  id: string;
  label: string;
  definition: string;
  mastery: ConceptNodeMasteryBadge;
  citations: Array<{ sourceId?: string; quote?: string }>;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface ConceptMapEdgeView {
  id: string;
  from: string;
  to: string;
  relation: string;
}

export interface ConceptMapGraphModel {
  title: string;
  nodes: ConceptMapNodeView[];
  edges: ConceptMapEdgeView[];
  width: number;
  height: number;
}

const NODE_WIDTH = 176;
const NODE_HEIGHT = 64;
const LAYER_GAP_X = 230;
const ROW_GAP_Y = 96;
const PADDING = 40;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

/**
 * Maps a concept map node strictly against unified learning evidence.
 * NEVER marks a concept understood merely because it was read or viewed.
 */
export function resolveConceptNodeMastery(
  nodeId: string,
  nodeLabel: string,
  evidenceConcepts: ConceptProgressBreakdown[]
): ConceptNodeMasteryBadge {
  const normId = normalizeKey(nodeId);
  const normLabel = normalizeKey(nodeLabel);

  const match = evidenceConcepts.find((c) => {
    const cid = normalizeKey(c.conceptId);
    const clabel = normalizeKey(c.conceptLabel);
    return cid === normId || cid === normLabel || clabel === normLabel;
  });

  if (!match) return "not_assessed";
  if (match.status === "demonstrated-consistently") return "demonstrated";
  if (match.status === "needs-attention") return "needs_practice";
  return "not_assessed";
}

/**
 * Builds a deterministic layered SVG graph model from a verified mind_map artifact
 * payload and unified evidence breakdown.
 */
export function buildConceptMapGraph(
  payload: Record<string, unknown>,
  evidenceConcepts: ConceptProgressBreakdown[]
): ConceptMapGraphModel {
  const rawNodes = Array.isArray(payload.nodes)
    ? (payload.nodes as Array<Record<string, unknown>>)
    : [];
  const rawEdges = Array.isArray(payload.edges)
    ? (payload.edges as Array<Record<string, unknown>>)
    : [];

  const nodeIds = new Set<string>();
  const parsedNodes = rawNodes.map((n, index) => {
    const id = typeof n.id === "string" && n.id.trim() ? n.id.trim() : `node-${index}`;
    nodeIds.add(id);
    const label = String(n.label ?? id);
    const definition = String(n.definition ?? "");
    const citations = Array.isArray(n.citations)
      ? (n.citations as Array<{ sourceId?: string; quote?: string }>)
      : [];
    return { id, label, definition, citations };
  });

  const edges: ConceptMapEdgeView[] = rawEdges
    .map((e, index) => ({
      id: `edge-${index}`,
      from: String(e.from ?? ""),
      to: String(e.to ?? ""),
      relation: String(e.relation ?? "supports"),
    }))
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to) && e.from !== e.to);

  // Assign deterministic layers using longest-path relaxation (cycle-safe)
  const layerMap = new Map<string, number>();
  for (const n of parsedNodes) layerMap.set(n.id, 0);

  for (let pass = 0; pass < Math.min(parsedNodes.length, 6); pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const fromLayer = layerMap.get(edge.from) ?? 0;
      const toLayer = layerMap.get(edge.to) ?? 0;
      if (toLayer <= fromLayer) {
        layerMap.set(edge.to, Math.min(5, fromLayer + 1));
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group nodes by layer to compute non-overlapping (x, y) coordinates
  const byLayer = new Map<number, typeof parsedNodes>();
  for (const n of parsedNodes) {
    const layer = layerMap.get(n.id) ?? 0;
    const list = byLayer.get(layer) ?? [];
    list.push(n);
    byLayer.set(layer, list);
  }

  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  const maxRows = Math.max(1, ...layers.map((l) => (byLayer.get(l) ?? []).length));

  const nodes: ConceptMapNodeView[] = [];
  for (const layer of layers) {
    const items = byLayer.get(layer) ?? [];
    items.forEach((item, rowIdx) => {
      nodes.push({
        ...item,
        mastery: resolveConceptNodeMastery(item.id, item.label, evidenceConcepts),
        x: PADDING + layer * LAYER_GAP_X,
        y: PADDING + rowIdx * ROW_GAP_Y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        layer,
      });
    });
  }

  const totalLayers = Math.max(1, layers.length);
  const width = Math.max(420, PADDING * 2 + (totalLayers - 1) * LAYER_GAP_X + NODE_WIDTH);
  const height = Math.max(240, PADDING * 2 + (maxRows - 1) * ROW_GAP_Y + NODE_HEIGHT);

  return {
    title: String(payload.title ?? "Concept Map"),
    nodes,
    edges,
    width,
    height,
  };
}

export function getPrerequisitesForNode(
  model: ConceptMapGraphModel,
  nodeId: string
): ConceptMapNodeView[] {
  const prereqIds = new Set(
    model.edges
      .filter((e) => e.to === nodeId && (e.relation === "prerequisite" || e.relation === "leads_to" || e.relation === "causes"))
      .map((e) => e.from)
  );
  return model.nodes.filter((n) => prereqIds.has(n.id));
}
