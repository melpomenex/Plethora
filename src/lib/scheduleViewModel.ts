/**
 * Schedule View Model
 *
 * Pure, memoizable derivation of schedule workspace semantics. Components
 * format localized copy but never recalculate business semantics here.
 *
 * All calendar comparisons operate on normalized date-only keys
 * (`YYYY-MM-DD` in the local calendar) produced by `toDateString` /
 * `dateKeyOf`, never on raw UTC timestamp strings compared to local dates.
 * Empty inputs return explicit zero values.
 */

import type { ForecastPoint, ScheduleDayItem } from "../types/queue";
import { toDateString } from "./scheduleUtils";

/** Local calendar date key for a Date instance (YYYY-MM-DD). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalized date-only key for a schedule item's due date. */
export function dateKeyOf(item: Pick<ScheduleDayItem, "dueDate">): string {
  return toDateString(item.dueDate);
}

/** Normalized date-only key for any date string (bare or ISO). */
export function dateKey(dateStr: string): string {
  return toDateString(dateStr);
}

/** Relative magnitude bucket for a day's load (for shape/emphasis, not color alone). */
export type LoadBucket = "none" | "light" | "moderate" | "heavy" | "critical";

export function loadBucket(count: number): LoadBucket {
  if (count <= 0) return "none";
  if (count <= 10) return "light";
  if (count <= 25) return "moderate";
  if (count <= 50) return "heavy";
  return "critical";
}

/** Presentation-ready forecast day within the 14-day horizon. */
export interface ScheduleForecastDay {
  /** Normalized date-only key (YYYY-MM-DD). */
  dateKey: string;
  dueTotal: number;
  learningCount: number;
  documentCount: number;
  /** Sum of estimated minutes for items due on this date (0 when unknown). */
  estimatedMinutes: number;
  isToday: boolean;
  isSelected: boolean;
  isPeak: boolean;
  /** 0..1 relative magnitude vs. the horizon maximum (0 when no load). */
  magnitude: number;
  bucket: LoadBucket;
}

/** Trustworthy workload insight values (all explicitly zero when empty). */
export interface ScheduleInsights {
  /** Items whose calendar due date is exactly today. */
  dueToday: number;
  /** Items whose calendar due date is before today. */
  overdue: number;
  /** overdue + dueToday. */
  dueNow: number;
  /** Sum of daily totals over the displayed 14-day horizon. */
  horizonTotal: number;
  /** Sum of the next seven daily totals divided by the number of available days. */
  nextSevenAverage: number;
  /** Highest daily total in the displayed 14-day horizon (null when empty). */
  peakDay: ScheduleForecastDay | null;
}

/** A date group of scheduled items (date key, items, aggregate time). */
export interface ScheduleGroup {
  dateKey: string;
  items: ScheduleDayItem[];
  estimatedMinutes: number;
}

/** Spread-source eligibility computed from the visible scope. */
export interface ScheduleSpreadSource {
  dateKey: string;
  /** Items actually scheduled on the source date. */
  itemCount: number;
  /** Items on the source date that Spread can actually move (learning items). */
  eligibleCount: number;
}

/** Full derived workspace state. */
export interface ScheduleViewModel {
  todayKey: string;
  insights: ScheduleInsights;
  /** Presentation-ready days for the displayed horizon (up to 14). */
  forecastDays: ScheduleForecastDay[];
  /** All date groups, sorted by date, items sorted by priority desc. */
  groups: ScheduleGroup[];
  /** Groups filtered by the active date scope (all groups when null). */
  visibleGroups: ScheduleGroup[];
  /** Total estimated minutes across the visible scope. */
  visibleEstimatedMinutes: number;
  /** Spread source: selected date first, else the peak horizon day. */
  spreadSource: ScheduleSpreadSource | null;
  /** Whether Spread can run (source exists and has eligible items). */
  canSpread: boolean;
}

export interface BuildScheduleViewModelInput {
  forecast: ForecastPoint[];
  items: ScheduleDayItem[];
  /** Normalized local calendar date key for "today". */
  todayKey: string;
  /** Active date scope (normalized date key) or null for All upcoming. */
  selectedDate: string | null;
}

/** Horizon lengths used by the view model (displayed days and averages). */
export const FORECAST_HORIZON_DAYS = 14;
export const SEVEN_DAY_WINDOW = 7;

/**
 * Spread scheduling math: given a set of items being spread across a horizon,
 * compute the target day offset for the item at `index` (0-based within the
 * eligible set). Items are distributed evenly across days 0..horizon-1 using
 * the absolute index, so batching the work never clusters a batch onto one day.
 */
export function spreadTargetDay(index: number, itemCount: number, horizonDays: number): number {
  if (itemCount <= 0 || horizonDays <= 0) return 0;
  const perDay = Math.ceil(itemCount / horizonDays);
  return Math.min(horizonDays - 1, Math.floor(index / perDay));
}

const HORIZON = FORECAST_HORIZON_DAYS;
const SEVEN = SEVEN_DAY_WINDOW;

/** Group items by normalized date, sort dates ascending and items by priority desc. */
export function groupScheduleItems(items: ScheduleDayItem[]): ScheduleGroup[] {
  const byDate = new Map<string, ScheduleDayItem[]>();
  for (const item of items) {
    const key = dateKeyOf(item);
    const list = byDate.get(key) ?? [];
    list.push(item);
    byDate.set(key, list);
  }
  const sortedKeys = Array.from(byDate.keys()).sort();
  return sortedKeys.map((dateKey) => {
    const list = byDate.get(dateKey)!;
    const sorted = [...list].sort((a, b) => {
      // Deterministic secondary key so order is stable for equal priorities.
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });
    return {
      dateKey,
      items: sorted,
      estimatedMinutes: sorted.reduce((s, i) => s + (i.estimatedTime > 0 ? i.estimatedTime : 0), 0),
    };
  });
}

