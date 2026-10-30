/**
 * sessionTransition.ts
 *
 * Pure identity-based transition and reconciliation helper for active study/review sessions
 * (ReviewStore, QueueScrollPage, Optimal sessions).
 *
 * Implements R06 / R07 requirements:
 * - Current identity and successor selection by stable ID rather than drifting array index.
 * - Distinct accounting for reviewed, removed, and remaining items.
 * - Committed deletion barriers preventing late refresh resurrection.
 * - Generation-based rejection of stale background hydration/refresh results.
 * - Reveal revision tracking to prevent answer state bleeding across successors.
 * - Undo restoration without current position theft.
 */

export interface IdentifiableItem {
  id: string;
}

export interface SessionState<T extends IdentifiableItem> {
  items: T[];
  currentId: string | null;
  reviewedIds: Set<string>;
  removedIds: Set<string>;
  revealRevision: number;
  generation: number;
}

export interface SessionRemovalResult<T extends IdentifiableItem> {
  nextItems: T[];
  nextCurrentId: string | null;
  nextIndex: number;
  reviewedIds: Set<string>;
  removedIds: Set<string>;
  revealRevision: number;
  generation: number;
  isCompleted: boolean;
  advancedFrom: string | null;
}

export interface SessionRefreshResult<T extends IdentifiableItem> {
  nextItems: T[];
  nextCurrentId: string | null;
  nextIndex: number;
  accepted: boolean;
  generation: number;
}

export interface SessionUndoResult<T extends IdentifiableItem> {
  nextItems: T[];
  nextCurrentId: string | null;
  nextIndex: number;
  removedIds: Set<string>;
  revealRevision: number;
}

export interface SessionRatingResult<T extends IdentifiableItem> {
  nextItems: T[];
  nextCurrentId: string | null;
  nextIndex: number;
  reviewedIds: Set<string>;
  revealRevision: number;
  isCompleted: boolean;
}

/**
 * Creates an initial session state from an items array.
 */
export function createSessionState<T extends IdentifiableItem>(
  items: T[],
  initialCurrentId?: string | null,
  initialGeneration: number = 1
): SessionState<T> {
  const currentId =
    initialCurrentId && items.some((it) => it.id === initialCurrentId)
      ? initialCurrentId
      : items[0]?.id ?? null;

  return {
    items: [...items],
    currentId,
    reviewedIds: new Set<string>(),
    removedIds: new Set<string>(),
    revealRevision: 0,
    generation: initialGeneration,
  };
}

/**
 * Reconcile item deletion / removal from the session.
 *
 * Rules:
 * - If the removed item is the current item, advance to its successor.
 *   If it was the last item, select the preceding survivor.
 *   If no survivors remain, session completes gracefully with null currentId.
 * - If the removed item is NOT the current item, the current identity is strictly preserved.
 * - Removed ID is added to the committed deletion barrier set.
 * - If the item was previously in reviewedIds, it is removed from reviewedIds so
 *   reviewed and removed counts remain strictly distinct.
 */
export function reconcileItemRemoval<T extends IdentifiableItem>(
  state: SessionState<T>,
  removedId: string
): SessionRemovalResult<T> {
  const removedIndex = state.items.findIndex((item) => item.id === removedId);
  if (removedIndex === -1) {
    const currentIndex = state.currentId
      ? state.items.findIndex((item) => item.id === state.currentId)
      : -1;
    return {
      nextItems: state.items,
      nextCurrentId: state.currentId,
      nextIndex: Math.max(0, currentIndex),
      reviewedIds: state.reviewedIds,
      removedIds: state.removedIds,
      revealRevision: state.revealRevision,
      generation: state.generation,
      isCompleted: state.items.length === 0,
      advancedFrom: null,
    };
  }

  const nextItems = state.items.filter((item) => item.id !== removedId);
  const nextRemovedIds = new Set(state.removedIds);
  nextRemovedIds.add(removedId);

  const nextReviewedIds = new Set(state.reviewedIds);
  nextReviewedIds.delete(removedId);

  // Case 1: Session becomes empty
  if (nextItems.length === 0) {
    return {
      nextItems,
      nextCurrentId: null,
      nextIndex: 0,
      reviewedIds: nextReviewedIds,
      removedIds: nextRemovedIds,
      revealRevision: state.revealRevision + 1,
      generation: state.generation,
      isCompleted: true,
      advancedFrom: state.currentId === removedId ? removedId : null,
    };
  }

  // Case 2: Removed item was NOT current item — current item remains unchanged
  if (state.currentId !== removedId) {
    const nextCurrentId = state.currentId;
    const nextIndex = nextItems.findIndex((it) => it.id === nextCurrentId);
    return {
      nextItems,
      nextCurrentId,
      nextIndex: Math.max(0, nextIndex),
      reviewedIds: nextReviewedIds,
      removedIds: nextRemovedIds,
      revealRevision: state.revealRevision,
      generation: state.generation,
      isCompleted: false,
      advancedFrom: null,
    };
  }

  // Case 3: Current item was removed — advance to successor
  let nextCurrentId: string;
  let nextIndex: number;

  if (removedIndex < nextItems.length) {
    // There is an item immediately at/after the removed slot in nextItems
    nextCurrentId = nextItems[removedIndex].id;
    nextIndex = removedIndex;
  } else {
    // Removed was the last item: fallback to previous survivor (end of list)
    nextIndex = nextItems.length - 1;
    nextCurrentId = nextItems[nextIndex].id;
  }

  return {
    nextItems,
    nextCurrentId,
    nextIndex,
    reviewedIds: nextReviewedIds,
    removedIds: nextRemovedIds,
    revealRevision: state.revealRevision + 1,
    generation: state.generation,
    isCompleted: false,
    advancedFrom: removedId,
  };
}

