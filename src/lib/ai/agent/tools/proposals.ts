/**
 * Proposal agent tools (design D25, tasks 8.1/8.3).
 *
 * propose_extract · propose_flashcard · propose_cloze · propose_occlusion ·
 * propose_tag · propose_link.
 *
 * None of these write anything. Each accumulates ONE validated candidate in
 * the session (`ctx.session.addProposal`); the AgentSheet hands the batch to
 * the EXISTING preview/approval flows (LearnThisProposalSheet
 * staticCandidates for cards/cloze, an explicit confirm for extract
 * creation / tag application, the occlusion composer event) — nothing is
 * durable until the user approves it there.
 *
 * Caps are enforced HERE regardless of model output:
 *  - the session rejects additions beyond the bounds' proposal cap (≤ 20);
 *  - every tool call proposes at most ONE item — there is no `count`
 *    parameter, and unknown parameters are rejected (so a mass-creation
 *    demand can only become N calls, which the ≤ 8 tool-call budget caps).
 *
 * id authority: `propose_tag` never trusts a model-supplied card id — it
 * resolves the card by QUERY against the real card list and fails typed
 * not-found when nothing matches. `propose_occlusion` verifies the image
 * asset id against the image registry before proposing.
 */

import { extractClozeDeletion } from "../../cardValidator";
import { LEARNING_CARD_TYPES } from "../../schemas/learningMaterial";
import { valid, type ValidationOutcome } from "../../schemas/common";
import {
  MAX_TOOL_LIMIT,
  rejectUnknownParams,
  requireString,
} from "./validation";
import {
  toolInvalid,
  toolNotAvailable,
  toolNotFound,
  toolOk,
  type AgentEnvironment,
  type AgentToolContext,
  type AgentToolDefinition,
} from "./types";

/** Card types a flashcard proposal may carry (occlusion needs an image). */
export const PROPOSABLE_CARD_TYPES = LEARNING_CARD_TYPES.filter(
  (t) => t !== "occlusion-ref"
);

const MAX_PROPOSAL_TEXT_CHARS = 2_000;
const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 2_000;
const MAX_NOTE_CHARS = 1_000;
const MAX_TAG_CHARS = 64;

/** Session cap message shown to the model when the proposal budget is hit. */
export const PROPOSAL_CAP_MESSAGE =
  "The proposal limit for this run has been reached; no further proposals were added.";

// ──────────────────────────────────────────────────────────────────────────
// propose_extract
// ──────────────────────────────────────────────────────────────────────────

interface ProposeExtractInput {
  text: string;
  note?: string;
}

