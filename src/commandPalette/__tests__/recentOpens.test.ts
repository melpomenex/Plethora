import { describe, expect, it, beforeEach } from "vitest";
import {
  RECENT_OPENS_STORAGE_KEY,
  clearRecentOpens,
  getMostRecentOpen,
  getRecentOpens,
  recordRecentOpen,
} from "../recentOpens";
import { useCollectionStore } from "../../stores/collectionStore";

describe("recentOpens (collection-keyed)", () => {
  beforeEach(() => {
    clearRecentOpens();
  });

  it("records opens newest-first and deduplicates within a collection", () => {
    recordRecentOpen("doc-a", { collectionId: "col-1", now: 100 });
    recordRecentOpen("doc-b", { collectionId: "col-1", now: 200 });
    recordRecentOpen("doc-a", { collectionId: "col-1", now: 300 });

    const entries = getRecentOpens("col-1");
    expect(entries.map((entry) => entry.documentId)).toEqual(["doc-a", "doc-b"]);
    expect(getMostRecentOpen("col-1")?.openedAt).toBe(300);
  });

  it("keeps collections isolated so a scope change cannot reuse another target", () => {
    recordRecentOpen("doc-1", { collectionId: "col-1", now: 100 });
    expect(getRecentOpens("col-2")).toEqual([]);
    expect(getMostRecentOpen("col-2")).toBeNull();
  });

  it("falls back to the active collection bucket when the caller has no collection id", () => {
    const activeCollectionId = useCollectionStore.getState().activeCollectionId;
    recordRecentOpen("doc-default", { collectionId: null, now: 10 });
    expect(getRecentOpens(activeCollectionId).map((entry) => entry.documentId)).toEqual([
      "doc-default",
    ]);
  });

  it("stores a title/fileType snapshot for bounded caches", () => {
    recordRecentOpen("doc-a", {
      collectionId: "col-1",
      title: "The-Doctrine-of-Fascism",
      fileType: "pdf",
      now: 1,
    });
    expect(getMostRecentOpen("col-1")).toMatchObject({
      documentId: "doc-a",
      title: "The-Doctrine-of-Fascism",
      fileType: "pdf",
    });
  });

  it("ignores a corrupt store instead of repairing it", () => {
    localStorage.setItem(RECENT_OPENS_STORAGE_KEY, "{not json");
    expect(getRecentOpens("col-1")).toEqual([]);
    localStorage.setItem(RECENT_OPENS_STORAGE_KEY, JSON.stringify({ "col-1": "nope" }));
    expect(getRecentOpens("col-1")).toEqual([]);
  });

  it("drops malformed entries within a collection", () => {
    localStorage.setItem(
      RECENT_OPENS_STORAGE_KEY,
      JSON.stringify({
        "col-1": [
          { documentId: "ok", openedAt: 5 },
          { documentId: "missing-time" },
          { openedAt: 9 },
          null,
        ],
      })
    );
    expect(getRecentOpens("col-1").map((entry) => entry.documentId)).toEqual(["ok"]);
  });

  it("does not record an empty document id", () => {
    recordRecentOpen("", { collectionId: "col-1", now: 1 });
    expect(getRecentOpens("col-1")).toEqual([]);
  });
});
