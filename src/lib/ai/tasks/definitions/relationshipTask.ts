/**
 * `ConceptRelationshipTask` — bounded typed relationship proposals over already
 * verified evidence handles (change `complete-knowledge-relationships-and-coverage`,
 * task 3.1).
 *
 * The app assembles `concepts` + `evidence` from resolved library records and
 * shared retrieval; the model only chooses among those exact handles. Handles
 * are opaque to the model and re-validated after generation. No durable write
 * happens here — see `concepts/relationships.ts` for explicit save/accept.
 */

import {
  CONCEPT_RELATIONSHIP_SCHEMA,
  MAX_RELATIONSHIP_PROPOSALS_PER_ANALYSIS,
  RELATIONSHIP_POLICY_VERSION,
  selectRelationshipDrafts,
  validateConceptRelationshipAnalysis,
  type ConceptRelationshipAnalysis,
  type ConceptRelationshipProposal,
  type RelationshipEvidenceHandle,
} from "../../schemas/conceptRelationship";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import { runTask } from "../runTask";
import { fnv1aHash } from "../../providers/types";
import type { AITaskDefinition, AITaskRunOptions } from "../types";

export const RELATIONSHIP_TASK_ID = "concept-relationship-analysis";
export const RELATIONSHIP_TIMEOUT_MS = 45_000;
export const RELATIONSHIP_MAX_OUTPUT_TOKENS = 900;
/** Bounded source handles sent to the model in one run. */
export const MAX_RELATIONSHIP_HANDLES = 24;
const MAX_PASSAGE_CHARS = 6_000;
const MAX_HANDLE_LABEL_CHARS = 200;

export interface RelationshipTaskInput {
  passage: string;
  concepts: Array<{ handle: string; label: string; why?: string }>;
  evidence: RelationshipEvidenceHandle[];
}

const RELATIONSHIP_CORE_INSTRUCTION = [
  "You propose typed relationships between concepts that are already present in a bounded evidence-handle list.",
  "Use ONLY the handles supplied. Never invent a handle, id, concept name or quotation.",
  "Allowed relation types: same-as, prerequisite-of, example-of, contradicts, supports, extends, analogous-to, definition-of, application-of, related-to.",
  "Every relationship must connect two DIFFERENT handles. Do not propose self-edges.",
  "confidence is a finite number from 0 to 1. rationale is one short sentence grounded in the supplied evidence — it is never proof of coverage.",
  "Prefer fewer, high-confidence relationships. Return at most five.",
  "If the handles do not support a relationship, return an empty relationships list.",
  "Return ONLY the JSON object.",
].join("\n");

function boundedHandles(input: RelationshipTaskInput): RelationshipEvidenceHandle[] {
  return input.evidence.slice(0, MAX_RELATIONSHIP_HANDLES);
}

export function relationshipAllowedHandles(input: RelationshipTaskInput): string[] {
  const handles = new Set<string>();
  for (const concept of input.concepts.slice(0, 12)) handles.add(concept.handle);
  for (const evidence of boundedHandles(input)) handles.add(evidence.handle);
  return [...handles];
}

function buildRelationshipInput(input: RelationshipTaskInput) {
  const passage = input.passage.slice(0, MAX_PASSAGE_CHARS);
  const concepts = input.concepts.slice(0, 12).map((concept) => ({
    handle: concept.handle,
    label: concept.label.slice(0, MAX_HANDLE_LABEL_CHARS),
    why: concept.why?.slice(0, 300),
  }));
  const evidence = boundedHandles(input).map((item) => ({
    handle: item.handle,
    kind: item.kind,
    label: item.label.slice(0, MAX_HANDLE_LABEL_CHARS),
  }));

  return {
    text: [
      "Propose typed relationships among these already-verified handles.",
      "",
      "Concept handles:",
      wrapUntrustedBlock("concept-handles", JSON.stringify(concepts)),
      "",
      "Evidence handles:",
      wrapUntrustedBlock("evidence-handles", JSON.stringify(evidence)),
      "",
      "Analyzed passage (context only):",
      wrapUntrustedBlock("passage", passage),
      "",
      `Respond with ONLY a JSON object of this shape: ${CONCEPT_RELATIONSHIP_SCHEMA.json}`,
    ].join("\n"),
  };
}

export const relationshipTask: AITaskDefinition<
  RelationshipTaskInput,
  ConceptRelationshipAnalysis
> = {
  id: RELATIONSHIP_TASK_ID,
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${RELATIONSHIP_CORE_INSTRUCTION}`,
  buildInput: buildRelationshipInput,
  outputKind: "structured",
  schema: CONCEPT_RELATIONSHIP_SCHEMA,
  validate: (output, input) =>
    validateConceptRelationshipAnalysis(output, relationshipAllowedHandles(input)),
  maxOutputTokens: RELATIONSHIP_MAX_OUTPUT_TOKENS,
  timeoutMs: RELATIONSHIP_TIMEOUT_MS,
  streaming: false,
  requirement: "prompt",
};

export interface RelationshipRunResult {
  proposals: ConceptRelationshipProposal[];
  rejected: Array<{ proposal: ConceptRelationshipProposal; reason: string }>;
  run: Awaited<ReturnType<typeof runTask<RelationshipTaskInput, ConceptRelationshipAnalysis>>>;
}

/**
 * Run the bounded relationship task and apply policy thresholds/caps.
 * `targetId` should include the analysis identity so a new selection never
 * coalesces with a stale run.
 */
export async function runRelationshipAnalysis(
  input: RelationshipTaskInput,
  options: AITaskRunOptions = {}
): Promise<RelationshipRunResult> {
  const fallbackTarget = `rel:${RELATIONSHIP_POLICY_VERSION}:${fnv1aHash(
    `${input.passage.slice(0, 512)}\u0000${relationshipAllowedHandles(input).join("|")}`
  )}`;
  const run = await runTask(relationshipTask, input, {
    targetId: fallbackTarget,
    ...options,
  });
  const selected = selectRelationshipDrafts(run.output.relationships, relationshipAllowedHandles(input));
  return {
    proposals: selected.accepted.slice(0, MAX_RELATIONSHIP_PROPOSALS_PER_ANALYSIS),
    rejected: selected.rejected,
    run,
  };
}

registerTasks(relationshipTask);
