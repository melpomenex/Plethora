import { invokeCommand } from "../lib/tauri";
import type { QueueItem } from "../types/queue";

export interface QueueStats {
  total_items: number;
  due_today: number;
  overdue: number;
  new_items: number;
  learning_items: number;
  review_items: number;
  total_estimated_time: number;
  suspended: number;
}

export interface BulkOperationResult {
  succeeded: string[];
  failed: string[];
  errors: string[];
}

export interface QueueExportItem {
  id: string;
  document_title: string;
  item_type: string;
  question: string;
  answer?: string;
  due_date: string;
  state: string;
  interval: number;
  tags: string[];
  category?: string;
}

// Internal type matching Rust backend (snake_case)
export interface RustQueueItem {
  id: string;
  document_id: string;
  document_title: string;
  extract_id?: string;
  learning_item_id?: string;
  question?: string;
  answer?: string;
  cloze_text?: string;
  learning_hint?: string;
  item_type: string;
  priority_rating?: number;
  priority_slider?: number;
  priority: number;
  due_date?: string;
  estimated_time: number;
  tags: string[];
  category?: string;
  progress: number;
  source?: string;
  position?: number;
  stability?: number;
  difficulty?: number;
  interval?: number;
  retrievability?: number;
  lapses?: number;
  reps?: number;
}

// Convert from Rust snake_case to TypeScript camelCase
export function convertQueueItem(item: RustQueueItem): QueueItem {
  if (!Array.isArray(item.tags)) {
    console.warn("[queue] Normalizing null tags for item", item.id);
  }
  return {
    id: item.id,
    documentId: item.document_id,
    documentTitle: item.document_title ?? "",
    extractId: item.extract_id,
    learningItemId: item.learning_item_id,
    question: item.question,
    answer: item.answer,
    clozeText: item.cloze_text,
    learningHint: item.learning_hint,
    itemType: item.item_type as "document" | "extract" | "learning-item" | "playlist-video",
    priorityRating: item.priority_rating,
    prioritySlider: item.priority_slider,
    priority: item.priority,
    dueDate: item.due_date,
    estimatedTime: item.estimated_time,
    tags: Array.isArray(item.tags) ? item.tags : [],
    category: item.category,
    progress: item.progress,
    source: item.source,
    position: item.position,
    stability: item.stability,
    difficulty: item.difficulty,
    interval: item.interval,
    retrievability: item.retrievability,
    lapses: item.lapses,
    reps: item.reps,
  };
}

/**
 * Get all queue items
 */
export async function getQueue(collectionId?: string): Promise<QueueItem[]> {
  const items = await invokeCommand<RustQueueItem[] | null>("get_queue", { collectionId });
  if (!Array.isArray(items)) {
    console.warn("[queue] get_queue returned non-array result", items);
    return [];
  }
  return items.map(convertQueueItem);
}

/**
 * Get only due documents (FSRS-scheduled documents with next_reading_date <= now)
 * This provides a "Due Today" view focused specifically on documents
 */
export async function getDueDocumentsOnly(collectionId?: string): Promise<QueueItem[]> {
  const items = await invokeCommand<RustQueueItem[] | null>("get_due_documents_only", { collectionId });
  if (!Array.isArray(items)) {
    console.warn("[queue] get_due_documents_only returned non-array result", items);
    return [];
  }
  return items.map(convertQueueItem);
}

/**
 * Get queue items scheduled through the end of today
 * (includes documents, extracts, and learning items)
 */
export async function getDueQueueItems(randomness?: number, collectionId?: string): Promise<QueueItem[]> {
  const items = await invokeCommand<RustQueueItem[] | null>("get_due_queue_items", { randomness, collectionId });
  if (!Array.isArray(items)) {
    console.warn("[queue] get_due_queue_items returned non-array result", items);
    return [];
  }
  return items.map(convertQueueItem);
}

/**
 * Where an element sits in the global priority queue, right now.
 *
 * Nothing stores these numbers — they are derived from the element's rank each
 * time you ask, so an untouched element's percentile drifts as the collection
 * grows: a priority is a position, not a value.
 */
export interface PriorityStanding {
  /** 0-100, higher = more important (same direction as the slider). */
  percentile: number;
  /** 1-based; position 1 is the most important element. */
  position: number;
  queueSize: number;
}

/**
 * Look up an element's live priority standing. `id` may be a document,
 * extract, or learning item — they share one queue. Returns null if the id
 * matches no queue element.
 */
export async function getPriorityStanding(id: string): Promise<PriorityStanding | null> {
  return invokeCommand<PriorityStanding | null>("get_priority_standing", { id });
}

/**
 * Get next item from the queue
 */
export async function getNextQueueItem(randomness?: number, collectionId?: string): Promise<QueueItem | null> {
  const item = await invokeCommand<RustQueueItem | null>("get_next_queue_item", { randomness, collectionId });
  return item ? convertQueueItem(item) : null;
}

/**
 * Get multiple items from the queue
 */
