/**
 * TF-IDF / BM25 term salience and keyphrase extractor (TypeScript baseline)
 */

import { extractCandidatePhrases, tokenizeWords } from "./tokenizer";

export interface ScoredTerm {
  term: string;
  score: number;
  frequency: number;
  isPhrase: boolean;
}

export interface DocumentContentParts {
  title: string;
  headings?: string[];
  body: string;
}

export function extractSalientTerms(
  parts: DocumentContentParts,
  topK = 30
): ScoredTerm[] {
  const termScores = new Map<string, number>();
  const termCounts = new Map<string, number>();
  const isPhraseMap = new Map<string, boolean>();

  // 1. Title (Weight 5.0)
  const titleTokens = tokenizeWords(parts.title);
  const titlePhrases = extractCandidatePhrases(parts.title);
  for (const token of titleTokens) {
    termScores.set(token, (termScores.get(token) || 0) + 5.0);
    termCounts.set(token, (termCounts.get(token) || 0) + 1);
    if (!isPhraseMap.has(token)) isPhraseMap.set(token, false);
  }
  for (const phrase of titlePhrases) {
    termScores.set(phrase, (termScores.get(phrase) || 0) + 8.0);
    termCounts.set(phrase, (termCounts.get(phrase) || 0) + 1);
    isPhraseMap.set(phrase, true);
  }

  // 2. Headings (Weight 3.0)
  if (parts.headings) {
    for (const heading of parts.headings) {
      const headingTokens = tokenizeWords(heading);
      const headingPhrases = extractCandidatePhrases(heading);
      for (const token of headingTokens) {
        termScores.set(token, (termScores.get(token) || 0) + 3.0);
        termCounts.set(token, (termCounts.get(token) || 0) + 1);
        if (!isPhraseMap.has(token)) isPhraseMap.set(token, false);
      }
      for (const phrase of headingPhrases) {
        termScores.set(phrase, (termScores.get(phrase) || 0) + 5.0);
        termCounts.set(phrase, (termCounts.get(phrase) || 0) + 1);
        isPhraseMap.set(phrase, true);
      }
    }
  }

  // 3. Body (Weight 1.0)
  const bodyTokens = tokenizeWords(parts.body);
  const bodyPhrases = extractCandidatePhrases(parts.body);
  const bodyTokenCount = Math.max(1, bodyTokens.length);

  for (const token of bodyTokens) {
    termScores.set(token, (termScores.get(token) || 0) + 1.0);
    termCounts.set(token, (termCounts.get(token) || 0) + 1);
    if (!isPhraseMap.has(token)) isPhraseMap.set(token, false);
  }
  for (const phrase of bodyPhrases) {
    termScores.set(phrase, (termScores.get(phrase) || 0) + 1.5);
    termCounts.set(phrase, (termCounts.get(phrase) || 0) + 1);
    isPhraseMap.set(phrase, true);
  }

  // 4. BM25 / Frequency Saturation & Length Normalization
  const k1 = 1.5;
  const b = 0.75;
  const avgDocLen = 500.0;
  const docLenNorm = 1.0 - b + b * (bodyTokenCount / avgDocLen);

  const results: ScoredTerm[] = [];
  for (const [term, rawScore] of termScores.entries()) {
    const count = termCounts.get(term) || 0;
    const isPhrase = isPhraseMap.get(term) || false;
    const normalizedScore = (rawScore * (k1 + 1.0)) / (rawScore + k1 * docLenNorm);
    const phraseBoost = isPhrase && count >= 2 ? 1.3 : 1.0;

    results.push({
      term,
      score: normalizedScore * phraseBoost,
      frequency: count,
      isPhrase,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}
