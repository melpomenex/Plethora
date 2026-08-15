/**
 * `LearningMaterialProposal` — structured envelope of the "Learn this" task
 * (design D16 / ai-learning-material-generation spec), field-aligned with the
 * Kotlin `@Schema` envelope of the android-genai plugin.
 *
 * Validation enforces the spec's caps and grounding rules:
 *  - at most 8 card candidates per invocation;
 *  - at most 2 cards per concept;
 *  - cloze deletions must appear verbatim in the source passage;
 *  - answers grounding-checked against the source when it is provided.
 *
 * Occlusion candidates are triggered by image presence (`imageRefId`), never
 * by a "diagram" knowledge type.
 */

import { checkAnswerGrounding, extractClozeDeletion } from "../cardValidator";
import {
  checkNumber,
  checkString,
  checkStringArray,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

export const MAX_LEARNING_CARDS = 8;
export const MAX_CARDS_PER_CONCEPT = 2;

/** Card types a proposal may carry, mapped from knowledge type (design D16). */
export const LEARNING_CARD_TYPES = [
  "qa",
  "cloze",
  "definition",
  "comparison",
  "enumeration",
  "process",
  "causeEffect",
  "formula",
  "example",
  "occlusion-ref",
] as const;
export type LearningCardType = (typeof LEARNING_CARD_TYPES)[number];

/** Canonical knowledge types (Kotlin contract spelling, incl. `dateEvent`). */
export const KNOWLEDGE_TYPES = [
  "definition",
  "enumeration",
  "process",
  "comparison",
  "formula",
  "causeEffect",
  "dateEvent",
  "example",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export interface LearningCardCandidate {
  cardType: LearningCardType;
  /** Concept this card tests; used for the ≤2-per-concept cap. */
  concept?: string;
  /** Concept keys the card covers (fingerprinting / coverage queries). */
  conceptKeys: string[];
  /** Front / prompt of the card. For cloze this is the full cloze sentence. */
  question: string;
  answer: string;
  /** Required for cloze cards: the sentence carrying the deletion. */
  clozeText?: string;
  /** Character ranges of cloze deletions within `clozeText`, as [start,end). */
  clozeRanges?: Array<[number, number]>;
  /** Verbatim quote from the source supporting the card. */
  evidenceQuote?: string;
  /** Image asset reference for `occlusion-ref` cards. */
  imageRefId?: string;
  tags?: string[];
}

export interface LearningMaterialProposal {
  /** Importance of the material, 0–1. */
  importance: number;
  knowledgeType: KnowledgeType;
  concepts: string[];
  suggestedCards: LearningCardCandidate[];
  prerequisites: string[];
  tags: string[];
  rationale: string;
}

export const LEARNING_MATERIAL_SCHEMA = {
  name: "LearningMaterialProposal",
  nativeName: "learningMaterialProposal",
  json: JSON.stringify({
    importance: "0.0-1.0",
    knowledgeType: KNOWLEDGE_TYPES.join("|"),
    concepts: ["string"],
    suggestedCards: [
      {
        cardType: LEARNING_CARD_TYPES.join("|"),
        concept: "string?",
        conceptKeys: ["string"],
        question: "string",
        answer: "string",
        clozeText: "string (cloze only)",
        clozeRanges: [[0, 5]],
        evidenceQuote: "string?",
        imageRefId: "string? (occlusion-ref only)",
        tags: ["string?"],
      },
    ],
    prerequisites: ["string"],
    tags: ["string"],
    rationale: "string",
  }),
} as const;

export interface LearningMaterialValidationContext {
  /** Source passage; enables verbatim-cloze and answer-grounding checks. */
  sourceText?: string;
}

export function validateLearningMaterialProposal(
  output: unknown,
  context: LearningMaterialValidationContext = {}
): ValidationOutcome<LearningMaterialProposal> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const importance = checkNumber(output.importance, "importance", errors, { min: 0, max: 1 });
  const knowledgeType = checkStringEnum(
    output.knowledgeType,
    KNOWLEDGE_TYPES,
    "knowledgeType",
    errors
  );
  const concepts = checkStringArray(output.concepts, "concepts", errors, {
    max: 12,
    maxLength: 120,
  });
  const prerequisites = checkStringArray(output.prerequisites, "prerequisites", errors, {
    max: 10,
    maxLength: 120,
  });
  const tags = checkStringArray(output.tags, "tags", errors, { max: 10, maxLength: 40 });
  const rationale = checkString(output.rationale, "rationale", errors, { maxLength: 1200 });

  const cards: LearningCardCandidate[] = [];
  if (!Array.isArray(output.suggestedCards)) {
    errors.push("suggestedCards: expected array");
  } else if (output.suggestedCards.length > MAX_LEARNING_CARDS) {
    errors.push(`suggestedCards: more than ${MAX_LEARNING_CARDS} cards`);
  } else {
    const perConcept = new Map<string, number>();
    (output.suggestedCards as unknown[]).forEach((raw, index) => {
      const card = validateCardCandidate(raw, `suggestedCards[${index}]`, errors, context);
      if (!card) return;
      const conceptKey = (card.concept ?? "").trim().toLowerCase();
      if (conceptKey) {
        const count = (perConcept.get(conceptKey) ?? 0) + 1;
        if (count > MAX_CARDS_PER_CONCEPT) {
          errors.push(
            `suggestedCards[${index}]: more than ${MAX_CARDS_PER_CONCEPT} cards for concept "${card.concept}"`
          );
          return;
        }
        perConcept.set(conceptKey, count);
      }
      cards.push(card);
    });
  }

  if (
    errors.length > 0 ||
    importance === undefined ||
    knowledgeType === undefined ||
    concepts === undefined ||
    prerequisites === undefined ||
    tags === undefined ||
    rationale === undefined
  ) {
    return { ok: false, errors: errors.length > 0 ? errors : ["root: missing required fields"] };
  }
  return valid({
    importance,
    knowledgeType,
    concepts,
    suggestedCards: cards,
    prerequisites,
    tags,
    rationale,
  });
}

function validateCardCandidate(
  raw: unknown,
  path: string,
  errors: string[],
  context: LearningMaterialValidationContext
): LearningCardCandidate | null {
  if (!isRecord(raw)) {
    errors.push(`${path}: expected object`);
    return null;
  }
  const cardErrors: string[] = [];
  const cardType = checkStringEnum(
    raw.cardType ?? raw.card_type,
    LEARNING_CARD_TYPES,
    `${path}.cardType`,
    cardErrors
  );
  const concept =
    raw.concept === undefined
      ? undefined
      : checkString(raw.concept, `${path}.concept`, cardErrors, { maxLength: 120 });
  const conceptKeys = checkStringArray(raw.conceptKeys, `${path}.conceptKeys`, cardErrors, {
    max: 8,
    maxLength: 120,
  });
  const question = checkString(raw.question ?? raw.front, `${path}.question`, cardErrors, {
    maxLength: 2000,
  });
  const answer = checkString(raw.answer ?? raw.back, `${path}.answer`, cardErrors, {
    maxLength: 2000,
  });
  const clozeText =
    raw.clozeText === undefined
      ? undefined
      : checkString(raw.clozeText ?? raw.cloze_text, `${path}.clozeText`, cardErrors, {
          maxLength: 2000,
        });
  const clozeRanges = checkClozeRanges(raw.clozeRanges, `${path}.clozeRanges`, cardErrors);
  const evidenceQuote =
    raw.evidenceQuote === undefined
      ? undefined
      : checkString(raw.evidenceQuote ?? raw.evidence, `${path}.evidenceQuote`, cardErrors, {
          maxLength: 2000,
        });
  const imageRefId =
    raw.imageRefId === undefined
      ? undefined
      : checkString(raw.imageRefId ?? raw.image_ref_id, `${path}.imageRefId`, cardErrors, {
          maxLength: 200,
        });
  const tags =
    raw.tags === undefined
      ? undefined
      : checkStringArray(raw.tags, `${path}.tags`, cardErrors, { max: 5, maxLength: 40 });

  if (cardType === undefined || question === undefined || answer === undefined) {
    errors.push(...cardErrors);
    return null;
  }

  if (cardType === "cloze") {
    const deletion = extractClozeDeletion(clozeText ?? question);
    if (!deletion) {
      errors.push(`${path}.clozeText: missing {{c1::...}} deletion`);
      return null;
    }
    if (context.sourceText && !containsVerbatim(context.sourceText, deletion)) {
      errors.push(`${path}: cloze deletion not found verbatim in source`);
      return null;
    }
    if (clozeRanges) {
      for (const [start, end] of clozeRanges) {
        if (start >= (clozeText ?? question).length || end > (clozeText ?? question).length) {
          errors.push(`${path}.clozeRanges: range [${start},${end}] outside clozeText`);
          return null;
        }
      }
    }
  }

  if (context.sourceText) {
    const grounding = checkAnswerGrounding(answer, context.sourceText);
    if (!grounding.grounded) {
      errors.push(`${path}: answer not grounded in source passage`);
      return null;
    }
  }

  if (cardErrors.length > 0) {
    errors.push(...cardErrors);
    return null;
  }

  const candidate: LearningCardCandidate = {
    cardType,
    conceptKeys: conceptKeys ?? [],
    question,
    answer,
  };
  if (concept !== undefined) candidate.concept = concept;
  if (clozeText !== undefined) candidate.clozeText = clozeText;
  if (clozeRanges !== undefined) candidate.clozeRanges = clozeRanges;
  if (evidenceQuote !== undefined) candidate.evidenceQuote = evidenceQuote;
  if (imageRefId !== undefined) candidate.imageRefId = imageRefId;
  if (tags !== undefined) candidate.tags = tags;
  return candidate;
}

function checkClozeRanges(
  value: unknown,
  path: string,
  errors: string[]
): Array<[number, number]> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return undefined;
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < value.length; i++) {
    const range = value[i];
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isInteger(range[0]) ||
      !Number.isInteger(range[1]) ||
      range[0] < 0 ||
      range[1] <= range[0]
    ) {
      errors.push(`${path}[${i}]: expected [start,end] with 0 <= start < end`);
      return undefined;
    }
    out.push([range[0], range[1]]);
  }
  return out;
}

function checkStringEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[]
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path}: expected one of [${allowed.join("|")}]`);
    return undefined;
  }
  return value as T;
}

/** Verbatim containment on normalized whitespace. */
function containsVerbatim(source: string, needle: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return squash(source).includes(squash(needle));
}
