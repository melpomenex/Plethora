import { invokeCommand, isTauri } from "../lib/tauri";
import {
  snapshotMatchesKnobs,
  type DaqeQueueSnapshot,
  type ProjectedQueue,
} from "../lib/daqe/snapshot";
import type { DaqeKnobs } from "../lib/daqe/knobs";
import type { DaqeHttpProvider } from "../api/ai";

/**
 * The ranking client.
 *
 * Split out of the store so the "serve the previous order, swap on completion"
 * behaviour can be tested without a store, a Tauri host, or a database. The store
 * owns *when* to rank; this owns *how* to ask and how to interpret the answer.
 */

/** One item's model-derived inputs, as `rank_queue` expects them. */
export interface ModelInput {
  itemId: string;
  complexity?: number;
  topicSimilarityToRecent?: number;
  topicMatches?: string[];
  clusterBoost?: number;
  /**
   * The decision model's judgement of this item against the session goal.
   *
   * Session-dependent, so it travels with the request rather than living in the
   * content-hash cache: the same item under a different goal deserves a different
   * answer.
   */
  goalAlignment?: number;
}

/** The session goal, as `rank_queue` expects it. */
export interface RankGoal {
  /** The user's stated objective, or `null` for no goal. */
  goal: string | null;
  /** Tags the user has focused this session. */
  focusTags?: string[];
}

function knobsPayload(knobs: DaqeKnobs): Record<string, number> {
  return { ...knobs };
}

/**
 * Whether a payload is a usable snapshot.
 *
 * A shape check rather than a blind cast: a backend that answers with something
 * unexpected (an error object, a future payload version, a truncated response)
 * must read as "no ranking available" and leave the previous order standing, not
 * as a snapshot whose `ranked` is undefined and which throws three components
 * later.
 */
function isSnapshotShape(value: unknown): value is DaqeQueueSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DaqeQueueSnapshot>;
  return (
    typeof candidate.id === "string" &&
    Array.isArray(candidate.ranked) &&
    Array.isArray(candidate.top10) &&
    candidate.knobs !== null &&
    typeof candidate.knobs === "object"
  );
}

/**
 * Ask the backend to rank the due pool.
 *
 * Returns `null` on any failure — no Tauri host, a rejected invoke, a malformed
 * payload. Every one of those leaves the caller with the previous order, which is
 * a valid order. A ranking is an optimisation of presentation, never a
 * precondition for showing the queue, so it must not be able to fail the surface.
 *
 * `sessionGoal` rides every call rather than being read from a snapshot, because the
 * ranker needs the goal the user is looking at *now*. Absence is sent as `null`, not
 * as `""`, so the backend can tell "no goal" apart from "a goal that matched nothing".
 */
export async function rankQueue(
  knobs: DaqeKnobs,
  modelInputs: ModelInput[] = [],
  collectionId?: string | null,
  sessionGoal?: RankGoal | null,
): Promise<DaqeQueueSnapshot | null> {
  if (!isTauri()) return null;
  try {
    const snapshot = await invokeCommand<unknown>("rank_queue", {
      collectionId: collectionId ?? null,
      goal: sessionGoal?.goal ?? null,
      focusTags: sessionGoal?.focusTags ?? null,
      knobs: knobsPayload(knobs),
      modelInputs,
    });
    return isSnapshotShape(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}

/** The last stored snapshot for these knobs, or `null`. */
export async function getLastQueueSnapshot(
  knobs: DaqeKnobs,
  collectionId?: string | null,
): Promise<DaqeQueueSnapshot | null> {
  if (!isTauri()) return null;
  try {
    const stored = await invokeCommand<unknown>("get_last_queue_snapshot", {
      collectionId: collectionId ?? null,
      knobs: knobsPayload(knobs),
    });
    return isSnapshotShape(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Whether a snapshot describes the knobs currently in effect.
 *
 * The gate on reuse. A snapshot produced under different knobs is a different
 * ordering; serving it would show the user a ranking their settings do not
 * describe, which is worse than serving no snapshot at all.
 */
export function isSnapshotCurrent(
  snapshot: DaqeQueueSnapshot | null,
  knobs: DaqeKnobs,
): boolean {
  return snapshot !== null && snapshotMatchesKnobs(snapshot, knobsPayload(knobs));
}

export type { DaqeQueueSnapshot, ProjectedQueue };
/**
 * The second ranking pass: the only path that contacts a decision model.
 *
 * Separate from `rankQueue` because that one is synchronous inside the 150 ms top-ten
 * budget and a network round trip cannot live in there. The first pass publishes
 * immediately; this one refines the order when the model answers, and returns `null`
 * whenever it declines or fails — leaving the first pass's snapshot standing, which is
 * a valid ranking.
 */

/**
 * How long to wait after the last change before asking the model.
 *
 * Long enough that dragging a slider produces one request rather than one per pixel,
 * short enough that the refinement has landed before the user reaches the end of the
 * list they are looking at.
 */
export const DECISION_RERANK_DEBOUNCE_MS = 400;

/** Which decision provider is configured, and whether it may be contacted. */
export interface DecisionProviderConfig {
  provider: DaqeHttpProvider;
  baseUrl?: string;
  model?: string;
  cloudflareAccountId?: string | null;
  allowRemote: boolean;
  timeoutMs?: number;
}

/**
 * Whether a second pass would do anything at all.
 *
 * Asked before scheduling, so an unconfigured or un-opted-in provider costs no round
 * trip — and so "not configured" stays distinguishable from "configured but declined".
 */
export async function decisionModelAvailability(
  decision: DecisionProviderConfig | null,
): Promise<boolean> {
  if (!isTauri() || !decision) return false;
  try {
    const result = await invokeCommand<{ available: boolean }>(
      "decision_model_availability",
      { decision: { ...decision, cloudflareAccountId: decision.cloudflareAccountId ?? null } },
    );
    return result?.available === true;
  } catch {
    return false;
  }
}

/**
 * Re-rank with the model's judgements folded in. Order only — never membership.
 *
 * Returns `null` on any failure or refusal, exactly as `rankQueue` does: an
 * unavailable model is the normal state of a local-first installation, and must never
 * be able to break the surface.
 */
export async function rankQueueWithDecision(
  knobs: DaqeKnobs,
  decision: DecisionProviderConfig,
  sessionGoal?: RankGoal | null,
  collectionId?: string | null,
  candidates?: number,
): Promise<DaqeQueueSnapshot | null> {
  if (!isTauri()) return null;
  try {
    const snapshot = await invokeCommand<unknown>("rank_queue_with_decision", {
      collectionId: collectionId ?? null,
      goal: sessionGoal?.goal ?? null,
      focusTags: sessionGoal?.focusTags ?? null,
      knobs: knobsPayload(knobs),
      decision: { ...decision, cloudflareAccountId: decision.cloudflareAccountId ?? null },
      candidates: candidates ?? null,
    });
    return isSnapshotShape(snapshot) ? snapshot : null;
  } catch {
    return null;
  }
}
