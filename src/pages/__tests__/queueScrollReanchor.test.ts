import { describe, expect, it } from "vitest";
import {
  reanchorSessionPosition,
  resolveFlashcardRevealGate,
  shouldBuildScrollSession,
} from "../queueScrollSessionLifecycle";
import { clampCompositionToAvailability, composeSession } from "../queueScrollBudget";
import { DEFAULT_COMBINED_SORT_CONFIG, orderScrollItemsByCombinedCriterion } from "../../utils/queueScrollOrder";

const item = (id: string) => ({ id });

describe("reanchorSessionPosition", () => {
  it("moves the index to the survivor's new position when a rebuild reorders", () => {
    const current = [item("a"), item("b"), item("c")];
    const next = [item("c"), item("x"), item("a"), item("b")];
    // The user is viewing "b" at index 2; the rebuild moved it to index 3.
    const result = reanchorSessionPosition(current, "b", next);
    expect(result.items).toEqual(next);
    expect(result.items[result.currentIndex].id).toBe("b");
    expect(result.currentIndex).toBe(3);
  });

  it("re-inserts a dropped current item at the current index", () => {
    const current = [item("a"), item("b"), item("c")];
    // The rebuild shrank and sliced "b" (index 1) off the tail.
    const next = [item("a"), item("c")];
    const result = reanchorSessionPosition(current, "b", next);
    expect(result.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(result.currentIndex).toBe(1);
    // The re-inserted item is the OLD object, verbatim — the caller must not
    // have to refetch its payload to keep presenting it.
    expect(result.items[1]).toBe(current[1]);
  });

  it("clamps the re-insertion position to the end of a shorter new list", () => {
    const current = [item("a"), item("b"), item("c"), item("d")];
    const next = [item("x")];
    const result = reanchorSessionPosition(current, "c", next);
    expect(result.items.map((i) => i.id)).toEqual(["x", "c"]);
    expect(result.currentIndex).toBe(1);
  });

  it("passes through when there is no current id (initial build)", () => {
    const next = [item("a"), item("b")];
    const result = reanchorSessionPosition([], null, next);
    expect(result.items).toEqual(next);
    expect(result.currentIndex).toBe(0);
  });

  it("passes through when the current id addresses neither list", () => {
    // The caller raced a removal (id already gone from the old list): nothing
    // to anchor, take the new list as-is.
    const result = reanchorSessionPosition([item("a")], "gone", [item("x"), item("y")]);
    expect(result.items.map((i) => i.id)).toEqual(["x", "y"]);
    expect(result.currentIndex).toBe(0);
  });

  it("handles boundary indices: index 0 and the last item", () => {
    // Index 0, dropped by the rebuild.
    const head = reanchorSessionPosition([item("a"), item("b")], "a", [item("b")]);
    expect(head.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(head.currentIndex).toBe(0);

    // Last item, dropped by the rebuild (re-inserted at the tail).
    const tail = reanchorSessionPosition([item("a"), item("b")], "b", [item("a")]);
    expect(tail.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(tail.currentIndex).toBe(1);
  });

  it("handles an empty next list by re-inserting the current item alone", () => {
    const result = reanchorSessionPosition([item("a"), item("b")], "b", []);
    expect(result.items.map((i) => i.id)).toEqual(["b"]);
    expect(result.currentIndex).toBe(0);
  });

  it("does not mutate its inputs", () => {
    const current = [item("a"), item("b")];
    const next = [item("a")];
    reanchorSessionPosition(current, "b", next);
    expect(current.map((i) => i.id)).toEqual(["a", "b"]);
    expect(next.map((i) => i.id)).toEqual(["a"]);
  });
});

// ── Pinning tests: the hazard the helper exists for ─────────────────────────
//
// These document WHY rebuilds must re-anchor. They pin the two properties
// that make an index-addressed session unstable across a rebuild, using the
// real composition and ordering functions with deterministic inputs.

describe("pinning: composition shrinks when a document leaves availability", () => {
  it("composeSession drops flashcards from the tail after one document is rated", () => {
    const targets = { documents: 50, extracts: 0, flashcards: 50 };
    const before = composeSession({ targets, available: { documents: 12, extracts: 0, flashcards: 30 } });
    const after = composeSession({ targets, available: { documents: 11, extracts: 0, flashcards: 30 } });

    // 12 docs / 30 cards at 50/50 composes to [12, 0, 12]; the session size
    // is anchored on documents, so one rated document shrinks N and the
    // flashcard slice loses a card the session had promised.
    expect(before).toMatchObject({ documents: 12, flashcards: 12 });
    expect(after).toMatchObject({ documents: 11, flashcards: 11 });
  });

  it("clampCompositionToAvailability keeps the snapshot's card budget when only documents shrank", () => {
    // The session-lifetime snapshot fix: the established counts [12, 0, 12]
    // survive a document-pool reduction; only the document count clamps.
    const clamped = clampCompositionToAvailability(
      { documents: 12, extracts: 0, flashcards: 12 },
      { documents: 11, extracts: 0, flashcards: 30 },
    );
    expect(clamped).toMatchObject({ documents: 11, flashcards: 12 });
    expect(clamped.shortfall).toMatchObject({ documents: 1, flashcards: 0 });
  });

  it("clampCompositionToAvailability still shrinks a genuinely emptied pool", () => {
    const clamped = clampCompositionToAvailability(
      { documents: 12, extracts: 3, flashcards: 12 },
      { documents: 0, extracts: 1, flashcards: 4 },
    );
    expect(clamped).toMatchObject({ documents: 0, extracts: 1, flashcards: 4 });
    expect(clamped.shortfall).toEqual({ documents: 12, extracts: 2, flashcards: 8 });
  });
});

describe("pinning: the greedy interleave displaces the index-addressed item", () => {
  // The page's stable-random scorer (QueueScrollPage `getStableRandom`):
  // new documents get priority + recency boost + jitter, flashcards 5 +
  // jitter*2. All inputs are deterministic, so the orders below are
  // identical on every run.
  const getStableRandom = (str: string, offset = 0): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    hash = ((hash << 5) - hash) + offset;
    hash = hash & hash;
    return Math.abs(hash) / 2147483647;
  };

  const docItems = Array.from({ length: 12 }, (_, i) => {
    const id = `doc-${i}`;
    // New documents (never reviewed): priority 5 + recency boost 2 + jitter.
    return { id, type: "document" as const, engagementScore: 5 + 2 + getStableRandom(id, 2) * 1.5 };
  });
  const cardItems = Array.from({ length: 30 }, (_, i) => {
    const id = `card-${i}`;
    return { id, type: "flashcard" as const, engagementScore: 5 + getStableRandom(id, 1) * 2 };
  });

  const build = (docs: typeof docItems, cards: typeof cardItems) => {
    const composed = composeSession({
      targets: { documents: 50, extracts: 0, flashcards: 50 },
      available: { documents: docs.length, extracts: 0, flashcards: cards.length },
    });
    const total = composed.documents + composed.extracts + composed.flashcards;
    const targetTopicShare = total > 0 ? (composed.documents + composed.extracts) / total : 0.5;
    return orderScrollItemsByCombinedCriterion(
      [...docs.slice(0, composed.documents), ...cards.slice(0, composed.flashcards)],
      { ...DEFAULT_COMBINED_SORT_CONFIG, targetTopicShare },
    );
  };

  it("rating each document and rebuilding changes the item at the rater's index (11/11)", () => {
    const initial = build(docItems, cardItems);
    const documentPositions = initial
      .map((entry, index) => (entry.type === "document" ? index : -1))
      .filter((index) => index !== -1);
    expect(documentPositions).toHaveLength(12);

    let displaced = 0;
    for (const raterIndex of documentPositions.slice(0, 11)) {
      const ratedId = initial[raterIndex].id;
      // advanceAfterRemoval: drop the rated item, keep the numeric index —
      // it now addresses the successor the user is looking at.
      const afterRemoval = initial.filter((entry) => entry.id !== ratedId);
      const successorId = afterRemoval[Math.min(raterIndex, afterRemoval.length - 1)].id;

      // The rebuild: the rated document left the pool, so composeSession +
      // the greedy interleave run again over the remaining items.
      const rebuilt = build(
        docItems.filter((doc) => doc.id !== ratedId),
        cardItems,
      );
      const rebuiltAt = rebuilt[Math.min(raterIndex, rebuilt.length - 1)]?.id;

      if (rebuiltAt !== successorId) displaced += 1;
    }
    // The regression this change fixes: without re-anchoring by id, the item
    // at the rater's index changes in every one of the sampled positions.
    expect(displaced).toBe(11);
  });

  it("re-anchoring the same rebuild keeps the successor current", () => {
    const initial = build(docItems, cardItems);
    for (const raterIndex of initial
      .map((entry, index) => (entry.type === "document" ? index : -1))
      .filter((index) => index !== -1)
      .slice(0, 11)) {
      const ratedId = initial[raterIndex].id;
      const afterRemoval = initial.filter((entry) => entry.id !== ratedId);
      const clampedIndex = Math.min(raterIndex, afterRemoval.length - 1);
      const successorId = afterRemoval[clampedIndex].id;

      const rebuilt = build(
        docItems.filter((doc) => doc.id !== ratedId),
        cardItems,
      );
      const reanchored = reanchorSessionPosition(afterRemoval, successorId, rebuilt);
      expect(reanchored.items[reanchored.currentIndex].id).toBe(successorId);
    }
  });
});

describe("resolveFlashcardRevealGate", () => {
  const card = (id: string) => ({ id, type: "flashcard" });
  const doc = (id: string) => ({ id, type: "document" });

  it("resets the gate immediately on a card → card change", () => {
    const gate = resolveFlashcardRevealGate(card("card-b"), "card-a");
    expect(gate).toEqual({ flashcardId: "card-b", revealed: false });
  });

  it("resets the gate on card → document → card transitions", () => {
    // card → document
    expect(resolveFlashcardRevealGate(doc("doc-1"), "card-a")).toEqual({
      flashcardId: null,
      revealed: false,
    });
    // document → a different card
    expect(resolveFlashcardRevealGate(card("card-b"), null)).toEqual({
      flashcardId: "card-b",
      revealed: false,
    });
    // document → the SAME card again (e.g. went back): also a fresh view.
    expect(resolveFlashcardRevealGate(card("card-a"), null)).toEqual({
      flashcardId: "card-a",
      revealed: false,
    });
  });

  it("keeps the gate untouched when a rebuild preserves the current card", () => {
    // revealed: null means "no change" — the card's own state is still
    // authoritative, so an answer stays revealed across an incidental
    // rebuild that kept the card in view.
    expect(resolveFlashcardRevealGate(card("card-a"), "card-a")).toEqual({
      flashcardId: "card-a",
      revealed: null,
    });
  });

  it("treats an absent current item as a non-card", () => {
    expect(resolveFlashcardRevealGate(undefined, "card-a")).toEqual({
      flashcardId: null,
      revealed: false,
    });
  });
});

// The gate helper composes with the build gate it lives next to: after a
// rating the unlock-skip run must not rebuild, and the run after that must
// reconcile — the sequence the component test drives end-to-end.
describe("gating composes with re-anchoring", () => {
  it("the unlock-skip run never rebuilds; the later rebuild re-anchors", () => {
    let wasRating = false;
    const runEffect = (isRating: boolean) => {
      const shouldBuild = shouldBuildScrollSession({ isRating, wasRating });
      wasRating = isRating;
      return shouldBuild;
    };

    expect(runEffect(false)).toBe(true); // initial build
    expect(runEffect(true)).toBe(false); // lock held
    expect(runEffect(false)).toBe(false); // unlock-skip: never rebuilds

    const session = [item("doc"), item("card"), item("doc-2")];
    const successor = session[1];
    const rebuilt = [item("doc-2"), item("card")];
    const reanchored = reanchorSessionPosition(session, successor.id, rebuilt);
    expect(reanchored.items[reanchored.currentIndex].id).toBe("card");
  });
});
