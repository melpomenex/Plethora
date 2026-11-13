import { beforeEach, describe, expect, it } from 'vitest';
import {
  assertPayloadSafe,
  recordMetricPoints,
  listMetricPoints,
  separateEngagementFromTransfer,
  sanitizeForNetwork,
} from '../localMetrics';

describe('local metrics (motivation 2.3)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records versioned aggregates and dedupes identical keys by summing', () => {
    const first = recordMetricPoints([
      { date: '2026-11-13', category: 'engagement', kind: 'session', count: 1 },
      { date: '2026-11-13', category: 'transfer', kind: 'independent-check', count: 2 },
    ]);
    const second = recordMetricPoints([
      { date: '2026-11-13', category: 'engagement', kind: 'session', count: 1 },
    ]);
    expect(listMetricPoints()).toHaveLength(2);
    const session = second.find((p) => p.kind === 'session');
    expect(session?.count).toBe(2);
    expect(first.length).toBe(2);
  });

  it('rejects payloads that carry raw learner or source data', () => {
    expect(() =>
      assertPayloadSafe({ date: '2026-11-13', category: 'engagement', kind: 'session', count: 1, text: 'learner answer' } as never)
    ).toThrow('pii_attribute');
    expect(() =>
      assertPayloadSafe({ date: '2026-11-13', category: 'engagement', kind: 'session', count: 1, documentId: 'd1' } as never)
    ).toThrow('pii_attribute');
    expect(() =>
      assertPayloadSafe({ date: '2026-11-13', category: 'engagement', kind: 'session', count: -1 })
    ).toThrow('invalid_count');
    expect(() =>
      assertPayloadSafe({ date: 'not-a-date', category: 'engagement', kind: 'session', count: 1 })
    ).toThrow('invalid_date');
  });

  it('keeps engagement and delayed-transfer measures separate', () => {
    const series = separateEngagementFromTransfer([
      { date: '2026-11-13', category: 'engagement', kind: 'session', count: 3 },
      { date: '2026-11-13', category: 'transfer', kind: 'independent-check', count: 2 },
      { date: '2026-11-14', category: 'transfer', kind: 'delayed-review', count: 5 },
    ]);
    expect(series.engagement).toEqual([{ date: '2026-11-13', total: 3 }]);
    expect(series.transfer).toEqual([
      { date: '2026-11-13', total: 2 },
      { date: '2026-11-14', total: 5 },
    ]);
  });

  it('network sanitization only allows allowlist aggregates', () => {
    const safe = sanitizeForNetwork([
      { date: '2026-11-13', category: 'transfer', kind: 'independent-check', count: 1 },
    ]);
    expect(safe).toEqual([{ date: '2026-11-13', category: 'transfer', kind: 'independent-check', count: 1 }]);
    expect(() =>
      sanitizeForNetwork([{ date: '2026-11-13', category: 'transfer', kind: 'independent-check', count: 1, answer: 'x' } as never])
    ).toThrow('pii_attribute');
  });
});
