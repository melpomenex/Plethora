import { describe, it, expect } from "vitest";
import { GraphNodeType, type GraphNode, type GraphEdge } from "../../KnowledgeGraph";
import {
  computeLayoutEnvelope,
  computeUniverseLayout,
  hashId,
  rand01,
  MAX_ORBITS,
  MAX_MOONS,
} from "../layout";
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

describe("computeLayoutEnvelope", () => {
  it("uses the geometric extent midpoint instead of a density-weighted centroid", () => {
    const envelope = computeLayoutEnvelope([
      { center: { x: -20, y: -4, z: 10 }, radius: 5 },
      { center: { x: 80, y: 16, z: 30 }, radius: 10 },
      // Repeated dense points do not move the envelope center.
      ...Array.from({ length: 40 }, () => ({ center: { x: 80, y: 16, z: 30 } })),
    ]);

    expect(envelope.center).toEqual({ x: 32.5, y: 8.5, z: 22.5 });
    expect(envelope.bounds).toBeGreaterThan(0);
  });

  it("supports a fixed center and stable empty-layout fallback", () => {
    const fixed = computeLayoutEnvelope(
      [{ center: { x: 10, y: 0, z: 0 } }],
      { x: 2, y: 0, z: 0 }
    );
    expect(fixed.center).toEqual({ x: 2, y: 0, z: 0 });
    expect(fixed.bounds).toBeGreaterThanOrEqual(8);

    expect(computeLayoutEnvelope([])).toEqual({
      center: { x: 0, y: 0, z: 0 },
      bounds: 60,
    });
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
    expect(a.center).toEqual(b.center);
    expect(a.bounds).toBe(b.bounds);
  });

  it("centers the visible core and encloses every visible placement", () => {
    const { nodes, edges } = makeCollection({ docs: 7, extractsPerDoc: 3, cardsPerExtract: 5 });
    nodes.push({
      id: "tag-distant",
      type: GraphNodeType.Tag,
      label: "distant",
      x: 0,
      y: 0,
    });
    const layout = computeUniverseLayout(nodes, edges);
    // Core = clusters + visible system nodes; rim (tags, belt) must not move
    // the home target, only widen the fit bounds.
    const coreExtents = [
      ...layout.clusters.map((cluster) => ({ center: cluster.center, radius: cluster.radius })),
      ...[...layout.placements.values()]
        .filter((placement) => !placement.paged && placement.systemIndex >= 0)
        .map((placement) => ({ center: placement.position, radius: 0 })),
    ];
    const allExtents = [
      ...layout.clusters.map((cluster) => ({ center: cluster.center, radius: cluster.radius })),
      ...[...layout.placements.values()]
        .filter((placement) => !placement.paged)
        .map((placement) => ({ center: placement.position, radius: 0 })),
    ];

    // Envelope center = (min(center − radius) + max(center + radius)) / 2 per axis.
    expect(layout.center.x).toBeCloseTo(
      (Math.min(...coreExtents.map((e) => e.center.x - (e.radius ?? 0))) +
        Math.max(...coreExtents.map((e) => e.center.x + (e.radius ?? 0)))) /
        2,
      10
    );
    expect(layout.center.y).toBeCloseTo(
      (Math.min(...coreExtents.map((e) => e.center.y - (e.radius ?? 0))) +
        Math.max(...coreExtents.map((e) => e.center.y + (e.radius ?? 0)))) /
        2,
      10
    );
    expect(layout.center.z).toBeCloseTo(
      (Math.min(...coreExtents.map((e) => e.center.z - (e.radius ?? 0))) +
        Math.max(...coreExtents.map((e) => e.center.z + (e.radius ?? 0)))) /
        2,
      10
    );
    for (const extent of allExtents) {
      const distance = Math.hypot(
        extent.center.x - layout.center.x,
        extent.center.y - layout.center.y,
        extent.center.z - layout.center.z
      );
      expect(distance + extent.radius).toBeLessThanOrEqual(layout.bounds + 1e-8);
    }
  });

  it("keeps the home target on the core when rim content is one-sided", () => {
    // A small collection keeps the core compact; a single tag plus one belt
    // orphan put the rim content on the far side of it. The home target must
    // stay on the core while the fit bounds still include the rim.
    const { nodes, edges } = makeCollection({ docs: 6, extractsPerDoc: 3, cardsPerExtract: 2 });
    const layout = computeUniverseLayout(nodes, edges);
    const tag = layout.placements.get("tag-alpha")!;
    const corePlacements = [...layout.placements.values()].filter(
      (placement) => placement.systemIndex >= 0
    );

    const coreRadius = Math.max(
      ...corePlacements.map((p) =>
        Math.hypot(p.position.x - layout.center.x, p.position.z - layout.center.z)
      )
    );
    const tagDistance = Math.hypot(
      tag.position.x - layout.center.x,
      tag.position.z - layout.center.z
    );

    // The rim sits outside the core, on one side of it.
    expect(tag.systemIndex).toBe(-1);
    expect(tagDistance).toBeGreaterThan(coreRadius);

    // …yet the home target equals the core envelope's exact midpoint: the old
    // full-envelope midpoint would be dragged toward the one-sided halo.
    const coreEnvelopeMid = {
      x: (Math.min(...corePlacements.map((p) => p.position.x)) +
        Math.max(...corePlacements.map((p) => p.position.x))) /
        2,
      z: (Math.min(...corePlacements.map((p) => p.position.z)) +
        Math.max(...corePlacements.map((p) => p.position.z))) /
        2,
    };
    const coreMidOffset = Math.hypot(
      layout.center.x - coreEnvelopeMid.x,
      layout.center.z - coreEnvelopeMid.z
    );
    expect(coreMidOffset).toBeLessThan(tagDistance * 0.15);

    // Rim-inclusive framing: the fit radius covers the halo node and the rim
    // genuinely widens the framing beyond the core.
    expect(layout.bounds).toBeGreaterThanOrEqual(tagDistance);
    expect(layout.bounds).toBeGreaterThan(layout.coreBounds);
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
    expect(layout.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(layout.bounds).toBeGreaterThan(0);
  });
});
