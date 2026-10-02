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

/**
 * A candidate whose rank came from the DAQE composite ranker.
 *
 * `priority` is the composite score, which is a *relative* ordering with no
 * absolute zero — two pools of different difficulty produce different score
 * distributions. The proportion bonus below is therefore expressed as a share of
 * the observed score spread rather than as a flat point value, which is what
 * makes the bias mean the same thing at every scale.
 */
export interface RankedScrollItem extends PrioritizableScrollItem {
  /** The composite `S(i)`. Overrides `engagementScore` as the ordering key. */
  priority?: number;
  /** The topics this item's interleave penalty was measured against, if any. */
  topics?: string[];
}

/** The observed score spread, used to scale the proportion bonus. */
export interface RankedSortScale {
  min: number;
  max: number;
}

/**
 * The score spread of a ranked pool.
 *
 * A degenerate pool (one item, or every item scoring identically) yields a range
 * of 0. Callers must treat that as "no spread" and order on the composite alone
 * rather than dividing by it.
 */
export function measureRankedScale(items: ReadonlyArray<{ priority?: number }>): RankedSortScale {
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    const value = item.priority ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 };
  return { min, max };
}

/**
 * The interleave penalty, as a share of the pool's score spread.
 *
 * DAQE's `interleavingDiversity` is a 0-1 knob applied inside the composite, so by
 * the time an item reaches here its penalty is already in the score. This is the
 * *second*, coarser pass, and it does something the composite cannot: it
 * penalises an item against what has **already been placed** in this session.
 * Per-item scores cannot see the run forming around them — five similar items
 * each score individually fine — so without a sequential pass a whole topic can
 * still arrive as one undifferentiated block.
 *
 * Expressed as a fraction of the observed spread rather than as flat points,
 * because the composite has no absolute scale: a fixed point bonus would erase the
 * ordering on a narrow pool and vanish on a wide one.
 */
export function interleaveShare(config: {
  /** The DAQE `interleavingDiversity` knob, 0-1. */
  diversity: number;
  /** Weight of the stable per-id jitter, carried over unchanged. */
  jitterWeight: number;
}): { penaltyShare: number; jitterWeight: number } {
  const diversity = Math.min(1, Math.max(0, config.diversity));
  return {
    // Capped at 0.5. Above half the spread the penalty could reorder items the
    // ranker deliberately ordered, which is the ranker's job, not this pass's.
    penaltyShare: 0.5 * diversity,
    jitterWeight: config.jitterWeight,
  };
}

/**
 * Order DAQE-ranked scroll items: composite score (primary), less a
 * topic-repetition penalty against the items already placed, plus stable per-id
 * jitter.
 *
 * Sequential, like the legacy combined sort it parallels, because the penalty
 * depends on the running placed set. O(n·k) over the session length rather than
 * the legacy sort's O(n²) over the whole pool — a session is a few hundred items,
 * not the whole queue.
 *
 * Guarantees: a higher composite score still wins unless the repetition penalty
 * is decisive; the order is stable for an unchanged pool; and a single-item or
 * single-topic pool is ordered by score alone, because nothing can repeat.
 */
export function orderRankedScrollItems<T extends RankedScrollItem>(
  items: T[],
  options: { diversity: number; jitterWeight?: number } = { diversity: 0.2 },
): T[] {
  if (items.length <= 1) return [...items];

  const { penaltyShare, jitterWeight } = interleaveShare({
    diversity: options.diversity,
    jitterWeight: options.jitterWeight ?? DEFAULT_COMBINED_SORT_CONFIG.jitterWeight,
  });
  const scale = measureRankedScale(items);
  const spread = scale.max - scale.min;

  // No measurable spread: every item scored the same, so there is no ordering to
  // preserve and the penalty would be pure noise. Fall back to the stable jitter
  // for a deterministic but arbitrary order.
  if (spread <= 0) {
    return [...items]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => stableJitter(a.item.id) - stableJitter(b.item.id) || a.index - b.index)
      .map((entry) => entry.item);
  }

  const normalize = (value: number | undefined) => ((value ?? scale.min) - scale.min) / spread;
  const jitter = items.map((item) => jitterWeight * stableJitter(item.id));

  // The running set of placed topics, as a count per topic so "how much of what I
  // have seen is this?" is a division rather than a set scan.
  const placedTopicCounts = new Map<string, number>();
  let placed = 0;

  const remaining = new Set(items.map((_, i) => i));
  const result: T[] = [];

  while (remaining.size > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;

    for (const index of remaining) {
      const item = items[index];
      const overlap = (item.topics ?? []).reduce(
        (sum, topic) => sum + (placedTopicCounts.get(topic) ?? 0),
        0,
      );
      // Overlap as a share of everything placed so far: 0 for the first item,
      // rising toward 1 as the session becomes one long run of that topic.
      const repetition = placed > 0 ? overlap / placed : 0;
      const score = normalize(item.priority ?? item.engagementScore) + jitter[index] - penaltyShare * repetition;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    remaining.delete(bestIndex);
    for (const topic of items[bestIndex].topics ?? []) {
      placedTopicCounts.set(topic, (placedTopicCounts.get(topic) ?? 0) + 1);
    }
    placed += 1;
    result.push(items[bestIndex]);
  }

  return result;
}
