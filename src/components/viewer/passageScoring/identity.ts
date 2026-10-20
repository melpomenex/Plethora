/**
 * Passage normalization, digest and eligibility rules (tasks 1.1/1.3/4.1).
 *
 * These functions are pure so the controller, adapters and tests share one
 * definition of identity:
 *
 *   digest = SHA-256(
 *     normalizationVersion ‖ classifierVersion ‖ servingRevision ‖ normalizedText
 *   )
 *
 * The digest is used as the persistent cache key. The same 96-character text
 * prefix with a different suffix therefore yields a different key, and a
 * changed classifier or serving model is a cache miss instead of a stale hit.
 */

import type { PassageClassification } from "../../../lib/ai/schemas/passageClassification";
import { sha256Hex } from "./hash";
import {
  PASSAGE_MAX_TEXT_LENGTH,
  PASSAGE_MIN_TEXT_LENGTH,
  PASSAGE_WORTHINESS_THRESHOLD,
  type PassagePolicyIdentity,
} from "./types";

/** Bump when normalization changes; participates in every digest. */
export const PASSAGE_NORMALIZATION_VERSION = "passage-normalization-v1";

/** Classifier prompt/schema/output-envelope revision marker. */
export const PASSAGE_CLASSIFIER_REVISION_PREFIX = "passage-classifier-v1";

const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;
/** Control characters are stripped from display text; `\p{Cc}` avoids an
 * explicit control-character range in source while matching the same set. */
const CONTROL = /\p{Cc}+/gu;

/**
 * Normalize passage text for identity and classification. Reflow, soft line
 * breaks and zero-width artifacts must not change the digest; actual wording
 * must.
 */
export function normalizePassageText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One-line display form used by the indicator sheet (plain text only). */
export function toPlainReason(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(CONTROL, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

export interface PassageDigestInput {
  text: string;
  /** Resolved policy identity. */
  policy: Pick<PassagePolicyIdentity, "classifierVersion" | "servingRevision">;
  /** Override for tests/migrations. */
  normalizationVersion?: string;
}

/** Full SHA-256 passage identity. Never includes source geometry or titles. */
export function computePassageDigest(input: PassageDigestInput): string {
  const normalizationVersion =
    input.normalizationVersion ?? PASSAGE_NORMALIZATION_VERSION;
  return sha256Hex(
    [
      normalizationVersion,
      input.policy.classifierVersion,
      input.policy.servingRevision,
      normalizePassageText(input.text),
    ].join("\u0000")
  );
}

/** Convenience for adapters: digest of already-normalized text. */
export function digestNormalizedPassage(
  normalizedText: string,
  policy: Pick<PassagePolicyIdentity, "classifierVersion" | "servingRevision">
): string {
  return sha256Hex(
    [
      PASSAGE_NORMALIZATION_VERSION,
      policy.classifierVersion,
      policy.servingRevision,
      normalizedText,
    ].join("\u0000")
  );
}

export interface BoundedPassageText {
  /** Normalized text actually classified and hashed. */
  readonly text: string;
  /** True when the adapter's text exceeded the per-passage cap. */
  readonly truncated: boolean;
}

/**
 * Bound a passage to 60–2,400 characters. Splitting belongs to the adapter;
 * this is the controller's safety bound (it never invents an anchor).
 */
export function boundPassageText(raw: string): BoundedPassageText | null {
  const normalized = normalizePassageText(raw);
  if (normalized.length < PASSAGE_MIN_TEXT_LENGTH) return null;
  if (normalized.length <= PASSAGE_MAX_TEXT_LENGTH) {
    return { text: normalized, truncated: false };
  }
  const slice = normalized.slice(0, PASSAGE_MAX_TEXT_LENGTH);
  const boundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("\n")
  );
  const text = (boundary >= PASSAGE_MIN_TEXT_LENGTH ? slice.slice(0, boundary + 1) : slice).trim();
  return { text, truncated: true };
}

export interface PassageTextPart {
  /** Offsets in the normalized block text. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Deterministically split a long block at sentence boundaries while
 * preserving offsets. A part is at most `maxLength` characters and (except
 * for a final short remainder) at least `minLength`.
 */
export function splitPassageText(
  normalizedText: string,
  maxLength = 1_200,
  minLength = 240
): PassageTextPart[] {
  const text = normalizePassageText(normalizedText);
  if (!text) return [];
  if (text.length <= maxLength) {
    return [{ start: 0, end: text.length, text }];
  }

  const parts: PassageTextPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= maxLength) {
      const tail = text.slice(cursor);
      if (tail.trim().length > 0) {
        parts.push({ start: cursor, end: text.length, text: tail });
      }
      break;
    }

    const hardEnd = Math.min(cursor + maxLength, text.length);
    const window = text.slice(cursor, hardEnd);
    // Prefer a paragraph break, then sentence end, then whitespace.
    const candidates = [
      window.lastIndexOf("\n\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf(" "),
    ];
    let cut = hardEnd;
    for (const candidate of candidates) {
      if (candidate >= minLength) {
        cut = cursor + candidate + (candidate === window.lastIndexOf("\n\n") ? 2 : 1);
        break;
      }
    }

    const part = text.slice(cursor, cut);
    if (part.trim().length > 0) {
      parts.push({ start: cursor, end: cut, text: part });
    }
    cursor = cut;
    // Never emit an infinite loop from a pathological zero-width cut.
    if (cut <= cursor - maxLength) break;
  }
  return parts;
}

const QUIET_TYPES = new Set<PassageClassification["type"]>([
  "transition",
  "bibliography",
  "low-value",
]);

/**
 * Indicator gate: strictly above 0.75 AND a meaningful role/action.
 * An inconsistent high score on a bibliography/transition/low-value passage
 * (or `suggestedLearningAction: "none"`) stays quiet.
 */
export function isExtractWorthinessEligible(classification: PassageClassification): boolean {
  if (!(classification.extractWorthiness > PASSAGE_WORTHINESS_THRESHOLD)) return false;
  if (QUIET_TYPES.has(classification.type)) return false;
  if (classification.suggestedLearningAction === "none") return false;
  return true;
}

/** Safe diagnostic category for a failed run (never raw text). */
export function classifyErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "category" in error) {
    const category = (error as { category?: unknown }).category;
    if (typeof category === "string" && category.length > 0 && category.length < 64) {
      return category;
    }
  }
  return "error";
}
