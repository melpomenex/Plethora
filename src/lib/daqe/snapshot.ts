/**
 * Projecting a ranking snapshot into the queue store.
 *
 * A snapshot arrives with the full ranked order plus a per-term breakdown for
 * every entry. Only the visible slice needs its breakdown materialised, so this
 * keeps a lookup map keyed by item id and resolves lazily: building a breakdown
 * map for a 5 000-item pool on every re-rank would put work on the UI thread for
 * entries nobody looks at.
 *
 * Determinism matters here as much as it does in Rust — the store must not
 * reorder items on its own, or the score a user was shown would not be the score
 * that produced their queue.
 */

import type { QueueItem } from "../../types/queue";

/** Mirrors `TermValue` in `src-tauri/src/models/daqe.rs`. */
export interface TermValue {
  value: number;
  /** `false` means the input signal was absent and `value` is a neutral placeholder. */
  available: boolean;
  /** `true` means a deterministic local stand-in supplied the value. */
  defaulted: boolean;
}

/** Mirrors `TermBreakdown` in `src-tauri/src/models/daqe.rs`. */
export interface TermBreakdown {
  srsUrgency: TermValue;
  srsWeight: number;
  goalRelevance: TermValue;
  goalWeight: number;
  energyFit: TermValue;
  energyWeight: number;
  interleavePenalty: TermValue;
  interleaveWeight: number;
  frictionPenalty: TermValue;
  frictionWeight: number;
  effectiveEnergyTarget: number;
  energyDownshiftReason?: string;
  interleaveAgainst: string[];
}

/** Mirrors `RankedItem`. */
export interface RankedQueueItem {
  item: QueueItem;
  score: number;
  breakdown: TermBreakdown;
  inputIndex: number;
}

/** Mirrors `QueueSnapshot`. */
export interface DaqeQueueSnapshot {
  id: string;
  collectionId?: string;
  profile: string;
  knobs: Readonly<Record<string, number>>;
  ranked: RankedQueueItem[];
  top10: RankedQueueItem[];
  computedAt: string;
}

export interface ProjectedQueue {
  /** The items in ranked order. Never empty just because a snapshot is missing. */
  ordered: QueueItem[];
  /** Ids in ranked order, for position lookups without walking `ordered`. */
  orderedIds: string[];
  /** Breakdown by item id, populated for the visible slice only. */
  breakdowns: Map<string, TermBreakdown>;
  /** The energy target actually used, if a snapshot is present. */
  effectiveEnergyTarget?: number;
  energyDownshiftReason?: string;
  /** The knobs the snapshot was computed under. */
  knobs?: Readonly<Record<string, number>>;
}

/**
 * Whether `snapshot` was computed under exactly `knobs`.
 *
 * Snapshot reuse keys off this. A mismatch means the stored order was produced by
 * different settings, so it is kept as the display fallback but is not treated as
 * the current ranking.
 */
export function snapshotMatchesKnobs(
  snapshot: Pick<DaqeQueueSnapshot, "knobs">,
  knobs: Readonly<Record<string, number>>,
): boolean {
  const keys = Object.keys(knobs);
  if (Object.keys(snapshot.knobs).length !== keys.length) return false;
  return keys.every((key) => snapshot.knobs[key] === knobs[key]);
}

/**
 * Project a snapshot onto the items the store already holds.
 *
 * `items` is the store's current pool, `snapshot` the incoming ranking. Items the
 * snapshot does not mention are kept at the end in their existing relative order,
 * because the snapshot ranks a candidate pool and the store may hold more than the
 * pool covered (for example a filter the ranker does not see). Dropping them would
 * silently delete items from the user's view.
 */
export function projectSnapshot(
  items: QueueItem[],
  snapshot: DaqeQueueSnapshot | null,
  visibleCount = 50,
): ProjectedQueue {
  if (!snapshot) {
    return {
      ordered: items.slice(),
      orderedIds: items.map((item) => item.id),
      breakdowns: new Map(),
    };
  }

  const byId = new Map<string, QueueItem>(items.map((item) => [item.id, item]));
  const ordered: QueueItem[] = [];
  const orderedIds: string[] = [];
  const breakdowns = new Map<string, TermBreakdown>();
  const placed = new Set<string>();

  for (const entry of snapshot.ranked) {
    const item = byId.get(entry.item.id);
    if (!item) continue;
    if (placed.has(item.id)) continue;
    placed.add(item.id);
    ordered.push(item);
    orderedIds.push(item.id);
    // Only the visible slice carries a breakdown: the popover cannot ask about an
    // item that is not rendered.
    if (ordered.length <= visibleCount) {
      breakdowns.set(item.id, entry.breakdown);
    }
  }

  // Anything the ranker did not place keeps its existing relative order, after
  // the ranked items.
  for (const item of items) {
    if (placed.has(item.id)) continue;
    ordered.push(item);
    orderedIds.push(item.id);
  }

  const first = snapshot.ranked[0];
  return {
    ordered,
    orderedIds,
    breakdowns,
    effectiveEnergyTarget: first?.breakdown.effectiveEnergyTarget,
    energyDownshiftReason: first?.breakdown.energyDownshiftReason,
    knobs: snapshot.knobs,
  };
}

/** The breakdown for one item, or `undefined` when it was never projected. */
export function breakdownFor(
  projected: ProjectedQueue,
  itemId: string,
): TermBreakdown | undefined {
  return projected.breakdowns.get(itemId);
}

/** A 1-based queue position, for display. Absent items report `undefined`. */
export function positionOf(
  projected: ProjectedQueue,
  itemId: string,
): number | undefined {
  const index = projected.orderedIds.indexOf(itemId);
  return index === -1 ? undefined : index + 1;
}

/**
 * Whether a term was measured, as opposed to defaulted or untracked.
 *
 * The popover uses this to decide what to say about a number: a defaulted value
 * must not be presented as though a model produced it.
 */
export function termStatus(term: TermValue): "measured" | "defaulted" | "untracked" {
  if (!term.available) return "untracked";
  return term.defaulted ? "defaulted" : "measured";
}