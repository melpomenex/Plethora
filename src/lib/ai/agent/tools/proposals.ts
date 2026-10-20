/**
 * Proposal agent tools (design D25, tasks 8.1/8.3; source grounding 3.1).
 *
 * propose_extract · propose_flashcard · propose_cloze · propose_occlusion ·
 * propose_tag · propose_link.
 *
 * None of these write anything. Each accumulates ONE validated candidate in
 * the session (`ctx.session.addProposal`); the Assistant hands the batch to
 * the EXISTING preview/approval flows — nothing is durable until the user
 * approves it there.
 *
 * Caps are enforced HERE regardless of model output:
 *  - the session rejects additions beyond the bounds' proposal cap (≤ 20);
 *  - every tool call proposes at most ONE item — there is no `count`
 *    parameter, and unknown parameters are rejected (so a mass-creation
 *    demand can only become N calls, which the ≤ 8 tool-call budget caps).
 *
 * Source authority (task 3.1): a proposal may only cite evidence the run
 * actually resolved. The model supplies an application-issued `sourceHandle`
 * (from a read tool) and/or text that appears verbatim inside one of those
 * records; this module resolves it through the run's evidence map. In a
 * production ("frozen") run there is NO fallback to the currently visible
 * document, so a card from paper B can never inherit paper A.
 *
 * id authority: `propose_tag` never trusts a model-supplied card id — it
 * resolves the card by QUERY against a bounded read and fails typed not-found
 * when nothing matches. `propose_occlusion` verifies the image asset id
 * against the image registry before proposing.
 */