export async function getQueueItems(count?: number, randomness?: number, collectionId?: string): Promise<QueueItem[]> {
  const items = await invokeCommand<RustQueueItem[] | null>("get_queue_items", { count, randomness, collectionId });
  if (!Array.isArray(items)) {
    console.warn("[queue] get_queue_items returned non-array result", items);
    return [];
  }
  return items.map(convertQueueItem);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<QueueStats> {
  return await invokeCommand<QueueStats>("get_queue_stats");
}

/**
 * Postpone an item by N days.
 * Handles both learning items and documents (passes item_type to backend).
 *
 * Resolves to the item's NEW due date (RFC 3339) so the caller can apply the
 * mutation to local queue state without reloading the whole queue; `null` if
 * the backend returned an unexpected shape (callers should fall back to a
 * full reload in that case).
 */
export async function postponeItem(itemId: string, days: number, itemType?: string): Promise<string | null> {
  const newDueDate = await invokeCommand<unknown>("postpone_item", { itemId, days, itemType: itemType ?? null });
  if (itemType !== "document") {
  }
  return typeof newDueDate === "string" && newDueDate.length > 0 ? newDueDate : null;
}

/** Result of a bulk load-management operation (advance / load-balance / easy-days). */
export interface LoadManagementResult {
  affected: number;
  skipped: number;
}

/**
 * Advance an item by N days (inverse of postpone). Pulls a future-due item
 * closer to today. Memory state is preserved.
 */
export async function advanceItem(itemId: string, days: number, itemType?: string): Promise<boolean> {
  const res = await invokeCommand<boolean>("advance_item", { itemId, days, itemType: itemType ?? null });
  if (res && itemType !== "document") {
  }
  return res;
}

/**
 * Bulk-advance all items due within the next `days` (default 7) onto today.
 * Useful for "I have time now, let me get ahead" cramming.
 */
export async function advanceDueQueue(days?: number): Promise<LoadManagementResult> {
  const res = await invokeCommand<LoadManagementResult>("advance_due_queue", { days: days ?? null });

  return res;
}

/**
 * Redistribute the due pile across the next `windowDays` (default 14) so no
 * single day exceeds `targetPerDay`. When targetPerDay is null, defaults to
 * ceil(total / window * 1.25).
 */
export async function loadBalanceQueue(
  windowDays?: number,
  targetPerDay?: number
): Promise<LoadManagementResult> {
  const res = await invokeCommand<LoadManagementResult>("load_balance_queue", {
    windowDays: windowDays ?? null,
    targetPerDay: targetPerDay ?? null,
  });

  return res;
}

/**
 * Easy Days: shift any item due within the next `windowDays` (default 30) that
 * falls on an easy weekday (0=Sun..6=Sat) forward to the next non-easy day.
 */
export async function applyEasyDays(
  windowDays?: number,
  easyDays?: number[]
): Promise<LoadManagementResult> {
  const res = await invokeCommand<LoadManagementResult>("apply_easy_days", {
    windowDays: windowDays ?? null,
    easyDays: easyDays ?? null,
  });

  return res;
}

/**
 * Bulk suspend items
 */
export async function bulkSuspendItems(itemIds: string[]): Promise<BulkOperationResult> {
  const res = await invokeCommand<BulkOperationResult>("bulk_suspend_items", { itemIds });
  return res;
}

/**
 * Bulk unsuspend items
 */
export async function bulkUnsuspendItems(itemIds: string[]): Promise<BulkOperationResult> {
  const res = await invokeCommand<BulkOperationResult>("bulk_unsuspend_items", { itemIds });
  return res;
}

/**
 * Bulk delete items
 */
export async function bulkDeleteItems(itemIds: string[]): Promise<BulkOperationResult> {
  const res = await invokeCommand<BulkOperationResult>("bulk_delete_items", { itemIds });
  return res;
}

/**
 * Export queue data
 */
export async function exportQueue(): Promise<QueueExportItem[]> {
  return await invokeCommand<QueueExportItem[]>("export_queue");
}

/**
 * Get queue with playlist videos interspersed
 * Playlist videos are inserted at regular intervals based on subscription settings
 */
export async function getQueueWithPlaylistIntersperse(randomness?: number): Promise<QueueItem[]> {
  const items = await invokeCommand<RustQueueItem[] | null>("get_queue_with_playlist_intersperse", { randomness });
  if (!Array.isArray(items)) {
    console.warn("[queue] get_queue_with_playlist_intersperse returned non-array result", items);
    return [];
  }
  return items.map(convertQueueItem);
}

/** Lifecycle transitions accepted by `bulk_set_item_lifecycle`. */
export type LifecycleTransition = "done" | "dismiss" | "forget";

/**
 * Set one priority slider value (0-100) across a mixed selection.
 *
 * Flashcards have no priority column, so any learning-item ids come back in
 * `failed` rather than being silently skipped.
 */
export async function bulkUpdateItemPriorities(
  itemIds: string[],
  slider: number,
): Promise<BulkOperationResult> {
  return await invokeCommand<BulkOperationResult>("bulk_update_item_priorities", {
    itemIds,
    slider,
  });
}

/** Push a mixed selection out by a fixed number of days. */
export async function bulkPostponeItems(
  itemIds: string[],
  days: number,
): Promise<BulkOperationResult> {
  return await invokeCommand<BulkOperationResult>("bulk_postpone_items", { itemIds, days });
}

/** Reassign a mixed selection to an existing collection. Never creates one. */
export async function bulkMoveItemsToCollection(
  itemIds: string[],
  collectionId: string,
): Promise<BulkOperationResult> {
  return await invokeCommand<BulkOperationResult>("bulk_move_items_to_collection", {
    itemIds,
    collectionId,
  });
}

/** Add and/or remove tags across a mixed selection. Both lists may be empty. */
export async function bulkUpdateItemTags(
  itemIds: string[],
  add: string[],
  remove: string[],
): Promise<BulkOperationResult> {
  return await invokeCommand<BulkOperationResult>("bulk_update_item_tags", {
    itemIds,
    add,
    remove,
  });
}

/** Apply a lifecycle transition (done / dismiss / forget) across a selection. */
export async function bulkSetItemLifecycle(
  itemIds: string[],
  transition: LifecycleTransition,
): Promise<BulkOperationResult> {
  return await invokeCommand<BulkOperationResult>("bulk_set_item_lifecycle", {
    itemIds,
    transition,
  });
}
