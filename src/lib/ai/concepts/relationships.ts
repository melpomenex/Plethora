/**
 * One cancellable owner for prerequisite + relationship analysis (change
 * `complete-knowledge-relationships-and-coverage`, tasks 2.1/3.2/3.3).
 *
 * Responsibilities:
 * - resolve feature flags INDEPENDENTLY (`aiPrerequisites` ≠ `aiConceptLinks`);
 * - preflight generation + embedding destinations before any remote work;
 * - run the existing prerequisite task with a full source-revision target id;
 * - validate/dedupe proposed concepts by the exact Rust normalization;
 * - run deterministic coverage (read-only) and stage bounded relationship
 *   drafts that persist NOTHING until an explicit save/accept;
 * - reject late results after a new selection/cancel.
 *
 * Drafts are ephemeral. The lifecycle wrappers at the bottom are the only
 * durable entry points and reuse the existing concept-link commands.
 */

import {
  canonicalConceptLinkFingerprint,
  conceptLinkFingerprintDismissed,
  deleteConceptLink,
  dismissConceptLink,
  findConceptsByNames,
  getConcept,
  listConceptLinksFor,
  saveConceptLinkSuggestions,
  updateConceptLink,
  acceptConceptLink,
  type ConceptLink,
  type ConceptLinkProposalInput,
  type NewConceptInput,
} from "../../../api/concept-links";
import { retrieveFromLibrary, type RetrievalResponse } from "../../../api/ai-learning";
import { getDocument } from "../../../api/documents";
import type { Document } from "../../../types/document";
import { formatAIErrorMessage } from "../errors";
import { recordFeatureObservation, type FeatureStage, type FeatureObservationOutcome } from "../diagnostics";
import type { FeatureId } from "../features/types";
import { classifyCloudDestination } from "../features/destinations";
import { defaultCoveragePreflight, runCoverageAnalysis, sourceStillContains, COVERAGE_LIMITATIONS } from "./coverage";
import type {
  CoverageConceptInput,
  CoverageDependencies,
  CoveragePreflight,
  CoverageScope,
  ConceptCoverage,
  CoverageEvidenceRef,
  CoverageLocator,
} from "./coverage";
import { runPrerequisiteAnalysis } from "../tasks/definitions/prerequisiteTask";
import { MAX_PREREQUISITES } from "../schemas/prerequisite";
import {
  MAX_RELATIONSHIP_PROPOSALS_PER_ANALYSIS,
  RELATIONSHIP_POLICY_VERSION,
  type ConceptRelationshipProposal,
  type RelationshipEvidenceHandle,
} from "../schemas/conceptRelationship";
import {
  RELATIONSHIP_TASK_ID,
  runRelationshipAnalysis,
} from "../tasks/definitions/relationshipTask";
import type { AITaskRunOptions } from "../tasks/types";
import { fnv1aHash } from "../providers/types";
import { normalizeConceptName } from "../../../api/concept-links";

/* ------------------------------------------------------------------------- */
/* Types                                                                     */
/* ------------------------------------------------------------------------- */

export const EMPTY_PREREQUISITES_MESSAGE = "No prerequisites suggested for this passage";
export const RELATIONSHIP_FEATURE_ID: FeatureId = "knowledge-relationships";

export type RelationshipAnalysisStatus =
  | "complete"
  | "coverage-only"
  | "empty"
  | "unavailable"
  | "denied"
  | "cancelled";

export interface RelationshipDestinationSnapshot {
  /** Resolved generation path for this run (`ondevice`/`cloud`/`none`). */
  generationPath: "ondevice" | "cloud" | "none";
  /** Content leaves the device for generation. */
  generationRemote: boolean;
  /** Content leaves the device for the retrieval query embedding. */
  embeddingRemote: boolean;
  /** True when both required destinations are authorized. */
  allowed: boolean;
}

export interface RelationshipPreflightRequest {
  needsGeneration: boolean;
  needsRetrieval: boolean;
}

export interface RelationshipPreflight extends RelationshipDestinationSnapshot {
  limitations: string[];
}

/** Stable identity of one analysis attempt; late results are matched to it. */
export interface RelationshipAnalysisIdentity {
  analysisId: string;
  passageHash: string;
  sourceRevision: string;
  authorizedDestinations: RelationshipDestinationSnapshot;
  signal: AbortSignal;
}

export interface PrerequisiteConceptResult {
  concept: string;
  why: string;
  conceptKey: string;
  /** Read-only draft handle for an unresolved concept (never a DB id). */
  draftHandle: string;
  /** Existing normalized concept id, resolved read-only. */
  conceptId?: string;
  /** Deterministic coverage; absent only when the analysis was blocked. */
  coverage?: ConceptCoverage;
}

/** Bounded evidence citation attached to a draft (no model-supplied ids). */
export interface RelationshipDraftEvidence {
  kind: "chunk" | "extract" | "card" | "annotation";
  id: string;
  documentId?: string;
  sourceRevision: string;
  locator?: CoverageLocator;
  text?: string;
}