/** Derive the presentation-ready 14-day horizon from the forecast array. */
export function buildForecastDays(
  forecast: ForecastPoint[],
  items: ScheduleDayItem[],
  todayKey: string,
  selectedDate: string | null,
): ScheduleForecastDay[] {
  const horizon = forecast.slice(0, HORIZON);
  const maxTotal = horizon.reduce((max, p) => Math.max(max, p.due_total), 0);

  // Estimated minutes per normalized date (from actual items).
  const minutesByDate = new Map<string, number>();
  for (const item of items) {
    const key = dateKeyOf(item);
    if (item.estimatedTime > 0) {
      minutesByDate.set(key, (minutesByDate.get(key) ?? 0) + item.estimatedTime);
    }
  }

  let peak: ForecastPoint | null = null;
  for (const p of horizon) {
    if (!peak || p.due_total > peak.due_total) peak = p;
  }

  return horizon.map((p) => {
    const key = dateKey(p.date);
    const isToday = key === todayKey;
    const isSelected = selectedDate != null && key === selectedDate;
    const isPeak = peak != null && p.due_total > 0 && key === dateKey(peak.date);
    return {
      dateKey: key,
      dueTotal: p.due_total,
      learningCount: p.due_learning_items,
      documentCount: p.due_documents,
      estimatedMinutes: minutesByDate.get(key) ?? 0,
      isToday,
      isSelected,
      isPeak,
      magnitude: maxTotal > 0 ? p.due_total / maxTotal : 0,
      bucket: loadBucket(p.due_total),
    };
  });
}

/** Derive workload insights from forecast days and items. */
export function buildInsights(
  forecastDays: ScheduleForecastDay[],
  items: ScheduleDayItem[],
  todayKey: string,
): ScheduleInsights {
  let dueToday = 0;
  let overdue = 0;
  for (const item of items) {
    const key = dateKeyOf(item);
    if (key < todayKey) overdue += 1;
    else if (key === todayKey) dueToday += 1;
  }

  const nextSeven = forecastDays.slice(0, SEVEN);
  const nextSevenSum = nextSeven.reduce((s, d) => s + d.dueTotal, 0);
  const nextSevenAverage = nextSeven.length > 0 ? Math.round(nextSevenSum / nextSeven.length) : 0;
  const horizonTotal = forecastDays.reduce((s, d) => s + d.dueTotal, 0);

  let peakDay: ScheduleForecastDay | null = null;
  for (const d of forecastDays) {
    if (d.dueTotal > 0 && (!peakDay || d.dueTotal > peakDay.dueTotal)) peakDay = d;
  }

  return {
    dueToday,
    overdue,
    dueNow: overdue + dueToday,
    horizonTotal,
    nextSevenAverage,
    peakDay,
  };
}

/** Filter groups to the active date scope (null scope returns all groups). */
export function scopeGroups(groups: ScheduleGroup[], selectedDate: string | null): ScheduleGroup[] {
  if (!selectedDate) return groups;
  return groups.filter((g) => g.dateKey === selectedDate);
}

/** Compute spread-source eligibility (selected date first, else peak day). */
export function computeSpreadSource(
  groups: ScheduleGroup[],
  forecastDays: ScheduleForecastDay[],
  selectedDate: string | null,
): ScheduleSpreadSource | null {
  const eligible = (list: ScheduleDayItem[]) =>
    list.filter((i) => i.itemType === "learning-item").length;

  if (selectedDate) {
    const group = groups.find((g) => g.dateKey === selectedDate);
    if (group) {
      return {
        dateKey: group.dateKey,
        itemCount: group.items.length,
        eligibleCount: eligible(group.items),
      };
    }
    return null;
  }

  const peak = forecastDays.reduce<ScheduleForecastDay | null>((best, d) => {
    if (d.dueTotal <= 0) return best;
    if (!best || d.dueTotal > best.dueTotal) return d;
    return best;
  }, null);
  if (!peak) return null;

  const group = groups.find((g) => g.dateKey === peak.dateKey);
  return {
    dateKey: peak.dateKey,
    itemCount: peak.dueTotal,
    eligibleCount: group ? eligible(group.items) : 0,
  };
}

/** Build the full view model in bounded passes over forecast + items. */
export function buildScheduleViewModel(input: BuildScheduleViewModelInput): ScheduleViewModel {
  const { forecast, items, todayKey, selectedDate } = input;
  const normalizedSelected = selectedDate ? dateKey(selectedDate) : null;
  const groups = groupScheduleItems(items);
  const forecastDays = buildForecastDays(forecast, items, todayKey, normalizedSelected);
  const insights = buildInsights(forecastDays, items, todayKey);
  const visibleGroups = scopeGroups(groups, normalizedSelected);
  const visibleEstimatedMinutes = visibleGroups.reduce((s, g) => s + g.estimatedMinutes, 0);
  const spreadSource = computeSpreadSource(groups, forecastDays, normalizedSelected);

  return {
    todayKey,
    insights,
    forecastDays,
    groups,
    visibleGroups,
    visibleEstimatedMinutes,
    spreadSource,
    canSpread: spreadSource != null && spreadSource.eligibleCount > 0,
  };
}
