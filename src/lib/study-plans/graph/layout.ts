import type {
  GraphOrientation,
  GraphViewLayer,
  PositionedGraphEdge,
  PositionedGraphNode,
  PositionedSourceGraphEdge,
  PositionedSourceGraphNode,
  PrerequisiteSupportFilter,
  StudyPlanGraphEdge,
  StudyPlanGraphLayout,
  StudyPlanGraphNode,
  StudyPlanGraphProjection,
} from './types';

export const GRAPH_NODE_WIDTH = 264;
export const GRAPH_NODE_HEIGHT = 100;
export const GRAPH_SOURCE_WIDTH = 236;
export const GRAPH_SOURCE_HEIGHT = 72;

const CANVAS_PADDING = 56;
const NODE_GAP_X = 48;
const NODE_GAP_Y = 88;
const LR_NODE_GAP_X = 112;
const LR_NODE_GAP_Y = 36;
const SOURCE_GAP = 32;
const SOURCE_BAND_GAP = 104;
const ISOLATED_BAND_GAP = 92;

export interface ComputeStudyPlanGraphLayoutOptions {
  orientation?: GraphOrientation;
  viewLayer?: GraphViewLayer;
  supportFilter?: PrerequisiteSupportFilter;
}

function compareNodesDeterministically(a: StudyPlanGraphNode, b: StudyPlanGraphNode): number {
  const numA = a.curriculumNumber > 0 ? a.curriculumNumber : Number.MAX_SAFE_INTEGER;
  const numB = b.curriculumNumber > 0 ? b.curriculumNumber : Number.MAX_SAFE_INTEGER;
  if (numA !== numB) return numA - numB;
  const titleCmp = a.title.localeCompare(b.title, 'en-US');
  if (titleCmp !== 0) return titleCmp;
  return a.nodeId.localeCompare(b.nodeId, 'en-US');
}

function buildCubicPathTB(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  isBackEdge: boolean,
  laneOffset: number
): { pathD: string; labelX: number; labelY: number } {
  if (isBackEdge) {
    const curveOut = Math.max(84, Math.abs(sx - tx) * 0.35 + 72) + laneOffset;
    const side = sx >= tx ? 1 : -1;
    const cx = Math.max(sx, tx) + side * curveOut;
    return {
      pathD: `M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ty}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2 + side * (curveOut * 0.5),
      labelY: (sy + ty) / 2,
    };
  }
  const midY = (sy + ty) / 2 + laneOffset;
  return {
    pathD: `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`,
    labelX: (sx + tx) / 2,
    labelY: midY,
  };
}

function buildCubicPathLR(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  isBackEdge: boolean,
  laneOffset: number
): { pathD: string; labelX: number; labelY: number } {
  if (isBackEdge) {
    const curveOut = Math.max(76, Math.abs(sy - ty) * 0.35 + 64) + laneOffset;
    const cy = Math.max(sy, ty) + curveOut;
    return {
      pathD: `M ${sx} ${sy} C ${sx} ${cy}, ${tx} ${cy}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2 + curveOut * 0.5,
    };
  }
  const midX = (sx + tx) / 2 + laneOffset;
  return {
    pathD: `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`,
    labelX: midX,
    labelY: (sy + ty) / 2,
  };
}

/**
 * Computes a deterministic layered Sugiyama-style layout for Study Plan DAGs
 * and an ordered curriculum roadmap layout when no prerequisite edges are present.
 */
