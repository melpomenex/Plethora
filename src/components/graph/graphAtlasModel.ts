/**
 * Pure projection models for the Knowledge Atlas, Focus Web (ego-graph),
 * and Directory/Bridges views.
 */

import { GraphNodeType, type GraphData, type GraphEdge, type GraphNode } from "./KnowledgeGraph";

export type KnowledgeLens =
  | "structure"
  | "memory_health"
  | "extract_density"
  | "orphans_bridges";

export type ClusterHealth = "healthy" | "attention" | "critical" | "neutral";

export interface ClusterSummary {
  id: string;
  label: string;
  nodeIds: string[];
  documentCount: number;
  extractCount: number;
  flashcardCount: number;
  conceptCount: number;
  totalNodes: number;
  avgRetrievability: number | null;
  leechCount: number;
  dueCount: number;
  bridgeCount: number;
  health: ClusterHealth;
  topNodes: GraphNode[];
  /** Normalized 0..1 layout coordinates on the Atlas canvas */
  nx: number;
  ny: number;
}

export interface ClusterBridge {
  id: string;
  sourceClusterId: string;
  targetClusterId: string;
  weight: number;
  conceptLabels: string[];
}

export interface KnowledgeAtlasModel {
  clusters: ClusterSummary[];
  bridges: ClusterBridge[];
  nodeToClusterId: Map<string, string>;
  totalNodes: number;
  totalBridges: number;
}

export interface GroupedNeighbors {
  parents: GraphNode[];
  children: GraphNode[];
  concepts: GraphNode[];
  related: GraphNode[];
}

export interface DirectoryEntry {
  node: GraphNode;
  degree: number;
  crossDocDegree: number;
  retrievability: number | null;
  isLeech: boolean;
  extractCount: number;
  clusterLabel: string;
}

export interface DirectoryInsights {
  hubs: DirectoryEntry[];
  hotspots: DirectoryEntry[];
  orphans: DirectoryEntry[];
}

