import type { QueueItem, QueueOrderingMode } from "../types/queue";

/**
 * Resolve display slider, honoring explicit zero.
 */
export function resolveDisplaySlider(doc: {
  prioritySlider?: number;
  priorityRating?: number;
  priorityExplicitlySet?: boolean;
}): number {
  const slider = Math.round(doc.prioritySlider ?? 0);
  if (doc.priorityExplicitlySet) {
    return Number.isFinite(slider) ? Math.max(0, Math.min(100, slider)) : 0;
  }
  if (Number.isFinite(slider) && slider > 0) return Math.min(100, slider);
  const rating = Math.round(doc.priorityRating ?? 0);
  if (rating > 0) {
    return ([0, 10, 30, 50, 70, 90] as const)[Math.min(5, Math.max(0, rating))];
  }
  return 50;
}

/**
 * Authoritative 0–100 readback for a queue row.
 *
 * Prefers the backend's resolved display slider (which includes inherited
 * extract values), then falls back to the row's own explicit fields so older
 * rows and browser-backed queues still render a committed zero or slider.
 */
export function resolveQueueItemDisplaySlider(item: {
  itemType: string;
  priorityDisplaySlider?: number;
  prioritySlider?: number;
  priorityRating?: number;
  priorityExplicitlySet?: boolean;
}): number {
  if (typeof item.priorityDisplaySlider === "number" && Number.isFinite(item.priorityDisplaySlider)) {
    return Math.max(0, Math.min(100, Math.round(item.priorityDisplaySlider)));
  }
  if (item.itemType === "extract" || item.itemType === "video-extract") {
    return item.prioritySlider != null
      ? Math.max(0, Math.min(100, Math.round(item.prioritySlider)))
      : 50;
  }
  return resolveDisplaySlider({
    prioritySlider: item.prioritySlider,
    priorityRating: item.priorityRating,
    priorityExplicitlySet:
      item.priorityExplicitlySet ?? (item.itemType === "learning-item" && item.prioritySlider != null),
  });
}

export function resolveQueueOrderingMode(value: unknown): QueueOrderingMode {
  return value === "strict_manual" ? "strict_manual" : "adaptive";
}

export interface ManualQueueOrderKey {
  priority: number;
  dueDate?: string | null;
  itemType: string;
  id: string;
}

export function compareManualQueueOrder(a: ManualQueueOrderKey, b: ManualQueueOrderKey): number {
  const byPriority = b.priority - a.priority;
  if (byPriority !== 0) return byPriority;
  const aDue = a.dueDate ? Date.parse(a.dueDate) : NaN;
  const bDue = b.dueDate ? Date.parse(b.dueDate) : NaN;
  const leftDue = Number.isFinite(aDue) ? aDue : Infinity;
  const rightDue = Number.isFinite(bDue) ? bDue : Infinity;
  if (leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
  if (a.itemType !== b.itemType) return a.itemType < b.itemType ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

export function compareManualQueueItems(a: QueueItem, b: QueueItem): number {
  return compareManualQueueOrder(
    { id: a.id, itemType: a.itemType, dueDate: a.dueDate, priority: resolveQueueItemDisplaySlider(a) },
    { id: b.id, itemType: b.itemType, dueDate: b.dueDate, priority: resolveQueueItemDisplaySlider(b) },
  );
}
