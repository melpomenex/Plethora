export interface ReviewEvent {
  id: string;
  itemId: string;
  reviewedAtMs: number;
  deviceId: string;
  rating: number;
}

export function mergeReviewEvents(events: ReviewEvent[]): ReviewEvent[] {
  const unique = new Map<string, ReviewEvent>();
  for (const event of events) unique.set(event.id, event);
  return Array.from(unique.values()).sort((a, b) => a.reviewedAtMs - b.reviewedAtMs || a.deviceId.localeCompare(b.deviceId) || a.id.localeCompare(b.id));
}

export function recomputeScheduleFromReviewLog<T>(events: ReviewEvent[], initial: T, reduce: (state: T, event: ReviewEvent) => T): T {
  return mergeReviewEvents(events).reduce(reduce, initial);
}
