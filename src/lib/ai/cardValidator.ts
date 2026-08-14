/**
 * Grounded flashcard validation, evidence normalization, cross-chunk deduplication,
 * and deterministic quality scoring for on-device GenAI.
 */

import type { GeneratedFlashcard } from "../../api/ai";

export interface CardValidationResult {
  valid: boolean;
  grounded: boolean;
  evidenceFound: boolean;
  reasons: string[];
  /** Deterministic acceptance score from 0.0 to 1.0; missing or self-reported model confidence is ignored. */
  acceptanceScore: number;
}

export interface InternalOnDeviceFlashcard {
  question: string;
  answer: string;
  card_type: "qa" | "cloze";
  tags: string[];
  evidenceQuote?: string;
  sourceChunkIndex?: number;
  baseModelName?: string;
  validation: CardValidationResult;
}

export interface CardGenerationConstraints {
  allowedTypes?: Array<"qa" | "cloze">;
  topicFocus?: string;
  difficulty?: string;
  customPrompt?: string;
}

/** Matches `Q:` / `Question:`. */
const Q_LINE = /^[-*\d.)\s]*\**\s*(?:q|question)\s*\**\s*[:.]\s*\**\s*(.+)$/i;
/** Matches `A:` / `Answer:`. */
const A_LINE = /^[-*\d.)\s]*\**\s*(?:a|answer)\s*\**\s*[:.]\s*\**\s*(.+)$/i;
/** Matches `CLOZE:`. */
const CLOZE_LINE = /^[-*\d.)\s]*\**\s*cloze\s*\**\s*[:.]\s*\**\s*(.+)$/i;
/** Matches `EVIDENCE:` / `QUOTE:`. */
const EVIDENCE_LINE = /^[-*\d.)\s]*\**\s*(?:evidence|quote)\s*\**\s*[:.]\s*\**\s*(.+)$/i;

/** Cloze deletion pattern `{{c1::answer}}` or `[[c1::answer]]`. */
const CLOZE_DELETION = /\{\{c\d+::(.+?)(?:::.*?)?\}\}|\[\[c\d+::(.+?)(?:::.*?)?\]\]/;

/** Common stop words to strip when checking keyword grounding. */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "be", "been",
  "being", "in", "on", "at", "to", "for", "of", "with", "by", "that", "this", "it"
]);

