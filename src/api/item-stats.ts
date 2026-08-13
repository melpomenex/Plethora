/**
 * Per-item statistics API.
 *
 * Two reads with deliberately different costs — a cheap summary for the
 * Details popover and the full payload for the Item Stats modal — plus the
 * write the active-time tracker calls on every flush.
 */

import { invokeCommand, isTauri } from "../lib/tauri";

/** Item types the statistics surfaces support. Matches `ItemDetailsTarget`. */
export type StatsItemType = "document" | "extract" | "learning-item" | "rss";

/** Where an interaction happened. */
export type ActivitySurface = "queue" | "reader";

/**
 * A metric and the reason it does or does not have a value.
 *
 * The three states are the whole point: `value` covers a genuine zero,
 * `untracked` means the item predates recording, and `notApplicable` means the
 * metric does not exist for this item type. A bare `null` would collapse them,
 * and the surface is specified to say which one it is.
 */
export type Metric<T> =
  | { state: "value"; value: T }
  | { state: "untracked" }
  | { state: "notApplicable" };

export interface ItemStatsSummary {
  itemType: StatsItemType;
  itemId: string;
  totalActiveSeconds: Metric<number>;
  /** Repetitions for reviewable items, sessions for reading. */
  repetitions: Metric<number>;
  averageSecondsPerRepetition: Metric<number>;
  firstInteractionAt: Metric<string>;
  lastInteractionAt: Metric<string>;
}

export interface ItemStatsEvent {
  /** RFC3339 timestamp of when the interaction ended. */
  at: string;
  activeSeconds: number | null;
  /** `queue`, `reader`, or `review` (a flashcard repetition). */
  surface: string;
  rating: number | null;
  resultingIntervalDays: number | null;
  progressDelta: number | null;
}

export interface ItemTimeStats {
  totalActiveSeconds: Metric<number>;
  queueSeconds: Metric<number>;
  readerSeconds: Metric<number>;
  sessionCount: Metric<number>;
  longestSessionSeconds: Metric<number>;
  averageSessionSeconds: Metric<number>;
  medianSessionSeconds: Metric<number>;
  estimatedReadingSeconds: Metric<number>;
}

export interface IntervalPoint {
  repetition: number;
  intervalDays: number;
}

export interface RetentionPoint {
  day: number;
  retention: number;
}

export interface ItemScheduleStats {
  stability: Metric<number>;
  difficulty: Metric<number>;
  retrievability: Metric<number>;
  currentIntervalDays: Metric<number>;
  nextIntervalDays: Metric<number>;
  dueDate: Metric<string>;
  intervalModifier: Metric<number>;
  intervalHistory: IntervalPoint[];
  retentionCurve: RetentionPoint[];
}

export interface RatingDistribution {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface ItemHistoryStats {
  events: ItemStatsEvent[];
  ratingDistribution: RatingDistribution;
  /** Indexes into `events` where the user rated Again. */
  lapsePositions: number[];
  lapses: Metric<number>;
  isLeech: boolean;
  leechThreshold: number;
}

export interface ItemContentStats {
  createdAt: Metric<string>;
  firstSeenAt: Metric<string>;
  ageDays: Metric<number>;
  wordCount: Metric<number>;
  characterCount: Metric<number>;
  progressPercent: Metric<number>;
  extractsYielded: Metric<number>;
  flashcardsYielded: Metric<number>;
  priorityScore: Metric<number>;
  prioritySlider: Metric<number>;
  category: Metric<string>;
  tags: string[];
}

export interface TimeInvestedRank {
  /** 1 = most time invested. */
  rank: number;
  total: number;
}

/**
 * A `null` section is one the current item type has no data for. The modal
 * omits it entirely rather than rendering it empty.
 */
export interface ItemStatsDetail {
  summary: ItemStatsSummary;
  time: ItemTimeStats | null;
  schedule: ItemScheduleStats | null;
  history: ItemHistoryStats | null;
  content: ItemContentStats | null;
  rankByTimeInvested: Metric<TimeInvestedRank>;
}

const desktopOnly = () => Promise.reject(new Error("This feature requires the desktop app"));

/**
 * The ≤6 values the Details popover shows. Cheap by construction — indexed
 * lookups only — so opening the popover is not slowed by it.
 */
export async function getItemStatsSummary(
  itemType: StatsItemType,
  itemId: string,
): Promise<ItemStatsSummary> {
  if (!isTauri()) return desktopOnly();
  return await invokeCommand<ItemStatsSummary>("get_item_stats_summary", { itemType, itemId });
}

/**
 * Everything the full Item Statistics modal renders, in one round trip.
 *
 * @param leechThreshold From the user's learning settings, so the leech flag
 *   here agrees with the Leech dashboard's.
 */
export async function getItemStatsDetail(
  itemType: StatsItemType,
  itemId: string,
  leechThreshold?: number,
): Promise<ItemStatsDetail> {
  if (!isTauri()) return desktopOnly();
  return await invokeCommand<ItemStatsDetail>("get_item_stats_detail", {
    itemType,
    itemId,
    leechThreshold,
  });
}

/**
 * Hand the backend a batch of observed active seconds.
 *
 * Called on the tracker's flush cadence and on blur, visibility loss, item
 * change, unmount, and `beforeunload`. Only documents and extracts have a
 * cumulative column; flashcard time travels with the review itself.
 *
 * Fire-and-forget by design: a failed flush must not interrupt reading. The
 * seconds are lost, never duplicated.
 */
export async function recordActiveTime(
  itemType: "document" | "extract",
  itemId: string,
  surface: ActivitySurface,
  activeSeconds: number,
  sessionId?: string | null,
): Promise<void> {
  if (!isTauri() || activeSeconds <= 0) return;
  await invokeCommand("record_active_time", {
    itemType,
    itemId,
    surface,
    activeSeconds,
    sessionId: sessionId ?? null,
  });
}

/** Read a metric's value, or `undefined` when it has none. */
export function metricValue<T>(metric: Metric<T> | undefined | null): T | undefined {
  return metric?.state === "value" ? metric.value : undefined;
}
