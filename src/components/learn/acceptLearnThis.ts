/**
 * Acceptance flow for "Learn this" / agent learning candidates (task 2.5,
 * design D16; generalized for agent proposals in task 3.3).
 *
 * Accepted candidates are created EXCLUSIVELY through the existing domain
 * services — the model never mutates state directly:
 *
 *  - non-cloze candidates  → `create_learning_items_batch` (one transaction
 *                            per group: either every card in the group is
 *                            persisted or none are);
 *  - cloze + existing extract → `create_cloze_from_extract` (extract creation
 *                            is never forced: ranges are computed
 *                            deterministically from the `{{cN::...}}` markers,
 *                            exactly like the Cloze Creator);
 *  - cloze without extract   → `create_learning_item` with item_type "cloze",
 *                            cloze_text carrying the markers and direct
 *                            document linkage.
 *
 * After each successful create, provenance is recorded via a SEPARATE
 * `record_ai_provenance` invoke — a provenance failure is non-fatal and never
 * rolls back a created card.
 *
 * Agent-specific additions (all optional, so existing Learn-this callers keep
 * their exact behavior):
 *  - per-candidate context (document/extract/passage/source reference);
 *  - `acceptanceId`/`proposalId` idempotency keys on every create path;
 *  - extract-less cards populate the existing `source_reference` envelope;
 *  - the cloze duplicate bypass is opt-out (agent path opts out).
 */

import {
  createLearningItem,
  createLearningItemsBatch,
  type CreateLearningItemInput,
  type LearningItem,
} from "../../api/learning-items";
import { createClozeFromExtract } from "../../api/extract-review";
import { recordAiProvenance } from "../../api/ai-provenance";
import { fnv1aHash } from "../../lib/ai/providers/types";
import type { LearningCardCandidate } from "../../lib/ai/schemas/learningMaterial";
import { LEARN_THIS_TASK_ID } from "../../lib/ai/tasks/definitions/learnThisTask";

export interface AcceptLearnThisSourceRef {
  /** Stable record/handle identity (used for supporting provenance only). */
  refId: string;
  kind: "chunk" | "card" | "document" | "extract";
  documentId?: string;
  title?: string;
  locator?: string;
  contentVersion?: string;
}

export interface AcceptLearnThisContext {
  /** Document the selection came from (always known in the viewer). */
  documentId?: string;
  /**
   * Existing extract the selection belongs to, when there is one. Cloze
   * candidates attach via `create_cloze_from_extract`; no extract is ever
   * created implicitly (task 2.5).
   */
  extractId?: string;
  /** Provenance inputs from the run (`AITaskResult`). */
  provider: string;
  model?: string;
  modelClass: string;
  /** The source passage that produced the proposal. */
  passage: string;
  /** Selection context payload recorded alongside provenance. */
  selectionContext?: unknown;
  /** Originating task id (defaults to learn-this; agent runs pass agent-runner). */
  taskId?: string;
  /** Stable run identity recorded in provenance. */
  runId?: string;
  /** Serialized `CardSourceReference` for extract-less navigation. */
  sourceReference?: string;
  /** All supporting source refs recorded in existing AI provenance metadata. */
  sourceReferences?: AcceptLearnThisSourceRef[];
  /**
   * Narrow idempotency keys (agent path). The backend returns the original
   * row when the same (acceptanceId, proposalId) pair is retried.
   */
  acceptanceId?: string;
  proposalId?: string;
  /**
   * Legacy Learn-this clozes historically bypassed duplicate detection. The
   * agent path sets false so text proposals are checked before creation.
   */
  allowClozeDuplicate?: boolean;
}

export interface AcceptLearnThisResult {
  created: LearningItem[];
  /** Provenance rows successfully recorded (one per created item). */
  provenanceRecorded: number;
}

/** Non-cloze card types map onto front/back learning items. */
function toBatchEntry(
  candidate: LearningCardCandidate,
  ctx: AcceptLearnThisContext
): CreateLearningItemInput {
  return {
    // "qa" keeps its typed semantics; every other text card type is a
    // front/back flashcard (definition/comparison/process/... are authoring
    // flavors of the same review interaction).
    item_type: candidate.cardType === "qa" ? "qa" : "flashcard",
    question: candidate.question,
    answer: candidate.answer,
    extract_id: ctx.extractId,
    document_id: ctx.documentId,
    tags: candidate.tags?.length ? candidate.tags : undefined,
    source_reference: ctx.extractId ? undefined : ctx.sourceReference,
    acceptance_id: ctx.acceptanceId,
    proposal_id: ctx.proposalId,
  };
}

const CLOZE_MARKER = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/;

/**
 * Deterministically convert a `{{c1::answer}}` marker sentence into the clean
 * text + character ranges pair `create_cloze_from_extract` expects (ranges
 * index into the MARKER-FREE text; same algorithm as the Cloze Creator).
 *
 * Correctly handles multiple markers and Anki hints:
 *   `{{c1::Paris::city}}` → clean text `Paris`, range covers `Paris` (hint is
 *   not part of the revealed answer). Non-marker braces are preserved.
 */
