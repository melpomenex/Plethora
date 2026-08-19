import { describe, it, expect } from "vitest";
import type { QueueItem } from "../../types/queue";
import {
  applyFilters,
  getPriorityScore,
  getPriorityVector,
  getQueueStatus,
  getTimeEstimateRange,
  isScheduledItem,
  orderQueueItems,
  splitPriorityTargets,
} from "../reviewUx";

const baseItem = (overrides: Partial<QueueItem>): QueueItem => ({
  id: "1",
  documentId: "doc",
  documentTitle: "Doc",
  itemType: "learning-item",
  priority: 7,
  estimatedTime: 3,
  tags: ["History"],
  progress: 20,
  ...overrides,
});

describe("splitPriorityTargets", () => {
  it("routes document-less cards to the learning-item path", () => {
    // The regression: an Anki/extension card has documentId "", and sending
    // that to update_document_priority failed with `Document ` not found.
    const { documentIds, learningItemIds } = splitPriorityTargets([
      baseItem({ id: "a", documentId: "", learningItemId: "card-1" }),
      baseItem({ id: "b", documentId: "doc-1" }),
    ]);
    expect(documentIds).toEqual(["doc-1"]);
    expect(learningItemIds).toEqual(["card-1"]);
  });

  it("never emits an empty id on either path", () => {
    const { documentIds, learningItemIds } = splitPriorityTargets([
      baseItem({ id: "a", documentId: "", learningItemId: undefined }),
      baseItem({ id: "b", documentId: "" }),
    ]);
    expect(documentIds).toEqual([]);
    expect(learningItemIds).toEqual([]);
  });

  it("de-duplicates cards sharing one source document", () => {
    const { documentIds } = splitPriorityTargets([
      baseItem({ id: "a", documentId: "doc-1", learningItemId: "card-1" }),
      baseItem({ id: "b", documentId: "doc-1", learningItemId: "card-2" }),
    ]);
    expect(documentIds).toEqual(["doc-1"]);
  });
});

describe("reviewUx helpers", () => {
  it("computes priority vector ranges", () => {
    const vector = getPriorityVector(baseItem({}));
    expect(vector.retentionRisk).toBeGreaterThan(0);
    expect(vector.cognitiveLoad).toBeGreaterThan(0);
  });

  it("scores items using presets", () => {
    const score = getPriorityScore(baseItem({ priority: 9 }), "maximize-retention");
    expect(score).toBeGreaterThan(0);
  });

  it("returns drifted status for overdue items", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(getQueueStatus(baseItem({ itemType: "document", dueDate: twoDaysAgo }))).toBe("drifted");
  });

  it("creates time estimate ranges", () => {
    const range = getTimeEstimateRange(baseItem({ estimatedTime: 4 }));
    expect(range.min).toBeLessThanOrEqual(range.max);
  });

  it("treats items with due dates as scheduled", () => {
    expect(isScheduledItem(baseItem({ dueDate: new Date().toISOString() }))).toBe(true);
  });

  it("orders mixed queue items and decorates visible positions", () => {
    const items = [
      baseItem({ id: "document", itemType: "document", priority: 4 }),
      baseItem({ id: "learning", itemType: "learning-item", priority: 9 }),
      baseItem({ id: "rss", itemType: "rss-article", priority: 6 }),
    ];

    const ordered = orderQueueItems(items, "maximize-retention");

    expect(ordered).toHaveLength(3);
    expect(ordered.map((item) => item.id)).toEqual(["learning", "rss", "document"]);
    expect(ordered.map((item) => item.queuePosition)).toEqual([1, 2, 3]);
    expect(ordered.every((item) => item.queueTotal === 3)).toBe(true);
    expect(ordered[0].isUpNext).toBe(true);
    expect(ordered.slice(1).every((item) => !item.isUpNext)).toBe(true);
  });

  it("keeps equal-ranked items stable with deterministic tie breakers", () => {
    const items = [
      baseItem({ id: "z-item", priority: 5 }),
      baseItem({ id: "a-item", priority: 5 }),
      baseItem({ id: "positioned", priority: 5, position: 1 }),
    ];

    expect(orderQueueItems(items).map((item) => item.id)).toEqual([
      "positioned",
      "a-item",
      "z-item",
    ]);
    expect(orderQueueItems(items).map((item) => item.id)).toEqual([
      "positioned",
      "a-item",
      "z-item",
    ]);
  });

  it("interleaves documents into a card-dominated queue", () => {
    // A real library: hundreds of overdue Anki-imported cards that all score
    // ~73, and documents that all score ~59 (never read, no user priority set).
    // A plain priority sort puts every card ahead of every document, which is
    // what made Due All look like a flashcard-only queue while Scroll Mode —
    // ordering by the same combined criterion this now uses — showed EPUBs.
    const overdue = new Date(Date.now() - 37 * 24 * 60 * 60 * 1000).toISOString();
    const cards = Array.from({ length: 100 }, (_, i) =>
      baseItem({
        id: `card-${i}`,
        itemType: "learning-item",
        priority: 9.9,
        estimatedTime: 1,
        dueDate: overdue,
        tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        progress: 0,
      }),
    );
    const documents = Array.from({ length: 20 }, (_, i) =>
      baseItem({
        id: `doc-${i}`,
        itemType: "document",
        priority: 10,
        estimatedTime: 5,
        dueDate: undefined,
        priorityRating: 0,
        prioritySlider: 0,
        progress: 0,
      }),
    );

    const ordered = orderQueueItems([...cards, ...documents], "exploratory");
    const firstDocument = ordered.findIndex((item) => item.itemType === "document");

    expect(firstDocument).toBeGreaterThanOrEqual(0);
    expect(firstDocument).toBeLessThan(10);
  });

  it("numbers only the currently visible filtered items", () => {
    const filtered = [
      baseItem({ id: "second-visible", priority: 6 }),
      baseItem({ id: "first-visible", priority: 8 }),
    ];

    const ordered = orderQueueItems(filtered);

    expect(ordered.map((item) => item.queuePosition)).toEqual([1, 2]);
    expect(ordered.map((item) => item.queueTotal)).toEqual([2, 2]);
  });
});

