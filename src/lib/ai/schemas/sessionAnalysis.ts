/**
 * Structured schema definitions and validation for session analysis (Task 3.4, Design D8).
 *
 * Provides:
 *   - Combined section analysis schema: outline, topics, concepts, verbatim extracts, card candidates, profile observations in ONE call.
 *   - Hierarchical overview schema: summary, outline, key takeaways, synthesized concepts.
 *   - Verbatim evidence validation: exact quote match in owned source text, quote <= 8k chars.
 *   - Range and timing reconstruction: maps quote back to segment keys, code-unit offsets, and truthful timing.
 *   - Quality checks: generic card blocking, answer grounding, cloze verbatim deletion, notes distinct from quotes.
 *   - Caps: max 8 cards, max 2 per concept, max 3 extracts per section.
 */

import { checkAnswerGrounding, extractClozeDeletion } from "../cardValidator";
import {
  checkNumber,
  checkString,
  checkStringArray,
  isRecord,
  valid,
  type AISchemaNames,
  type ValidationOutcome,
} from "./common";
import {
  LEARNING_CARD_TYPES,
  normalizeCardType,
  type LearningCardCandidate,
} from "./learningMaterial";
import type { SessionTranscriptTiming } from "../../../types/recordingSession";
import type { SegmentRangeRef } from "../../../services/recording/analysis/unitPlanner";

export const SESSION_ANALYSIS_TASK_VERSION = "1.0.0";

export const MAX_SECTION_CARDS = 8;
export const MAX_SESSION_CARDS_PER_CONCEPT = 2;
export const MAX_SECTION_EXTRACTS = 3;
export const MAX_SECTION_CONCEPTS = 10;
export const MAX_SECTION_TOPICS = 8;
export const MAX_QUOTE_LENGTH_CHARS = 8000;
export const MAX_SUMMARY_LENGTH_CHARS = 4000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionSectionConcept {
  name: string;
  definition?: string;
}

export interface SessionExtractProposal {
  quote: string;
  summaryNote?: string;
  segmentKey?: string;
}

export interface SessionProfileObservations {
  decisions?: string[];
  actionItems?: string[];
  questions?: string[];
  keyTakeaways?: string[];
}

export interface SessionSectionAnalysisResult {
  sectionSummary: string;
  topics: string[];
  concepts: SessionSectionConcept[];
  extractProposals: SessionExtractProposal[];
  cards: LearningCardCandidate[];
  profileObservations?: SessionProfileObservations;
  taskVersion: string;
}

export interface SessionOverviewAnalysisResult {
  overviewSummary: string;
  outline: string[];
  keyTakeaways: string[];
  concepts: SessionSectionConcept[];
  decisions?: string[];
  actionItems?: string[];
  taskVersion: string;
}

// ── Schemas ──────────────────────────────────────────────────────────────────

export const SESSION_SECTION_ANALYSIS_SCHEMA: AISchemaNames = {
  name: "SessionSectionAnalysis",
  nativeName: "sessionSectionAnalysis",
  json: JSON.stringify({
    sectionSummary: "concise summary of this section under 300 tokens",
    topics: ["string (topic outline point)"],
    concepts: [{ name: "string", definition: "string?" }],
    extractProposals: [
      {
        quote: "verbatim exact quotation from the transcript, max 8000 characters",
        summaryNote: "string? (distinct explanatory note, never identical to quote)",
      },
    ],
    cards: [
      {
        cardType: LEARNING_CARD_TYPES.join("|"),
        concept: "string?",
        conceptKeys: ["string"],
        question: "string",
        answer: "string",
        clozeText: "string (cloze only: verbatim sentence with {{c1::answer}})",
        clozeRanges: [[0, 5]],
        evidenceQuote: "string (verbatim exact quotation from transcript)",
        tags: ["string?"],
      },
    ],
    profileObservations: {
      decisions: ["string?"],
      actionItems: ["string?"],
      questions: ["string?"],
      keyTakeaways: ["string?"],
    },
    taskVersion: "1.0.0",
  }),
};