import { extractClozeDeletion } from "../../cardValidator";
import { LEARNING_CARD_TYPES } from "../../schemas/learningMaterial";
import { valid, type ValidationOutcome } from "../../schemas/common";
import {
  entryContainsText,
  type AgentEvidenceEntry,
} from "../evidence";
import { MAX_TOOL_LIMIT, rejectUnknownParams, requireString } from "./validation";
import {
  toolInvalid,
  toolNotAvailable,
  toolNotFound,
  toolOk,
  type AgentEnvironment,
  type AgentProposalSourceRef,
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
const MAX_HANDLE_CHARS = 40;

/** Session cap message shown to the model when the proposal budget is hit. */
export const PROPOSAL_CAP_MESSAGE =
  "The proposal limit for this run has been reached; no further proposals were added.";

/* ------------------------------------------------------------------------- */
/* Source binding helpers                                                    */
/* ------------------------------------------------------------------------- */

export interface ProposalSourceResolution {
  ok: boolean;
  sources: AgentProposalSourceRef[];
  problem?: string;
}

function toSource(entry: AgentEvidenceEntry, ctx: AgentToolContext): AgentProposalSourceRef {
  return {
    ...ctx.session.evidence.toProposalSourceRef(entry),
    text: entry.text,
  };
}

/**
 * Resolve the primary + supporting sources for one proposal.
 *
 * Order is deliberate and model-independent:
 *  1. an explicit application handle must resolve (unknown handles rejected);
 *  2. otherwise the proposal text itself must appear verbatim in a record the
 *     run resolved (cloze deletion / extract text);
 *  3. otherwise an explicit `evidenceQuote` must appear verbatim;
 *  4. only a legacy/injected global environment may fall back to the current
 *     document — production runs never do.
 */
export function resolveProposalSources(
  options: {
    sourceHandle?: string;
    supportingSourceHandles?: string[];
    evidenceQuote?: string;
    /** Text that must be grounded (cloze deletion / extract text). */
    requireText?: string;
    /** Keep evidence text for validation (extracts/cards). */
    primaryText?: string;
  },
  ctx: AgentToolContext
): ProposalSourceResolution {
  const evidence = ctx.session.evidence;
  const handles = [
    ...(options.sourceHandle ? [options.sourceHandle] : []),
    ...(options.supportingSourceHandles ?? []),
  ];

  for (const handle of handles) {
    if (!evidence.resolve(handle)) {
      return {
        ok: false,
        sources: [],
        problem: `sourceHandle "${handle}" was not resolved during this run; cite a handle returned by a read tool.`,
      };
    }
  }

  let primary = options.sourceHandle
    ? evidence.resolve(options.sourceHandle)
    : undefined;

  if (!primary && options.requireText) {
    primary = evidence.findContaining(options.requireText);
  }
  if (!primary && options.evidenceQuote) {
    primary = evidence.findContainingQuote(options.evidenceQuote);
  }

  if (!primary && ctx.env.sourceScope !== "frozen") {
    // Legacy injected environments (and older tests) read the globally open
    // document. Production runs opt into "frozen" and never reach this branch.
    const doc = ctx.env.getDocument();
    if (!doc) {
      return {
        ok: false,
        sources: [],
        problem:
          "No source was resolved for this proposal. Use a read/retrieval tool first and cite its sourceHandle.",
      };
    }
    const legacy = evidence.register({
      kind: "document",
      recordId: doc.id,
      documentId: doc.id,
      title: doc.title,
      text: options.primaryText ?? "",
      sourceRevision: ctx.session.sourceRevision,
    });
    return { ok: true, sources: [toSource(legacy, ctx)] };
  }

  if (!primary) {
    return {
      ok: false,
      sources: [],
      problem:
        "No source was resolved for this proposal. Call a read or retrieval tool and cite the returned sourceHandle; proposals cannot cite the currently visible document implicitly.",
    };
  }

  if (!primary.text && ctx.env.sourceScope === "frozen" && options.requireText) {
    return {
      ok: false,
      sources: [],
      problem:
        "The cited source has no text for grounding. Retrieve the passage text with search_library, get_section_context or get_recent_reading_context.",
    };
  }

  if (options.requireText && primary.text && !entryContainsText(primary, options.requireText)) {
    return {
      ok: false,
      sources: [],
      problem:
        "The proposed text does not appear verbatim in the cited source. Quote exact source text.",
    };
  }

  if (options.evidenceQuote && primary.text && !entryContainsText(primary, options.evidenceQuote)) {
    return {
      ok: false,
      sources: [],
      problem:
        "evidenceQuote is not verbatim in the cited source. Use an exact quote or omit it.",
    };
  }

  const supporting = (options.supportingSourceHandles ?? [])
    .map((handle) => evidence.resolve(handle))
    .filter((entry): entry is AgentEvidenceEntry => Boolean(entry) && entry!.handle !== primary!.handle)
    .map((entry) => toSource(entry, ctx));

  return { ok: true, sources: [toSource(primary, ctx), ...supporting] };
}

function optionalSourceHandle(
  raw: Record<string, unknown>,
  key: string,
  errors: string[]
): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(raw, key, errors, { maxLength: MAX_HANDLE_CHARS });
}

function optionalHandleArray(
  raw: Record<string, unknown>,
  key: string,
  errors: string[]
): string[] | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 3) {
    errors.push(`${key}: expected an array of at most 3 source handles`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_HANDLE_CHARS) {
      errors.push(`${key}: every entry must be a source handle string`);
      return undefined;
    }
    out.push(item);
  }
  return out.length ? out : undefined;
}

function optionalEvidenceQuote(
  raw: Record<string, unknown>,
  errors: string[]
): string | undefined {
  const value = raw.evidenceQuote;
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(raw, "evidenceQuote", errors, { maxLength: 2_000 });
}

function aborted(ctx: AgentToolContext): boolean {
  return ctx.signal?.aborted === true;
}

/* ------------------------------------------------------------------------- */
/* propose_extract                                                           */
/* ------------------------------------------------------------------------- */

interface ProposeExtractInput {
  text: string;
  note?: string;
  sourceHandle?: string;
  supportingSourceHandles?: string[];
  evidenceQuote?: string;
}