function readNumber(val: unknown): number | null {
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function readBoolean(val: unknown): boolean {
  return val === true;
}

function resolveHealth(avgRet: number | null, leechCount: number, total: number): ClusterHealth {
  if (total === 0) return "neutral";
  if (leechCount > 0 && leechCount / Math.max(1, total) >= 0.15) return "critical";
  if (avgRet !== null) {
    if (avgRet < 0.65) return "critical";
    if (avgRet < 0.85) return "attention";
    return "healthy";
  }
  return leechCount > 0 ? "attention" : "neutral";
}

function resolveBaseGroupName(node: GraphNode, docClusterMap: Map<string, string>): string {
  if (node.type === GraphNodeType.Document) {
    const cat = node.category?.trim();
    if (cat) return cat;
    const tag = node.tags?.[0]?.trim();
    if (tag) return tag;
    return "Uncategorized";
  }
  const docId = node.metadata?.documentId;
  if (typeof docId === "string" || typeof docId === "number") {
    const mapped = docClusterMap.get(`doc-${docId}`);
    if (mapped) return mapped;
  }
  const cat = node.category?.trim();
  if (cat) return cat;
  if (node.type === GraphNodeType.Concept) return "Cross-Document Concepts";
  return "Uncategorized";
}

/**
 * Groups graph nodes into 5-20 meaningful topic clusters with cross-cluster
 * bridge counts and FSRS health metrics.
 */
export function buildKnowledgeAtlas(
  nodes: GraphNode[],
  edges: GraphEdge[],
): KnowledgeAtlasModel {
  if (nodes.length === 0) {
    return {
      clusters: [],
      bridges: [],
      nodeToClusterId: new Map(),
      totalNodes: 0,
      totalBridges: 0,
    };
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const docClusterMap = new Map<string, string>();
  for (const n of nodes) {
    if (n.type === GraphNodeType.Document) {
      const name = n.category?.trim() || n.tags?.[0]?.trim() || "Uncategorized";
      docClusterMap.set(n.id, name);
    }
  }

  // Initial grouping by category/tag
  const rawGroups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const group = resolveBaseGroupName(n, docClusterMap);
    const list = rawGroups.get(group);
    if (list) list.push(n);
    else rawGroups.set(group, [n]);
  }

  // If everything collapsed into 1-2 giant groups (e.g. mostly Uncategorized),
  // split large groups by their parent Document so the Atlas stays visual and useful.
  if (rawGroups.size <= 2 && nodes.length > 12) {
    const refined = new Map<string, GraphNode[]>();
    for (const [groupName, members] of rawGroups.entries()) {
      if (members.length <= 16) {
        refined.set(groupName, members);
        continue;
      }
      const docBuckets = new Map<string, GraphNode[]>();
      for (const m of members) {
        if (m.type === GraphNodeType.Document) {
          const bucket = refined.get(m.label) ?? [];
          bucket.push(m);
          refined.set(m.label, bucket);
          docBuckets.set(m.id, bucket);
        }
      }
      for (const m of members) {
        if (m.type === GraphNodeType.Document) continue;
        const docId = m.metadata?.documentId;
        const docKey = docId !== undefined ? `doc-${docId}` : "";
        const docNode = docKey ? nodeMap.get(docKey) : undefined;
        const targetLabel = docNode?.label || groupName;
        const bucket = refined.get(targetLabel);
        if (bucket) bucket.push(m);
        else refined.set(targetLabel, [m]);
      }
    }
    rawGroups.clear();
    for (const [k, v] of refined.entries()) {
      rawGroups.set(k, v);
    }
  }

  // Sort clusters by size descending and cap display clusters at 18 (folding tiny tail into "Other Topics")
  const sortedEntries = Array.from(rawGroups.entries()).sort((a, b) => b[1].length - a[1].length);
  const MAX_CLUSTERS = 18;
  const finalGroups: Array<[string, GraphNode[]]> = [];
  if (sortedEntries.length > MAX_CLUSTERS) {
    for (let i = 0; i < MAX_CLUSTERS - 1; i++) {
      finalGroups.push(sortedEntries[i]);
    }
    const otherNodes: GraphNode[] = [];
    for (let i = MAX_CLUSTERS - 1; i < sortedEntries.length; i++) {
      otherNodes.push(...sortedEntries[i][1]);
    }
    finalGroups.push(["Other Topics", otherNodes]);
  } else {
    finalGroups.push(...sortedEntries);
  }

  const nodeToClusterId = new Map<string, string>();
  const clusterSummaries: ClusterSummary[] = [];

  finalGroups.forEach(([label, members], idx) => {
    const id = `cluster-${idx}`;
    let documentCount = 0;
    let extractCount = 0;
    let flashcardCount = 0;
    let conceptCount = 0;
    let retSum = 0;
    let retCount = 0;
    let leechCount = 0;
    let dueCount = 0;

    for (const m of members) {
      nodeToClusterId.set(m.id, id);
      if (m.type === GraphNodeType.Document) documentCount++;
      else if (m.type === GraphNodeType.Extract) extractCount++;
      else if (m.type === GraphNodeType.Flashcard) flashcardCount++;
      else if (m.type === GraphNodeType.Concept) conceptCount++;

      const ret = readNumber(m.metadata?.retrievability);
      if (ret !== null) {
        retSum += ret;
        retCount++;
      }
      if (readBoolean(m.metadata?.isLeech)) leechCount++;
      if (readBoolean(m.metadata?.isDue)) dueCount++;
    }

    const avgRetrievability = retCount > 0 ? retSum / retCount : null;
    const topNodes = [...members]
      .sort((a, b) => {
        const rank = (t: GraphNodeType) =>
          t === GraphNodeType.Concept ? 0 : t === GraphNodeType.Document ? 1 : 2;
        return rank(a.type) - rank(b.type);
      })
      .slice(0, 4);

    // Golden-angle spiral layout normalized in 0.14..0.86 so cards never clip at edges
    const count = finalGroups.length;
    let nx = 0.5;
    let ny = 0.5;
    if (count === 1) {
      nx = 0.5;
      ny = 0.5;
    } else if (count <= 6) {
      const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
      nx = 0.5 + Math.cos(angle) * 0.3;
      ny = 0.5 + Math.sin(angle) * 0.28;
    } else {
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const r = 0.36 * Math.sqrt((idx + 0.5) / count);
      const theta = idx * goldenAngle;
      nx = 0.5 + Math.cos(theta) * r * 1.1;
      ny = 0.5 + Math.sin(theta) * r * 0.92;
    }

    clusterSummaries.push({
      id,
      label,
      nodeIds: members.map((m) => m.id),
      documentCount,
      extractCount,
      flashcardCount,
      conceptCount,
      totalNodes: members.length,
      avgRetrievability,
      leechCount,
      dueCount,
      bridgeCount: 0,
      health: resolveHealth(avgRetrievability, leechCount, members.length),
      topNodes,
      nx: Math.max(0.12, Math.min(0.88, nx)),
      ny: Math.max(0.14, Math.min(0.86, ny)),
    });
  });

  // Aggregate cross-cluster bridges
  const bridgeAcc = new Map<string, { source: string; target: string; weight: number; labels: Set<string> }>();
  for (const edge of edges) {
    const cA = nodeToClusterId.get(edge.source);
    const cB = nodeToClusterId.get(edge.target);
    if (!cA || !cB || cA === cB) continue;
    const [first, second] = cA < cB ? [cA, cB] : [cB, cA];
    const key = `${first}::${second}`;
    const existing = bridgeAcc.get(key);
    const labelHint = edge.label || nodeMap.get(edge.target)?.label || "";
    if (existing) {
      existing.weight++;
      if (labelHint && existing.labels.size < 4) existing.labels.add(labelHint);
    } else {
      const labels = new Set<string>();
      if (labelHint) labels.add(labelHint);
      bridgeAcc.set(key, { source: first, target: second, weight: 1, labels });
    }
  }

  const clusterById = new Map(clusterSummaries.map((c) => [c.id, c]));
  const bridges: ClusterBridge[] = [];
  for (const [key, b] of bridgeAcc.entries()) {
    const cA = clusterById.get(b.source);
    const cB = clusterById.get(b.target);
    if (cA) cA.bridgeCount += b.weight;
    if (cB) cB.bridgeCount += b.weight;
    bridges.push({
      id: `bridge-${key}`,
      sourceClusterId: b.source,
      targetClusterId: b.target,
      weight: b.weight,
      conceptLabels: Array.from(b.labels),
    });
  }
  bridges.sort((a, b) => b.weight - a.weight);

  return {
    clusters: clusterSummaries,
    bridges,
    nodeToClusterId,
    totalNodes: nodes.length,
    totalBridges: bridges.reduce((sum, b) => sum + b.weight, 0),
  };
}

/**
 * Builds a clean, non-overlapping 1-hop or 2-hop ego-graph around `focusNodeId`
 * with deterministic radial coordinates so ObsidianGraph renders legibly.
 */
export function buildFocusNeighborhood(
  nodes: GraphNode[],
  edges: GraphEdge[],
  focusNodeId: string,
  depth: 1 | 2 = 1,
): { data: GraphData; focusNode: GraphNode | null; grouped: GroupedNeighbors } {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const focusNode = nodeMap.get(focusNodeId) ?? null;
  if (!focusNode) {
    return {
      data: { nodes: [], edges: [] },
      focusNode: null,
      grouped: { parents: [], children: [], concepts: [], related: [] },
    };
  }

  const hop1Ids = new Set<string>([focusNodeId]);
  const parents: GraphNode[] = [];
  const children: GraphNode[] = [];
  const concepts: GraphNode[] = [];
  const related: GraphNode[] = [];

  for (const e of edges) {
    if (e.source === focusNodeId && nodeMap.has(e.target)) {
      const target = nodeMap.get(e.target)!;
      if (!hop1Ids.has(target.id)) {
        hop1Ids.add(target.id);
        if (target.type === GraphNodeType.Concept) concepts.push(target);
        else if (e.type === "contains" || e.type === "derived") children.push(target);
        else related.push(target);
      }
    } else if (e.target === focusNodeId && nodeMap.has(e.source)) {
      const source = nodeMap.get(e.source)!;
      if (!hop1Ids.has(source.id)) {
        hop1Ids.add(source.id);
        if (source.type === GraphNodeType.Concept) concepts.push(source);
        else if (e.type === "contains" || e.type === "derived") parents.push(source);
        else related.push(source);
      }
    }
  }

  const includedIds = new Set<string>(hop1Ids);
  const hop2Nodes: GraphNode[] = [];
  if (depth === 2) {
    for (const e of edges) {
      if (hop1Ids.has(e.source) && !includedIds.has(e.target) && nodeMap.has(e.target)) {
        if (hop2Nodes.length < 28) {
          includedIds.add(e.target);
          hop2Nodes.push(nodeMap.get(e.target)!);
        }
      } else if (hop1Ids.has(e.target) && !includedIds.has(e.source) && nodeMap.has(e.source)) {
        if (hop2Nodes.length < 28) {
          includedIds.add(e.source);
          hop2Nodes.push(nodeMap.get(e.source)!);
        }
      }
    }
  }

  // Assign structured radial coordinates around (500, 400)
  const cx = 500;
  const cy = 400;
  const positioned: GraphNode[] = [{ ...focusNode, x: cx, y: cy }];

  const ring1 = [...parents, ...children, ...concepts, ...related].slice(0, 36);
  const r1 = Math.max(190, Math.min(310, ring1.length * 16));
  ring1.forEach((n, i) => {
    const angle = (i / Math.max(1, ring1.length)) * Math.PI * 2 - Math.PI / 2;
    positioned.push({
      ...n,
      x: cx + Math.cos(angle) * r1,
      y: cy + Math.sin(angle) * r1,
    });
  });

  if (hop2Nodes.length > 0) {
    const r2 = r1 + 185;
    hop2Nodes.forEach((n, i) => {
      const angle = (i / hop2Nodes.length) * Math.PI * 2 - Math.PI / 3;
      positioned.push({
        ...n,
        x: cx + Math.cos(angle) * r2,
        y: cy + Math.sin(angle) * r2,
      });
    });
  }

  const posIds = new Set(positioned.map((n) => n.id));
  const subEdges = edges.filter((e) => posIds.has(e.source) && posIds.has(e.target));

  return {
    data: { nodes: positioned, edges: subEdges },
    focusNode,
    grouped: { parents, children, concepts, related },
  };
}

/**
 * Builds a clean, non-overlapping graph for a single topic cluster (documents +
 * top extracts + concepts, excluding noisy flashcard leaf sprawl unless few nodes).
 */
export function buildClusterSubgraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  clusterNodeIds: string[],
): GraphData {
  const idSet = new Set(clusterNodeIds);
  const clusterNodes = nodes.filter((n) => idSet.has(n.id));
  // If cluster is large, summarize by hiding individual flashcard leaves
  const filtered =
    clusterNodes.length > 35
      ? clusterNodes.filter((n) => n.type !== GraphNodeType.Flashcard)
      : clusterNodes;

  const limited = filtered.slice(0, 60);
  const cx = 500;
  const cy = 400;

  const docs = limited.filter((n) => n.type === GraphNodeType.Document || n.type === GraphNodeType.Concept);
  const others = limited.filter((n) => n.type !== GraphNodeType.Document && n.type !== GraphNodeType.Concept);

  const positioned: GraphNode[] = [];
  const docR = docs.length <= 1 ? 0 : Math.max(130, Math.min(240, docs.length * 26));
  docs.forEach((n, i) => {
    const angle = (i / Math.max(1, docs.length)) * Math.PI * 2 - Math.PI / 2;
    positioned.push({
      ...n,
      x: cx + Math.cos(angle) * docR,
      y: cy + Math.sin(angle) * docR,
    });
  });

  const outerR = docR + 190;
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
    positioned.push({
      ...n,
      x: cx + Math.cos(angle) * outerR,
      y: cy + Math.sin(angle) * outerR,
    });
  });

  const posIds = new Set(positioned.map((n) => n.id));
  const subEdges = edges.filter((e) => posIds.has(e.source) && posIds.has(e.target));

  return { nodes: positioned, edges: subEdges };
}

