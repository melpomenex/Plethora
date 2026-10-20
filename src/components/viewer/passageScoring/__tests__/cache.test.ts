import { describe, expect, it, vi } from "vitest";
import { PassageCandidateQueue } from "../queue";
import {
  RecentPassageScoreCache,
  PassageUsageBudget,
  PassageDismissalStore,
  classificationFromStoredScore,
  passageDismissalId,
  type StoredPassageScore,
} from "../cache";
import { PASSAGE_RECENT_CACHE_LIMIT } from "../types";

function score(hash: string): StoredPassageScore {
  return {
    chunkHash: hash,
    passageType: "definition",
    extractWorthiness: 0.9,
    suggestedAction: "extract",
    reason: "Defines the term.",
    classifierVersion: "c1",
    modelRevision: "p\u0000m",
    normalizationVersion: "n1",
    createdAt: "2026-10-20T00:00:00Z",
  };
}

describe("PassageCandidateQueue", () => {
  it("dedupes and caps at the bounded queue limit", () => {
    const queue = new PassageCandidateQueue(2);
    expect(queue.push("a")).toBe(true);
    expect(queue.push("a")).toBe(false);
    expect(queue.push("b")).toBe(true);
    expect(queue.push("c")).toBe(false);
    expect(queue.size).toBe(2);
    expect(queue.idsInOrder()).toEqual(["a", "b"]);
    expect(queue.pop()?.passageId).toBe("a");
    expect(queue.remove("b")).toBe(true);
    expect(queue.remove("b")).toBe(false);
    expect(queue.size).toBe(0);
  });
});

describe("RecentPassageScoreCache", () => {
  it("is LRU-bounded to 128 entries and refreshes hits", () => {
    const cache = new RecentPassageScoreCache();
    expect(cache.capacity).toBe(PASSAGE_RECENT_CACHE_LIMIT);
    for (let index = 0; index < PASSAGE_RECENT_CACHE_LIMIT; index += 1) {
      cache.set(`k${index}`, score(`k${index}`));
    }
    // Touch the oldest entry so it is no longer evicted first.
    expect(cache.get("k0")).toBeDefined();
    cache.set("overflow", score("overflow"));
    expect(cache.size).toBe(PASSAGE_RECENT_CACHE_LIMIT);
    expect(cache.get("k0")).toBeDefined();
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("overflow")).toBeDefined();
  });
});

describe("PassageUsageBudget", () => {
  it("enforces visit, hour and remote budgets", () => {
    const now = 1_000_000;
    const budget = new PassageUsageBudget(2, 3, 1);
    expect(budget.canClassify(now, false)).toBeNull();
    budget.consume(now, false);
    budget.consume(now, false);
    expect(budget.canClassify(now, false)).toBe("visit-quota");
    budget.startVisit();
    expect(budget.canClassify(now, false)).toBeNull();
    budget.consume(now, true);
    expect(budget.canClassify(now, true)).toBe("remote-quota");

    const hourly = new PassageUsageBudget(10, 2, 10);
    hourly.consume(now, false);
    hourly.consume(now + 1, false);
    expect(hourly.canClassify(now + 2, false)).toBe("hour-quota");
    expect(hourly.canClassify(now + 60 * 60 * 1_000 + 3, false)).toBeNull();
  });
});

describe("PassageDismissalStore", () => {
  it("is unique per key and keeps session-only dismissals in memory", async () => {
    const persist = vi.fn(async () => {});
    const store = new PassageDismissalStore({
      durable: false,
      documentId: "doc-1",
      sourceRevision: "rev-1",
      classifierVersion: "c1",
      persist,
    });
    expect(await store.isDismissed("p1")).toBe(false);
    await store.dismiss("p1");
    expect(await store.isDismissed("p1")).toBe(true);
    expect(persist).not.toHaveBeenCalled();
    expect(store.durableSource).toBe(false);
  });

  it("persists durable dismissals and loads them for the same revision/classifier", async () => {
    const persist = vi.fn(async () => {});
    const load = vi.fn(async () => [
      {
        documentId: "doc-1",
        sourceRevision: "rev-1",
        passageId: "p-old",
        classifierVersion: "c1",
        dismissedAt: "2026-01-01T00:00:00Z",
      },
      {
        documentId: "doc-1",
        sourceRevision: "rev-2",
        passageId: "p-other-rev",
        classifierVersion: "c1",
        dismissedAt: "2026-01-01T00:00:00Z",
      },
      {
        documentId: "doc-1",
        sourceRevision: "rev-1",
        passageId: "p-old-classifier",
        classifierVersion: "c0",
        dismissedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    const store = new PassageDismissalStore({
      durable: true,
      documentId: "doc-1",
      sourceRevision: "rev-1",
      classifierVersion: "c1",
      load,
      persist,
    });
    expect(await store.isDismissed("p-old")).toBe(true);
    expect(await store.isDismissed("p-other-rev")).toBe(false);
    expect(await store.isDismissed("p-old-classifier")).toBe(false);
    await store.dismiss("p-new");
    expect(persist).toHaveBeenCalledWith({
      documentId: "doc-1",
      sourceRevision: "rev-1",
      passageId: "p-new",
      classifierVersion: "c1",
    });
    expect(store.durableSource).toBe(true);
  });

  it("never collapses keys across documents or revisions", () => {
    const a = passageDismissalId({
      documentId: "doc-1",
      sourceRevision: "rev-1",
      passageId: "p",
      classifierVersion: "c",
    });
    const b = passageDismissalId({
      documentId: "doc-2",
      sourceRevision: "rev-1",
      passageId: "p",
      classifierVersion: "c",
    });
    expect(a).not.toBe(b);
  });

  it("maps stored rows defensively", () => {
    expect(classificationFromStoredScore(score("k"))?.type).toBe("definition");
    expect(
      classificationFromStoredScore({ ...score("k"), extractWorthiness: Number.NaN })
    ).toBeNull();
  });
});
