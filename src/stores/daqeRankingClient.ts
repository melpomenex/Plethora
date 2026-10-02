import { invokeCommand, isTauri } from "../lib/tauri";
import {
  snapshotMatchesKnobs,
  type DaqeQueueSnapshot,
  type ProjectedQueue,
} from "../lib/daqe/snapshot";
import type { DaqeKnobs } from "../lib/daqe/knobs";

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
 */
export async function rankQueue(
  knobs: DaqeKnobs,
  modelInputs: ModelInput[] = [],
  collectionId?: string | null,
): Promise<DaqeQueueSnapshot | null> {
  if (!isTauri()) return null;
  try {
    const snapshot = await invokeCommand<unknown>("rank_queue", {
      collectionId: collectionId ?? null,
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