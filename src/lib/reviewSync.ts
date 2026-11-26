import type { LearningItem } from "../api/learning-items";
import type { QueueItem } from "../types/queue";
import { useQueueStore } from "../stores/queueStore";
import { useReviewStore } from "../stores/reviewStore";

/**
 * Structural LearningItem shape compatible with both `api/learning-items` and
 * `api/review` LearningItem definitions (which differ slightly in `item_type` casing).
 */
export type SyncableLearningItem = Omit<LearningItem, "item_type" | "state"> & {
  item_type?: string;
  state?: string;
};

export type ReviewSyncSource =
  | "reviewStore"
  | "scrollMode"
  | "quickReview"
  | "zenReview"
  | "unknown";

export type ReviewSyncEvent =
  | {
      type: "review-committed";
      item: SyncableLearningItem;
      canonicalId: string;
      eligible: boolean;
      source: ReviewSyncSource;
      buryExtractId: string | null;
      revision: number;
    }
  | {
      type: "review-undone";
      item: SyncableLearningItem;
      canonicalId: string;
      eligible: boolean;
      source: ReviewSyncSource;
      revision: number;
    };

export type ReviewSyncListener = (event: ReviewSyncEvent) => void;

const listeners = new Set<ReviewSyncListener>();
let syncRevision = 0;

/**
 * Tracks the latest committed scheduling outcome per canonical learning item ID
 * along with the syncRevision at commit time, so in-flight `getDueItems` calls
 * that started before a commit cannot resurrect an ineligible card.
 */
const recentCommitStates = new Map<string, { eligible: boolean; revision: number }>();

export function canonicalLearningItemId(rawId: string): string {
  return rawId.replace(/^flashcard-/, "");
}

export function isItemDueNow(dueDate?: string | null, nowMs: number = Date.now()): boolean {
  if (!dueDate) return true;
  const parsed = Date.parse(dueDate);
  if (Number.isNaN(parsed)) return true;
  return parsed <= nowMs;
}

export function isLearningItemEligibleForDueQueue(
  item: Pick<LearningItem, "due_date" | "is_suspended">,
  nowMs: number = Date.now()
): boolean {
  return !item.is_suspended && isItemDueNow(item.due_date, nowMs);
}

export function matchesQueueLearningItem(item: QueueItem, canonicalId: string): boolean {
  if (item.itemType !== "learning-item") return false;
  const normalizedItemId = canonicalLearningItemId(item.id);
  const normalizedLearningId = item.learningItemId
    ? canonicalLearningItemId(item.learningItemId)
    : null;
  return normalizedItemId === canonicalId || normalizedLearningId === canonicalId;
}

export function getReviewSyncRevision(): number {
  return syncRevision;
}

/**
 * Filter a fetched `getDueItems` list against any review commits that occurred
 * *after* `startedAtRevision` so a stale in-flight fetch cannot resurrect a
 * card that was just rated into the future.
 */
export function filterStaleDueLearningItems<T extends { id: string }>(
  items: T[],
  startedAtRevision: number
): T[] {
  if (startedAtRevision >= syncRevision || recentCommitStates.size === 0) {
    return items;
  }
  return items.filter((item) => {
    const canonicalId = canonicalLearningItemId(item.id);
    const recent = recentCommitStates.get(canonicalId);
    if (!recent || recent.revision <= startedAtRevision) {
      return true;
    }
    return recent.eligible;
  });
}

export function subscribeReviewSync(listener: ReviewSyncListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitReviewSync(event: ReviewSyncEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("[reviewSync] Listener error:", error);
    }
  }
}

export function reconcileScheduledReview(
  updatedItem: SyncableLearningItem,
  options?: {
    source?: ReviewSyncSource;
    buryExtractId?: string | null;
    nowMs?: number;
  }
): ReviewSyncEvent {
  const source = options?.source ?? "unknown";
  const canonicalId = canonicalLearningItemId(updatedItem.id);
  const eligible = isLearningItemEligibleForDueQueue(updatedItem, options?.nowMs);
  syncRevision += 1;
  recentCommitStates.set(canonicalId, { eligible, revision: syncRevision });

  // 1. Reconcile Reading Queue store (useQueueStore)
  const queueStore = useQueueStore.getState();
  const queueItems = Array.isArray(queueStore?.items) ? queueStore.items : [];
  const matchingIds = queueItems
    .filter((qi) => matchesQueueLearningItem(qi, canonicalId))
    .map((qi) => qi.id);

  if (eligible) {
    if (matchingIds.length > 0 && typeof queueStore?.applyItemDeltas === "function") {
      queueStore.applyItemDeltas(matchingIds, {
        dueDate: updatedItem.due_date,
        interval: updatedItem.interval,
      });
    }
  } else if (typeof queueStore?.removeItemsLocally === "function") {
    const idsToRemove = matchingIds.length > 0 ? matchingIds : [canonicalId];
    queueStore.removeItemsLocally(idsToRemove);
  }
  if (typeof queueStore?.invalidateQueueGeneration === "function") {
    queueStore.invalidateQueueGeneration();
  }

  // 2. Reconcile Review View store (useReviewStore) when triggered externally
  if (source !== "reviewStore") {
    const reviewStore = useReviewStore.getState();
    if (typeof reviewStore?.reconcileExternalReview === "function") {
      reviewStore.reconcileExternalReview(updatedItem, options?.nowMs);
    }
  }

  // 3. Notify mounted Scroll Mode / other listeners
  const event: ReviewSyncEvent = {
    type: "review-committed",
    item: updatedItem,
    canonicalId,
    eligible,
    source,
    buryExtractId: options?.buryExtractId ?? null,
    revision: syncRevision,
  };
  emitReviewSync(event);
  return event;
}

export function reconcileReviewUndo(
  restoredItem: SyncableLearningItem,
  options?: {
    source?: ReviewSyncSource;
    nowMs?: number;
  }
): ReviewSyncEvent {
  const source = options?.source ?? "unknown";
  const canonicalId = canonicalLearningItemId(restoredItem.id);
  const eligible = isLearningItemEligibleForDueQueue(restoredItem, options?.nowMs);
  syncRevision += 1;
  recentCommitStates.set(canonicalId, { eligible, revision: syncRevision });

  const queueStore = useQueueStore.getState();
  if (typeof queueStore?.invalidateQueueGeneration === "function") {
    queueStore.invalidateQueueGeneration();
  }
  if (queueStore?.hasCompletedFirstLoad && typeof queueStore?.reloadForCurrentMode === "function") {
    void queueStore.reloadForCurrentMode();
  }

  const event: ReviewSyncEvent = {
    type: "review-undone",
    item: restoredItem,
    canonicalId,
    eligible,
    source,
    revision: syncRevision,
  };
  emitReviewSync(event);
  return event;
}

/** Test-only helper to reset module-level sync revision state between tests. */
export function _resetReviewSyncForTests(): void {
  syncRevision = 0;
  recentCommitStates.clear();
  listeners.clear();
}