export const proposeExtractTool: AgentToolDefinition<ProposeExtractInput> = {
  name: "propose_extract",
  description:
    "Propose saving a passage as an extract for the user to approve (requires an open document). Nothing is saved until the user confirms the proposal.",
  category: "propose",
  validate: (input): ValidationOutcome<ProposeExtractInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_extract: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["text", "note"], "propose_extract"),
    ];
    const text = requireString(raw, "text", errors, { maxLength: MAX_PROPOSAL_TEXT_CHARS });
    let note: string | undefined;
    if (raw.note !== undefined && raw.note !== null && raw.note !== "") {
      note = requireString(raw, "note", errors, { maxLength: MAX_NOTE_CHARS });
    }
    if (errors.length > 0) return { ok: false, errors };
    const out: ProposeExtractInput = { text: text! };
    if (note) out.note = note;
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    const doc = ctx.env.getDocument();
    if (!doc) {
      return toolNotAvailable(
        "propose_extract needs an open document; none is open."
      );
    }
    const added = ctx.session.addProposal({
      kind: "extract",
      documentId: doc.id,
      text: input.text,
      note: input.note,
      sourceText: input.text,
    });
    if (!added) {
      return toolInvalid(PROPOSAL_CAP_MESSAGE);
    }
    return toolOk(
      { proposal: "extract", acceptedForReview: true },
      `proposed extract (${input.text.length} chars)`
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// propose_flashcard
// ──────────────────────────────────────────────────────────────────────────

interface ProposeFlashcardInput {
  question: string;
  answer: string;
  cardType: string;
}

export const proposeFlashcardTool: AgentToolDefinition<ProposeFlashcardInput> = {
  name: "propose_flashcard",
  description:
    `Propose ONE flashcard for the user to approve in the standard preview UI. cardType is one of [${PROPOSABLE_CARD_TYPES.join("|")}]. Propose at most a few high-value cards per run.`,
  category: "propose",
  validate: (input): ValidationOutcome<ProposeFlashcardInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_flashcard: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["question", "answer", "cardType"], "propose_flashcard"),
    ];
    const question = requireString(raw, "question", errors, { maxLength: MAX_QUESTION_CHARS });
    const answer = requireString(raw, "answer", errors, { maxLength: MAX_ANSWER_CHARS });
    let cardType: string | undefined;
    if (raw.cardType === undefined || raw.cardType === null) {
      cardType = "qa";
    } else if (
      typeof raw.cardType !== "string" ||
      !(PROPOSABLE_CARD_TYPES as readonly string[]).includes(raw.cardType)
    ) {
      errors.push(
        `propose_flashcard.cardType: expected one of [${PROPOSABLE_CARD_TYPES.join("|")}]`
      );
    } else {
      cardType = raw.cardType;
    }
    if (errors.length > 0) return { ok: false, errors };
    return valid({ question: question!, answer: answer!, cardType: cardType! });
  },
  execute: async (input, ctx: AgentToolContext) => {
    const doc = ctx.env.getDocument();
    const added = ctx.session.addProposal({
      kind: "flashcard",
      question: input.question,
      answer: input.answer,
      cardType: input.cardType,
      documentId: doc?.id,
      sourceText: input.answer,
    });
    if (!added) {
      return toolInvalid(PROPOSAL_CAP_MESSAGE);
    }
    return toolOk(
      { proposal: "flashcard", acceptedForReview: true },
      `proposed card: ${input.question.slice(0, 60)}`
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// propose_cloze
// ──────────────────────────────────────────────────────────────────────────

interface ProposeClozeInput {
  text: string;
}

export const proposeClozeTool: AgentToolDefinition<ProposeClozeInput> = {
  name: "propose_cloze",
  description:
    'Propose ONE cloze card: `text` must be a sentence containing exactly one deletion in the form {{c1::answer}}. The deletion must be verbatim from the source passage.',
  category: "propose",
  validate: (input): ValidationOutcome<ProposeClozeInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_cloze: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [...rejectUnknownParams(raw, ["text"], "propose_cloze")];
    const text = requireString(raw, "text", errors, { maxLength: MAX_PROPOSAL_TEXT_CHARS });
    if (errors.length > 0) return { ok: false, errors };
    if (!extractClozeDeletion(text!)) {
      return {
        ok: false,
        errors: [
          "propose_cloze.text: must contain a deletion like {{c1::answer}} — nothing was proposed",
        ],
      };
    }
    return valid({ text: text! });
  },
  execute: async (input, ctx: AgentToolContext) => {
    const doc = ctx.env.getDocument();
    const deletion = extractClozeDeletion(input.text);
    const added = ctx.session.addProposal({
      kind: "cloze",
      question: input.text,
      answer: deletion,
      cardType: "cloze",
      documentId: doc?.id,
      sourceText: input.text,
    });
    if (!added) {
      return toolInvalid(PROPOSAL_CAP_MESSAGE);
    }
    return toolOk(
      { proposal: "cloze", acceptedForReview: true },
      `proposed cloze: ${input.text.slice(0, 60)}`
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// propose_occlusion
// ──────────────────────────────────────────────────────────────────────────

interface ProposeOcclusionInput {
  imageRef: string;
}

export const proposeOcclusionTool: AgentToolDefinition<ProposeOcclusionInput> = {
  name: "propose_occlusion",
  description:
    "Propose turning an image the user has in their image registry into occlusion cards. imageRef must be an image asset id returned by another tool; the proposal opens the existing occlusion composer for the user — labels are selected there.",
  category: "propose",
  validate: (input): ValidationOutcome<ProposeOcclusionInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_occlusion: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["imageRef"], "propose_occlusion"),
    ];
    const imageRef = requireString(raw, "imageRef", errors, { maxLength: 128 });
    if (errors.length > 0) return { ok: false, errors };
    return valid({ imageRef: imageRef! });
  },
  execute: async (input, ctx: AgentToolContext) => {
    // Id authority: verify the asset exists via the registry before proposing.
    let asset: { id: string; fileName?: string } | null = null;
    try {
      asset = await ctx.env.getImageAsset(input.imageRef);
    } catch (error) {
      return toolNotFound(
        `propose_occlusion: image asset lookup failed (${(error as Error).message})`
      );
    }
    if (!asset) {
      return toolNotFound(
        `propose_occlusion: no image asset "${input.imageRef}" exists — hallucinated ids are rejected`
      );
    }
    const doc = ctx.env.getDocument();
    const added = ctx.session.addProposal({
      kind: "occlusion",
      imageAssetId: asset.id,
      documentId: doc?.id,
      sourceText: asset.fileName ?? asset.id,
    });
    if (!added) {
      return toolInvalid(PROPOSAL_CAP_MESSAGE);
    }
    return toolOk(
      { proposal: "occlusion", acceptedForReview: true },
      `proposed occlusion for image ${asset.fileName ?? asset.id}`
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// propose_tag
// ──────────────────────────────────────────────────────────────────────────

interface ProposeTagInput {
  cardQuery: string;
  tag: string;
}

export const proposeTagTool: AgentToolDefinition<ProposeTagInput> = {
  name: "propose_tag",
  description:
    "Propose adding a tag to an existing card. cardQuery is a search term identifying the card (never a raw id); when several cards match, the closest question match is chosen. The user approves before anything changes.",
  category: "propose",
  validate: (input): ValidationOutcome<ProposeTagInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_tag: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(raw, ["cardQuery", "tag"], "propose_tag"),
    ];
    const cardQuery = requireString(raw, "cardQuery", errors, { maxLength: MAX_QUESTION_CHARS });
    const tag = requireString(raw, "tag", errors, { maxLength: MAX_TAG_CHARS });
    if (errors.length > 0) return { ok: false, errors };
    return valid({ cardQuery: cardQuery!, tag: tag! });
  },
  execute: async (input, ctx: AgentToolContext) => {
    let cards: Awaited<ReturnType<AgentEnvironment["getCards"]>>;
    try {
      cards = await ctx.env.getCards();
    } catch (error) {
      return toolNotFound(`propose_tag: card lookup failed (${(error as Error).message})`);
    }    // Query resolution — never a raw id from the model.
    const needle = input.cardQuery.toLowerCase();
    const candidates = cards.filter((c) => c.question.toLowerCase().includes(needle));
    const target =
      candidates.length === 1
        ? candidates[0]
        : candidates.sort((a, b) => a.question.length - b.question.length)[0];
    if (!target) {
      return toolNotFound(
        `propose_tag: no existing card matches "${input.cardQuery}"`
      );
    }
    if (target.tags.includes(input.tag)) {
      return toolInvalid(
        `propose_tag: card already has the tag "${input.tag}"`
      );
    }
    const added = ctx.session.addProposal({
      kind: "tag",
      itemId: target.id,
      itemQuestion: target.question,
      existingTags: [...target.tags],
      tag: input.tag,
      sourceText: target.question,
    });
    if (!added) {
      return toolInvalid(PROPOSAL_CAP_MESSAGE);
    }
    return toolOk(
      { proposal: "tag", card: target.question.slice(0, 120), tag: input.tag },
      `proposed tag "${input.tag}" on card`
    );
  },
};

// ──────────────────────────────────────────────────────────────────────────
// propose_link (concept links: not-available seam, task 8.3 note)
// ──────────────────────────────────────────────────────────────────────────

export const CONCEPT_LINKS_NOTE =
  "Concept-link proposals are not available in this build (concept-link APIs are landing separately); propose cards or extracts instead.";

export const proposeLinkTool: AgentToolDefinition<Record<string, never>> = {
  name: "propose_link",
  description:
    "Propose a link between two concepts/cards. Currently returns not-available in this build.",
  category: "propose",
  validate: (input): ValidationOutcome<Record<string, never>> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_link: expected object"] };
    }
    const errors = rejectUnknownParams(input as Record<string, unknown>, [], "propose_link");
    if (errors.length > 0) return { ok: false, errors };
    return valid({});
  },
  execute: async () => toolNotAvailable(CONCEPT_LINKS_NOTE),
};

export const PROPOSAL_TOOLS = [
  proposeExtractTool,
  proposeFlashcardTool,
  proposeClozeTool,
  proposeOcclusionTool,
  proposeTagTool,
  proposeLinkTool,
] as const;

export { MAX_TOOL_LIMIT };
