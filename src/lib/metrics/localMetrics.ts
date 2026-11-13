/**
 * Local aggregate product metrics (motivation 2.3).
 *
 * Engagement and delayed-transfer measures are stored locally as versioned,
 * aggregated counts per (date, category, kind). Payloads are allowlisted:
 * only non-identifying aggregation fields may ever be recorded — no learner
 * text, document names, answers, source contents or raw identifiers. A
 * network path exists only behind an explicit opt-in that revalidates the
 * payload allowlist.
 */

export type MetricCategory = 'engagement' | 'transfer';

export interface AggregatePoint {
  date: string; // YYYY-MM-DD
  category: MetricCategory;
  kind: string; // e.g. "session", "independent-check", "delayed-review"
  count: number;
}

const STORAGE_KEY = 'plethora.local_metrics.v1';
const ALLOWED_KEYS = new Set(['date', 'category', 'kind', 'count']);

export function assertPayloadSafe(raw: unknown): asserts raw is AggregatePoint {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('metrics.error.invalid_payload');
  }
  const keys = Object.keys(raw as Record<string, unknown>);
  for (const key of keys) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error('metrics.error.pii_attribute');
    }
  }
  const p = raw as Record<string, unknown>;
  if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
    throw new Error('metrics.error.invalid_date');
  }
  if (p.category !== 'engagement' && p.category !== 'transfer') {
    throw new Error('metrics.error.invalid_category');
  }
  if (typeof p.kind !== 'string' || p.kind.length === 0 || p.kind.length > 64) {
    throw new Error('metrics.error.invalid_kind');
  }
  if (typeof p.count !== 'number' || !Number.isInteger(p.count) || p.count < 0) {
    throw new Error('metrics.error.invalid_count');
  }
}

function load(): AggregatePoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => {
      try {
        assertPayloadSafe(item);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function listMetricPoints(): AggregatePoint[] {
  return load().sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || a.kind.localeCompare(b.kind));
}

export function recordMetricPoints(points: AggregatePoint[]): AggregatePoint[] {
  for (const point of points) assertPayloadSafe(point);
  const existing = load();
  const merged = new Map<string, AggregatePoint>();
  for (const point of [...existing, ...points]) {
    const key = `${point.date}|${point.category}|${point.kind}`;
    const prior = merged.get(key);
    merged.set(key, {
      date: point.date,
      category: point.category,
      kind: point.kind,
      count: (prior?.count ?? 0) + point.count,
    });
  }
  const next = [...merged.values()];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export interface EngagementTransferSeries {
  engagement: Array<{ date: string; total: number }>;
  transfer: Array<{ date: string; total: number }>;
}

export function separateEngagementFromTransfer(points: AggregatePoint[]): EngagementTransferSeries {
  const engagement = new Map<string, number>();
  const transfer = new Map<string, number>();
  for (const point of points) {
    const target = point.category === 'transfer' ? transfer : engagement;
    target.set(point.date, (target.get(point.date) ?? 0) + point.count);
  }
  return {
    engagement: [...engagement.entries()].map(([date, total]) => ({ date, total })),
    transfer: [...transfer.entries()].map(([date, total]) => ({ date, total })),
  };
}

/** Network opt-in path: only allowlist-approved aggregates may leave the device. */
export function sanitizeForNetwork(points: AggregatePoint[]): AggregatePoint[] {
  return points.map((point) => {
    assertPayloadSafe(point);
    return { date: point.date, category: point.category, kind: point.kind, count: point.count };
  });
}