export function computeStudyPlanGraphLayout(
  projection: StudyPlanGraphProjection,
  options: ComputeStudyPlanGraphLayoutOptions = {}
): StudyPlanGraphLayout {
  const orientation: GraphOrientation = options.orientation ?? 'TB';
  const viewLayer: GraphViewLayer = options.viewLayer ?? 'curriculum';
  const supportFilter: PrerequisiteSupportFilter = options.supportFilter ?? 'all';

  const sortedNodes = [...projection.nodes].sort(compareNodesDeterministically);
  const nodeById = new Map(sortedNodes.map((n) => [n.nodeId, n]));

  if (sortedNodes.length === 0) {
    return {
      mode: 'empty',
      orientation,
      viewLayer,
      width: 680,
      height: 360,
      nodes: [],
      edges: [],
      sourceNodes: [],
      sourceEdges: [],
      nodePositionById: {},
      sourcePositionById: {},
    };
  }

  const activeEdges = projection.edges.filter(
    (e) =>
      nodeById.has(e.prerequisiteNodeId) &&
      nodeById.has(e.dependentNodeId) &&
      (supportFilter === 'all' || e.support === supportFilter)
  );

  // Source layer placement (optional when viewLayer === 'sources')
  const showSources = viewLayer === 'sources' && projection.sourceNodes.length > 0;
  const sourceColumns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(projection.sourceNodes.length))));
  const positionedSourceNodes: PositionedSourceGraphNode[] = [];
  const sourcePositionById: Record<string, PositionedSourceGraphNode> = {};

  let sourceBandWidth = 0;
  let sourceBandHeight = 0;

  if (showSources) {
    const sourceRows = Math.ceil(projection.sourceNodes.length / sourceColumns);
    if (orientation === 'TB') {
      const cols = Math.min(sourceColumns, projection.sourceNodes.length);
      sourceBandWidth = cols * GRAPH_SOURCE_WIDTH + Math.max(0, cols - 1) * SOURCE_GAP;
      sourceBandHeight = sourceRows * GRAPH_SOURCE_HEIGHT + Math.max(0, sourceRows - 1) * SOURCE_GAP;
    } else {
      // In LR mode, stack sources cleanly in 1..N columns on the far left
      const maxRows = Math.max(4, Math.ceil(Math.sqrt(projection.sourceNodes.length) * 1.4));
      const cols = Math.ceil(projection.sourceNodes.length / maxRows);
      const rows = Math.min(maxRows, projection.sourceNodes.length);
      sourceBandWidth = cols * GRAPH_SOURCE_WIDTH + Math.max(0, cols - 1) * SOURCE_GAP;
      sourceBandHeight = rows * GRAPH_SOURCE_HEIGHT + Math.max(0, rows - 1) * SOURCE_GAP;
    }
  }

  // Case A: Zero active prerequisite edges -> clean deterministic curriculum roadmap
  if (activeEdges.length === 0) {
    const positionedNodes: PositionedGraphNode[] = [];
    const nodePositionById: Record<string, PositionedGraphNode> = {};

    const perAxis = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(sortedNodes.length))));
    const cols = orientation === 'TB' ? perAxis : Math.ceil(sortedNodes.length / perAxis);
    const rows = orientation === 'TB' ? Math.ceil(sortedNodes.length / perAxis) : Math.min(perAxis, sortedNodes.length);

    const gridWidth = cols * GRAPH_NODE_WIDTH + Math.max(0, cols - 1) * NODE_GAP_X;
    const gridHeight = rows * GRAPH_NODE_HEIGHT + Math.max(0, rows - 1) * (orientation === 'TB' ? 40 : LR_NODE_GAP_Y);

    const originX =
      showSources && orientation === 'LR'
        ? CANVAS_PADDING + sourceBandWidth + SOURCE_BAND_GAP
        : CANVAS_PADDING + (showSources && orientation === 'TB' ? Math.max(0, (sourceBandWidth - gridWidth) / 2) : 0);
    const originY =
      showSources && orientation === 'TB'
        ? CANVAS_PADDING + sourceBandHeight + SOURCE_BAND_GAP
        : CANVAS_PADDING + (showSources && orientation === 'LR' ? Math.max(0, (sourceBandHeight - gridHeight) / 2) : 0);

    sortedNodes.forEach((node, index) => {
      const col = orientation === 'TB' ? index % cols : Math.floor(index / rows);
      const row = orientation === 'TB' ? Math.floor(index / cols) : index % rows;
      const x = originX + col * (GRAPH_NODE_WIDTH + NODE_GAP_X);
      const y = originY + row * (GRAPH_NODE_HEIGHT + (orientation === 'TB' ? 40 : LR_NODE_GAP_Y));

      const positioned: PositionedGraphNode = {
        node,
        x,
        y,
        width: GRAPH_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
        rank: row,
        orderInRank: col,
        isIsolated: true,
      };
      positionedNodes.push(positioned);
      nodePositionById[node.nodeId] = positioned;
    });

    const totalWidth = Math.max(
      originX + gridWidth + CANVAS_PADDING,
      showSources ? CANVAS_PADDING * 2 + sourceBandWidth : 0
    );
    const totalHeight = Math.max(
      originY + gridHeight + CANVAS_PADDING,
      showSources ? CANVAS_PADDING * 2 + sourceBandHeight : 0
    );

    if (showSources) {
      layoutSourceNodes(
        projection,
        orientation,
        totalWidth,
        totalHeight,
        sourceColumns,
        positionedSourceNodes,
        sourcePositionById
      );
    }

    const sourceEdges = routeSourceEdges(projection, orientation, nodePositionById, sourcePositionById, showSources);

    return {
      mode: 'roadmap-no-prerequisites',
      orientation,
      viewLayer,
      width: Math.max(totalWidth, 640),
      height: Math.max(totalHeight, 360),
      nodes: positionedNodes,
      edges: [],
      sourceNodes: positionedSourceNodes,
      sourceEdges,
      nodePositionById,
      sourcePositionById,
    };
  }

  // Case B: Layered Sugiyama DAG Layout
  // Separate nodes participating in active edges from completely isolated nodes
  const connectedIds = new Set<string>();
  for (const edge of activeEdges) {
    connectedIds.add(edge.prerequisiteNodeId);
    connectedIds.add(edge.dependentNodeId);
  }

  const connectedNodes = sortedNodes.filter((n) => connectedIds.has(n.nodeId));
  const isolatedNodes = sortedNodes.filter((n) => !connectedIds.has(n.nodeId));

  // Build adjacency and break any cycle deterministically for ranking only
  const outMap = new Map<string, string[]>();
  for (const n of connectedNodes) outMap.set(n.nodeId, []);
  for (const e of activeEdges) {
    outMap.get(e.prerequisiteNodeId)?.push(e.dependentNodeId);
  }
  for (const [k, list] of outMap) {
    list.sort((a, b) => compareNodesDeterministically(nodeById.get(a)!, nodeById.get(b)!));
    outMap.set(k, list);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const backEdgeIds = new Set<string>();

  function detectBackEdges(u: string) {
    visited.add(u);
    inStack.add(u);
    for (const v of outMap.get(u) ?? []) {
      if (inStack.has(v)) {
        backEdgeIds.add(`${u}->${v}`);
      } else if (!visited.has(v)) {
        detectBackEdges(v);
      }
    }
    inStack.delete(u);
  }

  for (const n of connectedNodes) {
    if (!visited.has(n.nodeId)) detectBackEdges(n.nodeId);
  }

  // Acyclic adjacency for rank assignment
  const dagOut = new Map<string, string[]>();
  const dagIn = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of connectedNodes) {
    dagOut.set(n.nodeId, []);
    dagIn.set(n.nodeId, []);
    inDeg.set(n.nodeId, 0);
  }

  for (const e of activeEdges) {
    if (backEdgeIds.has(e.id)) continue;
    dagOut.get(e.prerequisiteNodeId)!.push(e.dependentNodeId);
    dagIn.get(e.dependentNodeId)!.push(e.prerequisiteNodeId);
    inDeg.set(e.dependentNodeId, (inDeg.get(e.dependentNodeId) ?? 0) + 1);
  }

  // Topological rank assignment: rank(v) = max(rank(u) + 1)
  const rankById = new Map<string, number>();
  const queue = connectedNodes
    .filter((n) => (inDeg.get(n.nodeId) ?? 0) === 0)
    .map((n) => n.nodeId);
  for (const id of queue) rankById.set(id, 0);

  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const uRank = rankById.get(u) ?? 0;
    for (const v of dagOut.get(u) ?? []) {
      const nextRank = Math.max(rankById.get(v) ?? 0, uRank + 1);
      rankById.set(v, nextRank);
      const deg = (inDeg.get(v) ?? 1) - 1;
      inDeg.set(v, deg);
      if (deg === 0) {
        queue.push(v);
      }
    }
  }

  // Assign rank 0 to any node not reached (defensive guard)
  for (const n of connectedNodes) {
    if (!rankById.has(n.nodeId)) rankById.set(n.nodeId, 0);
  }

  // Pull roots downward if all their dependents start much deeper (improves compactness)
  let maxRank = 0;
  for (const r of rankById.values()) {
    if (r > maxRank) maxRank = r;
  }

  // Group nodes by rank
  const layers: StudyPlanGraphNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of connectedNodes) {
    layers[rankById.get(n.nodeId) ?? 0].push(n);
  }
  for (const layer of layers) {
    layer.sort(compareNodesDeterministically);
  }

  // 4 deterministic barycenter sweeps to reduce edge crossings
  const orderIndex = new Map<string, number>();
  const refreshOrderIndices = () => {
    for (const layer of layers) {
      layer.forEach((n, idx) => orderIndex.set(n.nodeId, idx));
    }
  };
  refreshOrderIndices();

  for (let pass = 0; pass < 4; pass++) {
    // Top-down pass
    for (let r = 1; r < layers.length; r++) {
      layers[r].sort((a, b) => {
        const predsA = dagIn.get(a.nodeId) ?? [];
        const predsB = dagIn.get(b.nodeId) ?? [];
        const baryA =
          predsA.length > 0
            ? predsA.reduce((acc, p) => acc + (orderIndex.get(p) ?? 0), 0) / predsA.length
            : Number.MAX_SAFE_INTEGER;
        const baryB =
          predsB.length > 0
            ? predsB.reduce((acc, p) => acc + (orderIndex.get(p) ?? 0), 0) / predsB.length
            : Number.MAX_SAFE_INTEGER;
        if (Math.abs(baryA - baryB) > 1e-6) return baryA - baryB;
        return compareNodesDeterministically(a, b);
      });
      refreshOrderIndices();
    }

    // Bottom-up pass
    for (let r = layers.length - 2; r >= 0; r--) {
      layers[r].sort((a, b) => {
        const succsA = dagOut.get(a.nodeId) ?? [];
        const succsB = dagOut.get(b.nodeId) ?? [];
        const baryA =
          succsA.length > 0
            ? succsA.reduce((acc, s) => acc + (orderIndex.get(s) ?? 0), 0) / succsA.length
            : orderIndex.get(a.nodeId) ?? 0;
        const baryB =
          succsB.length > 0
            ? succsB.reduce((acc, s) => acc + (orderIndex.get(s) ?? 0), 0) / succsB.length
            : orderIndex.get(b.nodeId) ?? 0;
        if (Math.abs(baryA - baryB) > 1e-6) return baryA - baryB;
        return compareNodesDeterministically(a, b);
      });
      refreshOrderIndices();
    }
  }

  // Compute connected DAG dimensions
  const maxNodesInLayer = Math.max(1, ...layers.map((l) => l.length));
  const positionedNodes: PositionedGraphNode[] = [];
  const nodePositionById: Record<string, PositionedGraphNode> = {};

  let dagWidth = 0;
  let dagHeight = 0;

  if (orientation === 'TB') {
    dagWidth = maxNodesInLayer * GRAPH_NODE_WIDTH + Math.max(0, maxNodesInLayer - 1) * NODE_GAP_X;
    dagHeight = layers.length * GRAPH_NODE_HEIGHT + Math.max(0, layers.length - 1) * NODE_GAP_Y;
  } else {
    dagWidth = layers.length * GRAPH_NODE_WIDTH + Math.max(0, layers.length - 1) * LR_NODE_GAP_X;
    dagHeight = maxNodesInLayer * GRAPH_NODE_HEIGHT + Math.max(0, maxNodesInLayer - 1) * LR_NODE_GAP_Y;
  }

  // Account for isolated nodes if any exist
  const isolatedCols = isolatedNodes.length > 0 ? Math.min(4, Math.max(1, maxNodesInLayer)) : 0;
  const isolatedRows = isolatedNodes.length > 0 ? Math.ceil(isolatedNodes.length / isolatedCols) : 0;
  const isolatedWidth =
    isolatedNodes.length > 0
      ? (orientation === 'TB'
          ? Math.min(isolatedNodes.length, isolatedCols) * GRAPH_NODE_WIDTH +
            Math.max(0, Math.min(isolatedNodes.length, isolatedCols) - 1) * NODE_GAP_X
          : Math.ceil(isolatedNodes.length / Math.min(4, Math.max(1, maxNodesInLayer))) * GRAPH_NODE_WIDTH +
            Math.max(0, Math.ceil(isolatedNodes.length / Math.min(4, Math.max(1, maxNodesInLayer))) - 1) * NODE_GAP_X)
      : 0;

  const contentSpanWidth = Math.max(dagWidth, isolatedWidth, showSources && orientation === 'TB' ? sourceBandWidth : 0);

  const dagOriginX =
    showSources && orientation === 'LR'
      ? CANVAS_PADDING + sourceBandWidth + SOURCE_BAND_GAP
      : CANVAS_PADDING + Math.max(0, (contentSpanWidth - dagWidth) / 2);
  const dagOriginY =
    showSources && orientation === 'TB'
      ? CANVAS_PADDING + sourceBandHeight + SOURCE_BAND_GAP
      : CANVAS_PADDING;

  if (orientation === 'TB') {
    layers.forEach((layer, rank) => {
      const layerSpan = layer.length * GRAPH_NODE_WIDTH + Math.max(0, layer.length - 1) * NODE_GAP_X;
      const startX = dagOriginX + (dagWidth - layerSpan) / 2;
      const y = dagOriginY + rank * (GRAPH_NODE_HEIGHT + NODE_GAP_Y);
      layer.forEach((node, idx) => {
        const x = startX + idx * (GRAPH_NODE_WIDTH + NODE_GAP_X);
        const positioned: PositionedGraphNode = {
          node,
          x,
          y,
          width: GRAPH_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
          rank,
          orderInRank: idx,
          isIsolated: false,
        };
        positionedNodes.push(positioned);
        nodePositionById[node.nodeId] = positioned;
      });
    });

    // Place isolated nodes cleanly below the connected DAG
    if (isolatedNodes.length > 0) {
      const cols = Math.min(4, Math.max(1, maxNodesInLayer));
      const baseIsolatedY = dagOriginY + dagHeight + ISOLATED_BAND_GAP;
      isolatedNodes.forEach((node, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const nodesInThisRow = Math.min(cols, isolatedNodes.length - row * cols);
        const rowSpan = nodesInThisRow * GRAPH_NODE_WIDTH + Math.max(0, nodesInThisRow - 1) * NODE_GAP_X;
        const rowStartX = CANVAS_PADDING + (contentSpanWidth - rowSpan) / 2;
        const positioned: PositionedGraphNode = {
          node,
          x: rowStartX + col * (GRAPH_NODE_WIDTH + NODE_GAP_X),
          y: baseIsolatedY + row * (GRAPH_NODE_HEIGHT + 40),
          width: GRAPH_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
          rank: layers.length + row,
          orderInRank: col,
          isIsolated: true,
        };
        positionedNodes.push(positioned);
        nodePositionById[node.nodeId] = positioned;
      });
    }
  } else {
    layers.forEach((layer, rank) => {
      const layerSpan = layer.length * GRAPH_NODE_HEIGHT + Math.max(0, layer.length - 1) * LR_NODE_GAP_Y;
      const startY = dagOriginY + (dagHeight - layerSpan) / 2;
      const x = dagOriginX + rank * (GRAPH_NODE_WIDTH + LR_NODE_GAP_X);
      layer.forEach((node, idx) => {
        const y = startY + idx * (GRAPH_NODE_HEIGHT + LR_NODE_GAP_Y);
        const positioned: PositionedGraphNode = {
          node,
          x,
          y,
          width: GRAPH_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
          rank,
          orderInRank: idx,
          isIsolated: false,
        };
        positionedNodes.push(positioned);
        nodePositionById[node.nodeId] = positioned;
      });
    });

    if (isolatedNodes.length > 0) {
      const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(isolatedNodes.length))));
      const baseIsolatedY = dagOriginY + dagHeight + ISOLATED_BAND_GAP;
      isolatedNodes.forEach((node, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const positioned: PositionedGraphNode = {
          node,
          x: dagOriginX + col * (GRAPH_NODE_WIDTH + NODE_GAP_X),
          y: baseIsolatedY + row * (GRAPH_NODE_HEIGHT + LR_NODE_GAP_Y),
          width: GRAPH_NODE_WIDTH,
          height: GRAPH_NODE_HEIGHT,
          rank: layers.length + row,
          orderInRank: col,
          isIsolated: true,
        };
        positionedNodes.push(positioned);
        nodePositionById[node.nodeId] = positioned;
      });
    }
  }

  // Compute total canvas bounding box
  let maxRight = 0;
  let maxBottom = 0;
  for (const pn of positionedNodes) {
    maxRight = Math.max(maxRight, pn.x + pn.width);
    maxBottom = Math.max(maxBottom, pn.y + pn.height);
  }
  const totalWidth = Math.max(maxRight + CANVAS_PADDING, showSources ? CANVAS_PADDING * 2 + sourceBandWidth : 0, 640);
  const totalHeight = Math.max(
    maxBottom + CANVAS_PADDING,
    showSources ? CANVAS_PADDING * 2 + sourceBandHeight : 0,
    isolatedRows > 0 ? maxBottom + CANVAS_PADDING : 360
  );

  if (showSources) {
    layoutSourceNodes(
      projection,
      orientation,
      totalWidth,
      totalHeight,
      sourceColumns,
      positionedSourceNodes,
      sourcePositionById
    );
  }

  // Route edges with deterministic multi-port spreading so overlapping arrows separate cleanly
  const outEdgesBySource = new Map<string, StudyPlanGraphEdge[]>();
  const inEdgesByTarget = new Map<string, StudyPlanGraphEdge[]>();
  for (const edge of activeEdges) {
    const outList = outEdgesBySource.get(edge.prerequisiteNodeId) ?? [];
    outList.push(edge);
    outEdgesBySource.set(edge.prerequisiteNodeId, outList);

    const inList = inEdgesByTarget.get(edge.dependentNodeId) ?? [];
    inList.push(edge);
    inEdgesByTarget.set(edge.dependentNodeId, inList);
  }

  for (const list of outEdgesBySource.values()) {
    list.sort((a, b) => {
      const posA = nodePositionById[a.dependentNodeId];
      const posB = nodePositionById[b.dependentNodeId];
      return orientation === 'TB' ? posA.x - posB.x : posA.y - posB.y;
    });
  }
  for (const list of inEdgesByTarget.values()) {
    list.sort((a, b) => {
      const posA = nodePositionById[a.prerequisiteNodeId];
      const posB = nodePositionById[b.prerequisiteNodeId];
      return orientation === 'TB' ? posA.x - posB.x : posA.y - posB.y;
    });
  }

  const positionedEdges: PositionedGraphEdge[] = activeEdges
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, 'en-US'))
    .map((edge) => {
      const srcPos = nodePositionById[edge.prerequisiteNodeId];
      const tgtPos = nodePositionById[edge.dependentNodeId];
      const outSiblings = outEdgesBySource.get(edge.prerequisiteNodeId) ?? [edge];
      const inSiblings = inEdgesByTarget.get(edge.dependentNodeId) ?? [edge];
      const outIdx = outSiblings.findIndex((e) => e.id === edge.id);
      const inIdx = inSiblings.findIndex((e) => e.id === edge.id);
      const outSpread = (outIdx - (outSiblings.length - 1) / 2) * 18;
      const inSpread = (inIdx - (inSiblings.length - 1) / 2) * 18;
      const laneOffset = ((outIdx + inIdx) % 3 - 1) * 8;
      const isBackEdge = backEdgeIds.has(edge.id);

      if (orientation === 'TB') {
        const sx = srcPos.x + srcPos.width / 2 + Math.max(-72, Math.min(72, outSpread));
        const sy = isBackEdge ? srcPos.y + srcPos.height / 2 : srcPos.y + srcPos.height;
        const tx = tgtPos.x + tgtPos.width / 2 + Math.max(-72, Math.min(72, inSpread));
        const ty = isBackEdge ? tgtPos.y + tgtPos.height / 2 : tgtPos.y;
        const { pathD, labelX, labelY } = buildCubicPathTB(sx, sy, tx, ty, isBackEdge, laneOffset);
        return { edge, sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, labelX, labelY, pathD, isBackEdge };
      }

      const sx = isBackEdge ? srcPos.x + srcPos.width / 2 : srcPos.x + srcPos.width;
      const sy = srcPos.y + srcPos.height / 2 + Math.max(-28, Math.min(28, outSpread));
      const tx = isBackEdge ? tgtPos.x + tgtPos.width / 2 : tgtPos.x;
      const ty = tgtPos.y + tgtPos.height / 2 + Math.max(-28, Math.min(28, inSpread));
      const { pathD, labelX, labelY } = buildCubicPathLR(sx, sy, tx, ty, isBackEdge, laneOffset);
      return { edge, sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, labelX, labelY, pathD, isBackEdge };
    });

  const sourceEdges = routeSourceEdges(projection, orientation, nodePositionById, sourcePositionById, showSources);

  return {
    mode: 'dag',
    orientation,
    viewLayer,
    width: totalWidth,
    height: totalHeight,
    nodes: positionedNodes,
    edges: positionedEdges,
    sourceNodes: positionedSourceNodes,
    sourceEdges,
    nodePositionById,
    sourcePositionById,
  };
}

