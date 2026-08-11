import type { ItemTagType } from "./types";
import { subscribeItemTagsUpdated } from "./itemTagEvents";
import { useDocumentStore } from "../../stores/documentStore";
import { useExtractStore } from "../../stores/extractStore";
import { useQueueStore } from "../../stores/queueStore";

/**
 * Store reconciliation for successful tag mutations (design decision 3:
 * "update the matching entity or perform their existing bounded refresh").
 * Each handler performs a LOCAL merge — no refetch, no extra Tauri round
 * trip — so virtualized lists keep their position and mounted views converge
 * without a full reload.
 *
 * - Document store: merge tags into the matching document row(s).
 * - Extract store: merge tags into the matching extract row.
 * - Queue store: merge tags into the matching queue item (queue item ids are
 *   the entity ids for documents/extracts/learning-items).
 *
 * Kept separate from the pure pub/sub module (`itemTagEvents.ts`) so
 * surfaces that only subscribe (e.g. ScheduleView) don't pull the store
 * chain into their bundle.
 */

/** Apply a persisted tag list to the mounted stores that hold the item. */
export function applyItemTagsToStores(itemType: ItemTagType, id: string, tags: string[]): void {
  if (itemType === "document") {
    const doc = useDocumentStore
      .getState()
      .documents.find((d) => (d as { id?: string }).id === id);
    // Pass the document's existing dateModified through so the local merge
    // does NOT stamp a fresh one (documentStore.updateDocument stamps unless
    // the caller provides it) — stamping would re-sort the library on any tag
    // edit from any surface and can cause a re-render loop. See
    // documentStore.updateDocument's own sort-stability comment.
    useDocumentStore
      .getState()
      .updateDocument(id, { tags, dateModified: (doc as { dateModified?: string } | undefined)?.dateModified ?? new Date().toISOString() });
    return;
  }

  if (itemType === "extract") {
    useExtractStore.getState().patchExtractTags(id, tags);
    return;
  }

  if (itemType === "learning-item") {
    useQueueStore.getState().applyItemDelta(id, { tags });
    return;
  }
}

/**
 * Wire the store reconciliation listeners. Call once at app bootstrap.
 * Idempotent.
 */
let wired = false;
export function wireTagUpdateReconciliation(): void {
  if (wired) return;
  wired = true;

  subscribeItemTagsUpdated(({ itemType, id, tags }) => {
    applyItemTagsToStores(itemType, id, tags);
  });
}
