/**
 * Confirmed concept projection into the EXISTING knowledge graph
 * (change `complete-knowledge-relationships-and-coverage`, task 4.1).
 *
 * Only endorsed (`created_by = "user"`) live links become authoritative graph
 * nodes/edges. Pending AI suggestions are excluded here by construction, so
 * they cannot inflate graph counts or imply a relationship the user has not
 * confirmed. No second graph store or layout is introduced.
 */

import type { Concept, ConceptLink } from "../../api/concept-links";
import { GraphNodeType, type GraphEdge, type GraphNode } from "./KnowledgeGraph";

export function conceptNodeId(conceptId: string): string {
  return `concept-${conceptId}`;
}

export function isConfirmedConceptLink(link: ConceptLink): boolean {
  return link.createdBy === "user" && !link.isDismissed;
}

function endpointNodeId(kind: string, id: string): string | null {
  switch (kind) {
    case "concept":
      return conceptNodeId(id);
    case "document":
      return `doc-${id}`;
    case "extract":
      return `extract-${id}`;
    case "card":
      return `card-${id}`;
    default:
      // annotations/chunks do not have first-class renderer nodes.
      return null;
  }
}

export interface ConceptGraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Map confirmed concepts/links onto renderer-neutral graph data. The caller
 * merges these into the existing document/extract/card graph and ignores
 * edges whose endpoint node is absent.
 */
export function buildConceptGraphProjection(input: {
  concepts: readonly Concept[];
  links: readonly ConceptLink[];
}): ConceptGraphProjection {
  const confirmed = input.links.filter(isConfirmedConceptLink);
  const conceptIds = new Set<string>();
  for (const link of confirmed) {
    if (link.sourceKind === "concept") conceptIds.add(link.sourceId);
    if (link.targetKind === "concept") conceptIds.add(link.targetId);
  }

  const byId = new Map(input.concepts.map((concept) => [concept.id, concept]));
  const nodes: GraphNode[] = [];
  for (const conceptId of conceptIds) {
    const concept = byId.get(conceptId);
    if (!concept) continue;
    nodes.push({
      id: conceptNodeId(concept.id),
      type: GraphNodeType.Concept,
      label: concept.name,
      description: concept.description ?? "Confirmed concept",
      x: deterministicConceptCoordinate(concept.id, "x", 800, 100),
      y: deterministicConceptCoordinate(concept.id, "y", 600, 100),
      radius: 18,
      color: "#eab308",
      metadata: {
        conceptId: concept.id,
        normalizedName: concept.normalizedName,
        confirmed: true,
      },
    });
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const link of confirmed) {
    if (link.sourceKind === "concept" && !byId.has(link.sourceId)) continue;
    if (link.targetKind === "concept" && !byId.has(link.targetId)) continue;
    const source = endpointNodeId(link.sourceKind, link.sourceId);
    const target = endpointNodeId(link.targetKind, link.targetId);
    if (!source || !target || source === target) continue;
    const key = `${source}\u0000${target}\u0000${link.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `concept-link-${link.id}`,
      source,
      target,
      type: "related",
      label: link.relationType,
      weight: link.confidence,
    });
  }

  return { nodes, edges };
}

function deterministicConceptCoordinate(
  id: string,
  axis: "x" | "y",
  span: number,
  offset: number
): number {
  let hash = axis === "x" ? 2_166_136_261 : 3_747_613_931;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return offset + ((hash >>> 0) / 0xffff_ffff) * span;
}

/* ------------------------------------------------------------------------- */
/* Concept focus navigation (selection sheet → existing graph tab)           */
/* ------------------------------------------------------------------------- */

let pendingConceptId: string | null = null;
const focusListeners = new Set<(conceptId: string) => void>();

/** Ask the existing Knowledge Network surface to select a concept node. */
export function requestConceptFocus(conceptId: string): void {
  pendingConceptId = conceptId;
  for (const listener of focusListeners) listener(conceptId);
}

/** Consume a focus request made before the graph mounted. */
export function consumeConceptFocus(): string | null {
  const value = pendingConceptId;
  pendingConceptId = null;
  return value;
}

export function subscribeConceptFocus(listener: (conceptId: string) => void): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

/** Open (or focus) the existing Knowledge Network tab on a concept. */
export async function openConceptInKnowledgeGraph(conceptId: string): Promise<void> {
  requestConceptFocus(conceptId);
  const [{ createCanonicalTab }, { useTabsStore }] = await Promise.all([
    import("../tabs/TabRegistry"),
    import("../../stores/tabsStore"),
  ]);
  useTabsStore.getState().addTab(createCanonicalTab("knowledge-network"));
}
