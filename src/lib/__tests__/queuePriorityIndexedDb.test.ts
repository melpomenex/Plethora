import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeIndexedDb } from "../../test/fakeIndexedDb";
import { closeDatabase, createDocument, createExtract, getDocument, getExtract, getQueueExternalPriorities, openDatabase, setQueuePrioritiesAtomic } from "../database";

beforeEach(() => {
  closeDatabase();
  installFakeIndexedDb();
});

afterEach(() => closeDatabase());

describe("browser mixed priority batch", () => {
  it("updates the selected types, reports missing rows, and preserves explicit zero", async () => {
    await createDocument({ id: "same", title: "Parent", file_type: "pdf" });
    await createExtract({ id: "same", document_id: "same", content: "Excerpt" });
    const result = await setQueuePrioritiesAtomic([
      { kind: "extract", id: "same" },
      { kind: "document", id: "missing" },
    ], 0);
    expect(result.succeeded).toEqual(["extract:same"]);
    expect(result.failed).toEqual(["document:missing"]);
    expect((await getExtract("same"))?.priority_slider).toBe(0);
    expect((await getDocument("same"))?.priority_slider).toBe(50);
  });

  it("persists feed priorities independently and reports a missing episode", async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("podcast_episodes", "readwrite");
      tx.objectStore("podcast_episodes").put({ id: "ep-1", feed_id: "feed" });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const result = await setQueuePrioritiesAtomic([
      { kind: "rss-article", id: "ep-1" },
      { kind: "podcast-episode", id: "ep-1" },
      { kind: "podcast-episode", id: "missing" },
    ], 73);
    expect(result.succeeded.sort()).toEqual(["podcast-episode:ep-1", "rss-article:ep-1"]);
    expect(result.failed).toEqual(["podcast-episode:missing"]);
    expect(await getQueueExternalPriorities()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "rss-article", itemId: "ep-1", slider: 73 }),
      expect.objectContaining({ kind: "podcast-episode", itemId: "ep-1", slider: 73 }),
    ]));
  });
});
