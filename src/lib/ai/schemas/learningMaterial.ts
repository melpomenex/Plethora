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

/** Canonical knowledge types (Kotlin contract spelling, incl. `dateEvent`).
 * `general` is a TS-only fallback bucket for model outputs outside the
 * canonical set — never sent to the model, only produced by normalization. */
export const KNOWLEDGE_TYPES = [
  "definition",
  "enumeration",
  "process",
  "comparison",
  "formula",
  "causeEffect",
  "dateEvent",
  "example",
  "general",
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
    importance: "number between 0.0 and 1.0 as a JSON number (e.g. 0.8) — never a string",
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

// ──────────────────────────────────────────────────────────────────────────
// Normalization — salvage near-miss model output before strict validation.
// Small models routinely answer importance as "high"/"80%"/"0.8"-as-string
// and knowledgeType/cardType with off-enum spellings ("date-event",
// "Concept", "Q&A"). These scalar/enum fields are metadata, not card
// content: coerce them instead of failing the whole envelope.
// ──────────────────────────────────────────────────────────────────────────

const canonicalKey = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/.&]+/g, "");

const KNOWLEDGE_TYPE_ALIASES: Record<string, KnowledgeType> = {
  definition: "definition",
  def: "definition",
  term: "definition",
  terminology: "definition",
  concept: "general",
  idea: "general",
  fact: "general",
  summary: "general",
  overview: "general",
  enumeration: "enumeration",
  list: "enumeration",
  inventory: "enumeration",
  process: "process",
  procedure: "process",
  steps: "process",
  sequence: "process",
  howto: "process",
  comparison: "comparison",
  compare: "comparison",
  versus: "comparison",
  contrast: "comparison",
  formula: "formula",
  math: "formula",
  equation: "formula",
  causeeffect: "causeEffect",
  causal: "causeEffect",
  causality: "causeEffect",
  cause: "causeEffect",
  why: "causeEffect",
  whyhow: "causeEffect",
  dateevent: "dateEvent",
  date: "dateEvent",
  event: "dateEvent",
  temporal: "dateEvent",
  timeline: "dateEvent",
  example: "example",
  application: "example",
  apply: "example",
  usecase: "example",
};

const IMPORTANCE_LABELS: Record<string, number> = {
  verylow: 0.05,
  low: 0.3,
  medium: 0.5,
  moderate: 0.5,
  normal: 0.5,
  high: 0.75,
  important: 0.8,
  key: 0.85,
  veryhigh: 0.9,
  critical: 0.95,
  essential: 0.95,
};

const CARD_TYPE_ALIASES: Record<string, LearningCardType> = {
  qa: "qa",
  q: "qa",
  question: "qa",
  questionanswer: "qa",
  basic: "qa",
  basiccard: "qa",
  ask: "qa",
  recall: "qa",
  temporal: "qa",
  cloze: "cloze",
  clozedeletion: "cloze",
  deletion: "cloze",
  fillintheblank: "cloze",
  fillin: "cloze",
  definition: "definition",
  definitional: "definition",
  enumeration: "enumeration",
  list: "enumeration",
  listcard: "enumeration",
  comparison: "comparison",
  compare: "comparison",
  versus: "comparison",
  process: "process",
  orderedsteps: "process",
  steps: "process",
  sequence: "process",
  causeeffect: "causeEffect",
  whyhow: "causeEffect",
  formula: "formula",
  conceptualformula: "formula",
  equation: "formula",
  example: "example",
  application: "example",
  applicationcard: "example",
  identifyapply: "example",
  occlusion: "occlusion-ref",
  occlusionref: "occlusion-ref",
  imageocclusion: "occlusion-ref",
  image: "occlusion-ref",
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Coerce a model-supplied importance into a finite 0–1 number. */
export function coerceImportance(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Tolerate a 0–10 scale ("8" meaning 8/10).
    return clamp01(value > 1 && value <= 10 ? value / 10 : value);
  }
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    const key = canonicalKey(value);
    if (IMPORTANCE_LABELS[key] !== undefined) return IMPORTANCE_LABELS[key];
    const percent = raw.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percent) return clamp01(Number(percent[1]) / 100);
    const numeric = raw.match(/(\d+(?:\.\d+)?)(?:\s*\/\s*10)?/);
    if (numeric) {
      const n = Number(numeric[1]);
      if (Number.isFinite(n)) return clamp01(n > 1 && n <= 10 ? n / 10 : n);
    }
  }
  return 0.5;
}

/** Map any model spelling onto a canonical knowledge type (or `general`). */
export function normalizeKnowledgeType(value: unknown): KnowledgeType {
  return KNOWLEDGE_TYPE_ALIASES[canonicalKey(value)] ?? "general";
}

/** Map any model spelling onto a canonical card type (generic `qa` fallback). */
export function normalizeCardType(value: unknown): LearningCardType {
  return CARD_TYPE_ALIASES[canonicalKey(value)] ?? "qa";
}

/**
 * Shallow-normalize a raw proposal: coerced importance, canonical enums.
 * Card content (question/answer/cloze) is untouched — grounding and verbatim
 * checks still apply strictly.
 */