export const proposeExtractTool: AgentToolDefinition<ProposeExtractInput> = {
  name: "propose_extract",
  description:
    "Propose saving a passage as an extract for the user to approve. `text` must be verbatim from a source in this run; cite its sourceHandle. Nothing is saved until the user confirms in the extract editor.",
  category: "propose",
  validate: (input): ValidationOutcome<ProposeExtractInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_extract: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(
        raw,
        ["text", "note", "sourceHandle", "supportingSourceHandles", "evidenceQuote"],
        "propose_extract"
      ),
    ];
    const text = requireString(raw, "text", errors, { maxLength: MAX_PROPOSAL_TEXT_CHARS });
    let note: string | undefined;
    if (raw.note !== undefined && raw.note !== null && raw.note !== "") {
      note = requireString(raw, "note", errors, { maxLength: MAX_NOTE_CHARS });
    }
    const out: ProposeExtractInput = { text: text! };
    if (note) out.note = note;
    const sourceHandle = optionalSourceHandle(raw, "sourceHandle", errors);
    const supportingSourceHandles = optionalHandleArray(raw, "supportingSourceHandles", errors);
    const evidenceQuote = optionalEvidenceQuote(raw, errors);
    if (sourceHandle) out.sourceHandle = sourceHandle;
    if (supportingSourceHandles) out.supportingSourceHandles = supportingSourceHandles;
    if (evidenceQuote) out.evidenceQuote = evidenceQuote;
    if (errors.length > 0) return { ok: false, errors };
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    if (aborted(ctx)) return toolInvalid("The run was cancelled; nothing was proposed.");
    const resolved = resolveProposalSources(
      {
        sourceHandle: input.sourceHandle,
        supportingSourceHandles: input.supportingSourceHandles,
        evidenceQuote: input.evidenceQuote,
        requireText: input.text,
        primaryText: input.text,
      },
      ctx
    );
    if (!resolved.ok || resolved.sources.length === 0) {
      return toolInvalid(resolved.problem ?? "propose_extract: no valid source");
    }
    const primary = resolved.sources[0];
    if (!primary.documentId) {
      return toolNotAvailable(
        "propose_extract needs an authorized document source; this run has none."
      );
    }
    const added = ctx.session.addProposal({
      kind: "extract",
      documentId: primary.documentId,
      text: input.text,
      note: input.note,
      sourceText: input.text,
      sourceRefs: resolved.sources,
      sourceRevision: ctx.session.sourceRevision,
      evidenceQuote: input.evidenceQuote ?? input.text.slice(0, 300),
    });
    if (!added) return toolInvalid(PROPOSAL_CAP_MESSAGE);
    return toolOk(
      { proposalId: added.proposalId, proposal: "extract", acceptedForReview: true },
      `proposed extract (${input.text.length} chars)`
    );
  },
};

/* ------------------------------------------------------------------------- */
/* propose_flashcard                                                         */
/* ------------------------------------------------------------------------- */

interface ProposeFlashcardInput {
  question: string;
  answer: string;
  cardType: string;
  concept?: string;
  tags?: string[];
  sourceHandle?: string;
  supportingSourceHandles?: string[];
  evidenceQuote?: string;
}

