/**
 * Cross-session concept relations adapter (Task 5.4).
 *
 * Connects session-extracted concepts to the existing course knowledge graph via
 * `complete-knowledge-relationships-and-coverage` public APIs (`src/api/concept-links.ts`).
 *
 * Invariants:
 * - Reuses existing concept API: no new graph, no new index.
 * - Queries bounded course concepts (capped at 12).
 * - Distinguishes known evidence coverage from learner review mastery.
 * - Requires explicit user acceptance before creating durable links.
 * - History-preserving reuse: linking a concept across multiple recordings links
 *   the sources without creating duplicate flashcards, automatic graph writes,
 *   or scheduler/FSRS mutations.
 * - If dependency is absent or errors, gracefully marks UI unavailable without
 *   blocking the session or P0/P1 release.
 */

import {
  findConceptsByNames,
  getConceptBacklinks,
  proposeConceptLink,
  acceptConceptLink,
  normalizeConceptName,
  type Concept,
} from "../../api/concept-links";

export const MAX_SESSION_CONCEPTS_QUERIED = 12;

export interface SessionConceptRelationMatch {
  conceptName: string;
  normalizedName: string;
  existingConcept?: Concept;
  otherLinkedSources: Array<{
    sourceKind: string;
    sourceId: string;
    relationType: string;
  }>;
  isAlreadyLinkedToSession: boolean;
  evidenceCoverage: "unknown" | "partial" | "supported";
}

export interface ConceptRelationsAdapterResult {
  available: boolean;
  reason?: string;
  matches: SessionConceptRelationMatch[];
}

/**
 * Queries bounded course concepts matching the session's concept names.
 */
export async function querySessionConceptRelations(
  sessionDocumentId: string,
  conceptNames: string[]
): Promise<ConceptRelationsAdapterResult> {
  if (!conceptNames || conceptNames.length === 0) {
    return { available: true, matches: [] };
  }

  const boundedNames = conceptNames.slice(0, MAX_SESSION_CONCEPTS_QUERIED);
  const normalizedMap = new Map<string, string>();
  for (const name of boundedNames) {
    const norm = normalizeConceptName(name);
    if (norm) {
      normalizedMap.set(norm, name);
    }
  }

  const distinctNorms = Array.from(normalizedMap.keys());
  if (distinctNorms.length === 0) {
    return { available: true, matches: [] };
  }

  try {
    const existingConcepts = await findConceptsByNames(distinctNorms);
    const conceptByNorm = new Map<string, Concept>();
    for (const c of existingConcepts) {
      conceptByNorm.set(normalizeConceptName(c.name), c);
    }

    const matches: SessionConceptRelationMatch[] = [];

    for (const norm of distinctNorms) {
      const originalName = normalizedMap.get(norm) ?? norm;
      const existing = conceptByNorm.get(norm);

      if (!existing) {
        matches.push({
          conceptName: originalName,
          normalizedName: norm,
          otherLinkedSources: [],
          isAlreadyLinkedToSession: false,
          evidenceCoverage: "unknown",
        });
        continue;
      }

      // Query backlinks targeting this existing concept
      let backlinks: Awaited<ReturnType<typeof getConceptBacklinks>> = [];
      try {
        backlinks = await getConceptBacklinks(existing.id);
      } catch (err) {
        console.warn(`[ConceptRelationsAdapter] Could not load backlinks for concept ${existing.id}:`, err);
      }

      // Pending AI suggestions are drafts, not established evidence. Only a
      // user-endorsed link proves that a source actually covers the concept.
      const acceptedBacklinks = backlinks.filter((b) => b.createdBy === "user");

      const uniqueOtherSources = new Map<
        string,
        { sourceKind: string; sourceId: string; relationType: string }
      >();
      for (const b of acceptedBacklinks) {
        if (b.sourceId === sessionDocumentId) continue;
        const key = `${b.sourceKind}\u0000${b.sourceId}`;
        if (!uniqueOtherSources.has(key)) {
          uniqueOtherSources.set(key, {
            sourceKind: b.sourceKind,
            sourceId: b.sourceId,
            relationType: b.relationType,
          });
        }
      }

      const isAlreadyLinked = acceptedBacklinks.some(
        (b) => b.sourceId === sessionDocumentId
      );

      const otherLinked = Array.from(uniqueOtherSources.values());

      // Evidence coverage strictly reflects distinct accepted source links,
      // never learner mastery or unendorsed AI suggestions.
      const acceptedSourceCount = uniqueOtherSources.size + (isAlreadyLinked ? 1 : 0);
      const evidenceCoverage: "unknown" | "partial" | "supported" =
        acceptedSourceCount >= 2
          ? "supported"
          : acceptedSourceCount === 1
          ? "partial"
          : "unknown";

      matches.push({
        conceptName: originalName,
        normalizedName: norm,
        existingConcept: existing,
        otherLinkedSources: otherLinked,
        isAlreadyLinkedToSession: isAlreadyLinked,
        evidenceCoverage,
      });
    }

    return {
      available: true,
      matches,
    };
  } catch (err) {
    console.warn("[ConceptRelationsAdapter] Knowledge adapter unavailable:", err);
    return {
      available: false,
      reason: err instanceof Error ? err.message : "Knowledge relationships adapter unavailable",
      matches: [],
    };
  }
}

/**
 * Explicitly links this session's document to an existing course concept.
 *
 * Verifies that the source link is established without creating duplicate cards
 * or mutating the review scheduler.
 */
export async function linkSessionDocumentToConcept(
  sessionDocumentId: string,
  conceptId: string,
  relationType = "related-to"
): Promise<boolean> {
  if (!sessionDocumentId.trim() || !conceptId.trim()) {
    throw new Error("Both a session document and a concept are required");
  }

  try {
    const proposalResult = await proposeConceptLink({
      sourceKind: "document",
      sourceId: sessionDocumentId,
      targetKind: "concept",
      targetId: conceptId,
      relationType,
      confidence: 1.0,
      provenance: {
        policyVersion: "session-concept-link-v1",
        origin: "user",
      },
    });

    // A dismissed fingerprint is deliberately never re-proposed. The user
    // must make a new, distinct decision instead of silently resurrecting it.
    if (proposalResult.outcome === "dismissed") {
      throw new Error(
        "This concept relationship was previously dismissed. Change the relation or remove the dismissal before linking again."
      );
    }

    const linkId = proposalResult.link?.id;
    if (!linkId) {
      throw new Error("Knowledge adapter did not return a relationship proposal");
    }

    const accepted = await acceptConceptLink(linkId);
    if (!accepted) {
      throw new Error("Knowledge adapter could not confirm the relationship");
    }
    return true;
  } catch (err) {
    console.error("[ConceptRelationsAdapter] Failed to link session to concept:", err);
    throw err;
  }
}