function layoutSourceNodes(
  projection: StudyPlanGraphProjection,
  orientation: GraphOrientation,
  totalWidth: number,
  totalHeight: number,
  sourceColumns: number,
  outNodes: PositionedSourceGraphNode[],
  byId: Record<string, PositionedSourceGraphNode>
): void {
  const sources = projection.sourceNodes;
  if (sources.length === 0) return;

  if (orientation === 'TB') {
    const cols = Math.min(sourceColumns, sources.length);
    const bandW = cols * GRAPH_SOURCE_WIDTH + Math.max(0, cols - 1) * SOURCE_GAP;
    const startX = Math.max(CANVAS_PADDING, (totalWidth - bandW) / 2);
    sources.forEach((sourceNode, idx) => {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const positioned: PositionedSourceGraphNode = {
        sourceNode,
        x: startX + col * (GRAPH_SOURCE_WIDTH + SOURCE_GAP),
        y: CANVAS_PADDING + row * (GRAPH_SOURCE_HEIGHT + SOURCE_GAP),
        width: GRAPH_SOURCE_WIDTH,
        height: GRAPH_SOURCE_HEIGHT,
      };
      outNodes.push(positioned);
      byId[sourceNode.id] = positioned;
    });
  } else {
    const maxRows = Math.max(4, Math.ceil(Math.sqrt(sources.length) * 1.4));
    const rows = Math.min(maxRows, sources.length);
    const bandH = rows * GRAPH_SOURCE_HEIGHT + Math.max(0, rows - 1) * SOURCE_GAP;
    const startY = Math.max(CANVAS_PADDING, (totalHeight - bandH) / 2);
    sources.forEach((sourceNode, idx) => {
      const col = Math.floor(idx / rows);
      const row = idx % rows;
      const positioned: PositionedSourceGraphNode = {
        sourceNode,
        x: CANVAS_PADDING + col * (GRAPH_SOURCE_WIDTH + SOURCE_GAP),
        y: startY + row * (GRAPH_SOURCE_HEIGHT + SOURCE_GAP),
        width: GRAPH_SOURCE_WIDTH,
        height: GRAPH_SOURCE_HEIGHT,
      };
      outNodes.push(positioned);
      byId[sourceNode.id] = positioned;
    });
  }
}