export const proposeFlashcardTool: AgentToolDefinition<ProposeFlashcardInput> = {
  name: "propose_flashcard",
  description:
    `Propose ONE flashcard for the user to approve in the standard preview UI. cardType is one of [${PROPOSABLE_CARD_TYPES.join("|")}]. Cite the sourceHandle of the passage the card is based on (required in a scoped run). Propose at most a few high-value cards per run.`,
  category: "propose",
  validate: (input): ValidationOutcome<ProposeFlashcardInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_flashcard: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(
        raw,
        ["question", "answer", "cardType", "concept", "tags", "sourceHandle", "supportingSourceHandles", "evidenceQuote"],
        "propose_flashcard"
      ),
    ];
    const question = requireString(raw, "question", errors, { maxLength: MAX_QUESTION_CHARS });
    const answer = requireString(raw, "answer", errors, { maxLength: MAX_ANSWER_CHARS });
    let concept: string | undefined;
    if (raw.concept !== undefined && raw.concept !== null && raw.concept !== "") {
      concept = requireString(raw, "concept", errors, { maxLength: 120 });
    }
    let tags: string[] | undefined;
    if (raw.tags !== undefined && raw.tags !== null) {
      if (!Array.isArray(raw.tags) || raw.tags.length > 10) {
        errors.push("propose_flashcard.tags: expected an array of at most 10 strings");
      } else {
        tags = [];
        for (const tag of raw.tags) {
          if (typeof tag !== "string" || tag.length === 0 || tag.length > MAX_TAG_CHARS) {
            errors.push("propose_flashcard.tags: every tag must be a non-empty string");
            break;
          }
          tags.push(tag);
        }
      }
    }
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
    const out: ProposeFlashcardInput = {
      question: question!,
      answer: answer!,
      cardType: cardType!,
    };
    if (concept) out.concept = concept;
    if (tags?.length) out.tags = tags;
    const sourceHandle = optionalSourceHandle(raw, "sourceHandle", errors);
    const supportingSourceHandles = optionalHandleArray(raw, "supportingSourceHandles", errors);
    const evidenceQuote = optionalEvidenceQuote(raw, errors);
    if (sourceHandle) out.sourceHandle = sourceHandle;
    if (supportingSourceHandles) out.supportingSourceHandles = supportingSourceHandles;
    if (evidenceQuote) out.evidenceQuote = evidenceQuote;
    if (errors.length > 0) return { ok: false, errors };
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    if (aborted(ctx)) return toolInvalid("The run was cancelled; nothing was proposed.");
    const resolved = resolveProposalSources(
      {
        sourceHandle: input.sourceHandle,
        supportingSourceHandles: input.supportingSourceHandles,
        evidenceQuote: input.evidenceQuote,
      },
      ctx
    );
    if (!resolved.ok || resolved.sources.length === 0) {
      return toolInvalid(resolved.problem ?? "propose_flashcard: no valid source");
    }
    const primary = resolved.sources[0];
    const added = ctx.session.addProposal({
      kind: "flashcard",
      question: input.question,
      answer: input.answer,
      cardType: input.cardType,
      concept: input.concept,
      conceptKeys: input.concept ? [input.concept] : undefined,
      tags: input.tags,
      documentId: primary.documentId,
      sourceText: primary.text || input.answer,
      sourceRefs: resolved.sources,
      sourceRevision: ctx.session.sourceRevision,
      evidenceQuote: input.evidenceQuote,
    });
    if (!added) return toolInvalid(PROPOSAL_CAP_MESSAGE);
    return toolOk(
      { proposalId: added.proposalId, proposal: "flashcard", acceptedForReview: true },
      `proposed card: ${input.question.slice(0, 60)}`
    );
  },
};

/* ------------------------------------------------------------------------- */
/* propose_cloze                                                             */
/* ------------------------------------------------------------------------- */

interface ProposeClozeInput {
  text: string;
  sourceHandle?: string;
  supportingSourceHandles?: string[];
  evidenceQuote?: string;
}

