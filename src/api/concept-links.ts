/**
 * Typed frontend adapter over the EXISTING concept/link commands
 * (change `complete-knowledge-relationships-and-coverage`, task 1.1).
 *
 * Design reference: `opencode/.../design.md § Existing command adapter`. This
 * module is deliberately thin: it serializes the registered Tauri commands and
 * gives the UI/repository outcomes one typed vocabulary. It is NOT a second
 * graph service and does not own lifecycle rules beyond argument shape.
 *
 * Rust is authoritative for normalization (`normalize_concept_name`: lowercase
 * + collapse Unicode whitespace), relation validity, endpoint existence,
 * confidence, provenance origin, uniqueness and caps. `normalizeConceptName`
 * below mirrors that helper exactly so a draft handle and a persisted concept
 * agree on identity; aliases are never merged here.
 */

import { invokeCommand } from "../lib/tauri";

/* ------------------------------------------------------------------------- */
/* Vocabulary                                                                */
/* ------------------------------------------------------------------------- */

/** Canonical relation types — matches `CONCEPT_RELATION_TYPES` in Rust. */
export const CONCEPT_RELATION_TYPES = [
  "same-as",
  "prerequisite-of",
  "example-of",
  "contradicts",
  "supports",
  "extends",
  "analogous-to",
  "definition-of",
  "application-of",
  "related-to",
] as const;

export type ConceptRelationType = (typeof CONCEPT_RELATION_TYPES)[number];

/** Relation types whose meaning is symmetric for fingerprint purposes. */
export const SYMMETRIC_CONCEPT_RELATIONS: readonly ConceptRelationType[] = [
  "same-as",
  "analogous-to",
  "related-to",
];

/** Endpoint kinds the backend can validate today. */
export const CONCEPT_LINK_ENDPOINT_KINDS = [
  "concept",
  "document",
  "extract",
  "card",
  "annotation",
  "chunk",
] as const;

export type ConceptLinkEndpointKind = (typeof CONCEPT_LINK_ENDPOINT_KINDS)[number];

/** Immutable creation origin (migration 125). Legacy rows are `unknown`. */
export type ConceptLinkOrigin = "ai" | "user" | "unknown";

