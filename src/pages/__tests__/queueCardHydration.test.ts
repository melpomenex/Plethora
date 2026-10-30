import { describe, expect, it, vi } from "vitest";
import { normalizeLearningItem } from "../../api/normalizeLearningItem";
import { resolveMissingQueueCards } from "../queueScrollItemTypes";

const camelCard = (id: string) => ({
  id, documentId: "document", extractId: "extract", itemType: "cloze", question: "{{c1::answer}}", clozeText: "{{c1::answer}}",
  clozeRanges: [[0, 3]], interactionMetadata: { imageOcclusionRegions: [{ x: 0.2 }] }, imageAssetIds: ["asset"],
  difficulty: 1, interval: 10, easeFactor: 2.5, dueDate: "2026-11-01T00:00:00Z",
  dateCreated: "2026-01-01T00:00:00Z", dateModified: "2026-01-01T00:00:00Z", reviewCount: 3, lapses: 0,
  state: "review", isSuspended: false, tags: ["tag"],
});
const row = (id: string) => ({ id: `row-${id}`, itemType: "learning-item" as const, learningItemId: id });

describe("queue card hydration", () => {
  it("normalizes browser and native top-level fields while retaining source and authored metadata", () => {
    const card = normalizeLearningItem(camelCard("a"));
    expect(card).toMatchObject({ id: "a", item_type: "Cloze", state: "Review", document_id: "document", extract_id: "extract",
      cloze_text: "{{c1::answer}}", cloze_ranges: [[0, 3]], image_asset_ids: ["asset"], interaction_metadata: { imageOcclusionRegions: [{ x: 0.2 }] } });
    expect(normalizeLearningItem({ id: "a", question: "partial" })).toBeNull();
    expect(normalizeLearningItem({ ...camelCard("a"), _deleted: true })).toBeNull();
  });

  it("deduplicates bounded reads and separates unavailable cards from transport failures", async () => {
    let active = 0, maximum = 0;
    const fetch = vi.fn(async (id: string) => {
      active += 1; maximum = Math.max(active, maximum);
      await Promise.resolve(); active -= 1;
      if (id === "failure") throw new Error("offline");
      if (id === "deleted") return null;
      if (id === "suspended") return { ...camelCard(id), isSuspended: true } as never;
      return camelCard(id) as never;
    });
    const due = new Map([["due", normalizeLearningItem(camelCard("due"))!]]);
    const rows = [row("due"), row("a"), row("a"), row("failure"), row("deleted"), row("suspended"),
      ...Array.from({ length: 12 }, (_, index) => row(`extra-${index}`)), row("rated")];
    const result = await resolveMissingQueueCards(rows, due, fetch, new Set(["rated"]));
    expect(fetch).toHaveBeenCalledTimes(16);
    expect(maximum).toBeLessThanOrEqual(8);
    expect(result.cards.get("a")?.extract_id).toBe("extract");
    expect(result.cards.has("deleted")).toBe(false);
    expect(result.cards.has("suspended")).toBe(false);
    expect(result.failures).toEqual(["failure"]);
  });
});
