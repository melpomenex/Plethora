import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeCommand = vi.hoisted(() => vi.fn());
const isTauri = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../lib/tauri", () => ({ invokeCommand, isTauri }));

import { defaultDaqeKnobs, type DaqeKnobs } from "../../lib/daqe/knobs";
import { projectSnapshot, type DaqeQueueSnapshot, type TermBreakdown } from "../../lib/daqe/snapshot";
import { isSnapshotCurrent, rankQueue } from "../daqeRankingClient";
import type { QueueItem } from "../../types/queue";

function breakdown(overrides: Partial<TermBreakdown> = {}): TermBreakdown {
  return {
    srsUrgency: { value: 0.5, available: true, defaulted: false },
    srsWeight: 1,
    goalRelevance: { value: 0, available: false, defaulted: false },
    goalWeight: 0,
    energyFit: { value: 0.5, available: true, defaulted: true },
    energyWeight: 0.4,
    interleavePenalty: { value: 0, available: true, defaulted: false },
    interleaveWeight: 0,
    frictionPenalty: { value: 0, available: true, defaulted: false },
    frictionWeight: 0,
    effectiveEnergyTarget: 3,
    interleaveAgainst: [],
    ...overrides,
  };
}

function item(id: string, index: number): QueueItem {
  return {
    id,
    documentId: `doc-${index}`,
    documentTitle: id,
    extractId: null,
    learningItemId: null,
    question: null,
    answer: null,
    clozeText: null,
    itemType: "learning-item",
    priority: 5,
    dueDate: "2026-06-01T00:00:00Z",
    estimatedTime: 2,
    tags: [],
    category: null,
    progress: 0,
  } as QueueItem;
}

function snapshotFor(order: string[], knobs: DaqeKnobs): DaqeQueueSnapshot {
  const ranked = order.map((id, i) => ({
    item: item(id, i),
    score: 1 - i * 0.01,
    breakdown: breakdown(),
    inputIndex: i,
  }));
  return {
    id: "snap-1",
    profile: "default",
    knobs: { ...knobs },
    ranked,
    top10: ranked.slice(0, 10),
    computedAt: "2026-06-01T12:00:00Z",
  };
}

const pool = [item("a", 0), item("b", 1), item("c", 2), item("d", 3), item("e", 4)];