/**
 * Builds analytical lists for the Directory / Bridges view:
 * - hubs: highest-connectivity concepts & documents
 * - hotspots: lowest-retrievability / leech items
 * - orphans: documents with no extracts and no concept links
 */
export function buildDirectoryInsights(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeToClusterLabel?: Map<string, string>,
): DirectoryInsights {
  const degreeMap = new Map<string, number>();
  const extractCountByDoc = new Map<string, number>();

  for (const e of edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    if (e.type === "contains" && e.source.startsWith("doc-")) {
      extractCountByDoc.set(e.source, (extractCountByDoc.get(e.source) ?? 0) + 1);
    }
  }

  const toEntry = (n: GraphNode): DirectoryEntry => ({
    node: n,
    degree: degreeMap.get(n.id) ?? 0,
    crossDocDegree: n.type === GraphNodeType.Concept ? degreeMap.get(n.id) ?? 0 : 0,
    retrievability: readNumber(n.metadata?.retrievability),
    isLeech: readBoolean(n.metadata?.isLeech),
    extractCount: extractCountByDoc.get(n.id) ?? 0,
    clusterLabel: nodeToClusterLabel?.get(n.id) ?? n.category ?? "Uncategorized",
  });

  const entries = nodes.map(toEntry);

  const hubs = [...entries]
    .filter((e) => e.degree > 0)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 30);

  const hotspots = [...entries]
    .filter((e) => e.isLeech || (e.retrievability !== null && e.retrievability < 0.85))
    .sort((a, b) => {
      if (a.isLeech !== b.isLeech) return a.isLeech ? -1 : 1;
      return (a.retrievability ?? 1) - (b.retrievability ?? 1);
    })
    .slice(0, 30);

  const orphans = entries
    .filter((e) => e.node.type === GraphNodeType.Document && e.degree === 0)
    .slice(0, 30);

  return { hubs, hotspots, orphans };
}
