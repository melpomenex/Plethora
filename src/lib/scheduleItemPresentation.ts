/**
 * Shared schedule-item presentation metadata.
 *
 * Pure, unit-testable derivation of item type, due state, interval, stability,
 * difficulty, retrievability, progress, estimated time, and accessible metric
 * labels. Components map the returned keys to icons/colors but never re-derive
 * the business semantics.
 */

import type { ScheduleDayItem } from "../types/queue";
import { parseScheduleDate } from "./scheduleUtils";
import { getScheduleItemTitle } from "../components/schedule/scheduleTitles";

export type ItemTypeKey = ScheduleDayItem["itemType"];

/** Severity used for metric coloring; color is never the only signal. */
export type MetricSeverity = "good" | "warning" | "danger" | "neutral";

export type DueStateKey = "overdue" | "today" | "tomorrow" | "upcoming";

export interface DueState {
  key: DueStateKey;
  /** Calendar-day difference vs. today (negative = overdue). */
  daysDiff: number;
  label: string;
  /** Accessible full label, e.g. "Due today". */
  accessibleLabel: string;
  severity: MetricSeverity;
}

export interface ItemTypeMeta {
  key: ItemTypeKey;
  label: string;
  /** Icon identifier — components map to an actual icon. */
  icon: "document" | "extract" | "learning";
}

export interface MetricMeta<T extends string | number> {
  value: T;
  label: string;
  /** Localized accessible label including the value. */
  accessibleLabel: string;
  severity: MetricSeverity;
  /** 0..1 for bar rendering (stability/interval/progress). */
  ratio?: number;
}

