import { describe, expect, it } from "vitest";
import {
  buildConceptGraphProjection,
  conceptNodeId,
  consumeConceptFocus,
  requestConceptFocus,
  subscribeConceptFocus,
} from "../conceptProjection";
import { GraphNodeType } from "../KnowledgeGraph";
import type { Concept, ConceptLink } from "../../../api/concept-links";

const concept = (id: string, name: string): Concept => ({
  id,
  name,
  normalizedName: name.toLowerCase(),
  createdAt: "",
  updatedAt: "",
});

const link = (overrides: Partial<ConceptLink>): ConceptLink => ({
  id: "link-1",
  sourceKind: "concept",
  sourceId: "c1",
  targetKind: "concept",
  targetId: "c2",
  relationType: "supports",
  confidence: 0.9,
  createdBy: "user",
  createdAt: "",
  isDismissed: false,
  ...overrides,
});

describe("buildConceptGraphProjection", () => {
  it("maps only confirmed live concept links into authoritative nodes/edges", () => {
    const projection = buildConceptGraphProjection({
      concepts: [concept("c1", "Gravity"), concept("c2", "Orbits"), concept("c3", "Pending")],
      links: [
        link({ id: "confirmed", sourceId: "c1", targetId: "c2" }),
        link({ id: "pending", sourceKind: "concept", sourceId: "c1", targetId: "c3", createdBy: "ai" }),
        link({ id: "dismissed", sourceId: "c1", targetId: "c3", isDismissed: true }),
      ],
    });
    expect(projection.nodes.map((node) => node.id).sort()).toEqual([
      conceptNodeId("c1"),
      conceptNodeId("c2"),
    ]);
    expect(projection.nodes.every((node) => node.type === GraphNodeType.Concept)).toBe(true);
    expect(projection.edges.map((edge) => edge.id)).toEqual(["concept-link-confirmed"]);
    expect(projection.edges[0].label).toBe("supports");
  });

  it("maps source endpoints that already exist in the graph", () => {
    const projection = buildConceptGraphProjection({
      concepts: [concept("c1", "Gravity")],
      links: [
        link({
          id: "doc-link",
          sourceKind: "document",
          sourceId: "doc-1",
          targetId: "c1",
          relationType: "definition-of",
        }),
      ],
    });
    expect(projection.edges[0]).toMatchObject({
      source: "doc-doc-1",
      target: conceptNodeId("c1"),
      label: "definition-of",
    });
  });

  it("reflects removal immediately by dropping the concept edge/node", () => {
    const concepts = [concept("c1", "Gravity"), concept("c2", "Orbits")];
    const withLink = buildConceptGraphProjection({
      concepts,
      links: [link({ id: "removed", sourceId: "c1", targetId: "c2" })],
    });
    expect(withLink.nodes).toHaveLength(2);
    const afterRemoval = buildConceptGraphProjection({ concepts, links: [] });
    expect(afterRemoval.nodes).toHaveLength(0);
    expect(afterRemoval.edges).toHaveLength(0);
  });

  it("ignores links whose concept endpoint has no concept row", () => {
    const projection = buildConceptGraphProjection({
      concepts: [concept("c1", "Gravity")],
      links: [link({ sourceId: "c1", targetId: "missing" })],
    });
    expect(projection.nodes).toHaveLength(1);
    expect(projection.nodes[0].id).toBe(conceptNodeId("c1"));
    // The edge is emitted but the caller drops it because the target node is
    // absent; no phantom node is fabricated.
    expect(projection.edges).toHaveLength(0);
  });
});

describe("concept focus handoff", () => {
  it("delivers a pending focus once and notifies subscribers", () => {
    requestConceptFocus("c1");
    expect(consumeConceptFocus()).toBe("c1");
    expect(consumeConceptFocus()).toBeNull();

    const seen: string[] = [];
    const unsubscribe = subscribeConceptFocus((id) => seen.push(id));
    requestConceptFocus("c2");
    unsubscribe();
    requestConceptFocus("c3");
    expect(seen).toEqual(["c2"]);
  });
});