export const proposeClozeTool: AgentToolDefinition<ProposeClozeInput> = {
  name: "propose_cloze",
  description:
    'Propose ONE cloze card: `text` must be a sentence containing exactly one deletion in the form {{c1::answer}}. The deletion must be verbatim from the cited source passage (sourceHandle required in a scoped run).',
  category: "propose",
  validate: (input): ValidationOutcome<ProposeClozeInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_cloze: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [
      ...rejectUnknownParams(
        raw,
        ["text", "sourceHandle", "supportingSourceHandles", "evidenceQuote"],
        "propose_cloze"
      ),
    ];
    const text = requireString(raw, "text", errors, { maxLength: MAX_PROPOSAL_TEXT_CHARS });
    const out: ProposeClozeInput = { text: text! };
    const sourceHandle = optionalSourceHandle(raw, "sourceHandle", errors);
    const supportingSourceHandles = optionalHandleArray(raw, "supportingSourceHandles", errors);
    const evidenceQuote = optionalEvidenceQuote(raw, errors);
    if (sourceHandle) out.sourceHandle = sourceHandle;
    if (supportingSourceHandles) out.supportingSourceHandles = supportingSourceHandles;
    if (evidenceQuote) out.evidenceQuote = evidenceQuote;
    if (errors.length > 0) return { ok: false, errors };
    if (!extractClozeDeletion(text!)) {
      return {
        ok: false,
        errors: [
          "propose_cloze.text: must contain a deletion like {{c1::answer}} — nothing was proposed",
        ],
      };
    }
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    if (aborted(ctx)) return toolInvalid("The run was cancelled; nothing was proposed.");
    const deletion = extractClozeDeletion(input.text);
    if (!deletion) {
      return toolInvalid("propose_cloze: the deletion was not parseable — nothing was proposed.");
    }
    const resolved = resolveProposalSources(
      {
        sourceHandle: input.sourceHandle,
        supportingSourceHandles: input.supportingSourceHandles,
        evidenceQuote: input.evidenceQuote,
        requireText: deletion,
      },
      ctx
    );
    if (!resolved.ok || resolved.sources.length === 0) {
      return toolInvalid(resolved.problem ?? "propose_cloze: no valid source");
    }
    const primary = resolved.sources[0];
    const added = ctx.session.addProposal({
      kind: "cloze",
      question: input.text,
      answer: deletion,
      cardType: "cloze",
      documentId: primary.documentId,
      sourceText: primary.text || input.text,
      sourceRefs: resolved.sources,
      sourceRevision: ctx.session.sourceRevision,
      evidenceQuote: input.evidenceQuote,
    });
    if (!added) return toolInvalid(PROPOSAL_CAP_MESSAGE);
    return toolOk(
      { proposalId: added.proposalId, proposal: "cloze", acceptedForReview: true },
      `proposed cloze: ${input.text.slice(0, 60)}`
    );
  },
};

/* ------------------------------------------------------------------------- */
/* propose_occlusion                                                         */
/* ------------------------------------------------------------------------- */

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
    const errors = [...rejectUnknownParams(raw, ["imageRef"], "propose_occlusion")];
    const imageRef = requireString(raw, "imageRef", errors, { maxLength: 128 });
    if (errors.length > 0) return { ok: false, errors };
    return valid({ imageRef: imageRef! });
  },
  execute: async (input, ctx: AgentToolContext) => {
    if (aborted(ctx)) return toolInvalid("The run was cancelled; nothing was proposed.");
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
    const entry = ctx.session.evidence.register({
      kind: "image",
      recordId: asset.id,
      title: asset.fileName,
      text: asset.fileName ?? asset.id,
      sourceRevision: ctx.session.sourceRevision,
    });
    const primaryDoc = ctx.env.getDocument();
    const added = ctx.session.addProposal({
      kind: "occlusion",
      imageAssetId: asset.id,
      documentId: primaryDoc?.id,
      sourceText: asset.fileName ?? asset.id,
      sourceRefs: [ctx.session.evidence.toProposalSourceRef(entry)],
      sourceRevision: ctx.session.sourceRevision,
      evidenceQuote: asset.fileName,
    });
    if (!added) return toolInvalid(PROPOSAL_CAP_MESSAGE);
    return toolOk(
      { proposalId: added.proposalId, proposal: "occlusion", acceptedForReview: true },
      `proposed occlusion for image ${asset.fileName ?? asset.id}`
    );
  },
};

/* ------------------------------------------------------------------------- */
/* propose_tag                                                               */
/* ------------------------------------------------------------------------- */

