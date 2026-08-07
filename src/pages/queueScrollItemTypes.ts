import type { Extract } from "../api/extracts";
import type { QueueItem } from "../types/queue";
import type { SessionItemTypes } from "../utils/reviewUx";

/**
 * Gate a list of scroll items by the Queue's item-type selection
 * (Documents / Extracts / Flashcards).
 *
 * An item whose type is covered by the toggles is dropped when that type is
 * unchecked; types the toggles do not cover (rss, podcast, ...) always pass,
 * matching how the Queue list itself treats them.
 *
 * The optimal Scroll Mode builder applies this to each source collection
 * (documents, flashcards, extracts) UPSTREAM of `splitReviewBudget` and
 * `applyVarietyMixing`, so the budget arithmetic operates on the real, gated
 * totals instead of computing against items that are later thrown away.
 */
export function gateScrollItemsByType<T extends { type: string }>(
  items: T[],
  itemTypes: SessionItemTypes
): T[] {
  return items.filter((item) => {
    switch (item.type) {
      case "document":
        return itemTypes.documents;
      case "flashcard":
        return itemTypes.learningItems;
      case "extract":
        return itemTypes.extracts;
      default:
        return true;
    }
  });
}

/**
 * Resolve full extract content for sequential Scroll Mode queue items.
 *
 * Queue rows for extracts that are NOT part of the currently-due extract set
 * carry only a bounded `learningHint` preview. This collects those rows,
 * fetches the real extracts in one batched `Promise.all`, and returns a map
 * of extractId → Extract. Extracts that cannot be resolved (deleted —
 * `fetchOne` returns null — or a fetch that throws) are left out of the map,
 * so the caller omits them from the session instead of rendering a blank or
 * truncated card.
 *
 * `skipIds` (e.g. extracts already rated this session) are not fetched at
 * all. `cache` (a per-tab-session map held by the caller) is checked first
 * and written on success, so a rebuild triggered by a rating does not
 * re-fetch the non-due extracts it already resolved — the queue-list rebuild
 * re-derives from static tab data on every interaction, so without the cache
 * each rating would re-issue a fetch per remaining non-due extract.
 */
export async function resolveMissingExtractContent(
  items: Pick<QueueItem, "itemType" | "extractId" | "id">[],
  extractsMap: ReadonlyMap<string, Extract>,
  fetchOne: (id: string) => Promise<Extract | null>,
  skipIds?: ReadonlySet<string>,
  cache?: Map<string, Extract>
): Promise<Map<string, Extract>> {
  const missingIds = items
    .filter((item) => item.itemType === "extract")
    .map((item) => item.extractId ?? item.id)
    .filter(
      (id) =>
        !extractsMap.has(id) &&
        !(skipIds?.has(id) ?? false) &&
        !(cache?.has(id) ?? false)
    );
  const uniqueIds = [...new Set(missingIds)];
  const results = await Promise.all(
    uniqueIds.map(async (id) => {
      // A backend failure is treated like a missing extract: the item is
      // omitted rather than letting one failed fetch abort the whole
      // session build.
      try {
        return await fetchOne(id);
      } catch {
        return null;
      }
    })
  );
  for (const extract of results) {
    if (extract) cache?.set(extract.id, extract);
  }
  // Return everything resolvable for the requested items: cached entries
  // (including ones resolved on a previous rebuild) plus this round's results.
  const resolved = new Map<string, Extract>();
  if (cache) {
    for (const item of items) {
      if (item.itemType !== "extract") continue;
      const id = item.extractId ?? item.id;
      const entry = cache.get(id);
      if (entry) resolved.set(id, entry);
    }
  }
  for (const extract of results) {
    if (extract) resolved.set(extract.id, extract);
  }
  return resolved;
}
