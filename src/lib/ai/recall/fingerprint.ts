/**
 * Recall-question fingerprinting and near-duplicate detection (design D19 /
 * ai-active-recall spec, task 5.3).
 *
 * Pure module: no provider, store, or Tauri access. The deduplication WINDOW
 * (30 days per design D19) is applied by the caller when it queries
 * `get_recent_recall_prompts(documentId, sinceDays=30)`; this module only
 * decides whether two questions are "effectively identical".
 *
 * Fingerprint = fnv1a (the same stable hash used across the AI layer) over
 * the normalized question text plus the sorted normalized concept keys, so a
 * stored fingerprint in `recall_prompt_history` already encodes both inputs.
 * Near-duplicate detection is token-Jaccard ≥ 0.8 on the normalized question
 * — catches paraphrases the exact fingerprint cannot (spec: "effectively
 * identical questions SHALL NOT be re-asked").
 */

import { fnv1aHash } from "../providers/types";

/** Punctuation stripped for normalization (keeps letters, digits, spaces). */
const PUNCTUATION = /[^\p{L}\p{N}\s]+/gu;
const WHITESPACE = /\s+/g;

/**
 * Lowercase, strip punctuation, collapse whitespace. Two questions that only
 * differ in casing/punctuation/spacing normalize to the same string.
 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(PUNCTUATION, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

/**
 * Normalize concept keys: lowercase, trim, drop empties, dedupe, sort —
 * so key order and casing never change a fingerprint.
 */
export function normalizeConceptKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const key of keys) {
    const normalized = normalizeQuestion(key);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

/** Token multiset (set) of a normalized question. */
function tokenize(normalized: string): Set<string> {
  const tokens = normalized.split(" ").filter(Boolean);
  return new Set(tokens);
}

/** Jaccard similarity of two token sets (1 when identical, 0 when disjoint). */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

/**
 * Stable fingerprint over the normalized question + sorted concept keys.
 * Equal fingerprints mean identical (normalized) questions — a cheap exact
 * match against `recall_prompt_history.fingerprint`.
 */
export function fingerprintRecallQuestion(
  question: string,
  conceptKeys: readonly string[] = []
): string {
  const normalizedQuestion = normalizeQuestion(question);
  const normalizedKeys = normalizeConceptKeys(conceptKeys);
  return fnv1aHash(`${normalizedQuestion}\u0000${normalizedKeys.join(",")}`);
}

/** Similarity threshold at which two questions count as near-duplicates. */
export const NEAR_DUPLICATE_THRESHOLD = 0.8;

export interface NearDuplicateInput {
  question: string;
  conceptKeys?: readonly string[];
}

/**
 * True when two questions are effectively identical: token Jaccard ≥ 0.8 on
 * the normalized question text (covers paraphrases and added/removed
 * punctuation or filler words).
 */
export function nearDuplicate(a: NearDuplicateInput, b: NearDuplicateInput): boolean {
  const similarity = jaccardSimilarity(
    tokenize(normalizeQuestion(a.question)),
    tokenize(normalizeQuestion(b.question))
  );
  return similarity >= NEAR_DUPLICATE_THRESHOLD;
}

/**
 * Convenience for the viewer controller: does a freshly generated question
 * duplicate any prompt in the recent history (exact fingerprint or
 * near-duplicate)? Returns the first match, or null.
 */
export function findDuplicatePrompt(
  candidate: NearDuplicateInput & { fingerprint: string },
  history: ReadonlyArray<{ fingerprint: string; question: string }>
): { fingerprint: string; question: string } | null {
  for (const entry of history) {
    // Exact normalized match first (cheap string compare), then paraphrase
    // detection via token Jaccard.
    if (entry.fingerprint === candidate.fingerprint) return entry;
    if (nearDuplicate(candidate, entry)) return entry;
  }
  return null;
}