export interface ScheduleItemPresentation {
  title: string;
  type: ItemTypeMeta;
  due: DueState | null;
  interval: MetricMeta<string> | null;
  stability: MetricMeta<number> | null;
  difficulty: MetricMeta<number> | null;
  retrievability: MetricMeta<number> | null;
  progress: MetricMeta<number> | null;
  estimatedTime: MetricMeta<string> | null;
  hasAlgoData: boolean;
  tags: string[];
  category: string | null;
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export function itemTypeMeta(type: ItemTypeKey, t: Translator): ItemTypeMeta {
  switch (type) {
    case "document":
      return { key: "document", label: t("schedule.documentBadge"), icon: "document" };
    case "extract":
      return { key: "extract", label: t("schedule.extractBadge"), icon: "extract" };
    case "learning-item":
      return { key: "learning-item", label: t("schedule.learningBadge"), icon: "learning" };
    default:
      return { key: type, label: type, icon: "document" };
  }
}

/** Interval formatting: fractional days → human readable. */
export function formatInterval(days: number, t: Translator): string {
  if (days < 1) {
    const hours = Math.round(days * 24);
    if (hours < 1) return "<1h";
    return t("schedule.intervalHours", { count: hours });
  }
  if (days < 30) {
    return t("schedule.intervalDays", { count: Math.round(days * 10) / 10 });
  }
  return t("schedule.intervalWeeks", { count: Math.round((days / 7) * 10) / 10 });
}

/** Due-state derivation from a normalized date comparison. */
export function dueState(
  dueDate: string,
  todayKey: string,
  t: Translator,
): DueState | null {
  const due = parseScheduleDate(dueDate);
  const today = parseScheduleDate(todayKey);
  if (!due || !today) return null;
  const daysDiff = Math.round((due.getTime() - today.getTime()) / 86400000);

  let key: DueStateKey;
  let label: string;
  let severity: MetricSeverity;
  if (daysDiff < 0) {
    key = "overdue";
    label = t("schedule.overdue");
    severity = "danger";
  } else if (daysDiff === 0) {
    key = "today";
    label = t("schedule.today");
    severity = "warning";
  } else if (daysDiff === 1) {
    key = "tomorrow";
    label = t("schedule.tomorrow");
    severity = "neutral";
  } else {
    key = "upcoming";
    label = t("schedule.inDays", { count: daysDiff });
    severity = "neutral";
  }
  return {
    key,
    daysDiff,
    label,
    accessibleLabel: `${label} (${dueDate})`,
    severity,
  };
}

/** Severity for stability (days): higher is healthier. */
export function stabilityMeta(value: number | undefined, t: Translator): MetricMeta<number> | null {
  if (value == null || !Number.isFinite(value)) return null;
  const severity: MetricSeverity = value >= 21 ? "good" : value >= 7 ? "good" : value >= 3 ? "warning" : "danger";
  return {
    value,
    label: t("schedule.stability"),
    accessibleLabel: `${t("schedule.stability")}: ${value.toFixed(1)}`,
    severity,
    ratio: Math.min(1, value / 30),
  };
}

/** Severity for difficulty (1–10): higher is harder. */
export function difficultyMeta(value: number | undefined, t: Translator): MetricMeta<number> | null {
  if (value == null || !Number.isFinite(value)) return null;
  const severity: MetricSeverity = value <= 3 ? "good" : value <= 5 ? "warning" : value <= 7 ? "warning" : "danger";
  return {
    value,
    label: t("schedule.difficulty"),
    accessibleLabel: `${t("schedule.difficulty")}: ${value.toFixed(1)}`,
    severity,
    ratio: Math.min(1, value / 10),
  };
}

/** Retrievability (0–1): higher is healthier. */
export function retrievabilityMeta(value: number | undefined, t: Translator): MetricMeta<number> | null {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = Math.round(value * 100);
  const severity: MetricSeverity = pct >= 90 ? "good" : pct >= 70 ? "warning" : "danger";
  return {
    value: pct,
    label: t("schedule.retrievability"),
    accessibleLabel: `${t("schedule.retrievability")}: ${pct}%`,
    severity,
    ratio: Math.min(1, pct / 100),
  };
}

/** Progress (0–100): higher is closer to complete. */
export function progressMeta(value: number | undefined, t: Translator): MetricMeta<number> | null {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = Math.round(value);
  const severity: MetricSeverity = pct >= 100 ? "good" : pct >= 50 ? "good" : "neutral";
  return {
    value: pct,
    label: t("schedule.progress"),
    accessibleLabel: `${t("schedule.progress")}: ${pct}%`,
    severity,
    ratio: Math.min(1, pct / 100),
  };
}

/** Estimated time in minutes. */
export function estimatedTimeMeta(value: number | undefined, t: Translator): MetricMeta<string> | null {
  if (value == null || value <= 0 || !Number.isFinite(value)) return null;
  return {
    value: `${value}m`,
    label: t("schedule.estTime", { count: value }),
    accessibleLabel: t("schedule.estTime", { count: value }),
    severity: "neutral",
  };
}

/**
 * Build the full presentation for one item. `todayKey` is the normalized local
 * calendar date key for today.
 */
export function buildItemPresentation(
  item: ScheduleDayItem,
  todayKey: string,
  t: Translator,
): ScheduleItemPresentation {
  const interval =
    item.interval != null && item.interval > 0
      ? {
          value: formatInterval(item.interval, t),
          label: t("schedule.interval"),
          accessibleLabel: `${t("schedule.interval")}: ${formatInterval(item.interval, t)}`,
          severity: "neutral" as const,
        }
      : null;

  return {
    title: getScheduleItemTitle(item, t),
    type: itemTypeMeta(item.itemType, t),
    due: dueState(item.dueDate, todayKey, t),
    interval,
    stability: stabilityMeta(item.stability, t),
    difficulty: difficultyMeta(item.difficulty, t),
    retrievability: retrievabilityMeta(item.retrievability, t),
    progress: progressMeta(item.progress, t),
    estimatedTime: estimatedTimeMeta(item.estimatedTime, t),
    hasAlgoData:
      item.stability != null ||
      item.difficulty != null ||
      item.interval != null ||
      item.reps != null ||
      item.retrievability != null,
    tags: item.tags ?? [],
    category: item.category ?? null,
  };
}
