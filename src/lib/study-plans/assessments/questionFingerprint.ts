/**
 * Canonical Question Fingerprinting and Near-Duplicate Detection.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §5
 * - openspec/changes/generate-study-plan-examinations/
 */

import { toCanonicalJson, sha256Hex } from '../sourceValidation';
import type { AssessmentQuestion } from '../../../types/assessmentQuestions';

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

function normalizeCase(text: string): string {
  return text.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

/**
 * Computes a deterministic SHA-256 fingerprint for an AssessmentQuestion.
 * Intentionally EXCLUDES answer correctness/selection so that changing an option's
 * correctness or altering answer input does not manufacture a new distinct question identity.
 */
export function computeQuestionFingerprint(
  question: AssessmentQuestion,
  targets: Array<{ nodeId?: string | null; conceptId?: string | null }> = []
): string {
  const normPrompt = normalizeCase(question.prompt);

  let optionsTexts: string[] = [];
  let blankSourceDeletionTexts: string[] = [];
  let referenceKeyFacts: string[] = [];

  switch (question.kind) {
    case 'single-select':
    case 'multi-select': {
      optionsTexts = (question.options || [])
        .map((o) => normalizeCase(o.text))
        .sort();
      break;
    }

    case 'cloze': {
      blankSourceDeletionTexts = (question.blanks || [])
        .flatMap((b) => (b.acceptedAnswers || []).map((ans) => normalizeCase(ans)))
        .sort();
      break;
    }

    case 'short-answer': {
      referenceKeyFacts = (question.keyFacts || [])
        .map((kf) => normalizeCase(kf.text))
        .sort();
      break;
    }

    case 'essay': {
      referenceKeyFacts = [normalizeCase(question.expectedReasoning)];
      break;
    }
  }

  const sortedTargets = (targets || [])
    .map((t) => `${t.nodeId ?? ''}:${t.conceptId ?? ''}`)
    .sort();

  const canonicalObj = {
    kind: question.kind,
    normalizedPrompt: normPrompt,
    optionsTexts,
    blankSourceDeletionTexts,
    referenceKeyFacts,
    sortedTargets,
  };

  const canonicalJson = toCanonicalJson(canonicalObj);
  return sha256Hex(canonicalJson);
}

/**
 * Tokenizes text into normalized words, stripping punctuation.
 */
function tokenizeWords(text: string): string[] {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Generates token 3-grams multiset from text.
 * Falls back to character 3-grams when text has fewer than 3 words.
 */
export function extract3Grams(text: string): Map<string, number> {
  const tokens = tokenizeWords(text);
  const grams = new Map<string, number>();

  if (tokens.length >= 3) {
    for (let i = 0; i <= tokens.length - 3; i++) {
      const gram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
    }
  } else {
    // Fallback: character 3-grams for very short phrases
    const clean = tokens.join(' ');
    if (clean.length >= 3) {
      for (let i = 0; i <= clean.length - 3; i++) {
        const gram = clean.substring(i, i + 3);
        grams.set(gram, (grams.get(gram) ?? 0) + 1);
      }
    } else if (clean.length > 0) {
      grams.set(clean, 1);
    }
  }

  return grams;
}

/**
 * Computes Sørensen–Dice similarity coefficient over token 3-grams:
 * 2 * |A ∩ B| / (|A| + |B|)
 * Returns a value in [0.0, 1.0].
 */
export function computeDice3GramSimilarity(strA: string, strB: string): number {
  if (strA === strB) return 1.0;
  if (!strA || !strB) return 0.0;

  const gramsA = extract3Grams(strA);
  const gramsB = extract3Grams(strB);

  let totalA = 0;
  for (const count of gramsA.values()) totalA += count;

  let totalB = 0;
  for (const count of gramsB.values()) totalB += count;

  if (totalA === 0 || totalB === 0) return 0.0;

  let intersection = 0;
  for (const [gram, countA] of gramsA.entries()) {
    const countB = gramsB.get(gram);
    if (countB !== undefined) {
      intersection += Math.min(countA, countB);
    }
  }

  return Number(((2 * intersection) / (totalA + totalB)).toFixed(4));
}

/**
 * Extracts normalized content representation for near-duplicate comparison.
 */
function getQuestionComparisonText(question: AssessmentQuestion): string {
  const parts: string[] = [question.prompt];

  switch (question.kind) {
    case 'single-select':
    case 'multi-select':
      for (const opt of question.options || []) {
        parts.push(opt.text);
      }
      break;

    case 'cloze':
      for (const b of question.blanks || []) {
        parts.push(...(b.acceptedAnswers || []));
      }
      break;

    case 'short-answer':
      parts.push(question.referenceAnswer);
      for (const kf of question.keyFacts || []) {
        parts.push(kf.text);
      }
      break;

    case 'essay':
      parts.push(question.expectedReasoning);
      break;
  }

  return parts.join(' ');
}

/**
 * Checks whether two questions are near-duplicates using token 3-gram Dice similarity.
 */
export function isNearDuplicateQuestion(
  qA: AssessmentQuestion,
  qB: AssessmentQuestion,
  threshold: number = DUPLICATE_SIMILARITY_THRESHOLD
): { isDuplicate: boolean; similarity: number } {
  if (qA.kind !== qB.kind) {
    return { isDuplicate: false, similarity: 0.0 };
  }

  const textA = getQuestionComparisonText(qA);
  const textB = getQuestionComparisonText(qB);

  const similarity = computeDice3GramSimilarity(textA, textB);
  return {
    isDuplicate: similarity >= threshold,
    similarity,
  };
}