export function clozeToCleanTextAndRanges(
  clozeText: string
): { cleanText: string; ranges: Array<[number, number]> } {
  const ranges: Array<[number, number]> = [];
  let cleanText = "";
  let index = 0;

  while (index < clozeText.length) {
    const rest = clozeText.slice(index);
    const match = CLOZE_MARKER.exec(rest);
    if (!match || match.index === undefined) {
      cleanText += rest;
      break;
    }
    const matchStart = index + match.index;
    // Text before the marker is copied verbatim.
    cleanText += clozeText.slice(index, matchStart);
    const answer = match[2] ?? "";
    const start = cleanText.length;
    cleanText += answer;
    ranges.push([start, start + answer.length]);
    index = matchStart + match[0].length;
  }

  return { cleanText, ranges };
}

/** True when the marker sentence contains at least one parseable deletion. */
export function hasClozeMarker(clozeText: string): boolean {
  return CLOZE_MARKER.test(clozeText);
}

async function recordProvenanceForItem(
  itemId: string,
  candidate: LearningCardCandidate,
  ctx: AcceptLearnThisContext
): Promise<boolean> {
  try {
    await recordAiProvenance({
      targetKind: "learning_item",
      targetId: itemId,
      taskId: ctx.taskId ?? LEARN_THIS_TASK_ID,
      provider: ctx.provider,
      model: ctx.model,
      modelClass: ctx.modelClass,
      inputFingerprint: fnv1aHash(ctx.passage),
      metadata: {
        passage: ctx.passage,
        selectionContext: ctx.selectionContext ?? null,
        documentId: ctx.documentId ?? null,
        extractId: ctx.extractId ?? null,
        cardType: candidate.cardType,
        runId: ctx.runId ?? null,
        proposalId: ctx.proposalId ?? null,
        acceptanceId: ctx.acceptanceId ?? null,
        sourceReference: ctx.sourceReference ?? null,
        // Supporting sources live in existing AI provenance metadata — not a
        // second source-reference schema.
        sourceRefs: ctx.sourceReferences ?? [],
      },
    });
    return true;
  } catch (err) {
    console.warn("[learn-this] provenance recording failed (non-fatal)", err);
    return false;
  }
}

/**
 * Create the accepted candidates and record provenance for each created item.
 * Non-cloze candidates go out as one transactional batch; cloze candidates are
 * created individually (their create paths differ by extract presence).
 */
export async function acceptLearnThisCandidates(
  accepted: LearningCardCandidate[],
  ctx: AcceptLearnThisContext
): Promise<AcceptLearnThisResult> {
  const created: LearningItem[] = [];
  let provenanceRecorded = 0;

  const batchCandidates = accepted.filter((c) => c.cardType !== "cloze");
  const clozeCandidates = accepted.filter((c) => c.cardType === "cloze");

  if (batchCandidates.length > 0) {
    const items = await createLearningItemsBatch(
      batchCandidates.map((c) => toBatchEntry(c, ctx))
    );
    created.push(...items);
    // Provenance rows are independent of each other — recording them
    // sequentially serialized one IPC round trip per card and made accepting
    // a stack of cards feel wedged on phones.
    const recorded = await Promise.all(
      items.map((item, i) => recordProvenanceForItem(item.id, batchCandidates[i], ctx))
    );
    provenanceRecorded += recorded.filter(Boolean).length;
  }

  for (const candidate of clozeCandidates) {
    const clozeText = candidate.clozeText ?? candidate.question;
    let item: LearningItem;
    if (ctx.extractId) {
      const { cleanText, ranges } = clozeToCleanTextAndRanges(clozeText);
      item = await createClozeFromExtract(ctx.extractId, cleanText, ranges, {
        acceptanceId: ctx.acceptanceId,
        proposalId: ctx.proposalId,
      });
    } else {
      // No forced extract creation: cloze text keeps its {{c1::...}} markers
      // and review renders marker-based cloze when no ranges are stored.
      item = await createLearningItem({
        item_type: "cloze",
        question: clozeText,
        cloze_text: clozeText,
        answer: candidate.answer,
        document_id: ctx.documentId,
        tags: candidate.tags?.length ? candidate.tags : undefined,
        source_reference: ctx.sourceReference,
        // Legacy Learn-this keeps its historical bypass; the agent path sets
        // `allowClozeDuplicate: false` so text proposals cannot skip the
        // duplicate check by editing into a cloze.
        allow_duplicate: ctx.allowClozeDuplicate ?? true,
        acceptance_id: ctx.acceptanceId,
        proposal_id: ctx.proposalId,
      });
    }
    created.push(item);
    if (await recordProvenanceForItem(item.id, candidate, ctx)) {
      provenanceRecorded++;
    }
  }

  return { created, provenanceRecorded };
}