export const SESSION_OVERVIEW_SCHEMA: AISchemaNames = {
  name: "SessionOverview",
  nativeName: "sessionOverview",
  json: JSON.stringify({
    overviewSummary: "comprehensive executive overview of the session",
    outline: ["string (hierarchical outline item)"],
    keyTakeaways: ["string (major takeaway)"],
    concepts: [{ name: "string", definition: "string?" }],
    decisions: ["string? (key decisions made, if applicable)"],
    actionItems: ["string? (action items or follow-ups, if applicable)"],
    taskVersion: "1.0.0",
  }),
};

// ── Quality and Generic Card Defense ─────────────────────────────────────────

const GENERIC_QUESTION_PATTERNS = [
  /^(what is this (about|passage|text|section|recording))[\s.?!]*$/i,
  /^(summarize (this|the passage|the text|the recording))[\s.?!]*$/i,
  /^(explain the (above|concept|material|passage|text))[\s.?!]*$/i,
  /^(discuss the (above|passage|text|recording))[\s.?!]*$/i,
  /^(what happened in this (recording|passage))[\s.?!]*$/i,
  /^(general question)[\s.?!]*$/i,
];

export function isGenericOrLowQualityCard(card: LearningCardCandidate): {
  lowQuality: boolean;
  reason?: string;
} {
  const q = card.question.trim();
  const a = card.answer.trim();

  if (q.length < 10) {
    return { lowQuality: true, reason: "Question is too short (< 10 characters)" };
  }
  if (a.length < 2) {
    return { lowQuality: true, reason: "Answer is too short (< 2 characters)" };
  }

  for (const pattern of GENERIC_QUESTION_PATTERNS) {
    if (pattern.test(q)) {
      return { lowQuality: true, reason: `Generic or contextless question rejected: "${q}"` };
    }
  }

  if (q.toLowerCase() === a.toLowerCase()) {
    return { lowQuality: true, reason: "Question and answer are identical" };
  }

  return { lowQuality: false };
}

// ── Evidence Validation & Timing Reconstruction ──────────────────────────────

export interface ReconstructedEvidence {
  valid: boolean;
  error?: string;
  quote: string;
  segmentKeys: string[];
  ranges: Array<{ segmentKey: string; startUtf16: number; endUtf16: number }>;
  timing: SessionTranscriptTiming;
}

/**
 * Validate that an evidence quote appears verbatim in the owned source text,
 * map it to the underlying segment ranges, and truthfully reconstruct timing.
 */
