import { ITEM_TAGS_UPDATED_EVENT, type ItemTagsUpdatedDetail } from "./types";

/**
 * Lightweight window-event pub/sub for successful item tag mutations. This
 * module intentionally has NO store imports so any surface can subscribe
 * without pulling the store/browser-backend chain into its bundle (and into
 * component tests). Store reconciliation lives in `storeReconciliation.ts`.
 */

/** Publish a successful tag mutation so mounted consumers can converge. */
export function publishItemTagsUpdated(detail: ItemTagsUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ItemTagsUpdatedDetail>(ITEM_TAGS_UPDATED_EVENT, { detail }));
}

/** Subscribe to successful tag mutations. Returns an unsubscribe function. */
export function subscribeItemTagsUpdated(handler: (detail: ItemTagsUpdatedDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    handler((event as CustomEvent<ItemTagsUpdatedDetail>).detail);
  };
  window.addEventListener(ITEM_TAGS_UPDATED_EVENT, listener);
  return () => window.removeEventListener(ITEM_TAGS_UPDATED_EVENT, listener);
}
