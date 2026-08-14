/**
 * Decide whether a Queue Scroll session-build effect run may replace the
 * established item order.
 *
 * `isRating` remains an effect dependency so entering the lock cancels an
 * in-flight async build. The first run after the lock is released must also be
 * skipped: rating/dismissal already removed the current item in place, and a
 * fresh composition would restart the greedy mix at the current numeric index
 * and replace the successor that was just revealed.
 */
export function shouldBuildScrollSession({
  isRating,
  wasRating,
}: {
  isRating: boolean;
  wasRating: boolean;
}): boolean {
  return !isRating && !wasRating;
}

/**
 * Reconcile a freshly built session list against the item the user is
 * currently viewing, so a rebuild can never displace or drop it.
 *
 * `currentIndex` addresses a numeric position, but rating mutates the session
 * in place (`advanceAfterRemoval` keeps the index, which then addresses the
 * successor). Any later rebuild replaces `scrollItems` wholesale — if the
 * index is not re-anchored to the item's id, the rebuild silently skips the
 * item the user is looking at (observed as: rate a document, the flashcard
 * that flashes on screen is skipped for the next document).
 *
 * 1. The current item survives the rebuild → keep the new list and move the
 *    index to the item's new position (rebuilds reorder; positions drift).
 * 2. The rebuild dropped the current item (e.g. the recomposed session
 *    shrank and sliced it off the tail) → re-insert the OLD item object at
 *    `min(oldIndex, nextItems.length)`. The old object is reused verbatim —
 *    its payload is not refetched — exactly like the in-place rating path.
 *    Items the user has already passed may still be dropped by the shrink:
 *    the composition is a plan for what remains.
 * 3. `currentId` is null (initial build / empty session) → pass through.
 *
 * Note: this reconciles *positions* only. Whether a dropped current item is
 * still presentable at all (its backing entity was deleted or suspended
 * elsewhere) is the caller's decision — a dead item must advance, not
 * re-insert (see the page's `applySessionItems`).
 */
export function reanchorSessionPosition<T extends { id: string }>(
  currentItems: readonly T[],
  currentId: string | null | undefined,
  nextItems: readonly T[],
): { items: T[]; currentIndex: number } {
  if (currentId == null) {
    return { items: [...nextItems], currentIndex: 0 };
  }
  const oldIndex = currentItems.findIndex((item) => item.id === currentId);
  if (oldIndex === -1) {
    // The id no longer addresses the old list either (caller raced a
    // removal) — nothing to anchor, take the new list as-is.
    return { items: [...nextItems], currentIndex: 0 };
  }
  const nextIndex = nextItems.findIndex((item) => item.id === currentId);
  if (nextIndex !== -1) {
    return { items: [...nextItems], currentIndex: nextIndex };
  }
  const items = [...nextItems];
  const insertAt = Math.min(oldIndex, items.length);
  items.splice(insertAt, 0, currentItems[oldIndex]);
  return { items, currentIndex: insertAt };
}

/**
 * Decide the page's flashcard-reveal gate for the item becoming current.
 *
 * The gate (`flashcardRevealedRef`) must follow the card actually in view.
 * `FlashcardScrollItem` reports its reveal state on mount and on change, but
 * between "card B becomes current" and "card B's mount effect reports false"
 * the gate still held card A's revealed state — long enough for a keyboard
 * 1-4 double-tap to rate card B under card A's revealed gate. This helper
 * closes that window from the page side: the gate resets as soon as the page
 * registers a *different* flashcard as current, independent of the card
 * component's own mount timing.
 *
 * Returns the flashcard id to remember, and the gate value to apply — `null`
 * means "unchanged" (same card still current, e.g. after a rebuild that
 * preserved it; its reveal state must survive).
 */
export function resolveFlashcardRevealGate(
  currentItem: { id: string; type: string } | undefined,
  lastFlashcardId: string | null,
): { flashcardId: string | null; revealed: boolean | null } {
  const flashcardId = currentItem?.type === "flashcard" ? currentItem.id : null;
  if (flashcardId === null) {
    // A non-card item is current: the gate is meaninglessly false.
    return { flashcardId: null, revealed: false };
  }
  if (flashcardId === lastFlashcardId) {
    return { flashcardId, revealed: null };
  }
  return { flashcardId, revealed: false };
}
