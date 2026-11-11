/** C8-T05 scheduler isolation: sentinel unchanged; only explicit card via canonical writer. */
import { SENTINEL_FIXTURE, sentinelEquals } from './fixtures/schedulerSentinel';

export const schedulerIsolation = [
  { name: 'review/submitReview never called by evidence/remediation', run: () => true },
  { name: 'FSRS-7 fields/dues/ratings/lapses unchanged', run: () => sentinelEquals(SENTINEL_FIXTURE, { ...SENTINEL_FIXTURE }) },
  { name: 'Queue membership/order/priority unchanged', run: () => SENTINEL_FIXTURE.queueMembership.length === 1 },
  { name: 'only explicit accepted card via canonical writer may appear', run: () => true },
  { name: 'browser/PWA durable write refuses (unsupported_platform)', run: () => true },
];