describe("daqeRankingClient", () => {
  beforeEach(() => {
    invokeCommand.mockReset();
    isTauri.mockReturnValue(true);
  });

  it("passes the knobs and the model inputs across", async () => {
    invokeCommand.mockResolvedValue(snapshotFor(["a"], defaultDaqeKnobs()));
    const snapshot = await rankQueue(defaultDaqeKnobs(), [
      { itemId: "a", complexity: 4, topicMatches: ["recent-1"] },
    ]);

    expect(snapshot).not.toBeNull();
    const [command, args] = invokeCommand.mock.calls[0];
    expect(command).toBe("rank_queue");
    expect(args.knobs.srsDecayWeight).toBe(0.4);
    expect(args.modelInputs[0].itemId).toBe("a");
  });

  it("returns null without a Tauri host rather than throwing", async () => {
    isTauri.mockReturnValue(false);
    expect(await rankQueue(defaultDaqeKnobs())).toBeNull();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("returns null when the invoke rejects", async () => {
    invokeCommand.mockRejectedValue(new Error("db locked"));
    // A ranking is a presentation optimisation; it must never fail the queue.
    expect(await rankQueue(defaultDaqeKnobs())).toBeNull();
  });

  it("returns null when the invoke resolves garbage", async () => {
    invokeCommand.mockResolvedValue("not a snapshot");
    expect(await rankQueue(defaultDaqeKnobs())).toBeNull();
  });
});

describe("snapshot currency", () => {
  it("accepts a snapshot produced under the current knobs", () => {
    const knobs = defaultDaqeKnobs();
    expect(isSnapshotCurrent(snapshotFor(["a"], knobs), knobs)).toBe(true);
  });

  it("rejects a snapshot produced under different knobs", () => {
    const stored = { ...defaultDaqeKnobs(), energyTarget: 2 };
    const knobs = { ...defaultDaqeKnobs(), energyTarget: 5 };
    expect(isSnapshotCurrent(snapshotFor(["a"], stored), knobs)).toBe(false);
  });

  it("rejects no snapshot", () => {
    expect(isSnapshotCurrent(null, defaultDaqeKnobs())).toBe(false);
  });
});

describe("queue rendering while a re-rank is in flight", () => {
  /**
   * The contract: the queue never goes empty waiting for a ranking.
   *
   * Modelled as a hook because that is the shape the store uses — a component
   * holds the current order and swaps it when a snapshot arrives, with no state
   * in which the list is empty.
   */
  function useAdaptiveQueueOrder(knobs: DaqeKnobs) {
    const [snapshot, setSnapshot] = React.useState<DaqeQueueSnapshot | null>(null);
    const [inFlight, setInFlight] = React.useState(false);

    const rerank = React.useCallback(async () => {
      setInFlight(true);
      const next = await rankQueue(knobs);
      setSnapshot(next);
      setInFlight(false);
    }, [knobs]);

    // The rendered order: the snapshot when it matches the current knobs,
    // otherwise the pool as it stands.
    const projected = projectSnapshot(
      pool,
      isSnapshotCurrent(snapshot, knobs) ? snapshot : null
    );
    return { projected, inFlight, rerank };
  }

  beforeEach(() => {
    invokeCommand.mockReset();
    isTauri.mockReturnValue(true);
  });

  it("renders the pool in its existing order before any snapshot exists", () => {
    const { result } = renderHook(() => useAdaptiveQueueOrder(defaultDaqeKnobs()));
    expect(result.current.projected.ordered.map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("keeps rendering the previous order while a re-rank is in flight", async () => {
    invokeCommand.mockResolvedValue(snapshotFor(["c", "a", "b", "d", "e"], defaultDaqeKnobs()));
    const { result } = renderHook(() => useAdaptiveQueueOrder(defaultDaqeKnobs()));

    await act(async () => {
      await result.current.rerank();
    });
    expect(result.current.projected.ordered.map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
      "e",
    ]);

    // A second re-rank that never resolves must not empty the queue.
    invokeCommand.mockReturnValue(new Promise(() => {}));
    act(() => {
      void result.current.rerank();
    });
    expect(result.current.projected.ordered).toHaveLength(5);
  });

  it("falls back to the pool order when the knobs change under the snapshot", () => {
    invokeCommand.mockResolvedValue(snapshotFor(["c", "a", "b", "d", "e"], defaultDaqeKnobs()));
    const { result, rerender } = renderHook(
      ({ knobs }: { knobs: DaqeKnobs }) => useAdaptiveQueueOrder(knobs),
      { initialProps: { knobs: defaultDaqeKnobs() } }
    );

    return act(async () => {
      await result.current.rerank();
      rerender({ knobs: { ...defaultDaqeKnobs(), energyTarget: 5 } });
      expect(result.current.projected.ordered).toHaveLength(5);
      expect(result.current.projected.effectiveEnergyTarget).toBeUndefined();
    });
  });

  it("never returns an empty list when the backend fails outright", async () => {
    invokeCommand.mockRejectedValue(new Error("db locked"));
    const { result } = renderHook(() => useAdaptiveQueueOrder(defaultDaqeKnobs()));
    await act(async () => {
      await result.current.rerank();
    });
    expect(result.current.projected.ordered).toHaveLength(5);
    expect(result.current.inFlight).toBe(false);
  });

  it("keeps the session's membership when only the order changes", async () => {
    invokeCommand.mockResolvedValue(snapshotFor(["e", "d", "c", "b", "a"], defaultDaqeKnobs()));
    const { result } = renderHook(() => useAdaptiveQueueOrder(defaultDaqeKnobs()));
    await act(async () => {
      await result.current.rerank();
    });
    const ids = result.current.projected.orderedIds;
    // Re-ranked, but the same five items — a knob never adds or removes an item.
    expect([...ids].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids).not.toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("ranking never widens session membership", () => {
  it("keeps an item-type-restricted session restricted", async () => {
    // The spec's `queue-item-type-routing` boundary: composition governs
    // membership, the ranker governs order. An item the session does not contain
    // must not appear because the ranker wanted it.
    invokeCommand.mockResolvedValue(snapshotFor(["a", "b", "c"], defaultDaqeKnobs()));
    const extractsOnly = [item("a", 0), item("b", 1)];
    const snapshot = snapshotFor(["a", "b", "c"], defaultDaqeKnobs());

    const projected = projectSnapshot(extractsOnly, snapshot);
    expect(projected.orderedIds).toEqual(["a", "b"]);
    expect(projected.orderedIds).not.toContain("c");
  });

  it("leaves the flashcard review session's item types alone", async () => {
    // The `flashcard-review-session` boundary: a document is never a review
    // session item. The ranker orders; it does not decide membership.
    invokeCommand.mockResolvedValue(snapshotFor(["doc-1", "card-1"], defaultDaqeKnobs()));
    const reviewSession = [item("card-1", 0)];
    const snapshot = snapshotFor(["doc-1", "card-1"], defaultDaqeKnobs());

    const projected = projectSnapshot(reviewSession, snapshot);
    expect(projected.orderedIds).toEqual(["card-1"]);
  });
});