/** One ephemeral AI relationship draft. No durable row exists yet. */
export interface RelationshipDraft {
  id: string;
  analysisId: string;
  source: RelationshipDraftEndpoint;
  target: RelationshipDraftEndpoint;
  relationType: string;
  confidence: number;
  rationale: string;
  fingerprint: string;
  policyVersion: string;
  origin: "ai";
  status: "draft";
  evidence: RelationshipDraftEvidence[];
  /** App-observed generation provenance (safe classes only). */
  provenance?: {
    taskId: string;
    providerId?: string;
    modelClass?: string;
    baseModelName?: string;
  };
}

export interface RelationshipDraftEndpoint {
  handle: string;
  kind: "concept" | "document" | "extract" | "card" | "annotation" | "chunk";
  /** Concrete id; absent for a draft concept handle. */
  id?: string;
  /** Canonical concept name (draft concepts only). */
  conceptName?: string;
  label: string;
  sourceRevision?: string;
}

export interface RelationshipAnalysisOutcome {
  status: RelationshipAnalysisStatus;
  analysis: RelationshipAnalysisIdentity;
  prerequisites: PrerequisiteConceptResult[];
  drafts: RelationshipDraft[];
  limitations: string[];
  /** Exact empty-result copy; never "you are missing no knowledge". */
  emptyMessage?: string;
  /** Safe, already-redacted error text when `status === "unavailable"`. */
  error?: string;
}

export interface RelationshipAnalysisInput {
  passage: string;
  documentTitle?: string;
  documentId?: string;
  sourceRevision?: string;
  scope?: CoverageScope;
}

