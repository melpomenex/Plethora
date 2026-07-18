import { describe, it, expect } from "vitest";
import { GraphNodeType, type GraphNode, type GraphEdge } from "../../KnowledgeGraph";
import { computeUniverseLayout, hashId, rand01, MAX_ORBITS, MAX_MOONS } from "../layout";
import { NodeClass } from "../types";

function makeCollection(opts?: { docs?: number; extractsPerDoc?: number; cardsPerExtract?: number }) {
  const docCount = opts?.docs ?? 6;
  const extractsPerDoc = opts?.extractsPerDoc ?? 4;
  const cardsPerExtract = opts?.cardsPerExtract ?? 2;
  const categories = ["Physics", "History", undefined];

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (let d = 0; d < docCount; d++) {
    const docId = `doc-${d}`;
    nodes.push({
      id: docId,
      type: GraphNodeType.Document,
      label: `Document ${d}`,
      x: 0,
      y: 0,
      category: categories[d % categories.length],
    });
    for (let e = 0; e < extractsPerDoc; e++) {
      const extractId = `extract-${d}-${e}`;
      nodes.push({ id: extractId, type: GraphNodeType.Extract, label: `Extract ${d}.${e}`, x: 0, y: 0 });
      edges.push({ id: `edge-c-${extractId}`, source: docId, target: extractId, type: "contains" });
      for (let c = 0; c < cardsPerExtract; c++) {
        const cardId = `card-${d}-${e}-${c}`;
        nodes.push({ id: cardId, type: GraphNodeType.Flashcard, label: `Card ${d}.${e}.${c}`, x: 0, y: 0 });
        edges.push({ id: `edge-d-${cardId}`, source: extractId, target: cardId, type: "derived" });
      }
    }
  }
  // A tag and an orphan card (no derived edge)
  nodes.push({ id: "tag-alpha", type: GraphNodeType.Tag, label: "alpha", x: 0, y: 0 });
  nodes.push({ id: "card-orphan", type: GraphNodeType.Flashcard, label: "Orphan", x: 0, y: 0 });
  return { nodes, edges };
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("hash primitives", () => {
  it("are deterministic", () => {
    expect(hashId("doc-42")).toBe(hashId("doc-42"));
    expect(rand01("doc-42", "y")).toBe(rand01("doc-42", "y"));
    expect(rand01("doc-42", "y")).not.toBe(rand01("doc-42", "z"));
  });

  it("rand01 stays in [0, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = rand01(`id-${i}`, "salt");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("computeUniverseLayout", () => {
  it("produces identical positions across runs (session stability)", () => {
    const { nodes, edges } = makeCollection();
    const a = computeUniverseLayout(nodes, edges);
    const b = computeUniverseLayout(nodes, edges);
    expect(a.placements.size).toBe(b.placements.size);
    for (const [id, pa] of a.placements) {
      const pb = b.placements.get(id)!;
      expect(pb).toBeDefined();
      expect(pa.position).toEqual(pb.position);
      expect(pa.origin).toEqual(pb.origin);
      expect(pa.systemIndex).toBe(pb.systemIndex);
    }
  });

  it("is invariant to input ordering", () => {
    const { nodes, edges } = makeCollection();
    const a = computeUniverseLayout(nodes, edges);
    const b = computeUniverseLayout(seededShuffle(nodes, 7), seededShuffle(edges, 13));
    for (const [id, pa] of a.placements) {
      const pb = b.placements.get(id)!;
      expect(pb.position.x).toBeCloseTo(pa.position.x, 10);
      expect(pb.position.y).toBeCloseTo(pa.position.y, 10);
      expect(pb.position.z).toBeCloseTo(pa.position.z, 10);
    }
  });

  it("places every node exactly once", () => {
    const { nodes, edges } = makeCollection();
    const layout = computeUniverseLayout(nodes, edges);
    expect(layout.placements.size).toBe(nodes.length);
  });

  it("gives extracts ascending orbit rings around their parent star", () => {
    const { nodes, edges } = makeCollection({ docs: 1, extractsPerDoc: 5, cardsPerExtract: 0 });
    const layout = computeUniverseLayout(nodes, edges);
    const system = layout.systems.get("doc-0")!;
    expect(system.extractIds.length).toBe(5);
    expect(system.rings.length).toBe(5);
    for (let i = 1; i < system.rings.length; i++) {
      expect(system.rings[i].radius).toBeGreaterThan(system.rings[i - 1].radius);
    }
    // Every extract's distance from the star matches its ring radius
    system.extractIds.forEach((id, i) => {
      const p = layout.placements.get(id)!;
      const dx = p.position.x - system.center.x;
      const dy = p.position.y - system.center.y;
      const dz = p.position.z - system.center.z;
      expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeCloseTo(system.rings[i].radius, 6);
    });
  });

  it("collapses children onto their star as origin", () => {
    const { nodes, edges } = makeCollection({ docs: 1, extractsPerDoc: 3, cardsPerExtract: 2 });
    const layout = computeUniverseLayout(nodes, edges);
    const system = layout.systems.get("doc-0")!;
    for (const [id, p] of layout.placements) {
      if (p.nodeClass === NodeClass.Planet || (p.nodeClass === NodeClass.Moon && id !== "card-orphan")) {
        expect(p.origin).toEqual(system.center);
      }
    }
  });

  it("paginates orbits beyond the budget", () => {
    const { nodes, edges } = makeCollection({ docs: 1, extractsPerDoc: MAX_ORBITS + 6, cardsPerExtract: 0 });
    const layout = computeUniverseLayout(nodes, edges);
    const system = layout.systems.get("doc-0")!;
    expect(system.extractIds.length).toBe(MAX_ORBITS);
    expect(system.pagedExtracts).toBe(6);
    const paged = [...layout.placements.values()].filter((p) => p.paged);
    expect(paged.length).toBe(6);
  });

  it("paginates moons beyond the budget", () => {
    const { nodes, edges } = makeCollection({ docs: 1, extractsPerDoc: 1, cardsPerExtract: MAX_MOONS + 4 });
    const layout = computeUniverseLayout(nodes, edges);
    const system = layout.systems.get("doc-0")!;
    expect(system.moonsByExtract.get("extract-0-0")!.length).toBe(MAX_MOONS);
    expect(system.pagedMoons).toBe(4);
  });

  it("groups same-category documents into the same cluster", () => {
    const { nodes, edges } = makeCollection({ docs: 9, extractsPerDoc: 0, cardsPerExtract: 0 });
    const layout = computeUniverseLayout(nodes, edges);
    // 3 categories cycle across 9 docs → 3 clusters
    expect(layout.clusters.length).toBe(3);
    const physics = layout.clusters.find((c) => c.key === "Physics")!;
    const physicsDocs = [...layout.placements.values()].filter((p) => p.clusterKey === "Physics");
    expect(physicsDocs.length).toBe(3);
    for (const p of physicsDocs) {
      const dx = p.position.x - physics.center.x;
      const dz = p.position.z - physics.center.z;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeLessThanOrEqual(physics.radius + 1e-6);
    }
  });

  it("sends orphans to the belt and tags to the halo, outside the galaxy core", () => {
    const { nodes, edges } = makeCollection();
    const layout = computeUniverseLayout(nodes, edges);
    const orphan = layout.placements.get("card-orphan")!;
    const tag = layout.placements.get("tag-alpha")!;
    expect(orphan.systemIndex).toBe(-1);
    expect(tag.systemIndex).toBe(-1);
    const maxClusterExtent = Math.max(
      ...layout.clusters.map((c) => Math.hypot(c.center.x, c.center.z) + c.radius)
    );
    expect(Math.hypot(orphan.position.x, orphan.position.z)).toBeGreaterThan(maxClusterExtent);
    expect(Math.hypot(tag.position.x, tag.position.z)).toBeGreaterThan(maxClusterExtent);
  });

  it("handles an empty collection", () => {
    const layout = computeUniverseLayout([], []);
    expect(layout.placements.size).toBe(0);
    expect(layout.clusters.length).toBe(0);
    expect(layout.bounds).toBeGreaterThan(0);
  });
});