interface ProposeTagInput {
  cardQuery: string;
  tag: string;
}

export const proposeTagTool: AgentToolDefinition<ProposeTagInput> = {
  name: "propose_tag",
  description:
    "Propose adding a tag to an existing card. cardQuery is a search term identifying the card (never a raw id); the closest authorized match is chosen. The user approves before anything changes.",
  category: "propose",
  validate: (input): ValidationOutcome<ProposeTagInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_tag: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = [...rejectUnknownParams(raw, ["cardQuery", "tag"], "propose_tag")];
    const cardQuery = requireString(raw, "cardQuery", errors, { maxLength: MAX_QUESTION_CHARS });
    const tag = requireString(raw, "tag", errors, { maxLength: MAX_TAG_CHARS });
    if (errors.length > 0) return { ok: false, errors };
    return valid({ cardQuery: cardQuery!, tag: tag! });
  },
  execute: async (input, ctx: AgentToolContext) => {
    if (aborted(ctx)) return toolInvalid("The run was cancelled; nothing was proposed.");
    let cards: Awaited<ReturnType<AgentEnvironment["getCards"]>>;
    try {
      cards = await ctx.env.getCards({ text: input.cardQuery, limit: 10 });
    } catch (error) {
      return toolNotFound(`propose_tag: card lookup failed (${(error as Error).message})`);
    }
    // Bounded query resolution — never a raw id from the model.
    const needle = input.cardQuery.toLowerCase();
    const candidates = cards.filter((c) =>
      [c.question, c.answer ?? "", c.clozeText ?? "", ...c.tags]
        .some((text) => text.toLowerCase().includes(needle))
    );
    const target =
      candidates.length === 1
        ? candidates[0]
        : candidates.sort((a, b) => a.question.length - b.question.length)[0];
    if (!target) {
      return toolNotFound(
        `propose_tag: no authorized card matches "${input.cardQuery}"`
      );
    }
    if (target.tags.includes(input.tag)) {
      return toolInvalid(`propose_tag: card already has the tag "${input.tag}"`);
    }
    const entry = ctx.session.evidence.register({
      kind: "card",
      recordId: target.id,
      documentId: target.documentId,
      title: target.question,
      text: target.answer ?? target.clozeText ?? target.question,
      sourceRevision: ctx.session.sourceRevision,
    });
    const added = ctx.session.addProposal({
      kind: "tag",
      itemId: target.id,
      itemQuestion: target.question,
      existingTags: [...target.tags],
      tag: input.tag,
      sourceText: target.question,
      sourceRefs: [ctx.session.evidence.toProposalSourceRef(entry)],
      sourceRevision: ctx.session.sourceRevision,
    });
    if (!added) return toolInvalid(PROPOSAL_CAP_MESSAGE);
    return toolOk(
      { proposalId: added.proposalId, proposal: "tag", card: target.question.slice(0, 120), tag: input.tag },
      `proposed tag "${input.tag}" on card`
    );
  },
};

/* ------------------------------------------------------------------------- */
/* propose_link (concept links: draft-only adapter, typed unavailable)       */
/* ------------------------------------------------------------------------- */

export const CONCEPT_LINKS_NOTE =
  "Concept-link proposals are not available in this build (no validated concept handles were resolved for this run); propose cards or extracts instead.";

interface ProposeLinkInput {
  sourceHandle?: string;
  targetHandle?: string;
  relationType?: string;
  confidence?: number;
  rationale?: string;
}

/**
 * Consume the optional knowledge-relationship draft adapter (worker C). It is
 * draft-only: no durable concept command is called here. The agent evidence
 * map currently exposes document/extract/chunk/card handles only, so the
 * adapter reports typed `missing-evidence` until a validated concept handle
 * source exists. That limitation is surfaced verbatim instead of pretending
 * a link was proposed.
 */