export interface RelationshipAnalysisOwnerDeps {
  prerequisitesEnabled: boolean;
  linksEnabled: boolean;
  preflight?: () => Promise<RelationshipPreflight>;
  coverage?: Partial<CoverageDependencies>;
  runPrerequisites?: typeof runPrerequisiteAnalysis;
  runRelationships?: typeof runRelationshipAnalysis;
  runCoverage?: typeof runCoverageAnalysis;
  findConcepts?: typeof findConceptsByNames;
  fingerprintDismissed?: typeof conceptLinkFingerprintDismissed;
  now?: () => number;
  /** Content-free diagnostics correlation revision. */
  capabilityRevision?: string;
  observation?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Preflight                                                                 */
/* ------------------------------------------------------------------------- */

export async function defaultRelationshipPreflight(input: {
  needsGeneration: boolean;
  needsRetrieval: boolean;
}): Promise<RelationshipPreflight> {
  const limitations: string[] = [];
  let generationPath: RelationshipDestinationSnapshot["generationPath"] = "none";
  let generationRemote = false;
  let allowed = true;

  try {
    const [{ resolveAiPath }, { getActiveCloudConfig }, disclosure] = await Promise.all([
      import("../provider"),
      import("../providers/cloudProvider"),
      import("../../privacy/cloudAiDisclosure"),
    ]);
    generationPath = input.needsGeneration ? await resolveAiPath("prompt") : "none";
    if (generationPath === "cloud") {
      const config = getActiveCloudConfig();
      const destination = classifyCloudDestination({
        provider: config?.provider ?? "cloud",
        baseUrl: config?.baseUrl,
        hasApiKey: Boolean(config?.apiKey),
      });
      generationRemote = destination.sendsOffDevice;
      if (generationRemote) {
        const disclosed = await disclosure.ensureCloudAiDisclosure({
          featureClass: "ai_actions",
          provider: config?.provider ?? "cloud",
          isLocal: false,
        });
        if (!disclosed) {
          allowed = false;
          limitations.push("relationships.limitation.generation-denied");
        }
      }
    } else if (input.needsGeneration && generationPath === "none") {
      limitations.push("relationships.limitation.generation-unavailable");
    }
  } catch {
    if (input.needsGeneration) {
      allowed = false;
      limitations.push("relationships.limitation.generation-preflight-failed");
    }
  }

  let embeddingRemote = false;
  if (input.needsRetrieval) {
    const embedding = await defaultCoveragePreflight();
    embeddingRemote = embedding.remote;
    limitations.push(...embedding.limitations);
    if (!embedding.allowed) allowed = false;
  }

  return {
    generationPath,
    generationRemote,
    embeddingRemote,
    allowed,
    limitations,
  };
}

/* ------------------------------------------------------------------------- */
/* Draft helpers                                                             */
/* ------------------------------------------------------------------------- */

function endpointFromCoverageRef(ref: CoverageEvidenceRef): RelationshipDraftEndpoint {
  return {
    handle: `evidence:${ref.kind}:${ref.id}`,
    kind: ref.kind,
    id: ref.id,
    label: ref.documentTitle || ref.text.slice(0, 80),
    sourceRevision: ref.sourceRevision,
  };
}

function endpointFromConcept(concept: PrerequisiteConceptResult): RelationshipDraftEndpoint {
  return {
    handle: concept.conceptId ? `concept:${concept.conceptId}` : concept.draftHandle,
    kind: "concept",
    id: concept.conceptId,
    conceptName: concept.concept,
    label: concept.concept,
  };
}

function draftId(analysisId: string, fingerprint: string): string {
  return `draft:${analysisId}:${fnv1aHash(fingerprint)}`;
}

export function buildRelationshipDraft(input: {
  analysisId: string;
  source: RelationshipDraftEndpoint;
  target: RelationshipDraftEndpoint;
  relationType: string;
  confidence: number;
  rationale: string;
  evidence: RelationshipDraftEvidence[];
  provenance?: RelationshipDraft["provenance"];
}): RelationshipDraft {
  const fingerprint = canonicalConceptLinkFingerprint({
    sourceKind: input.source.kind,
    sourceId: input.source.id ?? input.source.handle,
    targetKind: input.target.kind,
    targetId: input.target.id ?? input.target.handle,
    relationType: input.relationType,
    sourceRevision: input.source.sourceRevision ?? null,
    targetRevision: input.target.sourceRevision ?? null,
    policyVersion: RELATIONSHIP_POLICY_VERSION,
  });
  return {
    id: draftId(input.analysisId, fingerprint),
    analysisId: input.analysisId,
    source: input.source,
    target: input.target,
    relationType: input.relationType,
    confidence: input.confidence,
    rationale: input.rationale,
    fingerprint,
    policyVersion: RELATIONSHIP_POLICY_VERSION,
    origin: "ai",
    status: "draft",
    evidence: input.evidence,
    provenance: input.provenance,
  };
}

/** Bound relationship-task handles to verified concepts + evidence only. */
export function relationshipTaskHandles(input: {
  prerequisites: readonly PrerequisiteConceptResult[];
  coverage: readonly ConceptCoverage[];
}): {
  handles: RelationshipEvidenceHandle[];
  conceptEndpoints: Map<string, RelationshipDraftEndpoint>;
  evidenceByHandle: Map<string, CoverageEvidenceRef>;
} {
  const handles: RelationshipEvidenceHandle[] = [];
  const conceptEndpoints = new Map<string, RelationshipDraftEndpoint>();
  const evidenceByHandle = new Map<string, CoverageEvidenceRef>();
  const seenConcept = new Set<string>();

  for (const concept of input.prerequisites) {
    if (seenConcept.has(concept.conceptKey)) continue;
    seenConcept.add(concept.conceptKey);
    const endpoint = endpointFromConcept(concept);
    conceptEndpoints.set(endpoint.handle, endpoint);
    handles.push({
      handle: endpoint.handle,
      kind: "concept",
      id: endpoint.id,
      label: endpoint.label,
      conceptName: endpoint.conceptName,
    });
  }

  const seenEvidence = new Set<string>();
  for (const coverage of input.coverage) {
    for (const ref of coverage.evidenceRefs) {
      if (ref.kind === "card" && !ref.documentId) continue;
      const endpoint = endpointFromCoverageRef(ref);
      if (seenEvidence.has(endpoint.handle)) continue;
      seenEvidence.add(endpoint.handle);
      evidenceByHandle.set(endpoint.handle, ref);
      if (handles.length >= 24) break;
      handles.push({
        handle: endpoint.handle,
        kind: endpoint.kind,
        id: endpoint.id,
        label: endpoint.label,
        documentId: ref.documentId,
        sourceRevision: ref.sourceRevision,
      });
    }
    if (handles.length >= 24) break;
  }

  return { handles, conceptEndpoints, evidenceByHandle };
}

/* ------------------------------------------------------------------------- */
/* Owner                                                                     */
/* ------------------------------------------------------------------------- */

let analysisSequence = 0;

function nextAnalysisId(now: () => number): string {
  analysisSequence += 1;
  return `ka-${now().toString(36)}-${analysisSequence.toString(36)}`;
}

function isAbortError(error: unknown): boolean {
  return (error as Error)?.name === "AbortError";
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    const error = new Error("relationship analysis cancelled");
    error.name = "AbortError";
    return Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const error = new Error("relationship analysis cancelled");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function observe(input: {
  deps: RelationshipAnalysisOwnerDeps;
  analysisId: string;
  stage: FeatureStage;
  outcome: FeatureObservationOutcome;
  started: number;
}): void {
  if (input.deps.observation === false) return;
  const now = input.deps.now ? input.deps.now() : Date.now();
  recordFeatureObservation({
    featureId: RELATIONSHIP_FEATURE_ID,
    runId: input.analysisId,
    stage: input.stage,
    level: input.stage === "preflight" ? "dependency" : "operational",
    outcome: input.outcome,
    durationMs: Math.max(0, now - input.started),
    capabilityRevision: input.deps.capabilityRevision ?? "unknown",
  });
}

export class ConceptRelationshipAnalysisOwner {
  private readonly deps: RelationshipAnalysisOwnerDeps;
  private active:
    | {
        identity: RelationshipAnalysisIdentity;
        controller: AbortController;
      }
    | null = null;
  /** Controller for the preflight window before `active` exists. */
  private pendingController: AbortController | null = null;

  constructor(deps: RelationshipAnalysisOwnerDeps) {
    this.deps = deps;
  }

  get currentAnalysisId(): string | null {
    return this.active?.identity.analysisId ?? null;
  }

  isCurrent(analysisId: string): boolean {
    return this.active?.identity.analysisId === analysisId;
  }

  cancel(): void {
    this.pendingController?.abort();
    this.pendingController = null;
    this.active?.controller.abort();
    this.active = null;
  }

  /**
   * Start one analysis. Starting replaces (and aborts) the previous attempt;
   * a late result from the old attempt can never replace the new one.
   */
  async start(input: RelationshipAnalysisInput): Promise<RelationshipAnalysisOutcome> {
    this.cancel();

    const controller = new AbortController();
    this.pendingController = controller;
    const analysisId = nextAnalysisId(this.deps.now ?? Date.now);
    const passage = input.passage.trim();
    const passageHash = fnv1aHash(passage);
    const sourceRevision = input.sourceRevision ?? `passage:${passageHash}`;
    const started = this.deps.now ? this.deps.now() : Date.now();

    const preflight = this.deps.preflight
      ? await this.deps.preflight().catch(() => ({
          generationPath: "none" as const,
          generationRemote: false,
          embeddingRemote: false,
          allowed: false,
          limitations: ["relationships.limitation.preflight-failed"],
        }))
      : await defaultRelationshipPreflight({
          needsGeneration: this.deps.prerequisitesEnabled,
          needsRetrieval: true,
        });

    const identity: RelationshipAnalysisIdentity = {
      analysisId,
      passageHash,
      sourceRevision,
      authorizedDestinations: {
        generationPath: preflight.generationPath,
        generationRemote: preflight.generationRemote,
        embeddingRemote: preflight.embeddingRemote,
        allowed: preflight.allowed,
      },
      signal: controller.signal,
    };
    this.pendingController = null;
    if (controller.signal.aborted) {
      return {
        status: "cancelled",
        analysis: identity,
        prerequisites: [],
        drafts: [],
        limitations: [],
      };
    }
    this.active = { identity, controller };

    const finish = (outcome: RelationshipAnalysisOutcome): RelationshipAnalysisOutcome => {
      if (!this.isCurrent(analysisId)) {
        return {
          status: "cancelled",
          analysis: identity,
          prerequisites: [],
          drafts: [],
          limitations: [],
        };
      }
      if (outcome.status !== "complete" && outcome.status !== "coverage-only" && outcome.status !== "empty") {
        this.active = null;
      }
      return outcome;
    };

    if (!passage) {
      return finish({
        status: "empty",
        analysis: identity,
        prerequisites: [],
        drafts: [],
        limitations: [],
        emptyMessage: EMPTY_PREREQUISITES_MESSAGE,
      });
    }

    if (!preflight.allowed) {
      observe({
        deps: this.deps,
        analysisId,
        stage: "preflight",
        outcome: "skipped",
        started,
      });
      return finish({
        status: "denied",
        analysis: identity,
        prerequisites: [],
        drafts: [],
        limitations: preflight.limitations,
      });
    }
    observe({
      deps: this.deps,
      analysisId,
      stage: "preflight",
      outcome: "success",
      started,
    });

    const limitations: string[] = [...preflight.limitations];
    let prerequisites: PrerequisiteConceptResult[] = [];

    if (this.deps.prerequisitesEnabled) {
      if (preflight.generationPath === "none") {
        return finish({
          status: "unavailable",
          analysis: identity,
          prerequisites: [],
          drafts: [],
          limitations,
          error: "No AI model is available for prerequisite analysis.",
        });
      }
      const generationStarted = this.deps.now ? this.deps.now() : Date.now();
      try {
        const runPrerequisites = this.deps.runPrerequisites ?? runPrerequisiteAnalysis;
        const run = await raceWithAbort(
          runPrerequisites(
            { passage, documentTitle: input.documentTitle },
            {
              signal: controller.signal,
              targetId: `prereq:${sourceRevision}:${passageHash}`,
              observation: {
                featureId: RELATIONSHIP_FEATURE_ID,
                runId: analysisId,
                capabilityRevision: this.deps.capabilityRevision ?? "unknown",
              },
            } satisfies AITaskRunOptions
          ),
          controller.signal
        );
        if (!this.isCurrent(analysisId) || controller.signal.aborted) {
          observe({
            deps: this.deps,
            analysisId,
            stage: "generation",
            outcome: "cancelled",
            started: generationStarted,
          });
          return finish({
            status: "cancelled",
            analysis: identity,
            prerequisites: [],
            drafts: [],
            limitations,
          });
        }
        observe({
          deps: this.deps,
          analysisId,
          stage: "generation",
          outcome: "success",
          started: generationStarted,
        });

        const seen = new Set<string>();
        for (const raw of run.analysis.prerequisites) {
          const name = raw.concept.trim();
          const key = normalizeConceptName(name);
          if (!name || !key || seen.has(key)) continue;
          seen.add(key);
          prerequisites.push({
            concept: name,
            why: raw.why,
            conceptKey: key,
            draftHandle: `draft:concept:${prerequisites.length}`,
          });
          if (prerequisites.length >= MAX_PREREQUISITES) break;
        }
        observe({
          deps: this.deps,
          analysisId,
          stage: "validation",
          outcome: "success",
          started: generationStarted,
        });
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          return finish({
            status: "cancelled",
            analysis: identity,
            prerequisites: [],
            drafts: [],
            limitations,
          });
        }
        observe({
          deps: this.deps,
          analysisId,
          stage: "generation",
          outcome: "failed",
          started: generationStarted,
        });
        return finish({
          status: "unavailable",
          analysis: identity,
          prerequisites: [],
          drafts: [],
          limitations,
          error: formatAIErrorMessage(error),
        });
      }
    }

    if (prerequisites.length === 0) {
      const status: RelationshipAnalysisStatus =
        this.deps.prerequisitesEnabled ? "empty" : this.deps.linksEnabled ? "coverage-only" : "unavailable";
      return finish({
        status,
        analysis: identity,
        prerequisites: [],
        drafts: [],
        limitations,
        emptyMessage: this.deps.prerequisitesEnabled ? EMPTY_PREREQUISITES_MESSAGE : undefined,
      });
    }

    // Read-only canonical resolution. Case/whitespace variants collapse; no
    // synonym is merged without a user-confirmed same-as link.
    const findConcepts = this.deps.findConcepts ?? findConceptsByNames;
    const resolvedConcepts = await findConcepts(
      prerequisites.map((concept) => concept.concept)
    ).catch(() => []);
    const resolvedByKey = new Map<string, string>();
    for (const resolved of resolvedConcepts) {
      resolvedByKey.set(normalizeConceptName(resolved.name), resolved.id);
    }
    for (const prerequisite of prerequisites) {
      prerequisite.conceptId = resolvedByKey.get(prerequisite.conceptKey);
    }

    const coverageStarted = this.deps.now ? this.deps.now() : Date.now();
    let coverageResult: Awaited<ReturnType<typeof runCoverageAnalysis>>;
    try {
      const runCoverage = this.deps.runCoverage ?? runCoverageAnalysis;
      const coverageDeps = this.deps.coverage;
      coverageResult = await raceWithAbort(
        runCoverage({
          concepts: prerequisites.map<CoverageConceptInput>((concept) => ({
            name: concept.concept,
            why: concept.why,
          })),
          scope: input.scope,
          signal: controller.signal,
          dependencies: coverageDeps,
          preflight: {
            allowed: preflight.allowed,
            remote: preflight.embeddingRemote,
            limitations: preflight.limitations,
          },
        }),
        controller.signal
      );
      if (!this.isCurrent(analysisId) || controller.signal.aborted) {
        return finish({
          status: "cancelled",
          analysis: identity,
          prerequisites: [],
          drafts: [],
          limitations,
        });
      }
      observe({
        deps: this.deps,
        analysisId,
        stage: "retrieval",
        outcome: coverageResult.blocked ? "skipped" : "success",
        started: coverageStarted,
      });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return finish({
          status: "cancelled",
          analysis: identity,
          prerequisites: [],
          drafts: [],
          limitations,
        });
      }
      observe({
        deps: this.deps,
        analysisId,
        stage: "retrieval",
        outcome: "failed",
        started: coverageStarted,
      });
      return finish({
        status: "unavailable",
        analysis: identity,
        prerequisites: [],
        drafts: [],
        limitations,
        error: "Library evidence could not be inspected; coverage is unknown.",
      });
    }

    const byKey = new Map(coverageResult.concepts.map((coverage) => [coverage.conceptKey, coverage]));
    for (const prerequisite of prerequisites) {
      prerequisite.coverage = byKey.get(prerequisite.conceptKey);
    }
    limitations.push(...coverageResult.limitations);

    if (!this.deps.linksEnabled) {
      return finish({
        status: "coverage-only",
        analysis: identity,
        prerequisites,
        drafts: [],
        limitations,
      });
    }

    const handlesStarted = this.deps.now ? this.deps.now() : Date.now();
    try {
      const handleSet = relationshipTaskHandles({
        prerequisites,
        coverage: coverageResult.concepts,
      });
      if (handleSet.handles.length < 2) {
        return finish({
          status: "coverage-only",
          analysis: identity,
          prerequisites,
          drafts: [],
          limitations,
        });
      }

      const conceptHandleByKey = new Map<string, string>();
      for (const endpoint of handleSet.conceptEndpoints.values()) {
        if (endpoint.kind === "concept") {
          conceptHandleByKey.set(
            normalizeConceptName(endpoint.conceptName ?? endpoint.label),
            endpoint.handle
          );
        }
      }

      const runRelationships = this.deps.runRelationships ?? runRelationshipAnalysis;
      const run = await raceWithAbort(
        runRelationships(
          {
            passage,
            concepts: prerequisites.map((concept) => ({
              handle: conceptHandleByKey.get(concept.conceptKey) ?? concept.draftHandle,
              label: concept.concept,
              why: concept.why,
            })),
            evidence: handleSet.handles,
          },
          {
            signal: controller.signal,
            targetId: `rel:${sourceRevision}:${passageHash}:${analysisId}`,
            observation: {
              featureId: RELATIONSHIP_FEATURE_ID,
              runId: analysisId,
              capabilityRevision: this.deps.capabilityRevision ?? "unknown",
            },
          }
        ),
        controller.signal
      );
      if (!this.isCurrent(analysisId) || controller.signal.aborted) {
        return finish({
          status: "cancelled",
          analysis: identity,
          prerequisites: [],
          drafts: [],
          limitations,
        });
      }

      const drafts: RelationshipDraft[] = [];
      for (const proposal of run.proposals.slice(0, MAX_RELATIONSHIP_PROPOSALS_PER_ANALYSIS)) {
        const draft = this.proposalToDraft({
          analysisId,
          proposal,
          handleSet,
          coverage: coverageResult.concepts,
          provenance: {
            taskId: RELATIONSHIP_TASK_ID,
            providerId: run.run.providerId,
            modelClass: run.run.servedModelClass,
            baseModelName: run.run.baseModelName,
          },
        });
        if (!draft) continue;
        const isDismissed = this.deps.fingerprintDismissed ?? conceptLinkFingerprintDismissed;
        const dismissed = await isDismissed(draft.fingerprint).catch(() => false);
        if (dismissed) {
          limitations.push("relationships.limitation.dismissed");
          continue;
        }
        drafts.push(draft);
      }

      observe({
        deps: this.deps,
        analysisId,
        stage: "validation",
        outcome: "success",
        started: handlesStarted,
      });

      return finish({
        status: "complete",
        analysis: identity,
        prerequisites,
        drafts,
        limitations: [...new Set(limitations)],
      });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return finish({
          status: "cancelled",
          analysis: identity,
          prerequisites: [],
          drafts: [],
          limitations,
        });
      }
      observe({
        deps: this.deps,
        analysisId,
        stage: "generation",
        outcome: "failed",
        started: handlesStarted,
      });
      // Relationship proposals are optional: coverage remains useful.
      limitations.push("relationships.limitation.proposals-unavailable");
      return finish({
        status: "coverage-only",
        analysis: identity,
        prerequisites,
        drafts: [],
        limitations: [...new Set(limitations)],
      });
    }
  }

  private proposalToDraft(input: {
    analysisId: string;
    proposal: ConceptRelationshipProposal;
    handleSet: ReturnType<typeof relationshipTaskHandles>;
    coverage: readonly ConceptCoverage[];
    provenance?: RelationshipDraft["provenance"];
  }): RelationshipDraft | null {
    const source =
      input.handleSet.conceptEndpoints.get(input.proposal.sourceHandle) ??
      this.evidenceEndpoint(input.proposal.sourceHandle, input.handleSet);
    const target =
      input.handleSet.conceptEndpoints.get(input.proposal.targetHandle) ??
      this.evidenceEndpoint(input.proposal.targetHandle, input.handleSet);
    if (!source || !target) return null;
    // A relationship must resolve at least one concept endpoint; never
    // fabricate a concept from a document title.
    if (source.kind !== "concept" && target.kind !== "concept") return null;
    if (source.handle === target.handle) return null;
    if (source.kind === "concept" && target.kind === "concept") {
      const sourceKey = normalizeConceptName(source.conceptName ?? "");
      const targetKey = normalizeConceptName(target.conceptName ?? "");
      if (sourceKey && sourceKey === targetKey) return null;
    }

    const conceptKeys = new Set(
      [source.conceptName, target.conceptName]
        .filter((name): name is string => Boolean(name))
        .map((name) => normalizeConceptName(name))
    );
    const evidenceByKey = new Map<string, CoverageEvidenceRef>();
    for (const entry of input.coverage) {
      if (!conceptKeys.has(entry.conceptKey)) continue;
      for (const ref of entry.evidenceRefs) {
        evidenceByKey.set(`${ref.kind}:${ref.id}`, ref);
      }
    }
    for (const entry of input.coverage) {
      for (const ref of entry.evidenceRefs) {
        const handle = `evidence:${ref.kind}:${ref.id}`;
        if (
          handle === input.proposal.sourceHandle ||
          handle === input.proposal.targetHandle
        ) {
          evidenceByKey.set(`${ref.kind}:${ref.id}`, ref);
        }
      }
    }
    const evidence = [...evidenceByKey.values()];
    return buildRelationshipDraft({
      analysisId: input.analysisId,
      source,
      target,
      relationType: input.proposal.relationType,
      confidence: input.proposal.confidence,
      rationale: input.proposal.rationale,
      evidence: evidence.slice(0, 4),
      provenance: input.provenance,
    });
  }

  private evidenceEndpoint(
    handle: string,
    handleSet: ReturnType<typeof relationshipTaskHandles>
  ): RelationshipDraftEndpoint | null {
    const ref = handleSet.evidenceByHandle.get(handle);
    return ref ? endpointFromCoverageRef(ref) : null;
  }
}