export interface Concept {
  id: string;
  name: string;
  normalizedName: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One `concept_links` row, as serialized by `ConceptRepository`. */
export interface ConceptLink {
  id: string;
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  relationType: ConceptRelationType | string;
  confidence: number;
  provenanceJson?: string | null;
  /** `ai` = not yet endorsed, `user` = endorsed. */
  createdBy: string;
  createdAt: string;
  isDismissed: boolean;
  proposalFingerprint?: string | null;
  /** Immutable creation origin (`unknown` for pre-125 rows). */
  origin?: ConceptLinkOrigin | string;
  analysisId?: string | null;
  sourceRevision?: string | null;
  endorsedAt?: string | null;
  updatedAt?: string | null;
  dismissedAt?: string | null;
}

/** `ConceptBacklink` flattens the link and adds the source concept name. */
export interface ConceptBacklink extends ConceptLink {
  sourceConceptName?: string | null;
}

export type LinkProposalOutcomeKind = "created" | "duplicate" | "dismissed";

export interface LinkProposalResult {
  outcome: LinkProposalOutcomeKind;
  link: ConceptLink;
}

export type LinkUpdateOutcomeKind = "updated" | "conflict" | "not-found";

export interface LinkUpdateResult {
  outcome: LinkUpdateOutcomeKind;
  link?: ConceptLink | null;
  /** Present on `conflict`: the live row that already owns the fingerprint. */
  conflictingLink?: ConceptLink | null;
}

export interface ConceptLinkProposalInput {
  sourceKind: ConceptLinkEndpointKind | string;
  sourceId: string;
  targetKind: ConceptLinkEndpointKind | string;
  targetId: string;
  relationType: ConceptRelationType | string;
  confidence: number;
  /** Evidence revision the proposal was derived from (validated in Rust). */
  sourceRevision?: string | null;
  targetRevision?: string | null;
  /**
   * Validated provenance projection. The backend does not trust arbitrary
   * fields; it only stores `analysisId`, task/provider facts and bounded
   * evidence refs it recognizes.
   */
  provenance?: Record<string, unknown> | null;
  /** App-generated canonical fingerprint; backend recomputes/validates it. */
  fingerprint?: string | null;
}

/** A concept that does not exist yet; created atomically with its links. */
export interface NewConceptInput {
  /** Draft handle used by proposals, e.g. `draft:concept:0`. */
  handle: string;
  name: string;
  description?: string | null;
}

/* ------------------------------------------------------------------------- */
/* Normalization / canonical fingerprint parity                              */
/* ------------------------------------------------------------------------- */

/**
 * Mirror of Rust `normalize_concept_name`: lowercase, split on any whitespace,
 * join with a single ASCII space. `String.prototype.toLowerCase` and Rust
 * `str::to_lowercase` both implement Unicode simple/full case mapping; the
 * split/join pair matches `split_whitespace`.
 */
export function normalizeConceptName(name: string): string {
  return name.toLowerCase().split(/\s+/u).filter((part) => part.length > 0).join(" ");
}

/** Stable endpoint identity used by fingerprints (`kind:id`). */
export function conceptLinkEndpointKey(kind: string, id: string): string {
  return `${kind.trim().toLowerCase()}:${id.trim()}`;
}

/**
 * Canonical, app-generated proposal fingerprint.
 *
 * - normalized endpoint kinds/IDs;
 * - relation type;
 * - the evidence content revisions the proposal was derived from;
 * - the proposal policy version.
 *
 * Symmetric relations (`same-as`, `analogous-to`, `related-to`) sort their
 * endpoints; directional relations (`prerequisite-of`, `definition-of`, …)
 * preserve order. The model never supplies this string.
 */
export function canonicalConceptLinkFingerprint(input: {
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  relationType: string;
  sourceRevision?: string | null;
  targetRevision?: string | null;
  policyVersion?: string;
}): string {
  const policyVersion = input.policyVersion ?? "relationship-policy-v1";
  const source = conceptLinkEndpointKey(input.sourceKind, input.sourceId);
  const target = conceptLinkEndpointKey(input.targetKind, input.targetId);
  const symmetric = (SYMMETRIC_CONCEPT_RELATIONS as readonly string[]).includes(
    input.relationType
  );
  const pair: Array<[string, string]> = [
    [source, input.sourceRevision ?? ""],
    [target, input.targetRevision ?? ""],
  ];
  if (symmetric) pair.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const endpoints = pair.map(([endpoint]) => endpoint);
  const revisions = pair.map(([, revision]) => revision);
  // Explicit delimiters keep the string unambiguous even when IDs contain
  // punctuation.
  return [
    "concept-link-v1",
    `policy=${policyVersion}`,
    `relation=${input.relationType}`,
    `endpoints=${endpoints.join("|")}`,
    `revisions=${revisions.join("|")}`,
  ].join("\u0000");
}

/* ------------------------------------------------------------------------- */
/* Commands                                                                  */
/* ------------------------------------------------------------------------- */

/** Window event emitted after a durable concept-link mutation. */
export const CONCEPT_LINKS_CHANGED_EVENT = "plethora:concept-links-changed";

function emitConceptLinksChanged(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(CONCEPT_LINKS_CHANGED_EVENT));
}

async function mutateConceptLinks<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  emitConceptLinksChanged();
  return result;
}

export function upsertConcept(name: string, description?: string): Promise<Concept> {
  return invokeCommand<Concept>("upsert_concept", { name, description: description ?? null });
}

export function getConcept(conceptId: string): Promise<Concept | null> {
  return invokeCommand<Concept | null>("get_concept", { conceptId });
}

export function findConceptsByNames(names: string[]): Promise<Concept[]> {
  return invokeCommand<Concept[]>("find_concepts_by_names", { names });
}

/** All concepts, bounded by `limit`, newest first. Read-only graph projection. */
export function listConcepts(limit = 500): Promise<Concept[]> {
  return invokeCommand<Concept[]>("list_concepts", { limit });
}

/**
 * Confirmed/endorsed links only (`created_by = 'user'`, not dismissed).
 * Pending AI suggestions are intentionally excluded from authoritative graph
 * edges and counts.
 */
export function listConfirmedConceptLinks(limit = 2000): Promise<ConceptLink[]> {
  return invokeCommand<ConceptLink[]>("list_confirmed_concept_links", { limit });
}