describe("applyFilters", () => {
  const items: QueueItem[] = [
    baseItem({ id: "1", tags: ["physics"], category: "Chapter 1", itemType: "document" }),
    baseItem({ id: "2", tags: ["math"], category: "Chapter 2", itemType: "document" }),
    baseItem({ id: "3", tags: ["physics", "math"], category: "Chapter 1", itemType: "extract" }),
    baseItem({ id: "4", tags: ["history"], category: "Chapter 3", itemType: "learning-item" }),
    baseItem({ id: "5", tags: [], category: "", itemType: "learning-item", status: "suspended" } as any),
  ];

  // 3.1 Tag filter
  describe("tag filter", () => {
    it("filters by single tag", () => {
      const result = applyFilters(items, { filters: { tags: ["physics"], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.every((item) => item.tags?.includes("physics"))).toBe(true);
      expect(result.length).toBe(2);
    });

    it("filters by multiple tags with OR logic", () => {
      const result = applyFilters(items, { filters: { tags: ["physics", "math"], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.length).toBe(3);
    });

    it("passes all items when no tags selected", () => {
      const result = applyFilters(items, { filters: { tags: [], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.length).toBe(items.length);
    });
  });

  // 3.2 Category filter
  describe("category filter", () => {
    it("filters by single category", () => {
      const result = applyFilters(items, { filters: { tags: [], categories: ["Chapter 1"], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.every((item) => item.category === "Chapter 1")).toBe(true);
      expect(result.length).toBe(2);
    });

    it("filters by multiple categories with OR logic", () => {
      const result = applyFilters(items, { filters: { tags: [], categories: ["Chapter 1", "Chapter 2"], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.length).toBe(3);
    });

    it("passes all items when no categories selected", () => {
      const result = applyFilters(items, { filters: { tags: [], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.length).toBe(items.length);
    });
  });

  // 3.3 Priority range filter
  describe("priority range filter", () => {
    it("filters by narrow priority range", () => {
      const allItems = [
        baseItem({ id: "1", priority: 1, itemType: "document" }),
        baseItem({ id: "2", priority: 5, itemType: "document" }),
        baseItem({ id: "3", priority: 10, itemType: "document" }),
      ];
      const scores = allItems.map((item) => getPriorityScore(item, "maximize-retention"));
      const midScore = scores[1];

      const result = applyFilters(allItems, {
        filters: { tags: [], categories: [], priorityRange: { min: midScore - 1, max: midScore + 1 }, excludeSuspended: false },
        priorityPreset: "maximize-retention",
      });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("2");
    });

    it("passes all items with default range 0-100", () => {
      const result = applyFilters(items, { filters: { tags: [], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.length).toBe(items.length);
    });
  });

  // 3.4 Exclude suspended filter
  describe("exclude suspended filter", () => {
    it("excludes suspended items when enabled", () => {
      const result = applyFilters(items, { filters: { tags: [], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: true } });
      expect(result.every((item) => (item as any).status !== "suspended")).toBe(true);
    });

    it("includes suspended items when disabled", () => {
      const result = applyFilters(items, { filters: { tags: [], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: false } });
      expect(result.some((item) => (item as any).status === "suspended")).toBe(true);
    });
  });

  // 3.5 Item type filter
  describe("item type filter", () => {
    it("filters to documents only", () => {
      const result = applyFilters(items, { itemTypes: { documents: true, extracts: false, learningItems: false } });
      expect(result.every((item) => item.itemType === "document")).toBe(true);
    });

    it("filters to learning items only", () => {
      const result = applyFilters(items, { itemTypes: { documents: false, extracts: false, learningItems: true } });
      expect(result.every((item) => item.itemType === "learning-item")).toBe(true);
    });

    it("filters to extracts only", () => {
      const result = applyFilters(items, { itemTypes: { documents: false, extracts: true, learningItems: false } });
      expect(result.every((item) => item.itemType === "extract")).toBe(true);
      expect(result.length).toBe(1);
    });

    it("passes all items when all types enabled", () => {
      const result = applyFilters(items, { itemTypes: { documents: true, extracts: true, learningItems: true } });
      expect(result.length).toBe(items.length);
    });
  });

  // 3.6 Filter composition
  describe("filter composition", () => {
    it("applies tag AND category together", () => {
      const result = applyFilters(items, {
        filters: { tags: ["physics"], categories: ["Chapter 1"], priorityRange: { min: 0, max: 100 }, excludeSuspended: false },
      });
      expect(result.length).toBe(2); // items 1 and 3 have tag "physics" AND category "Chapter 1"
    });

    it("applies tag AND priority range together", () => {
      const result = applyFilters(items, {
        filters: { tags: ["physics"], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: false },
        priorityPreset: "maximize-retention",
      });
      expect(result.every((item) => item.tags?.includes("physics"))).toBe(true);
    });

    it("applies all filters combined", () => {
      const result = applyFilters(items, {
        itemTypes: { documents: true, extracts: false, learningItems: false },
        filters: { tags: ["physics"], categories: ["Chapter 1"], priorityRange: { min: 0, max: 100 }, excludeSuspended: true },
      });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("1");
    });
  });
});
