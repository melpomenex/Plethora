import { describe, expect, it } from "vitest";
import {
  reanchorSessionPosition,
  shouldBuildScrollSession,
} from "../queueScrollSessionLifecycle";

describe("shouldBuildScrollSession", () => {
  it("does not recompose the session when a rating/removal lock is released", () => {
    let wasRating = false;
    const runEffect = (isRating: boolean) => {
      const shouldBuild = shouldBuildScrollSession({ isRating, wasRating });
      wasRating = isRating;
      return shouldBuild;
    };

    // Initial data arrival builds the session.
    expect(runEffect(false)).toBe(true);

    // Rating starts, then due/rated source state mutates while it is in flight.
    // Neither effect run may replace the established session order.
    expect(runEffect(true)).toBe(false);
    expect(runEffect(true)).toBe(false);

    // The old race was here: unlocking rebuilt and re-sorted the remaining
    // 50/50 session at the current numeric index, replacing the flashcard that
    // advanceAfterRemoval had just revealed with a document.
    expect(runEffect(false)).toBe(false);

    // A later, genuine source/settings dependency change while idle still
    // rebuilds normally.
    expect(runEffect(false)).toBe(true);
  });
});

// ── Effect-sequence simulation ───────────────────────────────────────────────
//
// Mirrors the page's mechanics with the real gating + reconciliation helpers:
// a session build that replaces the list, an in-place advance on rating
// (drop the rated item, keep the numeric index), the unlock-skip run, and the
// later dependency-identity flip that rebuilds. This is the exact sequence
// the component test drives through the real page — here it pins the
// helper-level contract without mounting the component.

interface SimItem {
  id: string;
  type: "document" | "flashcard";
}

interface SimState {
  items: SimItem[];
  currentIndex: number;
  wasRating: boolean;
  built: number;
}

/** The page's `applySessionItems`: replace the list, re-anchor by id. */
function applySessionItems(state: SimState, nextItems: SimItem[]) {
  const currentId = state.items[state.currentIndex]?.id ?? null;
  const { items, currentIndex } = reanchorSessionPosition(state.items, currentId, nextItems);
  state.items = items;
  state.currentIndex = currentIndex;
}

/** The page's `advanceAfterRemoval`: drop the item, keep the numeric index. */
function advanceAfterRemoval(state: SimState, removedId: string) {
  const updated = state.items.filter((item) => item.id !== removedId);
  state.items = updated;
  state.currentIndex = Math.min(state.currentIndex, Math.max(0, updated.length - 1));
}

/** One run of the page's build effect against `nextItems`. */
function runBuildEffect(state: SimState, isRating: boolean, nextItems: SimItem[] | null) {
  const shouldBuild = shouldBuildScrollSession({ isRating, wasRating: state.wasRating });
  state.wasRating = isRating;
  if (!shouldBuild || nextItems === null) return false;
  applySessionItems(state, nextItems);
  state.built += 1;
  return true;
}

describe("session stability across the rating → rebuild sequence", () => {
  const doc = (id: string): SimItem => ({ id, type: "document" });
  const card = (id: string): SimItem => ({ id, type: "flashcard" });

  it("keeps the current item unchanged through build → lock → advance → unlock-skip → dep-flip rebuild", () => {
    // Initial composition: document, flashcard, document (the regression's
    // exact shape — rate the first epub, the card is next).
    const state: SimState = {
      items: [doc("doc-a"), card("card-1"), doc("doc-b")],
      currentIndex: 0,
      wasRating: false,
      built: 0,
    };
    expect(runBuildEffect(state, false, [doc("doc-a"), card("card-1"), doc("doc-b")])).toBe(true);
    expect(state.built).toBe(1);

    // Rating starts; a source mutation arrives while the lock is held.
    expect(runBuildEffect(state, true, [doc("doc-b"), card("card-1")])).toBe(false);

    // The rating completes: in-place advance reveals card-1 at index 0.
    advanceAfterRemoval(state, "doc-a");
    expect(state.items[state.currentIndex].id).toBe("card-1");

    // The unlock-skip run itself still never rebuilds (today's guarantee).
    expect(runBuildEffect(state, false, [doc("doc-b"), card("card-1")])).toBe(false);
    expect(state.built).toBe(1);

    // The regression: a LATER dependency-identity change (e.g. the sync
    // engine's debounced documents store reload) rebuilds — and the rebuild
    // reorders (the greedy interleave restarts without doc-a).
    const rebuilt: SimItem[] = [doc("doc-b"), card("card-1")];
    expect(runBuildEffect(state, false, rebuilt)).toBe(true);
    expect(state.built).toBe(2);

    // The card the user is looking at is unchanged — same id, still current,
    // still unrated (not dropped, not skipped past).
    expect(state.items[state.currentIndex].id).toBe("card-1");
    expect(state.items).toHaveLength(2);

    // And the next advance goes to the rebuilt session's successor.
    advanceAfterRemoval(state, "card-1");
    expect(state.items[state.currentIndex].id).toBe("doc-b");
  });

  it("keeps the position glued to the item when the rebuild reorders around it", () => {
    const state: SimState = {
      items: [doc("doc-a"), card("card-1"), doc("doc-b")],
      currentIndex: 2,
      wasRating: false,
      built: 0,
    };
    // The rebuild moves doc-b from index 2 to index 0.
    expect(runBuildEffect(state, false, [doc("doc-b"), card("card-1"), doc("doc-a")])).toBe(true);
    expect(state.currentIndex).toBe(0);
    expect(state.items[state.currentIndex].id).toBe("doc-b");
  });

  it("re-inserts a dropped current item at the current index, unrated (5.2)", () => {
    const state: SimState = {
      items: [doc("doc-a"), card("card-1"), doc("doc-b")],
      currentIndex: 0,
      wasRating: false,
      built: 0,
    };
    // Rating doc-a: lock held while sources mutate, then the in-place advance.
    expect(runBuildEffect(state, true, [doc("doc-b")])).toBe(false);
    advanceAfterRemoval(state, "doc-a");
    expect(state.items[state.currentIndex].id).toBe("card-1");
    expect(runBuildEffect(state, false, [doc("doc-b")])).toBe(false); // unlock-skip still holds

    // The recomposed session shrank and sliced card-1 off the tail entirely.
    expect(runBuildEffect(state, false, [doc("doc-b")])).toBe(true);
    // card-1 was re-inserted at the current index and stays current — the
    // user can still finish (and rate) it.
    expect(state.items[state.currentIndex].id).toBe("card-1");
    expect(state.items.map((item) => item.id)).toEqual(["card-1", "doc-b"]);

    // After rating it, the advance goes to the rebuilt session's successor.
    advanceAfterRemoval(state, "card-1");
    expect(state.items[state.currentIndex].id).toBe("doc-b");
  });

  it("a rebuild while idle with no current item passes through", () => {
    const state: SimState = { items: [], currentIndex: 0, wasRating: false, built: 0 };
    expect(runBuildEffect(state, false, [doc("doc-a"), card("card-1")])).toBe(true);
    expect(state.items.map((item) => item.id)).toEqual(["doc-a", "card-1"]);
    expect(state.currentIndex).toBe(0);
  });
});
