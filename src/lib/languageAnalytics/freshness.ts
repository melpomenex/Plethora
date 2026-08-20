import type { AnalyticsFreshness, AnalyticsStatus, FreshnessMetadata, MetricValue } from "./types";

export const DEFAULT_ANALYTICS_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface FreshnessInput {
  computedAt?: number;
  sourceThrough?: number;
  now?: number;
  staleAfterMs?: number;
  pending?: boolean;
  reason?: string;
}

export function deriveFreshness(input: FreshnessInput): FreshnessMetadata {
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_ANALYTICS_STALE_AFTER_MS;
  if (input.pending) {
    return { status: "pending", computedAt: input.computedAt, sourceThrough: input.sourceThrough, staleAfterMs, reason: input.reason ?? "coverage_pending" };
  }
  if (input.computedAt === undefined || !Number.isFinite(input.computedAt)) {
    return { status: "unknown", sourceThrough: input.sourceThrough, staleAfterMs, reason: input.reason ?? "not_computed" };
  }
  const age = Math.max(0, (input.now ?? Date.now()) - input.computedAt);
  return {
    status: age > staleAfterMs ? "stale" : "fresh",
    computedAt: input.computedAt,
    sourceThrough: input.sourceThrough,
    staleAfterMs,
    ...(age > staleAfterMs ? { reason: input.reason ?? "aggregate_stale" } : {}),
  };
}

export interface MetricValueOptions {
  freshness: AnalyticsFreshness;
  measured?: boolean;
  capability?: boolean;
  numerator?: number;
  denominator?: number;
  asOf?: number;
  reason?: string;
}

/**
 * Centralizes the contract that unavailable, unknown, pending, and stale are
 * distinct from a measured zero. A UI can safely render `value === null` for
 * unavailable/unknown/pending without turning missing data into zero activity.
 */
export function metricValue<T>(value: T | null, options: MetricValueOptions): MetricValue<T> {
  const capability = options.capability ?? true;
  let status: AnalyticsStatus = options.freshness;
  let resolvedValue = value;
  let reason = options.reason;

  if (!capability) {
    status = "unavailable";
    resolvedValue = null;
    reason ??= "capability_unavailable";
  } else if (!options.measured || value === null) {
    status = options.freshness === "stale" ? "stale" : options.freshness === "pending" ? "pending" : "unknown";
    resolvedValue = null;
    reason ??= value === null ? "denominator_unavailable" : "no_source_events";
  }

  return {
    value: resolvedValue,
    status,
    ...(options.numerator === undefined ? {} : { numerator: options.numerator }),
    ...(options.denominator === undefined ? {} : { denominator: options.denominator }),
    freshness: options.freshness,
    ...(options.asOf === undefined ? {} : { asOf: options.asOf }),
    ...(reason ? { reason } : {}),
  };
}
