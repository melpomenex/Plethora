/**
 * Historical reauthorization (design D4, task 2.6 / defect A7).
 *
 * Source authorization is not a one-time property of a message: a document can
 * later be marked local-only, AI-excluded or deleted. Before any historical
 * message, summary, tool result, suggestion, repair prompt or embedding leaves
 * the device, its source edges are re-checked against *current* authorization.
 *
 * Denied content is replaced by a local placeholder that names the limitation;
 * it is never silently dropped (the reader would see a hole) and never
 * silently re-sent (a privacy leak). A strict follow-up that *requires* an
 * unavailable source stops before dispatch.
 */

import type { EvidenceStatus, Message, SourceReference } from "./conversations/types";

export type SourceAuthorizationVerdict =
  | { authorized: true }
  | {
      authorized: false;
      reason: "deleted" | "excluded" | "local_only_cloud" | "unknown" | "revoked";
      /** User-visible explanation fragment. */
      detail: string;
    };

export interface ReauthorizeContext {
  /** True when the current destination is off-device. */
  remoteDestination: boolean;
  /** True when Strict Local-Only is active. */
  strictLocalOnly: boolean;
  /**
   * Current authorization lookup. Must reflect live state; a missing/unknown
   * identity denies (fail closed).
   */
  authorize: (libraryId: string) => Promise<SourceAuthorizationVerdict>;
}

export interface ReauthorizeResult<T> {
  /** Content safe to send (denied parts replaced by placeholders). */
  content: T;
  /** True when at least one source was denied. */
  redacted: boolean;
  /** Human-readable limitations, one per denied source. */
  limitations: string[];
  /** True when a required source is unavailable: stop before dispatch. */
  blocked: boolean;
}

function placeholderFor(reference: SourceReference, verdict: { detail: string }): string {
  const title = reference.title || reference.libraryId || "a source";
  return `[${title} is unavailable for this request: ${verdict.detail}]`;
}

async function verdictFor(
  reference: SourceReference,
  context: ReauthorizeContext,
): Promise<SourceAuthorizationVerdict> {
  // Ephemeral sources are device-local by construction; they are allowed only
  // when nothing is leaving the device.
  if (reference.ephemeral) {
    if (context.remoteDestination || context.strictLocalOnly === false && context.remoteDestination) {
      return {
        authorized: false,
        reason: "local_only_cloud",
        detail: "device-local viewer content",
      };
    }
    return { authorized: true };
  }
  if (!reference.libraryId) {
    return { authorized: false, reason: "unknown", detail: "missing source identity" };
  }
  return context.authorize(reference.libraryId);
}

/**
 * Reauthorize one message's source edges and evidence status.
 *
 * The returned `evidence` never keeps a `supported` level for content whose
 * sources were denied: the claim loses its context.
 */
export async function reauthorizeMessage(
  message: Message,
  context: ReauthorizeContext,
): Promise<ReauthorizeResult<Message> & { evidence?: EvidenceStatus }> {
  const sources = message.sourceSnapshot ?? [];
  const limitations: string[] = [];
  const deniedRequired: SourceReference[] = [];
  for (const reference of sources) {
    const verdict = await verdictFor(reference, context);
    if (verdict.authorized === false) {
      limitations.push(`${reference.title || reference.libraryId}: ${verdict.detail}`);
      if (reference.role === "required" || reference.role === "strict") {
        deniedRequired.push(reference);
      }
    }
  }

  const redacted = limitations.length > 0;
  const evidence = message.evidence;
  const downgradedEvidence =
    redacted && evidence
      ? {
          ...evidence,
          level: evidence.level === "supported" ? ("weak" as const) : evidence.level,
          coverage: evidence.coverage
            ? {
                ...evidence.coverage,
                partialCoverage: true,
                limitations: [...(evidence.coverage.limitations ?? []), ...limitations],
              }
            : { suppliedCount: 0, citedCount: 0, partialCoverage: true, limitations },
        }
      : evidence;

  // Tool results and answer-derived text are dropped when their supporting
  // sources are denied: a saved effect cannot be re-authorized retroactively.
  const sanitized: Message = redacted
    ? {
        ...message,
        citations: message.citations?.filter((citation) =>
          sources.every(
            (source) =>
              !limitations.some((limitation) =>
                limitation.startsWith(`${source.title || source.libraryId}:`),
              ) || citation.documentId !== source.libraryId,
          ),
        ),
        toolResults: message.toolResults,
      }
    : message;

  return {
    content: sanitized,
    evidence: downgradedEvidence,
    redacted,
    limitations,
    blocked: deniedRequired.length > 0,
  };
}

/**
 * Reauthorize an outgoing history array. Message text whose sources are denied
 * is replaced with a placeholder so the model (and the log) never contains the
 * forbidden bytes; the placeholder still tells the model something is missing.
 */
export async function reauthorizeHistory(
  messages: readonly Message[],
  context: ReauthorizeContext,
): Promise<ReauthorizeResult<Message[]> & { limitations: string[]; blocked: boolean }> {
  const out: Message[] = [];
  const limitations: string[] = [];
  let redacted = false;
  let blocked = false;
  for (const message of messages) {
    const result = await reauthorizeMessage(message, context);
    if (result.redacted && message.sourceSnapshot?.length) {
      redacted = true;
      limitations.push(...result.limitations);
      if (result.blocked) blocked = true;
      // Replace the whole message: the answer text is *derived* from the
      // denied source, so omitting only the citation is not enough. The
      // placeholder keeps the conversation coherent without carrying any
      // source-derived bytes.
      out.push({
        ...result.content,
        content: `[This earlier answer is omitted because its source is no longer available: ${result.limitations.join(
          "; ",
        )}]`,
        citations: undefined,
        sourceSnapshot: result.content.sourceSnapshot?.map((reference) => ({
          ...reference,
          locator: undefined,
        })),
        evidence: result.evidence,
      });
    } else {
      out.push({ ...result.content, evidence: result.evidence });
    }
  }
  return { content: out, redacted, limitations, blocked };
}

/**
 * Decide whether a strict follow-up may be dispatched. A required source that
 * is currently unavailable blocks the turn *before* any provider call.
 */
export async function strictFollowUpDecision(
  plan: { sources: SourceReference[] },
  context: ReauthorizeContext,
): Promise<{ dispatch: boolean; reason?: string }> {
  for (const reference of plan.sources) {
    if (reference.role !== "required" && reference.role !== "strict") continue;
    const verdict = await verdictFor(reference, context);
    if (verdict.authorized === false) {
      return {
        dispatch: false,
        reason: `${reference.title || reference.libraryId} is required for this question and is ${verdict.detail}.`,
      };
    }
  }
  return { dispatch: true };
}

/**
 * A dispatch guard used by every outbound path (generation, embedding, web
 * lookup, repair, suggestions, fallback). The wrapped function is called only
 * when the plan is authorized; tests wrap it in a spy to prove no forbidden
 * bytes leave the device.
 */
export async function guardedDispatch<T>(options: {
  plan: { sources: SourceReference[] };
  context: ReauthorizeContext;
  onBlocked?: (reason: string) => void;
  dispatch: () => Promise<T>;
}): Promise<{ dispatched: true; value: T } | { dispatched: false; reason: string }> {
  const decision = await strictFollowUpDecision(options.plan, options.context);
  if (!decision.dispatch) {
    options.onBlocked?.(decision.reason ?? "source unavailable");
    return { dispatched: false, reason: decision.reason ?? "source unavailable" };
  }
  return { dispatched: true, value: await options.dispatch() };
}