/** Existing single-link proposal command (kept for compatibility). */
export function proposeConceptLink(
  input: ConceptLinkProposalInput & { analysisId?: string | null }
): Promise<LinkProposalResult> {
  return invokeCommand<LinkProposalResult>("propose_concept_link", {
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    relationType: input.relationType,
    confidence: input.confidence,
    provenanceJson: input.provenance ?? null,
    fingerprint: input.fingerprint ?? null,
    sourceRevision: input.sourceRevision ?? null,
    targetRevision: input.targetRevision ?? null,
    analysisId: input.analysisId ?? null,
  });
}

/**
 * Transactional batch save for explicit "Save suggestions": unresolved concept
 * handles and their links either all persist or none do. The backend caps the
 * batch at five AI proposals per analysis and returns per-item outcomes.
 */
export function saveConceptLinkSuggestions(input: {
  analysisId: string;
  proposals: ConceptLinkProposalInput[];
  newConcepts?: NewConceptInput[];
}): Promise<LinkProposalResult[]> {
  return mutateConceptLinks(
    invokeCommand<LinkProposalResult[]>("save_concept_link_suggestions", {
      analysisId: input.analysisId,
      proposals: input.proposals,
      newConcepts: input.newConcepts ?? [],
    })
  );
}

/** Explicit user endorsement; preserves immutable `origin` in Rust. */
export function acceptConceptLink(linkId: string): Promise<ConceptLink | null> {
  return mutateConceptLinks(invokeCommand<ConceptLink | null>("accept_concept_link", { linkId }));
}

/** Remember this canonical fingerprint so it is never re-proposed. */
export function dismissConceptLink(linkId: string): Promise<ConceptLink | null> {
  return mutateConceptLinks(invokeCommand<ConceptLink | null>("dismiss_concept_link", { linkId }));
}

/**
 * Narrow edit. A material change (endpoints/relation) resets endorsement on an
 * AI-origin row; the backend recomputes uniqueness and surfaces conflicts.
 */
export function updateConceptLink(input: {
  linkId: string;
  relationType?: string;
  confidence?: number;
  sourceKind?: string;
  sourceId?: string;
  targetKind?: string;
  targetId?: string;
  sourceRevision?: string | null;
}): Promise<LinkUpdateResult> {
  return mutateConceptLinks(
    invokeCommand<LinkUpdateResult>("update_concept_link", {
      linkId: input.linkId,
      relationType: input.relationType ?? null,
      confidence: input.confidence ?? null,
      sourceKind: input.sourceKind ?? null,
      sourceId: input.sourceId ?? null,
      targetKind: input.targetKind ?? null,
      targetId: input.targetId ?? null,
      sourceRevision: input.sourceRevision ?? null,
    })
  );
}

/** Remove (distinct from dismissal: no fingerprint is retained). */
export function deleteConceptLink(linkId: string): Promise<boolean> {
  return mutateConceptLinks(invokeCommand<boolean>("delete_concept_link", { linkId }));
}

export function listConceptLinksFor(
  sourceKind: string,
  sourceId: string,
  includeDismissed = false
): Promise<ConceptLink[]> {
  return invokeCommand<ConceptLink[]>("list_concept_links_for", {
    sourceKind,
    sourceId,
    includeDismissed,
  });
}

export function listConceptLinksTargeting(
  targetKind: string,
  targetId: string,
  includeDismissed = false
): Promise<ConceptLink[]> {
  return invokeCommand<ConceptLink[]>("list_concept_links_targeting", {
    targetKind,
    targetId,
    includeDismissed,
  });
}

export function getConceptBacklinks(conceptId: string): Promise<ConceptBacklink[]> {
  return invokeCommand<ConceptBacklink[]>("get_concept_backlinks", { conceptId });
}

export function conceptLinkFingerprintDismissed(fingerprint: string): Promise<boolean> {
  return invokeCommand<boolean>("concept_link_fingerprint_dismissed", { fingerprint });
}

/** Narrow annotation read projection used only to verify evidence freshness. */
export interface ConceptEvidenceAnnotation {
  id: string;
  documentId: string;
  content: string;
  pageNumber?: number;
  dateModified: string;
}

export function getConceptEvidenceAnnotation(
  annotationId: string
): Promise<ConceptEvidenceAnnotation | null> {
  return invokeCommand<ConceptEvidenceAnnotation | null>("get_concept_evidence_annotation", {
    annotationId,
  });
}
