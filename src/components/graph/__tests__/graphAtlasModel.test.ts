import { describe, expect, it } from "vitest";
import { GraphNodeType, type GraphEdge, type GraphNode } from "../KnowledgeGraph";
import {
  buildClusterSubgraph,
  buildDirectoryInsights,
  buildFocusNeighborhood,
  buildKnowledgeAtlas,
} from "../graphAtlasModel";

function makeNode(
  id: string,
  type: GraphNodeType,
  label: string,
  extra: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    type,
    label,
    x: 0,
    y: 0,
    ...extra,
  };
}

describe("graphAtlasModel", () => {
  const nodes: GraphNode[] = [
    makeNode("doc-1", GraphNodeType.Document, "Behave", { category: "Neuroscience" }),
    makeNode("doc-2", GraphNodeType.Document, "Thinking, Fast and Slow", {
      category: "Psychology",
    }),
    makeNode("doc-3", GraphNodeType.Document, "Orphan Paper", { category: "Physics" }),
    makeNode("extract-1", GraphNodeType.Extract, "Amygdala threat response", {
      metadata: { documentId: "1", retrievability: 0.92, isLeech: false },
    }),
    makeNode("extract-2", GraphNodeType.Extract, "System 1 heuristics", {
      metadata: { documentId: "2", retrievability: 0.52, isLeech: true },
    }),
    makeNode("concept-1", GraphNodeType.Concept, "Cognitive Bias", {
      category: "Psychology",
    }),
  ];

  const edges: GraphEdge[] = [
    { id: "e1", source: "doc-1", target: "extract-1", type: "contains" },
    { id: "e2", source: "doc-2", target: "extract-2", type: "contains" },
    { id: "e3", source: "extract-1", target: "concept-1", type: "related", label: "shared concept" },
    { id: "e4", source: "extract-2", target: "concept-1", type: "related", label: "shared concept" },
  ];

  it("groups nodes into topic clusters and computes cross-cluster bridges", () => {
    const atlas = buildKnowledgeAtlas(nodes, edges);
    expect(atlas.clusters.length).toBe(3);
    expect(atlas.totalNodes).toBe(6);
    expect(atlas.totalBridges).toBeGreaterThanOrEqual(1);

    const psych = atlas.clusters.find((c) => c.label === "Psychology");
    expect(psych).toBeDefined();
    expect(psych?.leechCount).toBe(1);
    expect(psych?.health).toBe("critical");
  });

  it("builds a 1-hop focus neighborhood with radial coordinates", () => {
    const focus = buildFocusNeighborhood(nodes, edges, "extract-1", 1);
    expect(focus.focusNode?.id).toBe("extract-1");
    expect(focus.data.nodes.map((n) => n.id)).toContain("doc-1");
    expect(focus.data.nodes.map((n) => n.id)).toContain("concept-1");
    expect(focus.grouped.parents.map((n) => n.id)).toContain("doc-1");
    expect(focus.grouped.concepts.map((n) => n.id)).toContain("concept-1");
  });

  it("builds a cluster subgraph without crashing", () => {
    const sub = buildClusterSubgraph(nodes, edges, ["doc-1", "extract-1"]);
    expect(sub.nodes.length).toBe(2);
    expect(sub.edges.length).toBe(1);
  });

  it("surfaces hubs, leech hotspots, and orphaned documents in directory insights", () => {
    const insights = buildDirectoryInsights(nodes, edges);
    expect(insights.hubs[0]?.node.id).toBe("extract-1");
    expect(insights.hotspots.map((h) => h.node.id)).toContain("extract-2");
    expect(insights.orphans.map((o) => o.node.id)).toContain("doc-3");
  });
});
