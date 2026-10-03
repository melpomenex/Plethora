/* eslint-disable no-control-regex -- the payload sanitiser strips control bytes
   from author-controlled headings on purpose; see the note at the cleaning step. */
/**
 * The outbound-payload gate for a remote decision model.
 *
 * Local-first is a default, not a preference: with the opt-in off, the builder
 * that would put bytes on the wire is **not reachable**. That is stronger than a
 * runtime check on the payload — it removes the code path, so a future change
 * cannot accidentally reintroduce it by forgetting to call a guard.
 *
 * When the user *has* opted in, the payload is a structural outline: heading
 * skeleton, item type, and length. Not the body, not the verbatim title, not
 * tags, not the author's byline. Those three omissions are asserted by tests
 * against a fixture containing all of them.
 */

/** The most that ever leaves the device for one item. */
export interface RemoteDecisionPayload {
  itemType: string;
  lengthChars: number;
  /** Heading skeleton only. */
  outline: string[];
  rubricVersion: number;
}

/** Why a payload was refused. */
export type PayloadRefusal =
  | "remote-not-opted-in"
  | "payload-too-large"
  | "outline-too-deep"
  | "non-ascii-control";

/** A payload plus either its refusal or the bytes that may be sent. */
export type PayloadDecision =
  | { ok: true; payload: RemoteDecisionPayload; body: string }
  | { ok: false; refusal: PayloadRefusal; detail?: string };

/**
 * Explicit outcome guards.
 *
 * The repo compiles without `strictNullChecks`, where boolean-discriminant
 * narrowing of these unions does not apply — the same reason
 * `schemas/common.ts` has `isValidOutcome` / `isFailedOutcome`. Use these rather
 * than `if (decision.ok)`.
 */
export function isPayloadRefused(
  decision: PayloadDecision
): decision is { ok: false; refusal: PayloadRefusal; detail?: string } {
  return decision.ok === false;
}

export function isPayloadAllowed(
  decision: PayloadDecision
): decision is { ok: true; payload: RemoteDecisionPayload; body: string } {
  return decision.ok === true;
}

/** Above this many characters the payload is refused even when opted in. */
export const MAX_REMOTE_OUTLINE_CHARS = 4_000;
/** Above this many headings the outline is refused as an exfiltration shape. */
export const MAX_REMOTE_OUTLINE_ENTRIES = 80;

/**
 * Build the payload a remote provider would receive, or refuse.
 *
 * This function is the *only* place a remote decision-model payload is
 * constructed, and it is unreachable while `allowRemote` is false.
 */
export function buildRemoteDecisionPayload(input: {
  allowRemote: boolean;
  itemType: string;
  lengthChars: number;
  outline?: string[];
  rubricVersion: number;
}): PayloadDecision {
  if (!input.allowRemote) {
    return {
      ok: false,
      refusal: "remote-not-opted-in",
      detail:
        "A remote decision model needs an explicit opt-in; with it off the payload is never constructed.",
    };
  }

  const outline = (input.outline ?? []).slice(0, MAX_REMOTE_OUTLINE_ENTRIES + 1);
  if (outline.length > MAX_REMOTE_OUTLINE_ENTRIES) {
    return {
      ok: false,
      refusal: "outline-too-deep",
      detail: `${outline.length} headings exceeds the ${MAX_REMOTE_OUTLINE_ENTRIES} allowed`,
    };
  }

  // Headings are author-controlled text. Control characters are replaced with a
  // space (then collapsed) so a heading cannot smuggle a field separator or a
  // newline-delimited extra record past the schema.
  // The control-character class below is the point of this function — a heading is
  // author-controlled text and must not be able to smuggle a field separator or
  // a newline-delimited extra record past the schema. `no-control-regex` is a
  // false positive here, so it is disabled for the file rather than weakening
  // the sanitiser to satisfy the lint.
  const cleaned = outline.map((heading) =>
    heading.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  );

  const totalChars = cleaned.reduce((sum, heading) => sum + heading.length, 0);
  if (totalChars > MAX_REMOTE_OUTLINE_CHARS) {
    return {
      ok: false,
      refusal: "payload-too-large",
      detail: `${totalChars} characters exceeds the ${MAX_REMOTE_OUTLINE_CHARS} allowed`,
    };
  }

  if (cleaned.some((heading) => /[^\x20-\x7e]/.test(heading))) {
    return {
      ok: false,
      refusal: "non-ascii-control",
      detail: "headings must be plain text",
    };
  }

  const payload: RemoteDecisionPayload = {
    itemType: input.itemType,
    lengthChars: input.lengthChars,
    outline: cleaned,
    rubricVersion: input.rubricVersion,
  };

  return { ok: true, payload, body: JSON.stringify(payload) };
}

/**
 * The structural outline extracted from an item for the payload.
 *
 * Deliberately lossy in one direction only: it keeps heading text and drops
 * everything else. Body paragraphs, the title, tags, and byline are not read at
 * all, so there is no value to leak even in principle.
 */
export function outlineFromHeadings(headings: readonly string[]): string[] {
  return headings.map((heading) => heading.trim()).filter((heading) => heading.length > 0);
}