function routeSourceEdges(
  projection: StudyPlanGraphProjection,
  orientation: GraphOrientation,
  nodePositionById: Record<string, PositionedGraphNode>,
  sourcePositionById: Record<string, PositionedSourceGraphNode>,
  showSources: boolean
): PositionedSourceGraphEdge[] {
  if (!showSources) return [];
  const result: PositionedSourceGraphEdge[] = [];
  for (const edge of projection.sourceEdges) {
    const src = sourcePositionById[edge.sourceNodeId];
    const tgt = nodePositionById[edge.topicNodeId];
    if (!src || !tgt) continue;

    if (orientation === 'TB') {
      const sx = src.x + src.width / 2;
      const sy = src.y + src.height;
      const tx = tgt.x + tgt.width / 2;
      const ty = tgt.y;
      const midY = (sy + ty) / 2;
      result.push({
        edge,
        sourceX: sx,
        sourceY: sy,
        targetX: tx,
        targetY: ty,
        pathD: `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`,
      });
    } else {
      const sx = src.x + src.width;
      const sy = src.y + src.height / 2;
      const tx = tgt.x;
      const ty = tgt.y + tgt.height / 2;
      const midX = (sx + tx) / 2;
      result.push({
        edge,
        sourceX: sx,
        sourceY: sy,
        targetX: tx,
        targetY: ty,
        pathD: `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${tx} ${ty}`,
      });
    }
  }
  return result;
}
