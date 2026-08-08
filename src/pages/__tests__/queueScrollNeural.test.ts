import { describe, it, expect } from "vitest";
import {
  buildNeuralScrollItems,
  neuralSeedFromItem,
  NEURAL_FETCH_BATCH,
} from "../queueScrollNeural";
import type { ResolvedNeuralQueueEntry } from "../../api/neural-queue";
import type { Document } from "../../types/document";
import type { LearningItem } from "../../api/learning-items";
import type { Extract } from "../../api/extracts";

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    title: "Cellular Respiration",
    filePath: "/cell-resp.epub",
    fileType: "epub",
    collectionId: "col",
    content: "",
    contentHash: "",
    tags: [],
    dateAdded: new Date().toISOString(),
    dateModified: new Date().toISOString(),
    isArchived: false,
    isFavorite: false,
    isDismissed: false,
    ...overrides,
  } as unknown as Document;
}

function makeCard(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: "card-1",
    question: "What is the powerhouse of the cell?",
    answer: "Mitochondria",
    item_type: "qa",
    tags: ["biology"],
    ...overrides,
  } as unknown as LearningItem;
}

function makeExtract(overrides: Partial<Extract> = {}): Extract {
  return {
    id: "ext-1",
    document_id: "doc-1",
    text: "Extracted passage",
    category: "biology",
    ...overrides,
  } as unknown as Extract;
}

function makeEntry(
  elementId: number,
  kind: ResolvedNeuralQueueEntry["element_kind"],
  refId: string,
  position: number,
  priorityValue = 0.1,
): ResolvedNeuralQueueEntry {
  return { element_id: elementId, position, priority_value: priorityValue, element_kind: kind, element_ref_id: refId };
}

// ── neuralSeedFromItem ────────────────────────────────────────────────────

describe("neuralSeedFromItem", () => {
  it("derives a document seed from documentId", () => {
    expect(neuralSeedFromItem({ type: "document", documentId: "doc-1" })).toEqual({
      kind: "document",
      refId: "doc-1",
    });
  });

  it("derives a learning_item seed from the learning item id", () => {
    expect(neuralSeedFromItem({ type: "flashcard", learningItem: { id: "card-1" } })).toEqual({
      kind: "learning_item",
      refId: "card-1",
    });
  });

  it("derives an extract seed from the extract id", () => {
    expect(neuralSeedFromItem({ type: "extract", extract: { id: "ext-1" } })).toEqual({
      kind: "extract",
      refId: "ext-1",
    });
  });

  it("returns null for RSS/podcast items (no element_tree node)", () => {
    expect(neuralSeedFromItem({ type: "rss" })).toBeNull();
    expect(neuralSeedFromItem({ type: "podcast" })).toBeNull();
    expect(neuralSeedFromItem(undefined)).toBeNull();
  });

  it("returns null when a document/card/extract lacks its id", () => {
    expect(neuralSeedFromItem({ type: "document" })).toBeNull();
    expect(neuralSeedFromItem({ type: "flashcard" })).toBeNull();
    expect(neuralSeedFromItem({ type: "extract" })).toBeNull();
  });
});

// ── buildNeuralScrollItems ────────────────────────────────────────────────

describe("buildNeuralScrollItems", () => {
  it("resolves entries of all three kinds in presentation order", async () => {
    const doc = makeDoc();
    const card = makeCard();
    const ext = makeExtract();
    const entries = [
      makeEntry(10, "document", doc.id, 1),
      makeEntry(20, "learning_item", card.id, 2),
      makeEntry(30, "extract", ext.id, 3),
    ];

    const items = await buildNeuralScrollItems(entries, new Map([[doc.id, doc]]), "Untitled", {
      fetchAllLearningItems: async () => [card],
      fetchAllExtracts: async () => [ext],
      fetchDocument: async () => undefined,
    });

    expect(items.map((i) => i.type)).toEqual(["document", "flashcard", "extract"]);
    expect(items.map((i) => i.neuralElementId)).toEqual([10, 20, 30]);
  });

  it("uses neural-<element_id> as the stable id so consume/refill can correlate", async () => {
    const doc = makeDoc();
    const items = await buildNeuralScrollItems(
      [makeEntry(42, "document", doc.id, 1)],
      new Map([[doc.id, doc]]),
      "Untitled",
      { fetchAllLearningItems: async () => [], fetchAllExtracts: async () => [] },
    );
    expect(items[0].id).toBe("neural-42");
  });

  it("skips archived and dismissed documents", async () => {
    const archived = makeDoc({ id: "archived", isArchived: true });
    const dismissed = makeDoc({ id: "dismissed", isDismissed: true });
    const active = makeDoc({ id: "active" });
    const entries = [
      makeEntry(1, "document", "archived", 1),
      makeEntry(2, "document", "dismissed", 2),
      makeEntry(3, "document", "active", 3),
    ];
    const items = await buildNeuralScrollItems(entries, new Map(), "Untitled", {
      fetchDocument: async (id) =>
        id === "archived" ? archived : id === "dismissed" ? dismissed : active,
      fetchAllLearningItems: async () => [],
      fetchAllExtracts: async () => [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].documentId).toBe("active");
  });

  it("returns [] for an empty entry list", async () => {
    const items = await buildNeuralScrollItems([], new Map(), "Untitled");
    expect(items).toEqual([]);
  });

  it("NEURAL_FETCH_BATCH exceeds the 20-element refill threshold", () => {
    // So the front isn't refetched on every advance.
    expect(NEURAL_FETCH_BATCH).toBeGreaterThan(20);
  });
});
