/**
 * Priority ordering for Scroll Mode sessions.
 *
 * Lives here rather than inline in QueueScrollPage so the rule is testable
 * without mounting a ~4000-line component (same reasoning as
 * `queueScrollBudget.ts`).
 *
 * This replaced the type-even-spacing `interleaveScrollItems` + engagement
 * reshuffle as the primary arrangement. Priority is the ordering principle:
 * higher-priority items surface first, with a gentle variety
 * guard so a run of equally-prioritized cards doesn't cluster.
 */

export interface PrioritizableScrollItem {
  id: string;
  type: "document" | "rss" | "flashcard" | "extract" | "podcast";
  /** Priority score; higher surfaces earlier. */
  engagementScore?: number;
}

/** Default cap on consecutive items of the same type. */
export const MAX_SAME_TYPE_CONSECUTIVE = 3;

/**
 * Order scroll items by priority (engagementScore, desc) with a gentle variety
 * guard: no more than `maxSameTypeConsecutive` items of the same type appear in
 * a row. The guard only breaks long same-type runs; it does NOT reorder items
 * across priority tiers, so a higher-priority document still precedes a
 * lower-priority flashcard.
 *
 * Within a priority tier (equal engagementScore), ties break by the item's id
 * for determinism across renders.
 */
export function orderScrollItemsByPriority<T extends PrioritizableScrollItem>(
  items: T[],
  maxSameTypeConsecutive: number = MAX_SAME_TYPE_CONSECUTIVE
): T[] {
  // Always sort by priority desc; stable tiebreak by id for determinism.
  // (The variety guard below is what's gated on length, not the sort itself —
  // a 2-item session must still put the higher-priority item first.)
  const sorted = [...items].sort((a, b) => {
    const scoreDiff = (b.engagementScore ?? 0) - (a.engagementScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.id.localeCompare(b.id);
  });

  // The variety guard only matters once the session is long enough to form a
  // run longer than the cap; short sessions are returned in priority order.
  if (sorted.length <= maxSameTypeConsecutive) return sorted;

  // Variety guard: walk the sorted list and defer items that would extend a
  // same-type run past the limit. Deferred items are re-inserted at the next
  // legal slot (a position where the surrounding types differ), preserving
  // their priority rank as closely as possible.
  const result: T[] = [];
  const deferred: T[] = [];
  let lastType: T["type"] | null = null;
  let streak = 0;

  for (const item of sorted) {
    if (item.type === lastType) {
      if (streak >= maxSameTypeConsecutive) {
        deferred.push(item);
        continue;
      }
      streak++;
    } else {
      lastType = item.type;
      streak = 1;
    }
    result.push(item);
  }

  // Place deferred items at the next slot where they won't restart the streak.
  for (const item of deferred) {
    let placed = false;
    for (let i = 0; i < result.length; i++) {
      const cur = result[i]?.type;
      const next = result[i + 1]?.type ?? null;
      if (cur !== item.type && next !== item.type) {
        result.splice(i + 1, 0, item);
        placed = true;
        break;
      }
    }
    if (!placed) result.push(item);
  }

  return result;
}

// ── Combined-criterion sort ────────────────────────────────────────────────
//
// The priority sort above is the basic arrangement principle. The combined
// criterion refines it with a proportion-of-topics-vs-items bias and
// a stable per-id jitter. Higher combined score = earlier in the session.
//
// The proportion term here is a tanh-scaled type-alternation bonus; the
// composition sliders remain the manual proxy for the count split. The
// priority term (primary ordering) and the stable-jitter term are faithful.

// ── Position ↔ priority mapping ───────────────────────────────────────────
//
// Mirrors the Rust `algorithms/priority_queue::priority_from_position` /
// `position_from_priority`. Position is 1-based (1 = front / highest
// importance); priority is the 0-100 derived value. Used to show each
// element's relative queue position alongside its percentage priority.

/** Derive a 0-100 priority from a 1-based position in a queue of `size`. */
export function priorityFromPosition(position: number, size: number): number {
  if (size <= 1) return 0;
  const pos = Math.max(1, position);
  return ((pos - 1) / (size - 1)) * 100;
}

/** The inverse: reposition an element to match a desired 0-100 priority. */
export function positionFromPriority(priority: number, size: number): number {
  if (size <= 1) return 1;
  const clamped = Math.min(100, Math.max(0, priority));
  return Math.round((clamped / 100) * (size - 1)) + 1;
}

/**
 * Take up to `quota` items of each type, walking the list IN ORDER and keeping
 * that order.
 *
 * Used when Scroll Mode's rows came from the Queue list: the list is the
 * session's preview, so the composition sliders may thin it but must not
 * re-sort it. Returns the kept items plus the per-type shortfall, so the caller
 * can decide what (if anything) to top up from outside the list.
 *
 * RSS articles draw from the Documents share, matching `composeSession`.
 */
export function selectByQuotaInOrder<T extends PrioritizableScrollItem>(
  items: T[],
  quota: { documents: number; extracts: number; flashcards: number },
): { selected: T[]; shortfall: { documents: number; extracts: number; flashcards: number } } {
  const remaining = { ...quota };
  const keyOf = (type: T["type"]) =>
    type === "flashcard" ? "flashcards" : type === "extract" ? "extracts" : "documents";

  const selected: T[] = [];
  for (const item of items) {
    const key = keyOf(item.type);
    if (remaining[key] <= 0) continue;
    remaining[key] -= 1;
    selected.push(item);
  }

  return {
    selected,
    shortfall: {
      documents: Math.max(0, remaining.documents),
      extracts: Math.max(0, remaining.extracts),
      flashcards: Math.max(0, remaining.flashcards),
    },
  };
}

/** Classify a scroll item as a Topic (reading) or Item (review) for the
 *  proportion bias. Documents/extracts/RSS/podcasts are Topics; flashcards
 *  are Items. */
function asSortElementType(
  type: PrioritizableScrollItem["type"],
): "topic" | "item" {
  return type === "flashcard" ? "item" : "topic";
}

/** Deterministic per-id jitter in [-1, 1), mirroring the Rust
 *  `priority_queue::stable_jitter` and the frontend's `getStableRandom`. Same
 *  id → same value, every run. */
export function stableJitter(id: string): number {
  // FNV-1a hash → [0,1) → [-1,1).
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < id.length; i++) {
    hash ^= BigInt(id.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const unit = Number(hash % 1_000_003n) / 1_000_003;
  return unit * 2 - 1;
}

/** Configuration for the combined-criterion sort. */
export interface CombinedSortConfig {
  /** Weight of the topic/item proportion bias (gentle nudge toward a mix). */
  proportionWeight: number;
  /** Weight of the stable per-id jitter (breaks equal-priority ties). */
  jitterWeight: number;
  /**
   * Target share of topic (reading) items in the placed mix, in [0, 1].
   * Defaults to 0.5 (parity), which reproduces the historical behaviour
   * exactly. A session whose composed counts are single-type gets 0 or 1,
   * where the proportion bias short-circuits and priority alone orders it.
   */
  targetTopicShare?: number;
}

export const DEFAULT_COMBINED_SORT_CONFIG: CombinedSortConfig = {
  proportionWeight: 15,
  jitterWeight: 5,
  targetTopicShare: 0.5,
};

/**
 * Weights for the Queue list, whose priority key is `getPriorityScore` on a
 * 0-100 scale rather than the backend's 0-10 `priority`.
 *
 * The defaults above are calibrated for the 0-10 band, where a 15-point
 * proportion bonus dwarfs the priority spread. Reused verbatim on a 0-100
 * score they become negligible, and the list rebuilds the very type blocks
 * this sort exists to break up (every card ~73, every document ~59 → 30 cards
 * before the first document). Scaled up: the proportion bonus clears the
 * cross-type gap within a couple of items, while the smaller jitter still only
 * breaks ties inside a priority tier instead of reshuffling across one.
 */
export const QUEUE_LIST_SORT_CONFIG: CombinedSortConfig = {
  proportionWeight: 20,
  jitterWeight: 3,
};

/**
 * Order scroll items by combined criterion: priority (primary) +
 * a topic/item proportion bias + stable per-id jitter. Higher priority still
 * surfaces first; the proportion bias interleaves reading and review so a
 * 90%-items queue doesn't present 90% items up front; the jitter makes equal-
 * priorities vary deterministically across sessions but not across re-renders.
 *
 * This is the Phase 3 refinement of `orderScrollItemsByPriority`. It runs once
 * at session build (not per render), preserving resumability.
 */
export function orderScrollItemsByCombinedCriterion<T extends PrioritizableScrollItem>(
  items: T[],
  config: CombinedSortConfig = DEFAULT_COMBINED_SORT_CONFIG,
): T[] {
  if (items.length <= 1) return [...items];

  // Precompute the per-item invariant part of each candidate's score once,
  // instead of recomputing it O(n) times inside the selection loop below.
  // `stableJitter` is a full FNV-1a BigInt hash of the id (pure, invariant per
  // item), and is the dominant cost of an O(n²) greedy selection. Hoisting
  // priority + jitter (and the topic/item classification) out of the inner loop
  // removes ~n² redundant hashes and keeps the remaining loop arithmetic-only.
  // The proportion term still depends on the running topicsPlaced/itemsPlaced
  // counts and is recomputed per position, exactly as before.
  const n = items.length;
  const baseScores = new Float64Array(n); // priority + jitter
  const isTopic = new Uint8Array(n); // 1 if asSortElementType(type) === "topic"
  for (let i = 0; i < n; i++) {
    const it = items[i];
    baseScores[i] =
      (it.engagementScore ?? 0) + config.jitterWeight * stableJitter(it.id);
    isTopic[i] = asSortElementType(it.type) === "topic" ? 1 : 0;
  }

  const remaining = new Set(items.map((_, i) => i));
  const result: T[] = [];
  let topicsPlaced = 0;
  let itemsPlaced = 0;

  while (remaining.size > 0) {
    let bestRemainingIdx = -1;
    let bestScore = -Infinity;
    // Imbalance per type this position; one of these is added to the baseScore.
    // The bias pulls the placed mix toward `targetTopicShare` (topics) instead
    // of a fixed 50/50: a type in deficit of its target share gets the bonus,
    // so a 60/40 session reads 60/40 while scrolling, not only in its totals.
    // The deficit is measured in placed-item units (`placed − placed/target`),
    // which makes the 0.5 default reproduce the historical parity terms
    // exactly. With a target of 0 or 1 the session is single-type —
    // short-circuit so priority alone orders it.
    const placed = topicsPlaced + itemsPlaced;
    const targetTopicShare = config.targetTopicShare ?? 0.5;
    const topicImbalance =
      targetTopicShare > 0 && targetTopicShare < 1
        ? Math.max(0, placed - topicsPlaced / targetTopicShare)
        : 0;
    const itemImbalance =
      targetTopicShare > 0 && targetTopicShare < 1
        ? Math.max(0, placed - itemsPlaced / (1 - targetTopicShare))
        : 0;
    const topicProportion = config.proportionWeight * Math.tanh(topicImbalance);
    const itemProportion = config.proportionWeight * Math.tanh(itemImbalance);
    for (const i of remaining) {
      const score = baseScores[i] + (isTopic[i] ? topicProportion : itemProportion);
      if (score > bestScore) {
        bestScore = score;
        bestRemainingIdx = i;
      }
    }
    remaining.delete(bestRemainingIdx);
    if (isTopic[bestRemainingIdx]) topicsPlaced++;
    else itemsPlaced++;
    result.push(items[bestRemainingIdx]);
  }

  return result;
}