export const proposeLinkTool: AgentToolDefinition<ProposeLinkInput> = {
  name: "propose_link",
  description:
    "Propose a typed relationship between two validated concept handles. Requires a validated concept handle source; in this build it returns a typed unavailable result and creates nothing.",
  category: "propose",
  validate: (input): ValidationOutcome<ProposeLinkInput> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false, errors: ["propose_link: expected object"] };
    }
    const raw = input as Record<string, unknown>;
    const errors = rejectUnknownParams(
      raw,
      ["sourceHandle", "targetHandle", "relationType", "confidence", "rationale"],
      "propose_link"
    );
    const out: ProposeLinkInput = {};
    const sourceHandle = optionalSourceHandle(raw, "sourceHandle", errors);
    const targetHandle = optionalSourceHandle(raw, "targetHandle", errors);
    if (sourceHandle) out.sourceHandle = sourceHandle;
    if (targetHandle) out.targetHandle = targetHandle;
    if (raw.relationType !== undefined) {
      const relationType = requireString(raw, "relationType", errors, { maxLength: 64 });
      if (relationType) out.relationType = relationType;
    }
    if (raw.confidence !== undefined) {
      if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) {
        errors.push("propose_link.confidence: expected a finite number in [0, 1]");
      } else {
        out.confidence = raw.confidence;
      }
    }
    if (raw.rationale !== undefined && raw.rationale !== null && raw.rationale !== "") {
      const rationale = requireString(raw, "rationale", errors, { maxLength: 600 });
      if (rationale) out.rationale = rationale;
    }
    if (errors.length > 0) return { ok: false, errors };
    return valid(out);
  },
  execute: async (input, ctx: AgentToolContext) => {
    if (aborted(ctx)) return toolInvalid("The run was cancelled; nothing was proposed.");
    const sourceHandle = input.sourceHandle;
    const targetHandle = input.targetHandle;
    if (!sourceHandle || !targetHandle || !input.relationType || input.confidence === undefined) {
      return toolNotAvailable(CONCEPT_LINKS_NOTE);
    }
    try {
      const { createRelationshipAdapter } = await import("./relationshipAdapter");
      const settings = (await import("../../../../stores/settingsStore")).useSettingsStore.getState()
        .settings;
      const handles = ctx.session.evidence
        .list()
        .filter((entry) => entry.kind !== "image")
        .map((entry) => ({
          handle: entry.handle,
          kind: entry.kind as "concept" | "document" | "extract" | "card" | "chunk",
          id: entry.recordId,
          label: entry.title ?? entry.recordId,
          documentId: entry.documentId,
          sourceRevision: entry.sourceRevision,
        }));
      const adapter = createRelationshipAdapter({
        enabled: settings.features?.aiConceptLinks === true,
        prerequisitesEnabled: settings.features?.aiPrerequisites === true,
        evidenceHandles: handles,
        analysisId: ctx.session.runId,
      });
      if (!adapter.available) {
        return toolNotAvailable(
          "Concept-link proposals are unavailable for this run (link/prerequisite setting off or no validated concept handles). Nothing was created."
        );
      }
      const result = adapter.propose({
        sourceHandle,
        targetHandle,
        relationType: input.relationType,
        confidence: input.confidence,
        rationale: input.rationale,
      });
      if (result.status === "unavailable") {
        return toolNotAvailable(result.message);
      }
      if (result.status === "invalid") {
        return toolInvalid(result.errors.join("; "));
      }
      // Draft only: the existing relationship review UI owns explicit
      // acceptance; the agent never calls a durable concept command.
      return toolOk(
        {
          proposal: "link",
          draftOnly: true,
          analysisId: result.draft.analysisId,
          relationType: result.draft.relationType,
        },
        "proposed relationship draft (requires its own approval)"
      );
    } catch (error) {
      return toolNotAvailable(
        `Concept-link proposals are not available in this build (${(error as Error).message}).`
      );
    }
  },
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