/* ------------------------------------------------------------------------- */
/* Related-content discovery (no writes)                                     */
/* ------------------------------------------------------------------------- */

export interface RelatedContentItem {
  handle: string;
  kind: "chunk" | "extract" | "card" | "annotation";
  id: string;
  documentId: string;
  documentTitle?: string;
  text: string;
  sourceRevision: string;
  locator: CoverageLocator;
}

export interface RelatedContentResult {
  status: "ok" | "unavailable" | "empty" | "error";
  items: RelatedContentItem[];
  concepts: Array<{ conceptId: string; name: string; relationType: string }>;
  limitations: string[];
  error?: string;
}

export interface RelatedContentDependencies {
  retrieve?: typeof retrieveFromLibrary;
  getDocument?(documentId: string): Promise<Document | null>;
  listLinksFor?(kind: string, id: string): ReturnType<typeof listConceptLinksFor>;
  getConcept?(conceptId: string): ReturnType<typeof getConcept>;
  preflight?: () => Promise<CoveragePreflight>;
}

/**
 * Explicit related-content discovery for a selection. Reuses shared retrieval
 * and confirmed concept links only; viewing results creates nothing.
 */
export async function discoverRelatedContent(input: {
  passage: string;
  documentId?: string;
  signal?: AbortSignal;
  dependencies?: RelatedContentDependencies;
}): Promise<RelatedContentResult> {
  const passage = input.passage.trim();
  const limitations: string[] = [];
  if (!passage) {
    return { status: "empty", items: [], concepts: [], limitations };
  }

  const preflight = input.dependencies?.preflight
    ? await input.dependencies.preflight()
    : await defaultCoveragePreflight();
  if (!preflight.allowed) {
    return {
      status: "unavailable",
      items: [],
      concepts: [],
      limitations: preflight.limitations,
    };
  }

  let response: RetrievalResponse;
  try {
    const retrieve = input.dependencies?.retrieve ?? retrieveFromLibrary;
    response = await retrieve(passage.slice(0, 1000), {
      k: 6,
      includeSpotlight: false,
    });
  } catch (error) {
    return {
      status: "error",
      items: [],
      concepts: [],
      limitations,
      error: formatAIErrorMessage(error),
    };
  }
  if (input.signal?.aborted) {
    return { status: "unavailable", items: [], concepts: [], limitations };
  }
  if (response.mode === "lexicalOnly") {
    limitations.push(COVERAGE_LIMITATIONS.lexicalOnly);
  }

  const getDoc = input.dependencies?.getDocument ?? getDocument;
  const items: RelatedContentItem[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const hit of response.results.slice(0, 6)) {
    const key = `${hit.sourceType}:${hit.sourceId ?? hit.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const doc = await getDoc(hit.documentId).catch(() => null);
    if (!doc || doc.isAiExcluded === true) {
      dropped += 1;
      continue;
    }
    if (doc.content && doc.content.trim() && !sourceStillContains(doc.content, hit.text)) {
      dropped += 1;
      continue;
    }
    if (hit.sourceType === "document" || hit.sourceType === "transcript") {
      items.push({
        handle: `evidence:chunk:${hit.chunkId}`,
        kind: "chunk",
        id: hit.chunkId,
        documentId: hit.documentId,
        documentTitle: doc.title,
        text: hit.text,
        sourceRevision: doc.contentHash || doc.dateModified || "unknown",
        locator: {
          kind: "chunk",
          sourceType: String(hit.location?.sourceType ?? "text"),
          chunkId: hit.chunkId,
          documentId: hit.documentId,
          ordinal: hit.ordinal,
          startOffset: hit.location?.startOffset ?? 0,
          endOffset: hit.location?.endOffset ?? 0,
          pageNumber: hit.location?.pageNumber,
          cfiRange: hit.location?.cfiRange,
          headingPath: hit.headingPath,
        },
      });
    } else if (hit.sourceId) {
      const kind =
        hit.sourceType === "extract"
          ? "extract"
          : hit.sourceType === "card"
            ? "card"
            : hit.sourceType === "annotation"
              ? "annotation"
              : null;
      if (!kind) continue;
      items.push({
        handle: `evidence:${kind}:${hit.sourceId}`,
        kind,
        id: hit.sourceId,
        documentId: hit.documentId,
        documentTitle: doc.title,
        text: hit.text,
        sourceRevision: doc.contentHash || doc.dateModified || "unknown",
        locator: {
          kind: "chunk",
          sourceType: String(hit.location?.sourceType ?? "text"),
          chunkId: hit.chunkId,
          documentId: hit.documentId,
          ordinal: hit.ordinal,
          startOffset: hit.location?.startOffset ?? 0,
          endOffset: hit.location?.endOffset ?? 0,
          pageNumber: hit.location?.pageNumber,
          cfiRange: hit.location?.cfiRange,
          headingPath: hit.headingPath,
        },
      });
    }
  }

  const concepts: RelatedContentResult["concepts"] = [];
  if (input.documentId && (input.dependencies?.listLinksFor || listConceptLinksFor)) {
    try {
      const listLinks = input.dependencies?.listLinksFor ?? listConceptLinksFor;
      const links = await listLinks("document", input.documentId);
      const getConceptFn = input.dependencies?.getConcept ?? getConcept;
      for (const link of links.slice(0, 8)) {
        if (link.createdBy !== "user" || link.isDismissed) continue;
        if (link.targetKind !== "concept") continue;
        const concept = await getConceptFn(link.targetId).catch(() => null);
        if (concept) {
          concepts.push({
            conceptId: concept.id,
            name: concept.name,
            relationType: link.relationType,
          });
        }
      }
    } catch {
      limitations.push("relationships.limitation.confirmed-links-unavailable");
    }
  }

  if (dropped > 0) {
    limitations.push(COVERAGE_LIMITATIONS.unresolvedHit);
  }

  return {
    status: items.length > 0 || concepts.length > 0 ? "ok" : "empty",
    items,
    concepts,
    limitations,
  };
}

/* ------------------------------------------------------------------------- */
/* Durable lifecycle (explicit user actions only)                            */
/* ------------------------------------------------------------------------- */

export interface SaveDraftsResult {
  results: Array<{
    draft: RelationshipDraft;
    outcome: "created" | "duplicate" | "dismissed";
    link: ConceptLink;
  }>;
  newConcepts: NewConceptInput[];
}

function endpointRevision(
  draft: RelationshipDraft,
  endpoint: RelationshipDraft["source"] | RelationshipDraft["target"]
): string | null {
  // Chunk evidence revisions are document-level while the backend validates
  // `semantic_chunks.content_hash` for a chunk endpoint. Do not send a
  // mismatched revision; kind/existence are still validated.
  if (endpoint.kind === "chunk") return null;
  if (endpoint.sourceRevision) return endpoint.sourceRevision;
  if (!endpoint.id) return null;
  const evidence = draft.evidence.find((ref) => ref.id === endpoint.id);
  return evidence?.sourceRevision ?? null;
}

function proposalFromDraft(draft: RelationshipDraft): ConceptLinkProposalInput {
  return {
    sourceKind: draft.source.kind,
    sourceId: draft.source.id ?? draft.source.handle,
    targetKind: draft.target.kind,
    targetId: draft.target.id ?? draft.target.handle,
    relationType: draft.relationType,
    confidence: draft.confidence,
    sourceRevision: endpointRevision(draft, draft.source),
    targetRevision: endpointRevision(draft, draft.target),
    provenance: {
      analysisId: draft.analysisId,
      policyVersion: draft.policyVersion,
      taskId: draft.provenance?.taskId ?? RELATIONSHIP_TASK_ID,
      origin: "ai",
      providerId: draft.provenance?.providerId,
      modelClass: draft.provenance?.modelClass,
      baseModelName: draft.provenance?.baseModelName,
      evidence: draft.evidence.slice(0, 4).map((ref) => ({
        kind: ref.kind,
        id: ref.id,
        sourceRevision: ref.sourceRevision,
      })),
    },
    fingerprint: draft.fingerprint,
  };
}

/** Explicit "Save suggestions": atomic create of unresolved concepts + links. */
export async function saveRelationshipDrafts(
  analysisId: string,
  drafts: readonly RelationshipDraft[]
): Promise<SaveDraftsResult> {
  const bounded = drafts.slice(0, MAX_RELATIONSHIP_PROPOSALS_PER_ANALYSIS);
  const newConcepts: NewConceptInput[] = [];
  const seenHandles = new Set<string>();
  for (const draft of bounded) {
    for (const endpoint of [draft.source, draft.target]) {
      if (endpoint.kind !== "concept" || endpoint.id) continue;
      if (seenHandles.has(endpoint.handle)) continue;
      seenHandles.add(endpoint.handle);
      newConcepts.push({
        handle: endpoint.handle,
        name: endpoint.conceptName ?? endpoint.label,
      });
    }
  }

  const results = await saveConceptLinkSuggestions({
    analysisId,
    proposals: bounded.map(proposalFromDraft),
    newConcepts,
  });

  return {
    results: results.map((result, index) => ({
      draft: bounded[index],
      outcome: result.outcome,
      link: result.link,
    })),
    newConcepts,
  };
}

/** Accept a draft: save it (if needed) then record endorsement. */
export async function acceptRelationshipDraft(
  analysisId: string,
  draft: RelationshipDraft,
  savedLink?: ConceptLink | null
): Promise<ConceptLink | null> {
  let link = savedLink ?? null;
  if (!link) {
    const saved = await saveRelationshipDrafts(analysisId, [draft]);
    link = saved.results[0]?.link ?? null;
  }
  if (!link) return null;
  return acceptConceptLink(link.id);
}

export async function dismissRelationshipLink(linkId: string): Promise<ConceptLink | null> {
  return dismissConceptLink(linkId);
}

export async function removeRelationshipLink(linkId: string): Promise<boolean> {
  return deleteConceptLink(linkId);
}

export async function editRelationshipLink(input: {
  linkId: string;
  relationType?: string;
  confidence?: number;
}): ReturnType<typeof updateConceptLink> {
  return updateConceptLink(input);
}

/** Confirmed/pending links that should appear in concept detail/backlinks. */
export async function listRelationshipLinks(input: {
  sourceKind?: string;
  sourceId?: string;
  conceptId?: string;
}): Promise<ConceptLink[]> {
  if (input.conceptId) {
    const outgoing = await listConceptLinksFor("concept", input.conceptId, false);
    return outgoing;
  }
  if (input.sourceKind && input.sourceId) {
    return listConceptLinksFor(input.sourceKind, input.sourceId, false);
  }
  return [];
}
