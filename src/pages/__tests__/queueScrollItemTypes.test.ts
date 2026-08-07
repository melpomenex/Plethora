import { describe, expect, it, vi } from "vitest";
import { gateScrollItemsByType, resolveMissingExtractContent } from "../queueScrollItemTypes";
import type { SessionItemTypes } from "../../utils/reviewUx";
import type { Extract } from "../../api/extracts";
import type { QueueItem } from "../../types/queue";

const ALL_ON: SessionItemTypes = { documents: true, extracts: true, learningItems: true };
const EXTRACTS_ONLY: SessionItemTypes = { documents: false, extracts: true, learningItems: false };
const EXTRACTS_AND_DOCUMENTS: SessionItemTypes = { documents: true, extracts: true, learningItems: false };
const FLASHCARDS_ONLY: SessionItemTypes = { documents: false, extracts: false, learningItems: true };
const NONE: SessionItemTypes = { documents: false, extracts: false, learningItems: false };

interface Item {
  id: string;
  type: string;
}

const doc = (id: string): Item => ({ id, type: "document" });
const extract = (id: string): Item => ({ id, type: "extract" });
const flashcard = (id: string): Item => ({ id, type: "flashcard" });
const rss = (id: string): Item => ({ id, type: "rss" });
const podcast = (id: string): Item => ({ id, type: "podcast" });

describe("gateScrollItemsByType", () => {
  // The reported bug: filtering the Queue to Extracts then pressing "Start
  // Optimal Session" handed the user source documents anyway.
  it("extracts only: keeps extracts, drops documents and flashcards", () => {
    const gated = gateScrollItemsByType(
      [doc("d1"), extract("e1"), flashcard("f1"), doc("d2")],
      EXTRACTS_ONLY,
    );
    expect(gated.map((i) => i.id)).toEqual(["e1"]);
  });

  it("extracts + documents: keeps both, drops flashcards", () => {
    const gated = gateScrollItemsByType(
      [doc("d1"), extract("e1"), flashcard("f1"), extract("e2"), doc("d2")],
      EXTRACTS_AND_DOCUMENTS,
    );
    expect(gated.map((i) => i.id)).toEqual(["d1", "e1", "e2", "d2"]);
  });

  it("flashcards only: keeps flashcards only", () => {
    const gated = gateScrollItemsByType(
      [doc("d1"), extract("e1"), flashcard("f1"), flashcard("f2")],
      FLASHCARDS_ONLY,
    );
    expect(gated.map((i) => i.id)).toEqual(["f1", "f2"]);
  });

  it("all three selected: nothing is filtered", () => {
    const items = [doc("d1"), extract("e1"), flashcard("f1"), extract("e2"), doc("d2")];
    expect(gateScrollItemsByType(items, ALL_ON)).toEqual(items);
  });

  it("none selected: every toggle-covered item is dropped (empty session)", () => {
    const gated = gateScrollItemsByType(
      [doc("d1"), extract("e1"), flashcard("f1")],
      NONE,
    );
    expect(gated).toEqual([]);
  });

  // Feed items are not governed by the toggles: RSS articles and podcast
  // episodes always pass, matching the Queue list's own behaviour.
  it("feed items are not governed by the toggles", () => {
    const gated = gateScrollItemsByType(
      [doc("d1"), rss("r1"), podcast("p1"), flashcard("f1")],
      EXTRACTS_ONLY,
    );
    expect(gated.map((i) => i.id)).toEqual(["r1", "p1"]);
  });
});

const makeExtract = (id: string, content: string): Extract => ({
  id,
  document_id: `doc-${id}`,
  content,
  progressive_disclosure_level: 0,
  max_disclosure_level: 0,
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  tags: [],
  review_count: 0,
  reps: 0,
});

// Typed queue-row factories: keeps `itemType` as the QueueItem union instead of
// widening to `string` when rows with different types share an array.
type QueueRow = Pick<QueueItem, "itemType" | "extractId" | "id">;
const extractRow = (id: string, extractId: string): QueueRow => ({ id, itemType: "extract", extractId });
const documentRow = (id: string): QueueRow => ({ id, itemType: "document" });

