/**
 * Bounded typed relationship proposal contract (change
 * `complete-knowledge-relationships-and-coverage`, task 3.1).
 *
 * The model receives ONLY verified evidence handles assembled by the app and
 * may only reference those handles. It cannot invent concept ids, evidence
 * ids, thresholds or caps. Every response is validated fail-closed, deduped by
 * endpoint/relation, filtered by the policy thresholds and capped at five
 * visible/saved proposals per analysis.
 */

import {
  CONCEPT_RELATION_TYPES,
  SYMMETRIC_CONCEPT_RELATIONS,
  normalizeConceptName,
  type ConceptRelationType,
} from "../../../api/concept-links";
import {
  checkNumber,
  checkString,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

/** Cap on visible/saved AI link proposals per analysis (design). */
export const MAX_RELATIONSHIP_PROPOSALS_PER_ANALYSIS = 5;
/** Upper bound on model-returned rows before policy filtering. */
export const MAX_RELATIONSHIP_PROPOSALS_OUTPUT = 12;
/** Fingerprint policy version; bumping it intentionally re-enables proposals. */
export const RELATIONSHIP_POLICY_VERSION = "relationship-policy-v1";

/**
 * Conservative initial per-relation thresholds (policy defaults, not measured
 * calibration). Prompt text/model output can never override them.
 */
export const RELATIONSHIP_MIN_CONFIDENCE: Readonly<Record<ConceptRelationType, number>> = {
  "same-as": 0.9,
  "prerequisite-of": 0.85,
  "example-of": 0.8,
  contradicts: 0.9,
  supports: 0.8,
  extends: 0.8,
  "analogous-to": 0.8,
  "definition-of": 0.8,
  "application-of": 0.8,
  "related-to": 0.8,
};

export function isConceptRelationType(value: unknown): value is ConceptRelationType {
  return typeof value === "string" && (CONCEPT_RELATION_TYPES as readonly string[]).includes(value);
}

export function minimumConfidenceForRelation(relationType: string): number {
  return isConceptRelationType(relationType)
    ? RELATIONSHIP_MIN_CONFIDENCE[relationType]
    : Number.POSITIVE_INFINITY;
}

export function isSymmetricRelation(relationType: string): boolean {
  return (SYMMETRIC_CONCEPT_RELATIONS as readonly string[]).includes(relationType);
}

/**
 * A verified source handle. `handle` is app-generated (never a model id) and
 * `label` is already-validated display text from a resolved source record.
 */
export interface RelationshipEvidenceHandle {
  handle: string;
  kind: "concept" | "document" | "extract" | "card" | "annotation" | "chunk";
  /** Concrete row id. Absent only for a draft concept that is not saved yet. */
  id?: string;
  label: string;
  /** Concept name for `kind: "concept"` handles. */
  conceptName?: string;
  documentId?: string;
  sourceRevision?: string;
}

export interface ConceptRelationshipProposal {
  sourceHandle: string;
  targetHandle: string;
  relationType: ConceptRelationType | string;
  /** Finite number in [0, 1]. */
  confidence: number;
  rationale: string;
}

export interface ConceptRelationshipAnalysis {
  relationships: ConceptRelationshipProposal[];
}

export const CONCEPT_RELATIONSHIP_SCHEMA = {
  name: "ConceptRelationshipAnalysis",
  nativeName: "conceptRelationshipAnalysis",
  json: JSON.stringify({
    relationships: [
      {
        sourceHandle: "string",
        targetHandle: "string",
        relationType: CONCEPT_RELATION_TYPES.join("|"),
        confidence: "number 0..1",
        rationale: "string",
      },
    ],
  }),
} as const;

function handleKey(kindOrHandle: string): string {
  return kindOrHandle.trim();
}

function endpointPairKey(
  sourceHandle: string,
  targetHandle: string,
  relationType: string
): string {
  const endpoints = isSymmetricRelation(relationType)
    ? [sourceHandle, targetHandle].sort()
    : [sourceHandle, targetHandle];
  return `${relationType}\u0000${endpoints[0]}\u0000${endpoints[1]}`;
}

/**
 * Validate the model envelope against the exact handle set supplied in the
 * task input. Malformed rows fail the whole envelope (never partial).
 */
export function validateConceptRelationshipAnalysis(
  output: unknown,
  allowedHandles: readonly string[]
): ValidationOutcome<ConceptRelationshipAnalysis> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }
  if (!Array.isArray(output.relationships)) {
    return { ok: false, errors: ["relationships: expected array"] };
  }
  if (output.relationships.length > MAX_RELATIONSHIP_PROPOSALS_OUTPUT) {
    return {
      ok: false,
      errors: [`relationships: more than ${MAX_RELATIONSHIP_PROPOSALS_OUTPUT} entries`],
    };
  }

  const allowed = new Set(allowedHandles.map((handle) => handleKey(handle)));
  const relationships: ConceptRelationshipProposal[] = [];

  (output.relationships as unknown[]).forEach((raw, index) => {
    if (!isRecord(raw)) {
      errors.push(`relationships[${index}]: expected object`);
      return;
    }
    const sourceHandle = checkString(raw.sourceHandle, `relationships[${index}].sourceHandle`, errors, {
      maxLength: 160,
    });
    const targetHandle = checkString(raw.targetHandle, `relationships[${index}].targetHandle`, errors, {
      maxLength: 160,
    });
    const relationType = checkString(raw.relationType, `relationships[${index}].relationType`, errors, {
      maxLength: 64,
    });
    const confidence = checkNumber(raw.confidence, `relationships[${index}].confidence`, errors, {
      min: 0,
      max: 1,
    });
    const rationale = checkString(raw.rationale, `relationships[${index}].rationale`, errors, {
      maxLength: 800,
    });

    if (relationType !== undefined && !isConceptRelationType(relationType)) {
      errors.push(`relationships[${index}].relationType: unsupported relation type`);
    }
    if (sourceHandle !== undefined && !allowed.has(sourceHandle)) {
      errors.push(`relationships[${index}].sourceHandle: not a supplied evidence handle`);
    }
    if (targetHandle !== undefined && !allowed.has(targetHandle)) {
      errors.push(`relationships[${index}].targetHandle: not a supplied evidence handle`);
    }
    if (sourceHandle !== undefined && sourceHandle === targetHandle) {
      errors.push(`relationships[${index}]: self-edge is not allowed`);
    }

    if (
      sourceHandle === undefined ||
      targetHandle === undefined ||
      relationType === undefined ||
      confidence === undefined ||
      rationale === undefined ||
      !isConceptRelationType(relationType)
    ) {
      return;
    }

    relationships.push({
      sourceHandle,
      targetHandle,
      relationType,
      confidence,
      rationale,
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  return valid({ relationships });
}

export interface RelationshipPolicySelection {
  accepted: ConceptRelationshipProposal[];
  rejected: Array<{ proposal: ConceptRelationshipProposal; reason: string }>;
}

/**
 * Apply policy thresholds, dedupe endpoint/relation pairs (symmetric relations
 * compare as unordered) and cap at five. Highest confidence wins.
 */
export function selectRelationshipDrafts(
  proposals: readonly ConceptRelationshipProposal[],
  allowedHandles: readonly string[]
): RelationshipPolicySelection {
  const allowed = new Set(allowedHandles.map((handle) => handleKey(handle)));
  const byPair = new Map<string, ConceptRelationshipProposal>();
  const rejected: RelationshipPolicySelection["rejected"] = [];

  for (const proposal of proposals) {
    if (!allowed.has(proposal.sourceHandle) || !allowed.has(proposal.targetHandle)) {
      rejected.push({ proposal, reason: "handle-not-supplied" });
      continue;
    }
    if (proposal.sourceHandle === proposal.targetHandle) {
      rejected.push({ proposal, reason: "self-edge" });
      continue;
    }
    if (!isConceptRelationType(proposal.relationType)) {
      rejected.push({ proposal, reason: "unsupported-relation" });
      continue;
    }
    if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
      rejected.push({ proposal, reason: "invalid-confidence" });
      continue;
    }
    const threshold = minimumConfidenceForRelation(proposal.relationType);
    if (proposal.confidence < threshold) {
      rejected.push({ proposal, reason: "below-threshold" });
      continue;
    }
    const key = endpointPairKey(proposal.sourceHandle, proposal.targetHandle, proposal.relationType);
    const existing = byPair.get(key);
    if (!existing || proposal.confidence > existing.confidence) {
      byPair.set(key, proposal);
    }
  }

  const accepted = [...byPair.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_RELATIONSHIP_PROPOSALS_PER_ANALYSIS);

  return { accepted, rejected };
}

/** Stable draft handle for an unresolved concept name (never a model id). */
export function draftConceptHandle(index: number): string {
  return `draft:concept:${index}`;
}

/** True when a handle denotes a concept the user has not saved yet. */
export function isDraftConceptHandle(handle: string): boolean {
  return handle.startsWith("draft:concept:");
}

/** Canonical concept-key equality (no synonym merge). */
export function sameConceptKey(a: string, b: string): boolean {
  return normalizeConceptName(a) === normalizeConceptName(b);
}