export function normalizeLearningMaterialProposal(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  out.importance = coerceImportance(raw.importance);
  if (raw.knowledgeType !== undefined || !("knowledgeType" in raw)) {
    out.knowledgeType = normalizeKnowledgeType(raw.knowledgeType);
  }
  // Small models omit "empty" metadata entirely instead of emitting [] —
  // default the lists and rationale so the envelope survives (device report:
  // "prerequisites: expected array, tags: expected array, rationale:
  // expected string").
  if (!Array.isArray(raw.concepts)) out.concepts = [];
  if (!Array.isArray(raw.prerequisites)) out.prerequisites = [];
  if (!Array.isArray(raw.tags)) out.tags = [];
  if (typeof raw.rationale !== "string" || raw.rationale.trim() === "") {
    out.rationale = "Card candidates generated from the selected passage.";
  }
  if (Array.isArray(raw.suggestedCards)) {
    out.suggestedCards = (raw.suggestedCards as unknown[]).map((card) =>
      isRecord(card) && card.cardType !== undefined
        ? { ...card, cardType: normalizeCardType(card.cardType) }
        : card
    );
  }
  return out;
}

export function validateLearningMaterialProposal(
  output: unknown,
  context: LearningMaterialValidationContext = {}
): ValidationOutcome<LearningMaterialProposal> {
  const normalized = normalizeLearningMaterialProposal(output);
  const errors: string[] = [];
  if (!isRecord(normalized)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const importance = checkNumber(normalized.importance, "importance", errors, { min: 0, max: 1 });
  const knowledgeType = checkStringEnum(
    normalized.knowledgeType,
    KNOWLEDGE_TYPES,
    "knowledgeType",
    errors
  );
  const concepts = checkStringArray(normalized.concepts, "concepts", errors, {
    max: 12,
    maxLength: 120,
  });
  const prerequisites = checkStringArray(normalized.prerequisites, "prerequisites", errors, {
    max: 10,
    maxLength: 120,
  });
  const tags = checkStringArray(normalized.tags, "tags", errors, { max: 10, maxLength: 40 });
  const rationale = checkString(normalized.rationale, "rationale", errors, { maxLength: 1200 });

  const cards: LearningCardCandidate[] = [];
  if (!Array.isArray(normalized.suggestedCards)) {
    errors.push("suggestedCards: expected array");
  } else if (normalized.suggestedCards.length > MAX_LEARNING_CARDS) {
    errors.push(`suggestedCards: more than ${MAX_LEARNING_CARDS} cards`);
  } else {
    const perConcept = new Map<string, number>();
    (normalized.suggestedCards as unknown[]).forEach((raw, index) => {
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

/** Empty strings are treated as absent (models — and truncation salvage —
 * emit `""` for optional fields; the validator requires ≥1 char). */
const nonEmpty = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

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
    normalizeCardType(raw.cardType ?? raw.card_type),
    LEARNING_CARD_TYPES,
    `${path}.cardType`,
    cardErrors
  );
  const concept =
    nonEmpty(raw.concept) === undefined
      ? undefined
      : checkString(nonEmpty(raw.concept), `${path}.concept`, cardErrors, { maxLength: 120 });
  const conceptKeys = checkStringArray(
    Array.isArray(raw.conceptKeys) ? raw.conceptKeys : [],
    `${path}.conceptKeys`,
    cardErrors,
    { max: 8, maxLength: 120 }
  );
  const question = checkString(raw.question ?? raw.front, `${path}.question`, cardErrors, {
    maxLength: 2000,
  });
  const answer = checkString(raw.answer ?? raw.back, `${path}.answer`, cardErrors, {
    maxLength: 2000,
  });
  let clozeText =
    nonEmpty(raw.clozeText ?? raw.cloze_text) === undefined
      ? undefined
      : checkString(nonEmpty(raw.clozeText ?? raw.cloze_text), `${path}.clozeText`, cardErrors, {
          maxLength: 2000,
        });
  const clozeRanges = checkClozeRanges(raw.clozeRanges, `${path}.clozeRanges`, cardErrors);
  const evidenceQuote =
    nonEmpty(raw.evidenceQuote ?? raw.evidence) === undefined
      ? undefined
      : checkString(
          nonEmpty(raw.evidenceQuote ?? raw.evidence),
          `${path}.evidenceQuote`,
          cardErrors,
          { maxLength: 2000 }
        );
  const imageRefId =
    nonEmpty(raw.imageRefId ?? raw.image_ref_id) === undefined
      ? undefined
      : checkString(
          nonEmpty(raw.imageRefId ?? raw.image_ref_id),
          `${path}.imageRefId`,
          cardErrors,
          { maxLength: 200 }
        );
  const tags =
    raw.tags === undefined
      ? undefined
      : checkStringArray(raw.tags, `${path}.tags`, cardErrors, { max: 5, maxLength: 40 });

  if (cardType === undefined || question === undefined || answer === undefined) {
    errors.push(...cardErrors);
    return null;
  }

  if (cardType === "cloze") {
    // Cloze cards carry the sentence in `question` when the model omits
    // clozeText (or emitted an empty one).
    if (clozeText === undefined) clozeText = question;
    const deletion = extractClozeDeletion(clozeText);
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
        if (start >= clozeText.length || end > clozeText.length) {
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