/** Normalize text by lowercasing, stripping punctuation, and compressing whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract cloze deletion answer string. */
export function extractClozeDeletion(text: string): string {
  const match = CLOZE_DELETION.exec(text);
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

/** Check if evidence or key terms are present in source text. */
export function checkGrounding(
  quote: string | undefined,
  question: string,
  answer: string,
  sourceChunk: string
): { grounded: boolean; evidenceFound: boolean; score: number } {
  const normSource = normalizeText(sourceChunk);
  if (!normSource) return { grounded: false, evidenceFound: false, score: 0 };

  // 1. Direct evidence quote match
  if (quote && quote.trim()) {
    const normQuote = normalizeText(quote);
    if (normQuote && normSource.includes(normQuote)) {
      return { grounded: true, evidenceFound: true, score: 1.0 };
    }
  }

  // 2. Term occurrence match (question + answer key terms in source)
  const normQ = normalizeText(question);
  const normA = normalizeText(answer);

  const keywords = [...normQ.split(" "), ...normA.split(" ")]
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (keywords.length === 0) {
    return { grounded: false, evidenceFound: false, score: 0.3 };
  }

  const matchedCount = keywords.filter((kw) => normSource.includes(kw)).length;
  const matchRatio = matchedCount / keywords.length;

  if (matchRatio >= 0.6) {
    return { grounded: true, evidenceFound: false, score: Math.min(0.9, 0.5 + matchRatio * 0.4) };
  }

  return { grounded: false, evidenceFound: false, score: Math.max(0.1, matchRatio * 0.5) };
}

/** Check if key content terms from an answer are grounded in a passage text. */
export function checkAnswerGrounding(
  answer: string,
  passage: string
): { grounded: boolean; score: number } {
  const normPassage = normalizeText(passage);
  if (!normPassage) return { grounded: false, score: 0 };

  const normA = normalizeText(answer);
  const keywords = normA
    .split(" ")
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (keywords.length === 0) {
    return { grounded: true, score: 0.8 };
  }

  const matchedCount = keywords.filter((kw) => normPassage.includes(kw)).length;
  const matchRatio = matchedCount / keywords.length;

  if (matchRatio >= 0.7) {
    return { grounded: true, score: Math.min(1.0, 0.4 + matchRatio * 0.6) };
  }

  return { grounded: false, score: Number((matchRatio * 0.5).toFixed(2)) };
}

/**
 * Validate a candidate on-device flashcard against rules and source text.
 */
export function validateOnDeviceCard(
  card: {
    question: string;
    answer: string;
    card_type: "qa" | "cloze";
    evidenceQuote?: string;
  },
  sourceChunk: string,
  constraints?: CardGenerationConstraints
): CardValidationResult {
  const reasons: string[] = [];
  const q = card.question.trim();
  const a = card.answer.trim();

  if (!q) reasons.push("missing_question");
  if (!a) reasons.push("missing_answer");

  if (card.card_type === "cloze") {
    const deletion = extractClozeDeletion(q);
    if (!deletion) {
      reasons.push("missing_cloze_deletion");
    }
  }

  if (constraints?.allowedTypes && constraints.allowedTypes.length > 0) {
    if (!constraints.allowedTypes.includes(card.card_type)) {
      reasons.push(`card_type_disallowed:${card.card_type}`);
    }
  }

  const valid = reasons.length === 0;

  const grounding = checkGrounding(card.evidenceQuote, q, a, sourceChunk);
  if (!grounding.grounded) {
    reasons.push("evidence_not_grounded");
  }

  const finalScore = valid ? grounding.score : Math.min(0.2, grounding.score);

  return {
    valid,
    grounded: grounding.grounded,
    evidenceFound: grounding.evidenceFound,
    reasons,
    acceptanceScore: Number(finalScore.toFixed(2)),
  };
}

/**
 * Parse delimited completions with optional EVIDENCE: / QUOTE: lines.
 */
export function parseDelimitedFlashcardsWithEvidence(
  completion: string,
  sourceChunk: string,
  tags: string[] = [],
  chunkIndex = 0,
  baseModelName?: string,
  constraints?: CardGenerationConstraints
): InternalOnDeviceFlashcard[] {
  const results: InternalOnDeviceFlashcard[] = [];

  // 1. Try structured JSON array parsing first if completion is JSON
  const trimmed = completion.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : parsed.cards || parsed.flashcards || [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const q = String(item.question || item.CLOZE || item.q || "").trim();
        const a = String(item.answer || item.a || "").trim();
        const typeStr = String(item.card_type || item.cardType || (q.includes("{{") ? "cloze" : "qa")).toLowerCase();
        const card_type: "qa" | "cloze" = typeStr === "cloze" ? "cloze" : "qa";
        const evidenceQuote = item.evidenceQuote || item.evidence || item.quote;

        const validation = validateOnDeviceCard({ question: q, answer: a, card_type, evidenceQuote }, sourceChunk, constraints);
        results.push({
          question: q,
          answer: card_type === "cloze" ? (extractClozeDeletion(q) || a) : a,
          card_type,
          tags: [...tags],
          evidenceQuote,
          sourceChunkIndex: chunkIndex,
          baseModelName,
          validation,
        });
      }
      if (results.length > 0) return results;
    } catch {
      // Fallback to line parser
    }
  }

  // 2. Line-oriented parser fallback with EVIDENCE: line support
  let pendingQuestion: string | null = null;
  let pendingAnswer: string | null = null;
  let pendingType: "qa" | "cloze" | null = null;

  const flushCard = (evidenceQuote?: string) => {
    if (pendingQuestion && (pendingAnswer || pendingType === "cloze")) {
      const card_type = pendingType ?? "qa";
      const q = pendingQuestion;
      const a = card_type === "cloze" ? extractClozeDeletion(q) || pendingAnswer || "" : pendingAnswer || "";
      const validation = validateOnDeviceCard({ question: q, answer: a, card_type, evidenceQuote }, sourceChunk, constraints);
      results.push({
        question: q,
        answer: a,
        card_type,
        tags: [...tags],
        evidenceQuote,
        sourceChunkIndex: chunkIndex,
        baseModelName,
        validation,
      });
    }
    pendingQuestion = null;
    pendingAnswer = null;
    pendingType = null;
  };

  for (const rawLine of completion.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cloze = CLOZE_LINE.exec(line);
    if (cloze) {
      flushCard();
      pendingQuestion = cloze[1].trim();
      pendingAnswer = extractClozeDeletion(pendingQuestion);
      pendingType = "cloze";
      continue;
    }

    const question = Q_LINE.exec(line);
    if (question) {
      flushCard();
      pendingQuestion = question[1].trim();
      pendingType = "qa";
      continue;
    }

    const answer = A_LINE.exec(line);
    if (answer && pendingQuestion && pendingType === "qa") {
      pendingAnswer = answer[1].trim();
      continue;
    }

    const evidence = EVIDENCE_LINE.exec(line);
    if (evidence && pendingQuestion) {
      flushCard(evidence[1].trim());
      continue;
    }
  }

  flushCard();
  return results;
}

/**
 * Deduplicate cards across chunk boundaries by question + answer signature.
 */
export function deduplicateOnDeviceCards(
  cards: InternalOnDeviceFlashcard[]
): InternalOnDeviceFlashcard[] {
  const seen = new Set<string>();
  const unique: InternalOnDeviceFlashcard[] = [];

  for (const card of cards) {
    const sig = `${card.card_type}:${normalizeText(card.question)}:${normalizeText(card.answer)}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      unique.push(card);
    }
  }

  return unique;
}

/**
 * Map valid internal cards into public `GeneratedFlashcard` shape.
 */
export function toGeneratedFlashcards(
  internalCards: InternalOnDeviceFlashcard[],
  acceptanceThreshold = 0.0
): GeneratedFlashcard[] {
  return internalCards
    .filter((c) => c.validation.valid && c.validation.acceptanceScore >= acceptanceThreshold)
    .map((c) => ({
      question: c.question,
      answer: c.answer,
      card_type: c.card_type,
      tags: c.tags,
    }));
}