describe("resolveMissingExtractContent", () => {
  // The reported bug: a queue extract whose next review date is in the future
  // (not in the due set) rendered as a truncated `learningHint` preview or a
  // blank card because only due extracts were looked up.
  it("fetches and returns full content for extracts missing from the due set", async () => {
    const dueMap = new Map<string, Extract>([["due-1", makeExtract("due-1", "due content")]]);
    const fetchOne = vi.fn(async (id: string) =>
      id === "non-due-1" ? makeExtract("non-due-1", "FULL CONTENT of the extract") : null,
    );

    const resolved = await resolveMissingExtractContent(
      [
        extractRow("row-1", "non-due-1"),
        extractRow("row-2", "due-1"),
        documentRow("row-3"),
      ],
      dueMap,
      fetchOne,
    );

    expect(resolved.get("non-due-1")?.content).toBe("FULL CONTENT of the extract");
    // Due extracts come from the in-memory map — no fetch for them.
    expect(resolved.has("due-1")).toBe(false);
    expect(fetchOne).toHaveBeenCalledTimes(1);
    expect(fetchOne).toHaveBeenCalledWith("non-due-1");
  });

  it("omits extracts whose content cannot be resolved (deleted)", async () => {
    const dueMap = new Map<string, Extract>();
    const fetchOne = vi.fn(async () => null); // deleted → getExtract resolves null

    const resolved = await resolveMissingExtractContent(
      [extractRow("row-1", "deleted-1")],
      dueMap,
      fetchOne,
    );

    expect(resolved.has("deleted-1")).toBe(false);
    expect(resolved.size).toBe(0);
  });

  it("fetches each missing extract exactly once (batched Promise.all)", async () => {
    const dueMap = new Map<string, Extract>();
    const fetchOne = vi.fn(async (id: string) => makeExtract(id, `content ${id}`));

    const resolved = await resolveMissingExtractContent(
      [
        extractRow("row-1", "a"),
        extractRow("row-2", "b"),
        // Duplicate id in two rows must not double-fetch.
        extractRow("row-3", "a"),
      ],
      dueMap,
      fetchOne,
    );

    expect(fetchOne).toHaveBeenCalledTimes(2);
    expect(resolved.get("a")?.content).toBe("content a");
    expect(resolved.get("b")?.content).toBe("content b");
  });

  it("does not fetch extracts already rated this session (rebuild safety)", async () => {
    const dueMap = new Map<string, Extract>();
    const fetchOne = vi.fn(async (id: string) => makeExtract(id, `content ${id}`));

    const resolved = await resolveMissingExtractContent(
      [
        extractRow("row-1", "a"),
        extractRow("row-2", "b"),
      ],
      dueMap,
      fetchOne,
      new Set(["a"]), // "a" was rated → the queue-list rebuild must not re-fetch it
    );

    expect(fetchOne).toHaveBeenCalledTimes(1);
    expect(fetchOne).toHaveBeenCalledWith("b");
    expect(resolved.has("a")).toBe(false);
  });

  it("treats a throwing fetch as unresolvable instead of aborting the batch", async () => {
    const dueMap = new Map<string, Extract>();
    const fetchOne = vi.fn(async (id: string) => {
      if (id === "broken") throw new Error("backend down");
      return makeExtract(id, `content ${id}`);
    });

    // Must resolve (not reject): one failed fetch must not kill the whole
    // sequential session build.
    const resolved = await resolveMissingExtractContent(
      [
        extractRow("row-1", "broken"),
        extractRow("row-2", "ok"),
      ],
      dueMap,
      fetchOne,
    );

    expect(resolved.has("broken")).toBe(false);
    expect(resolved.get("ok")?.content).toBe("content ok");
  });

  it("serves already-resolved extracts from the session cache without re-fetching", async () => {
    const dueMap = new Map<string, Extract>();
    const fetchOne = vi.fn(async (id: string) => makeExtract(id, `content ${id}`));
    const cache = new Map<string, Extract>();
    const items: QueueRow[] = [extractRow("row-1", "a"), extractRow("row-2", "b")];

    // First rebuild resolves both.
    const first = await resolveMissingExtractContent(items, dueMap, fetchOne, undefined, cache);
    expect(fetchOne).toHaveBeenCalledTimes(2);
    expect(first.get("a")?.content).toBe("content a");

    // A later rebuild (e.g. after rating another card) must not re-fetch: the
    // cache serves the same content with zero additional calls.
    const second = await resolveMissingExtractContent(items, dueMap, fetchOne, undefined, cache);
    expect(fetchOne).toHaveBeenCalledTimes(2); // unchanged
    expect(second.get("a")?.content).toBe("content a");
    expect(second.get("b")?.content).toBe("content b");
  });
});
