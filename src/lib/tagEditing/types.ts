/**
 * Shared contracts for cross-surface persisted item tag editing
 * (openspec change: unify-tag-editing-and-align-schedule-grid).
 *
 * Every persisted document / extract / learning-item tag presentation is
 * expected to route its mutations through these types so validation, busy
 * state, rollback, and cross-view reconciliation stay consistent.
 */

/** The three persisted item kinds whose tags the app can mutate. */
export type ItemTagType = "document" | "extract" | "learning-item";

/**
 * A stable identity for a persisted tag-bearing item. `id` is the entity id
 * used by the existing update APIs (document.id, extract.id, learningItem.id).
 * `tags` is the currently known persisted tag list (may be a stale snapshot;
 * editors reconcile from the persisted response).
 */
export interface ItemTagTarget {
  type: ItemTagType;
  id: string;
  tags: string[];
}

/**
 * Editor presentation modes:
 * - `inline`: removable chips plus an add input rendered directly on the
 *   surface (full detail panels, inspectors, expanded rows).
 * - `compact`: a readable chip preview with an explicit edit affordance that
 *   opens a small focus-managed popover containing the same editor (dense
 *   cards/rows where inline controls would compromise scan density).
 */
export type ItemTagEditorMode = "inline" | "compact";

/** Result of a successful tag mutation (the persisted tag list). */
export interface ItemTagMutationResult {
  /** The complete tag list that was persisted. */
  tags: string[];
}

/**
 * Typed detail for the `plethora:item-tags-updated` window event.
 * Published only AFTER a mutation is persisted successfully, so mounted
 * consumers converge on the persisted tag list without a full reload.
 */
export interface ItemTagsUpdatedDetail {
  itemType: ItemTagType;
  id: string;
  tags: string[];
}

/** Window CustomEvent name for successful tag mutations. */
export const ITEM_TAGS_UPDATED_EVENT = "plethora:item-tags-updated";
