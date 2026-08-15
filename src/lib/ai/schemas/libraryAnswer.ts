/**
 * `LibraryAnswer` — structured envelope of the "Ask library" task (design D15 /
 * ai-library-rag spec, task 4.9).
 *
 * The model answers ONLY from the retrieved chunks it was shown as untrusted
 * blocks, each labeled with a `[N]` citation marker. Validation enforces the
 * spec's grounding contract:
 *  - every `sourceRefs` entry must reference a chunk id the task actually
 *    supplied (`refId` = retrieval chunk id), and its `quote` must appear in
 *    that chunk's text (whitespace-normalized containment);
 *  - violators are DROPPED (citation capping, like the Learn-this card caps) —
 *    an over-eager model degrades to "the refs that check out" instead of
 *    failing the whole answer;
 *  - `evidenceLevel: "none"` must carry no fabricated refs (they are dropped)
 *    and the answer must read as an honest no-evidence response;
 *  - shape failures (missing answer, unknown evidenceLevel) fail closed
 *    through the strict-JSON repair path in `runTask`.
 */

import {
  checkEnum,
  checkString,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

/** How well the retrieved sources support the answer (spec semantics). */
export const EVIDENCE_LEVELS = ["supported", "weak", "none", "conflicting"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** Max quoted chars kept per source ref (display + validation input size). */
export const MAX_SOURCE_QUOTE_CHARS = 400;

/** Hard cap on refs accepted from the model (retrieval k caps these anyway). */
export const MAX_SOURCE_REFS = 12;

export interface LibrarySourceRef {
  /** Retrieval chunk id the model is citing (`[N]` maps to this). */
  refId: string;
  /** Verbatim quote from that chunk supporting the answer. */
  quote: string;
}

export interface LibraryAnswer {
  answer: string;
  sourceRefs: LibrarySourceRef[];
  evidenceLevel: EvidenceLevel;
}

export const LIBRARY_ANSWER_SCHEMA = {
  name: "LibraryAnswer",
  nativeName: "libraryAnswer",
  json: JSON.stringify({
    answer: "string",
    sourceRefs: [{ refId: "string", quote: "string" }],
    evidenceLevel: EVIDENCE_LEVELS.join("|"),
  }),
};

/** Whitespace-squashed, case-folded text for containment checks. */
function normalizeForContainment(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * True when `quote` appears in `sourceText` under normalized whitespace.
 * Exported for the eval fixtures and UI-side re-verification.
 */
export function quoteIsGroundedIn(sourceText: string, quote: string): boolean {
  const needle = normalizeForContainment(quote);
  if (!needle) return false;
  return normalizeForContainment(sourceText).includes(needle);
}

export interface ValidateLibraryAnswerContext {
  /**
   * Retrieved chunks the model was shown: `id` → chunk text. Refs whose
   * `refId` is absent from this map are fabricated citations and get dropped.
   */
  sources: ReadonlyMap<string, string>;
}

/**
 * Validate (and citation-cap) a raw `LibraryAnswer` payload.
 *
 * Structural failures (bad shape, missing fields, unknown evidenceLevel)
 * return `{ ok: false }` so `runTask` retries through strict-JSON repair.
 * Citation violations are NOT structural failures — invalid refs are dropped
 * and, when the model produced no verifiable refs at all, `evidenceLevel` is
 * normalized to `"none"` so the UI never shows "supported" above a fabricated
 * citation list.
 */
export function validateLibraryAnswer(
  output: unknown,
  context: ValidateLibraryAnswerContext
): ValidationOutcome<LibraryAnswer> {
  if (!isRecord(output)) {
    return { ok: false, errors: ["libraryAnswer: expected object"] };
  }

  const errors: string[] = [];
  const answer = checkString(output.answer, "answer", errors, {
    minLength: 1,
    maxLength: 4000,
  });
  const evidenceLevel = checkEnum(output.evidenceLevel, EVIDENCE_LEVELS, "evidenceLevel", errors);
  if (answer === undefined || evidenceLevel === undefined) {
    return { ok: false, errors };
  }

  const rawRefs = Array.isArray(output.sourceRefs) ? output.sourceRefs : [];
  const sourceRefs: LibrarySourceRef[] = [];
  for (let i = 0; i < rawRefs.length && sourceRefs.length < MAX_SOURCE_REFS; i++) {
    const entry = rawRefs[i];
    if (!isRecord(entry)) {
      // A malformed entry is a fabricated citation — drop it, keep the answer.
      continue;
    }
    const refErrors: string[] = [];
    const refId = checkString(entry.refId, `sourceRefs[${i}].refId`, refErrors);
    const quote = checkString(entry.quote, `sourceRefs[${i}].quote`, refErrors, {
      maxLength: MAX_SOURCE_QUOTE_CHARS,
    });
    if (refId === undefined || quote === undefined) continue;

    const chunkText = context.sources.get(refId);
    // Fabricated refId or ungrounded quote: drop the ref (spec: never render a
    // citation that does not check out; do not kill the answer over it).
    if (chunkText === undefined) continue;
    if (!quoteIsGroundedIn(chunkText, quote)) continue;

    // Dedup refs pointing at the same chunk with the same quote.
    if (sourceRefs.some((r) => r.refId === refId && r.quote === quote)) continue;
    sourceRefs.push({ refId, quote });
  }

  // Loose evidenceLevel consistency (spec task 4.9):
  //  - "none" is the honest-refusal verdict — it never carries citations;
  //  - "supported"/"conflicting" without a single verifiable citation is an
  //    unbacked claim, so the level normalizes to "none";
  //  - "weak" with zero refs stays "weak" (weak signal, nothing quotable).
  let normalizedLevel = evidenceLevel;
  let normalizedRefs = sourceRefs;
  if (evidenceLevel === "none") {
    normalizedRefs = [];
  } else if (evidenceLevel !== "weak" && sourceRefs.length === 0) {
    normalizedLevel = "none";
  }

  return valid({
    answer,
    sourceRefs: normalizedRefs,
    evidenceLevel: normalizedLevel,
  });
}