export function validateAndReconstructEvidence(
  quote: string,
  ownedRanges: SegmentRangeRef[]
): ReconstructedEvidence {
  const trimmedQuote = quote.trim();

  if (!trimmedQuote) {
    return {
      valid: false,
      error: "Empty quote",
      quote: "",
      segmentKeys: [],
      ranges: [],
      timing: { kind: "none" },
    };
  }

  if (trimmedQuote.length > MAX_QUOTE_LENGTH_CHARS) {
    return {
      valid: false,
      error: `Quote length (${trimmedQuote.length}) exceeds maximum allowed (${MAX_QUOTE_LENGTH_CHARS})`,
      quote: trimmedQuote,
      segmentKeys: [],
      ranges: [],
      timing: { kind: "none" },
    };
  }

  // Concatenate owned ranges verbatim
  const combinedOwnedText = ownedRanges.map((r) => r.text).join("");

  const matchIndex = combinedOwnedText.indexOf(trimmedQuote);
  if (matchIndex === -1) {
    return {
      valid: false,
      error: "Quote does not appear verbatim in owned transcript text",
      quote: trimmedQuote,
      segmentKeys: [],
      ranges: [],
      timing: { kind: "none" },
    };
  }

  const quoteStart = matchIndex;
  const quoteEnd = matchIndex + trimmedQuote.length;

  // Map offsets back to owned segment ranges
  const contributingRanges: Array<{ segmentKey: string; startUtf16: number; endUtf16: number }> = [];
  const contributingKeys = new Set<string>();
  const spannedSegmentRefs: SegmentRangeRef[] = [];

  let currentPos = 0;
  for (const r of ownedRanges) {
    const rangeLen = r.text.length;
    const rStartInCombined = currentPos;
    const rEndInCombined = currentPos + rangeLen;

    if (rEndInCombined > quoteStart && rStartInCombined < quoteEnd) {
      contributingKeys.add(r.segmentKey);
      spannedSegmentRefs.push(r);

      const overlapStartInCombined = Math.max(quoteStart, rStartInCombined);
      const overlapEndInCombined = Math.min(quoteEnd, rEndInCombined);

      const offsetWithinRangeStart = overlapStartInCombined - rStartInCombined;
      const offsetWithinRangeEnd = overlapEndInCombined - rStartInCombined;

      contributingRanges.push({
        segmentKey: r.segmentKey,
        startUtf16: r.startUtf16 + offsetWithinRangeStart,
        endUtf16: r.startUtf16 + offsetWithinRangeEnd,
      });
    }

    currentPos += rangeLen;
  }

  // Truthfully reconstruct timing from spanned segments
  const timed = spannedSegmentRefs
    .map((r) => r.timing)
    .filter(
      (t): t is { kind: "measured" | "imported"; startMs: number; endMs: number } =>
        Boolean(t && t.kind !== "none" && typeof t.startMs === "number" && typeof t.endMs === "number")
    );

  let timing: SessionTranscriptTiming = { kind: "none" };
  if (timed.length > 0) {
    let minStart = Infinity;
    let maxEnd = -Infinity;
    let allImported = true;

    for (const t of timed) {
      if (t.startMs < minStart) minStart = t.startMs;
      if (t.endMs > maxEnd) maxEnd = t.endMs;
      if (t.kind !== "imported") allImported = false;
    }

    timing = {
      kind: allImported ? "imported" : "measured",
      startMs: minStart,
      endMs: maxEnd,
    };
  }

  return {
    valid: true,
    quote: trimmedQuote,
    segmentKeys: Array.from(contributingKeys),
    ranges: contributingRanges,
    timing,
  };
}

// ── Validation and Normalization ─────────────────────────────────────────────

export interface SessionAnalysisValidationContext {
  ownedText?: string;
  ownedRanges?: SegmentRangeRef[];
}

export function normalizeSessionSectionAnalysis(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };

  if (typeof out.sectionSummary !== "string") {
    out.sectionSummary = "";
  }
  if (!Array.isArray(out.topics)) out.topics = [];
  if (!Array.isArray(out.concepts)) out.concepts = [];
  if (!Array.isArray(out.extractProposals)) out.extractProposals = [];
  if (!Array.isArray(out.cards)) out.cards = [];
  if (typeof out.taskVersion !== "string" || !out.taskVersion.trim()) {
    out.taskVersion = SESSION_ANALYSIS_TASK_VERSION;
  }

  if (Array.isArray(out.cards)) {
    out.cards = (out.cards as unknown[]).map((card) =>
      isRecord(card) && card.cardType !== undefined
        ? { ...card, cardType: normalizeCardType(card.cardType) }
        : card
    );
  }

  return out;
}

