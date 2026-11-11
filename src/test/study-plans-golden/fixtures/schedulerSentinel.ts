/** C8-T01 scheduler sentinel: actual review/FSRS/Queue fields, snapshot before/after. */
export interface SchedulerSentinel {
  learningItemId: string;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  due: string | null;
  rating: number | null;
  reviewCount: number;
  queueMembership: string[];
  queuePriority: number | null;
}
export function sentinelEquals(a: SchedulerSentinel, b: SchedulerSentinel): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export const SENTINEL_FIXTURE: SchedulerSentinel = {
  learningItemId: 'li_sentinel_text_review',
  fsrsStability: 1.7,
  fsrsDifficulty: 4.2,
  due: '2026-01-06T09:00:00.000Z',
  rating: 3,
  reviewCount: 2,
  queueMembership: ['queue_main'],
  queuePriority: 10,
};