/**
 * Reconcile item rating / review completion.
 * Marks the rated item as reviewed and advances to the next unreviewed item.
 */
export function reconcileItemRating<T extends IdentifiableItem>(
  state: SessionState<T>,
  ratedId: string
): SessionRatingResult<T> {
  const nextReviewedIds = new Set(state.reviewedIds);
  nextReviewedIds.add(ratedId);

  const currentIndex = state.items.findIndex((item) => item.id === ratedId);
  const unreviewedSurvivors = state.items.filter(
    (item) => !nextReviewedIds.has(item.id) && !state.removedIds.has(item.id)
  );

  if (unreviewedSurvivors.length === 0) {
    return {
      nextItems: state.items,
      nextCurrentId: null,
      nextIndex: 0,
      reviewedIds: nextReviewedIds,
      revealRevision: state.revealRevision + 1,
      isCompleted: true,
    };
  }

  // Pick the next unreviewed survivor after currentIndex in the original list
  let nextItem: T | undefined;
  for (let i = currentIndex + 1; i < state.items.length; i++) {
    const candidate = state.items[i];
    if (unreviewedSurvivors.some((s) => s.id === candidate.id)) {
      nextItem = candidate;
      break;
    }
  }

  // If no subsequent unreviewed survivor, wrap to first unreviewed survivor
  if (!nextItem) {
    nextItem = unreviewedSurvivors[0];
  }

  const nextIndex = state.items.findIndex((it) => it.id === nextItem!.id);

  return {
    nextItems: state.items,
    nextCurrentId: nextItem.id,
    nextIndex: Math.max(0, nextIndex),
    reviewedIds: nextReviewedIds,
    revealRevision: state.revealRevision + 1,
    isCompleted: false,
  };
}

/**
 * Reconcile an incoming external refresh / hydration list against active session state.
 *
 * Rules:
 * - Rejects stale refreshes where incomingGeneration < state.generation.
 * - Filters out all items in state.removedIds (committed deletion barrier).
 * - Preserves state.currentId if present in the resulting items.
 * - If currentId is missing from incoming, selects nearest successor or first item.
 */
export function reconcileSessionRefresh<T extends IdentifiableItem>(
  state: SessionState<T>,
  incomingItems: T[],
  incomingGeneration: number
): SessionRefreshResult<T> {
  // Reject stale generations
  if (incomingGeneration < state.generation) {
    const currentIndex = state.currentId
      ? state.items.findIndex((item) => item.id === state.currentId)
      : 0;
    return {
      nextItems: state.items,
      nextCurrentId: state.currentId,
      nextIndex: Math.max(0, currentIndex),
      accepted: false,
      generation: state.generation,
    };
  }

  // Apply deletion barrier (R06)
  const barrierFiltered = incomingItems.filter(
    (item) => !state.removedIds.has(item.id)
  );

  let nextCurrentId: string | null = null;
  let nextIndex = 0;

  if (barrierFiltered.length === 0) {
    nextCurrentId = null;
    nextIndex = 0;
  } else if (state.currentId && barrierFiltered.some((it) => it.id === state.currentId)) {
    nextCurrentId = state.currentId;
    nextIndex = barrierFiltered.findIndex((it) => it.id === state.currentId);
  } else {
    // Current item is no longer in queue: pick first available item
    nextCurrentId = barrierFiltered[0].id;
    nextIndex = 0;
  }

  return {
    nextItems: barrierFiltered,
    nextCurrentId,
    nextIndex,
    accepted: true,
    generation: incomingGeneration,
  };
}

/**
 * Reconcile an undo of an item deletion.
 *
 * Rules:
 * - Removes the item from state.removedIds (clears the deletion barrier).
 * - Re-inserts the item into the queue without stealing the current item's focus.
 * - If the session was previously empty, the restored item becomes the current card.
 */
export function reconcileSessionUndo<T extends IdentifiableItem>(
  state: SessionState<T>,
  restoredItem: T,
  preferredIndex?: number
): SessionUndoResult<T> {
  const nextRemovedIds = new Set(state.removedIds);
  nextRemovedIds.delete(restoredItem.id);

  // If already in queue, nothing to insert
  if (state.items.some((it) => it.id === restoredItem.id)) {
    const curIdx = state.currentId
      ? state.items.findIndex((it) => it.id === state.currentId)
      : 0;
    return {
      nextItems: state.items,
      nextCurrentId: state.currentId,
      nextIndex: Math.max(0, curIdx),
      removedIds: nextRemovedIds,
      revealRevision: state.revealRevision,
    };
  }

  // Case 1: Session was empty, restored item becomes current card
  if (state.items.length === 0) {
    return {
      nextItems: [restoredItem],
      nextCurrentId: restoredItem.id,
      nextIndex: 0,
      removedIds: nextRemovedIds,
      revealRevision: state.revealRevision + 1,
    };
  }

  // Case 2: Session had items, preserve current item
  const nextItems = state.items.slice();
  const insertAt =
    preferredIndex !== undefined && preferredIndex >= 0 && preferredIndex <= nextItems.length
      ? preferredIndex
      : nextItems.length; // Default to appending or inserting at slot

  nextItems.splice(insertAt, 0, restoredItem);
  const nextIndex = state.currentId
    ? nextItems.findIndex((it) => it.id === state.currentId)
    : 0;

  return {
    nextItems,
    nextCurrentId: state.currentId,
    nextIndex: Math.max(0, nextIndex),
    removedIds: nextRemovedIds,
    revealRevision: state.revealRevision,
  };
}
