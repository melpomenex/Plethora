import { describe, it, expect } from "vitest";
import {
  createSessionState,
  reconcileItemRemoval,
  reconcileItemRating,
  reconcileSessionRefresh,
  reconcileSessionUndo,
  IdentifiableItem,
} from "../sessionTransition";

interface TestItem extends IdentifiableItem {
  id: string;
  name: string;
}

const itemA: TestItem = { id: "item-a", name: "Card A" };
const itemB: TestItem = { id: "item-b", name: "Card B" };
const itemC: TestItem = { id: "item-c", name: "Card C" };
const itemD: TestItem = { id: "item-d", name: "Card D" };

describe("sessionTransition helper (R06 / R07)", () => {
  describe("createSessionState", () => {
    it("initializes session with first item as current by default", () => {
      const state = createSessionState([itemA, itemB, itemC]);
      expect(state.items).toEqual([itemA, itemB, itemC]);
      expect(state.currentId).toBe("item-a");
      expect(state.reviewedIds.size).toBe(0);
      expect(state.removedIds.size).toBe(0);
      expect(state.revealRevision).toBe(0);
      expect(state.generation).toBe(1);
    });

    it("respects initialCurrentId if present in list", () => {
      const state = createSessionState([itemA, itemB, itemC], "item-b", 5);
      expect(state.currentId).toBe("item-b");
      expect(state.generation).toBe(5);
    });

    it("falls back to first item if initialCurrentId is not in list", () => {
      const state = createSessionState([itemA, itemB], "unknown-id");
      expect(state.currentId).toBe("item-a");
    });

    it("handles empty items array gracefully", () => {
      const state = createSessionState([]);
      expect(state.items).toEqual([]);
      expect(state.currentId).toBeNull();
      expect(state.generation).toBe(1);
    });
  });

  describe("reconcileItemRemoval (R06 Deletion and Advancement)", () => {
    it("advances to successor when the first item is deleted", () => {
      const state = createSessionState([itemA, itemB, itemC], "item-a");
      const result = reconcileItemRemoval(state, "item-a");

      expect(result.nextItems).toEqual([itemB, itemC]);
      expect(result.nextCurrentId).toBe("item-b");
      expect(result.nextIndex).toBe(0);
      expect(result.removedIds.has("item-a")).toBe(true);
      expect(result.isCompleted).toBe(false);
      expect(result.revealRevision).toBe(state.revealRevision + 1);
      expect(result.advancedFrom).toBe("item-a");
    });

    it("advances to successor when a middle item is deleted", () => {
      const state = createSessionState([itemA, itemB, itemC], "item-b");
      const result = reconcileItemRemoval(state, "item-b");

      expect(result.nextItems).toEqual([itemA, itemC]);
      expect(result.nextCurrentId).toBe("item-c");
      expect(result.nextIndex).toBe(1);
      expect(result.removedIds.has("item-b")).toBe(true);
      expect(result.isCompleted).toBe(false);
      expect(result.revealRevision).toBe(state.revealRevision + 1);
      expect(result.advancedFrom).toBe("item-b");
    });

    it("falls back to preceding survivor when the last item is deleted", () => {
      const state = createSessionState([itemA, itemB, itemC], "item-c");
      const result = reconcileItemRemoval(state, "item-c");

      expect(result.nextItems).toEqual([itemA, itemB]);
      expect(result.nextCurrentId).toBe("item-b");
      expect(result.nextIndex).toBe(1);
      expect(result.removedIds.has("item-c")).toBe(true);
      expect(result.isCompleted).toBe(false);
      expect(result.revealRevision).toBe(state.revealRevision + 1);
      expect(result.advancedFrom).toBe("item-c");
    });

    it("completes session gracefully when the only item is deleted", () => {
      const state = createSessionState([itemA], "item-a");
      const result = reconcileItemRemoval(state, "item-a");

      expect(result.nextItems).toEqual([]);
      expect(result.nextCurrentId).toBeNull();
      expect(result.nextIndex).toBe(0);
      expect(result.removedIds.has("item-a")).toBe(true);
      expect(result.isCompleted).toBe(true);
      expect(result.revealRevision).toBe(state.revealRevision + 1);
      expect(result.advancedFrom).toBe("item-a");
    });

    it("strictly preserves current item identity and updates index when a non-current preceding item is deleted", () => {
      // User is viewing item-b (index 1), item-a (index 0) is deleted
      const state = createSessionState([itemA, itemB, itemC], "item-b");
      const result = reconcileItemRemoval(state, "item-a");

      expect(result.nextItems).toEqual([itemB, itemC]);
      expect(result.nextCurrentId).toBe("item-b"); // NOT advanced to item-c!
      expect(result.nextIndex).toBe(0); // Index shifted to match item-b's new position
      expect(result.removedIds.has("item-a")).toBe(true);
      expect(result.isCompleted).toBe(false);
      expect(result.revealRevision).toBe(state.revealRevision); // Reveal state not disrupted
      expect(result.advancedFrom).toBeNull();
    });

    it("strictly preserves current item identity and index when a non-current succeeding item is deleted", () => {
      // User is viewing item-a (index 0), item-c (index 2) is deleted
      const state = createSessionState([itemA, itemB, itemC], "item-a");
      const result = reconcileItemRemoval(state, "item-c");

      expect(result.nextItems).toEqual([itemA, itemB]);
      expect(result.nextCurrentId).toBe("item-a");
      expect(result.nextIndex).toBe(0);
      expect(result.removedIds.has("item-c")).toBe(true);
      expect(result.isCompleted).toBe(false);
      expect(result.revealRevision).toBe(state.revealRevision);
      expect(result.advancedFrom).toBeNull();
    });

    it("removes deleted item from reviewedIds if it was previously reviewed, keeping counts distinct", () => {
      const state = createSessionState([itemA, itemB], "item-b");
      state.reviewedIds.add("item-a");

      const result = reconcileItemRemoval(state, "item-a");
      expect(result.reviewedIds.has("item-a")).toBe(false);
      expect(result.removedIds.has("item-a")).toBe(true);
    });

    it("leaves state intact when attempting to remove an item not in session", () => {
      const state = createSessionState([itemA, itemB], "item-a");
      const result = reconcileItemRemoval(state, "non-existent");

      expect(result.nextItems).toEqual([itemA, itemB]);
      expect(result.nextCurrentId).toBe("item-a");
      expect(result.advancedFrom).toBeNull();
    });
  });

  describe("reconcileItemRating (R06 Rating Lifecycle)", () => {
    it("adds rated item to reviewedIds and advances to next unreviewed survivor", () => {
      const state = createSessionState([itemA, itemB, itemC], "item-a");
      const result = reconcileItemRating(state, "item-a");

      expect(result.reviewedIds.has("item-a")).toBe(true);
      expect(result.nextCurrentId).toBe("item-b");
      expect(result.nextIndex).toBe(1);
      expect(result.revealRevision).toBe(state.revealRevision + 1);
      expect(result.isCompleted).toBe(false);
    });

    it("completes session when all survivors have been reviewed", () => {
      const state = createSessionState([itemA, itemB], "item-b");
      state.reviewedIds.add("item-a");

      const result = reconcileItemRating(state, "item-b");
      expect(result.reviewedIds.has("item-a")).toBe(true);
      expect(result.reviewedIds.has("item-b")).toBe(true);
      expect(result.nextCurrentId).toBeNull();
      expect(result.isCompleted).toBe(true);
    });

    it("wraps around to earlier unreviewed survivor if current was near end", () => {
      // Items A, B, C, D. B and C are already reviewed. Current is D.
      const state = createSessionState([itemA, itemB, itemC, itemD], "item-d");
      state.reviewedIds.add("item-b");
      state.reviewedIds.add("item-c");

      const result = reconcileItemRating(state, "item-d");
      expect(result.reviewedIds.has("item-d")).toBe(true);
      expect(result.nextCurrentId).toBe("item-a"); // Wraps to unreviewed item-a
      expect(result.isCompleted).toBe(false);
    });
  });

  describe("reconcileSessionRefresh (R06 / R07 Stale Refresh and Deletion Barrier)", () => {
    it("rejects stale refresh when incoming generation is older than session generation", () => {
      const state = createSessionState([itemA, itemB], "item-b", 3);
      const staleIncoming = [itemA, itemB, itemC, itemD];

      const result = reconcileSessionRefresh(state, staleIncoming, 2);
      expect(result.accepted).toBe(false);
      expect(result.nextItems).toEqual([itemA, itemB]);
      expect(result.nextCurrentId).toBe("item-b");
      expect(result.generation).toBe(3);
    });

    it("applies committed deletion barrier to incoming items", () => {
      const state = createSessionState([itemB, itemC], "item-b", 2);
      state.removedIds.add("item-a");

      // Incoming list has resurrected item-a
      const incoming = [itemA, itemB, itemC];
      const result = reconcileSessionRefresh(state, incoming, 2);

      expect(result.accepted).toBe(true);
      expect(result.nextItems).toEqual([itemB, itemC]); // item-a excluded by barrier
      expect(result.nextCurrentId).toBe("item-b");
    });

    it("preserves active currentId and locates its position in refreshed list", () => {
      const state = createSessionState([itemA, itemB], "item-b", 1);
      const incoming = [itemC, itemD, itemB];

      const result = reconcileSessionRefresh(state, incoming, 2);
      expect(result.accepted).toBe(true);
      expect(result.nextItems).toEqual([itemC, itemD, itemB]);
      expect(result.nextCurrentId).toBe("item-b");
      expect(result.nextIndex).toBe(2);
    });

    it("falls back to first survivor if current item was removed from incoming list", () => {
      const state = createSessionState([itemA, itemB], "item-b", 1);
      const incoming = [itemC, itemD];

      const result = reconcileSessionRefresh(state, incoming, 2);
      expect(result.accepted).toBe(true);
      expect(result.nextItems).toEqual([itemC, itemD]);
      expect(result.nextCurrentId).toBe("item-c");
      expect(result.nextIndex).toBe(0);
    });

    it("handles all incoming items being barred gracefully", () => {
      const state = createSessionState([itemA], "item-a", 1);
      state.removedIds.add("item-a");
      state.removedIds.add("item-b");

      const incoming = [itemA, itemB];
      const result = reconcileSessionRefresh(state, incoming, 2);
      expect(result.accepted).toBe(true);
      expect(result.nextItems).toEqual([]);
      expect(result.nextCurrentId).toBeNull();
      expect(result.nextIndex).toBe(0);
    });
  });

  describe("reconcileSessionUndo (R07 Undo Restoration)", () => {
    it("removes restored item from deletion barrier and re-inserts without stealing focus", () => {
      const state = createSessionState([itemB, itemC], "item-b");
      state.removedIds.add("item-a");

      const result = reconcileSessionUndo(state, itemA, 0);
      expect(result.removedIds.has("item-a")).toBe(false);
      expect(result.nextItems).toEqual([itemA, itemB, itemC]);
      expect(result.nextCurrentId).toBe("item-b"); // item-b retains focus!
      expect(result.nextIndex).toBe(1); // item-b is now at index 1
      expect(result.revealRevision).toBe(state.revealRevision);
    });

    it("reopens restored card when session was completely empty", () => {
      const state = createSessionState<TestItem>([]);
      state.removedIds.add("item-a");

      const result = reconcileSessionUndo(state, itemA);
      expect(result.removedIds.has("item-a")).toBe(false);
      expect(result.nextItems).toEqual([itemA]);
      expect(result.nextCurrentId).toBe("item-a");
      expect(result.nextIndex).toBe(0);
      expect(result.revealRevision).toBe(state.revealRevision + 1);
    });

    it("does not create duplicate entry if restored item is already in list", () => {
      const state = createSessionState([itemA, itemB], "item-a");
      state.removedIds.add("item-a");

      const result = reconcileSessionUndo(state, itemA);
      expect(result.removedIds.has("item-a")).toBe(false);
      expect(result.nextItems).toEqual([itemA, itemB]);
      expect(result.nextCurrentId).toBe("item-a");
    });
  });
});
