/**
 * Pure helpers for approximating "already-read" material for active-recall
 * prompts (task 5.5; design D19 "only encountered material is tested").
 *
 * The semantic index knows every chunk of a document, but the viewer only
 * knows a scroll position. The pragmatic approximation implemented here:
 *
 *  1. the viewer's scroll container text is split into paragraphs and cut
 *     at the furthest scroll fraction the reader has reached — everything
 *     above the cut counts as READ (never upcoming content);
 *  2. when the document is semantically indexed, indexed chunks whose text
 *     overlaps that read region are preferred (they carry real chunk ids for
 *     `chunkRefs` and `recall_prompt_history.chunk_ids`);
 *  3. otherwise the recently-passed paragraphs themselves become pseudo
 *     chunks with deterministic ids (`approx-<fnv1a(text)>`) so history and
 *     dedup still work.
 *
 * All functions are pure (no DOM, no Tauri) — the DOM read lives in the
 * controller hook, which feeds text + scroll fraction in.
 */

import { fnv1aHash } from "../../lib/ai/providers/types";

/** Minimum paragraph length worth quizzing on (chars). */
export const MIN_PARAGRAPH_CHARS = 60;
/** Cap on the sampled read region (chars) — the prompt input budget. */
export const MAX_SAMPLE_CHARS = 2400;
/** Target chunk text length for pseudo chunks (matches the ~700–900 chunker). */
export const APPROX_CHUNK_MAX_CHARS = 900;

export interface ReadChunkCandidate {
  id: string;
  text: string;
}

/** Split container text into non-trivial paragraphs (blank-line / newline). */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= MIN_PARAGRAPH_CHARS);
}

/**
 * The slice of `fullText` the reader has already passed: paragraphs up to
 * `readFraction` of the document, keeping at most the last `MAX_SAMPLE_CHARS`
 * worth of them (the "recently passed" region a prompt is grounded in).
 */
export function approximateReadParagraphs(
  fullText: string,
  readFraction: number,
  maxChars: number = MAX_SAMPLE_CHARS
): string[] {
  const paragraphs = splitParagraphs(fullText);
  if (paragraphs.length === 0) return [];
  const clamped = Math.min(1, Math.max(0, readFraction));
  const readCount = Math.max(1, Math.ceil(clamped * paragraphs.length));
  const region: string[] = [];
  let used = 0;
  for (let i = readCount - 1; i >= 0; i--) {
    const paragraph = paragraphs[i];
    if (used + paragraph.length > maxChars && region.length > 0) break;
    region.unshift(paragraph);
    used += paragraph.length;
  }
  return region;
}

/** Deterministic pseudo chunks from sampled paragraphs. */
export function buildApproxChunks(paragraphs: string[]): ReadChunkCandidate[] {
  return paragraphs.map((text) => ({
    id: `approx-${fnv1aHash(text)}`,
    text: text.length > APPROX_CHUNK_MAX_CHARS
      ? text.slice(0, APPROX_CHUNK_MAX_CHARS)
      : text,
  }));
}

/**
 * Does an indexed chunk belong to the READ region? Token-overlap check so a
 * retrieved chunk from an unread section can never ground a prompt.
 */
export function chunkTextOverlapsRead(chunkText: string, readText: string): boolean {
  const chunkTokens = new Set(tokenize(chunkText));
  const readTokens = tokenize(readText);
  if (chunkTokens.size === 0 || readTokens.size === 0) return false;
  let shared = 0;
  for (const token of chunkTokens) {
    if (readTokens.has(token)) shared += 1;
  }
  // A chunk is "read" when most of its distinctive tokens appeared above
  // the reader's furthest position.
  return shared / chunkTokens.size >= 0.6;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/**
 * Deterministically choose 1–3 chunks for a prompt: the most recently read
 * ones (highest index first), newest first, capped at `max`.
 */
export function chooseRecallChunks<T>(chunks: T[], max = 3, min = 1): T[] {
  if (chunks.length === 0) return [];
  const count = Math.min(max, Math.max(min, chunks.length));
  return chunks.slice(chunks.length - count).reverse();
}

/**
 * Concept-density signal for the interruption policy: chunks read per
 * minute. Short windows are floored at half a minute so the value stays
 * finite and sane right after a prompt.
 */
export function estimateConceptDensity(chunksSeen: number, minutesRead: number): number {
  const minutes = Math.max(minutesRead, 0.5);
  return chunksSeen / minutes;
}
