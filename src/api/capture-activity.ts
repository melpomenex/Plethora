import { invokeCommand } from "../lib/tauri";

/**
 * Capture source buckets shown in the Dashboard capture-activity widget.
 * Wire values match the Rust `CaptureSource` serde renames
 * (kebab-case, see src-tauri/src/commands/analytics.rs).
 */
export type CaptureSource =
  | "browser-extension"
  | "share-target"
  | "rss"
  | "manual";

/** Raw shape returned by the `get_capture_activity` Tauri command. */
interface RawCaptureActivity {
  window_days?: unknown;
  per_day?: unknown;
  by_source?: unknown;
  needs_attention?: unknown;
}

export interface CaptureDayCount {
  date: string;
  count: number;
}

export interface CaptureSourceCount {
  source: CaptureSource;
  count: number;
}

export interface CaptureActivity {
  windowDays: number;
  perDay: CaptureDayCount[];
  bySource: CaptureSourceCount[];
  needsAttention: number;
}

const CAPTURE_SOURCES: CaptureSource[] = [
  "browser-extension",
  "share-target",
  "rss",
  "manual",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Coerce an unknown per-day entry into a `{date, count}` pair. */
function normalizeDayEntry(entry: unknown): CaptureDayCount | null {
  if (!isRecord(entry)) return null;
  const date = entry.date;
  const count = entry.count;
  if (typeof date !== "string" || date.length === 0) return null;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }
  return { date, count: Math.round(count) };
}

/** Coerce an unknown per-source entry, dropping unrecognized sources. */
function normalizeSourceEntry(entry: unknown): CaptureSourceCount | null {
  if (!isRecord(entry)) return null;
  const source = entry.source;
  const count = entry.count;
  if (
    typeof source !== "string" ||
    !CAPTURE_SOURCES.includes(source as CaptureSource)
  ) {
    return null;
  }
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
    return null;
  }
  return { source: source as CaptureSource, count: Math.round(count) };
}

/**
 * Normalize the command response defensively (mirrors `getActivityData`):
 * null/non-object payloads and malformed entries degrade to safe defaults
 * instead of leaking into the UI.
 */
export function normalizeCaptureActivity(raw: unknown): CaptureActivity {
  const source: RawCaptureActivity = isRecord(raw) ? raw : {};
  const windowDaysRaw = source.window_days;
  const needsAttentionRaw = source.needs_attention;

  return {
    windowDays:
      typeof windowDaysRaw === "number" && Number.isFinite(windowDaysRaw) && windowDaysRaw > 0
        ? Math.round(windowDaysRaw)
        : 30,
    perDay: Array.isArray(source.per_day)
      ? source.per_day
          .map(normalizeDayEntry)
          .filter((entry): entry is CaptureDayCount => entry !== null)
      : [],
    bySource: Array.isArray(source.by_source)
      ? source.by_source
          .map(normalizeSourceEntry)
          .filter((entry): entry is CaptureSourceCount => entry !== null)
      : [],
    needsAttention:
      typeof needsAttentionRaw === "number" &&
      Number.isFinite(needsAttentionRaw) &&
      needsAttentionRaw > 0
        ? Math.round(needsAttentionRaw)
        : 0,
  };
}

/**
 * Get aggregated capture activity (per-day counts, per-source totals,
 * needs-attention count) for the Dashboard capture-activity widget over a
 * lookback window of `days` (clamped server-side to [1, 90]).
 */
export async function getCaptureActivity(days: number = 30): Promise<CaptureActivity> {
  const raw = await invokeCommand<RawCaptureActivity | null>("get_capture_activity", { days });
  return normalizeCaptureActivity(raw);
}