export function validateSessionSectionAnalysis(
  output: unknown,
  context?: SessionAnalysisValidationContext
): ValidationOutcome<SessionSectionAnalysisResult> {
  const normalized = normalizeSessionSectionAnalysis(output);
  const errors: string[] = [];

  if (!isRecord(normalized)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const sectionSummary = checkString(normalized.sectionSummary, "sectionSummary", errors, {
    minLength: 1,
    maxLength: MAX_SUMMARY_LENGTH_CHARS,
  });

  const rawTopics = checkStringArray(normalized.topics, "topics", errors, {
    max: MAX_SECTION_TOPICS,
  }) ?? [];

  // Parse & validate concepts
  const concepts: SessionSectionConcept[] = [];
  if (Array.isArray(normalized.concepts)) {
    for (let i = 0; i < Math.min(normalized.concepts.length, MAX_SECTION_CONCEPTS); i++) {
      const c = normalized.concepts[i];
      if (isRecord(c)) {
        const name = checkString(c.name, `concepts[${i}].name`, errors, { minLength: 1 });
        const def = c.definition !== undefined ? checkString(c.definition, `concepts[${i}].definition`, errors) : undefined;
        if (name) {
          concepts.push({ name, definition: def });
        }
      } else if (typeof c === "string" && c.trim()) {
        concepts.push({ name: c.trim() });
      }
    }
  }

  // Parse & validate extract proposals (max 3)
  const extractProposals: SessionExtractProposal[] = [];
  if (Array.isArray(normalized.extractProposals)) {
    for (let i = 0; i < Math.min(normalized.extractProposals.length, MAX_SECTION_EXTRACTS); i++) {
      const ext = normalized.extractProposals[i];
      if (isRecord(ext)) {
        const quote = checkString(ext.quote, `extractProposals[${i}].quote`, errors, {
          minLength: 1,
          maxLength: MAX_QUOTE_LENGTH_CHARS,
        });
        const note = ext.summaryNote !== undefined ? checkString(ext.summaryNote, `extractProposals[${i}].summaryNote`, errors) : undefined;

        if (quote) {
          // Notes must be distinct from quotations
          if (note && note.trim().toLowerCase() === quote.trim().toLowerCase()) {
            errors.push(`extractProposals[${i}]: summary note cannot be identical to verbatim quotation`);
          }

          // If source context is present, check exact quote containment
          if (context?.ownedText) {
            if (!context.ownedText.includes(quote)) {
              errors.push(`extractProposals[${i}]: quote does not appear verbatim in owned transcript`);
            }
          }

          extractProposals.push({
            quote,
            summaryNote: note,
            segmentKey: typeof ext.segmentKey === "string" ? ext.segmentKey : undefined,
          });
        }
      }
    }
  }

  // Parse & validate cards (max 8 cards, max 2 per concept)
  const cards: LearningCardCandidate[] = [];
  const conceptCardCounts = new Map<string, number>();

  if (Array.isArray(normalized.cards)) {
    for (let i = 0; i < normalized.cards.length; i++) {
      if (cards.length >= MAX_SECTION_CARDS) break; // Enforce cap

      const rawCard = normalized.cards[i];
      if (!isRecord(rawCard)) continue;

      const cardType = normalizeCardType(rawCard.cardType);
      const question = checkString(rawCard.question, `cards[${i}].question`, errors, { minLength: 1 });
      const answer = checkString(rawCard.answer, `cards[${i}].answer`, errors, { minLength: 1 });
      if (!question || !answer) continue;

      const concept = typeof rawCard.concept === "string" ? rawCard.concept.trim() : undefined;
      const conceptKey = concept ? concept.toLowerCase() : "general";

      // Cap at 2 per concept
      const currentCount = conceptCardCounts.get(conceptKey) ?? 0;
      if (currentCount >= MAX_SESSION_CARDS_PER_CONCEPT) {
        continue; // Drop excess beyond cap
      }

      const cardCandidate: LearningCardCandidate = {
        cardType,
        concept,
        conceptKeys: Array.isArray(rawCard.conceptKeys)
          ? rawCard.conceptKeys.filter((k): k is string => typeof k === "string")
          : concept ? [concept] : [],
        question,
        answer,
        clozeText: typeof rawCard.clozeText === "string" ? rawCard.clozeText : undefined,
        evidenceQuote: typeof rawCard.evidenceQuote === "string" ? rawCard.evidenceQuote : undefined,
        tags: Array.isArray(rawCard.tags) ? rawCard.tags.filter((t): t is string => typeof t === "string") : [],
      };

      // Quality block
      const quality = isGenericOrLowQualityCard(cardCandidate);
      if (quality.lowQuality) {
        errors.push(`cards[${i}]: ${quality.reason}`);
        continue;
      }

      // Grounding & verbatim evidence checks against source
      if (context?.ownedText) {
        if (cardCandidate.evidenceQuote) {
          if (!context.ownedText.includes(cardCandidate.evidenceQuote)) {
            errors.push(`cards[${i}]: evidence quote does not appear verbatim in owned transcript`);
            continue;
          }
        }

        if (cardCandidate.cardType === "cloze" && cardCandidate.clozeText) {
          const deletion = extractClozeDeletion(cardCandidate.clozeText);
          if (!deletion) {
            errors.push(`cards[${i}]: cloze text missing {{c1::...}} deletion`);
            continue;
          }
          if (!context.ownedText.includes(deletion)) {
            errors.push(`cards[${i}]: cloze deletion "${deletion}" does not appear verbatim in owned transcript`);
            continue;
          }
        }

        const grounding = checkAnswerGrounding(answer, context.ownedText);
        if (!grounding.grounded) {
          errors.push(`cards[${i}]: answer is not grounded in owned transcript text`);
          continue;
        }
      }

      conceptCardCounts.set(conceptKey, currentCount + 1);
      cards.push(cardCandidate);
    }
  }

  // Profile observations
  let profileObservations: SessionProfileObservations | undefined = undefined;
  if (isRecord(normalized.profileObservations)) {
    const rawObs = normalized.profileObservations;
    profileObservations = {
      decisions: Array.isArray(rawObs.decisions)
        ? rawObs.decisions.filter((s): s is string => typeof s === "string")
        : undefined,
      actionItems: Array.isArray(rawObs.actionItems)
        ? rawObs.actionItems.filter((s): s is string => typeof s === "string")
        : undefined,
      questions: Array.isArray(rawObs.questions)
        ? rawObs.questions.filter((s): s is string => typeof s === "string")
        : undefined,
      keyTakeaways: Array.isArray(rawObs.keyTakeaways)
        ? rawObs.keyTakeaways.filter((s): s is string => typeof s === "string")
        : undefined,
    };
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return valid({
    sectionSummary: sectionSummary ?? "",
    topics: rawTopics,
    concepts,
    extractProposals,
    cards,
    profileObservations,
    taskVersion: (normalized.taskVersion as string) || SESSION_ANALYSIS_TASK_VERSION,
  });
}

export function validateSessionOverviewAnalysis(
  output: unknown
): ValidationOutcome<SessionOverviewAnalysisResult> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  const overviewSummary = checkString(output.overviewSummary, "overviewSummary", errors, {
    minLength: 1,
    maxLength: 10000,
  });

  const outline = checkStringArray(output.outline, "outline", errors) ?? [];
  const keyTakeaways = checkStringArray(output.keyTakeaways, "keyTakeaways", errors) ?? [];
  const decisions = output.decisions !== undefined ? checkStringArray(output.decisions, "decisions", errors) : undefined;
  const actionItems = output.actionItems !== undefined ? checkStringArray(output.actionItems, "actionItems", errors) : undefined;

  const concepts: SessionSectionConcept[] = [];
  if (Array.isArray(output.concepts)) {
    for (let i = 0; i < output.concepts.length; i++) {
      const c = output.concepts[i];
      if (isRecord(c)) {
        const name = checkString(c.name, `concepts[${i}].name`, errors, { minLength: 1 });
        const def = c.definition !== undefined ? checkString(c.definition, `concepts[${i}].definition`, errors) : undefined;
        if (name) concepts.push({ name, definition: def });
      } else if (typeof c === "string" && c.trim()) {
        concepts.push({ name: c.trim() });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return valid({
    overviewSummary: overviewSummary ?? "",
    outline,
    keyTakeaways,
    concepts,
    decisions: decisions ?? undefined,
    actionItems: actionItems ?? undefined,
    taskVersion: typeof output.taskVersion === "string" ? output.taskVersion : SESSION_ANALYSIS_TASK_VERSION,
  });
}
