/**
 * Draft-only relationship adapter for the bounded learning agent (change
 * `complete-knowledge-relationships-and-coverage`, task 3.4).
 *
 * Worker A can replace `agent/tools/proposals.ts`'s `propose_link` stub by
 * calling `createRelationshipAdapter` with handles that were already resolved
 * during the run. The adapter NEVER calls a durable command: it validates the
 * model proposal against the exact supplied handles, relation policy,
 * confidence, self-edge and the five-per-analysis cap, then returns an
 * ephemeral `RelationshipDraft`.
 *
 * Unavailable is typed (not an exception) when `aiConceptLinks` is off, the
 * prerequisite operation is unavailable, or no evidence handles were resolved.
 * That keeps knowledge coverage independent of Assistant availability.
 */

import {
  isConceptRelationType,
  minimumConfidenceForRelation,
  selectRelationshipDrafts,
  type RelationshipEvidenceHandle,
} from "../../schemas/conceptRelationship";
import {
  buildRelationshipDraft,
  type RelationshipDraft,
  type RelationshipDraftEndpoint,
  type RelationshipDraftEvidence,
} from "../../concepts/relationships";
import { normalizeConceptName } from "../../../../api/concept-links";

export type RelationshipAdapterUnavailableReason =
  | "links-disabled"
  | "prerequisites-disabled"
  | "missing-evidence";

export interface RelationshipAdapterOptions {
  /** Persisted `aiConceptLinks` preference. */
  enabled: boolean;
  /** Persisted `aiPrerequisites` preference (concept readiness). */
  prerequisitesEnabled: boolean;
  /** Handles already returned by retrieval/source resolution in this run. */
  evidenceHandles: readonly RelationshipEvidenceHandle[];
  /** Stable per-run identity for draft provenance. */
  analysisId?: string;
  /** Hard cap (defaults to the policy cap of 5). */
  maxProposals?: number;
}

export interface RelationshipAdapterProposalInput {
  sourceHandle: string;
  targetHandle: string;
  relationType: string;
  confidence: number;
  rationale?: string;
}

export type RelationshipAdapterResult =
  | { status: "draft"; draft: RelationshipDraft }
  | {
      status: "unavailable";
      reason: RelationshipAdapterUnavailableReason;
      message: string;
    }
  | { status: "invalid"; errors: string[] };

export interface RelationshipAdapter {
  readonly available: boolean;
  readonly drafts: readonly RelationshipDraft[];
  propose(input: RelationshipAdapterProposalInput): RelationshipAdapterResult;
  reset(): void;
}

const UNAVAILABLE_MESSAGES: Record<RelationshipAdapterUnavailableReason, string> = {
  "links-disabled": "Concept-link proposals are disabled in Settings.",
  "prerequisites-disabled": "Concept relationships need the prerequisites operation to be enabled.",
  "missing-evidence": "No verified evidence handles were supplied for this run.",
};

function endpointFromHandle(handle: RelationshipEvidenceHandle): RelationshipDraftEndpoint {
  return {
    handle: handle.handle,
    kind: handle.kind,
    id: handle.id,
    conceptName: handle.kind === "concept" ? handle.conceptName ?? handle.label : undefined,
    label: handle.label,
    sourceRevision: handle.sourceRevision,
  };
}

function evidenceForHandles(
  proposal: RelationshipAdapterProposalInput,
  handleMap: Map<string, RelationshipEvidenceHandle>
): RelationshipDraftEvidence[] {
  const out: RelationshipDraftEvidence[] = [];
  for (const handleId of [proposal.sourceHandle, proposal.targetHandle]) {
    const handle = handleMap.get(handleId);
    if (!handle || handle.kind === "concept" || handle.kind === "document" || !handle.id) continue;
    out.push({
      kind: handle.kind,
      id: handle.id,
      documentId: handle.documentId,
      sourceRevision: handle.sourceRevision ?? "unknown",
    });
  }
  return out;
}

/**
 * Create a run-scoped adapter. It is intentionally synchronous once
 * constructed — no I/O, no persistence, no durable command calls.
 */
