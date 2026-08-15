/**
 * Acceptance flow for "Learn this" candidates (task 2.5, design D16).
 *
 * Accepted candidates are created EXCLUSIVELY through the existing domain
 * services — the model never mutates state directly:
 *
 *  - non-cloze candidates  → `create_learning_items_batch` (one transaction:
 *                            either every card is persisted or none are);
 *  - cloze + existing extract → `create_cloze_from_extract` (extract creation
 *                            is never forced: ranges are computed
 *                            deterministically from the `{{cN::...}}` markers,
 *                            exactly like the Cloze Creator);
 *  - cloze without extract   → `create_learning_item` with item_type "cloze",
 *                            cloze_text carrying the markers and direct
 *                            document linkage (review renders marker-based
 *                            cloze when no ranges are stored).
 *
 * After each successful create, provenance is recorded via a SEPARATE
 * `record_ai_provenance` invoke (task 2.6) — a provenance failure is
 * non-fatal and never rolls back a created card.
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
  };
}

/**
 * Deterministically convert a `{{c1::answer}}` marker sentence into the clean
 * text + character ranges pair `create_cloze_from_extract` expects (ranges
 * index into the MARKER-FREE text; same algorithm as the Cloze Creator).
 */
export function clozeToCleanTextAndRanges(
  clozeText: string
): { cleanText: string; ranges: Array<[number, number]> } {
  const ranges: Array<[number, number]> = [];
  let runningLength = 0;
  const cleanText = clozeText
    .split(/(\{\{.*?\}\})/)
    .map((part) => {
      if (part.startsWith("{{") && part.endsWith("}}")) {
        const content = part.slice(2, -2);
        const start = runningLength;
        const end = runningLength + content.length;
        ranges.push([start, end]);
        runningLength += content.length;
        return content;
      }
      runningLength += part.length;
      return part;
    })
    .join("");
  return { cleanText, ranges };
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
      taskId: LEARN_THIS_TASK_ID,
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
    for (let i = 0; i < items.length; i++) {
      if (await recordProvenanceForItem(items[i].id, batchCandidates[i], ctx)) {
        provenanceRecorded++;
      }
    }
  }

  for (const candidate of clozeCandidates) {
    const clozeText = candidate.clozeText ?? candidate.question;
    let item: LearningItem;
    if (ctx.extractId) {
      const { cleanText, ranges } = clozeToCleanTextAndRanges(clozeText);
      item = await createClozeFromExtract(ctx.extractId, cleanText, ranges);
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
        allow_duplicate: true,
      });
    }
    created.push(item);
    if (await recordProvenanceForItem(item.id, candidate, ctx)) {
      provenanceRecorded++;
    }
  }

  return { created, provenanceRecorded };
}