export function createRelationshipAdapter(
  options: RelationshipAdapterOptions
): RelationshipAdapter {
  const drafts: RelationshipDraft[] = [];
  const maxProposals = Math.max(
    1,
    Math.min(options.maxProposals ?? 5, 5)
  );
  const handleMap = new Map(options.evidenceHandles.map((handle) => [handle.handle, handle]));
  const available =
    options.enabled === true &&
    options.prerequisitesEnabled === true &&
    options.evidenceHandles.length >= 2;

  const unavailableReason = (): RelationshipAdapterUnavailableReason | null => {
    if (!options.enabled) return "links-disabled";
    if (!options.prerequisitesEnabled) return "prerequisites-disabled";
    if (options.evidenceHandles.length < 2) return "missing-evidence";
    return null;
  };

  return {
    available,
    get drafts() {
      return drafts;
    },
    propose(input) {
      const unavailable = unavailableReason();
      if (unavailable) {
        return {
          status: "unavailable",
          reason: unavailable,
          message: UNAVAILABLE_MESSAGES[unavailable],
        };
      }

      const errors: string[] = [];
      if (!handleMap.has(input.sourceHandle)) {
        errors.push("propose_link.sourceHandle: not a supplied evidence handle");
      }
      if (!handleMap.has(input.targetHandle)) {
        errors.push("propose_link.targetHandle: not a supplied evidence handle");
      }
      if (input.sourceHandle === input.targetHandle) {
        errors.push("propose_link: self-edge is not allowed");
      }
      if (!isConceptRelationType(input.relationType)) {
        errors.push("propose_link.relationType: unsupported relation type");
      }
      if (
        typeof input.confidence !== "number" ||
        !Number.isFinite(input.confidence) ||
        input.confidence < 0 ||
        input.confidence > 1
      ) {
        errors.push("propose_link.confidence: expected finite number in [0, 1]");
      }
      if (errors.length > 0) return { status: "invalid", errors };

      const source = endpointFromHandle(handleMap.get(input.sourceHandle)!);
      const target = endpointFromHandle(handleMap.get(input.targetHandle)!);
      // Never fabricate a concept from a document title.
      if (source.kind !== "concept" && target.kind !== "concept") {
        return {
          status: "invalid",
          errors: ["propose_link: at least one endpoint must be a resolved concept"],
        };
      }
      if (
        source.kind === "concept" &&
        target.kind === "concept" &&
        normalizeConceptName(source.conceptName ?? "") ===
          normalizeConceptName(target.conceptName ?? "")
      ) {
        return { status: "invalid", errors: ["propose_link: endpoints resolve to the same concept"] };
      }

      const threshold = minimumConfidenceForRelation(input.relationType);
      if (input.confidence < threshold) {
        return {
          status: "invalid",
          errors: [
            `propose_link.confidence: below the ${threshold} policy threshold for ${input.relationType}`,
          ],
        };
      }
      if (drafts.length >= maxProposals) {
        return {
          status: "invalid",
          errors: ["propose_link: the five-proposal analysis cap has been reached"],
        };
      }

      const selected = selectRelationshipDrafts(
        [
          {
            sourceHandle: input.sourceHandle,
            targetHandle: input.targetHandle,
            relationType: input.relationType,
            confidence: input.confidence,
            rationale: input.rationale?.trim() || "Related to the analyzed material.",
          },
        ],
        [...handleMap.keys()]
      );
      if (selected.accepted.length === 0) {
        return { status: "invalid", errors: ["propose_link: proposal rejected by policy"] };
      }

      const draft = buildRelationshipDraft({
        analysisId: options.analysisId ?? "agent-run",
        source,
        target,
        relationType: input.relationType,
        confidence: input.confidence,
        rationale: input.rationale?.trim() || "Related to the analyzed material.",
        evidence: evidenceForHandles(input, handleMap),
        provenance: { taskId: "agent-proposal" },
      });
      drafts.push(draft);
      return { status: "draft", draft };
    },
    reset() {
      drafts.length = 0;
    },
  };
}
