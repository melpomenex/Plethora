import { invokeCommand } from "../lib/tauri";
import type { Document } from "../types/document";
import { validCaptureUrl } from "../utils/captureSource";

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

export interface BrowserCaptureDocument {
  documentId: string;
  title: string;
  fileType: Document["fileType"];
  sourceUrl: string;
  dateAdded: string;
  coverImageUrl: string | null;
  coverImageSource: string | null;
}

export interface BrowserCapturePage {
  items: BrowserCaptureDocument[];
  totalCount: number;
  limit: number;
  offset: number;
}

const FILE_TYPES: Document["fileType"][] = ["pdf", "epub", "markdown", "html", "youtube", "audio", "video", "image", "other"];
const stringOrNull = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const boundedInteger = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

function normalizeBrowserCapture(entry: unknown): BrowserCaptureDocument | null {
  if (!isRecord(entry)) return null;
  const sourceUrl = validCaptureUrl(entry.source_url);
  const documentId = stringOrNull(entry.document_id);
  const dateAdded = stringOrNull(entry.date_added);
  if (!documentId || !sourceUrl || !dateAdded || !Number.isFinite(Date.parse(dateAdded))) return null;
  return {
    documentId, sourceUrl, dateAdded,
    title: typeof entry.title === "string" ? entry.title : "",
    fileType: FILE_TYPES.includes(entry.file_type as Document["fileType"]) ? entry.file_type as Document["fileType"] : "other",
    coverImageUrl: stringOrNull(entry.cover_image_url),
    coverImageSource: stringOrNull(entry.cover_image_source),
  };
}

export function normalizeBrowserCapturePage(raw: unknown): BrowserCapturePage {
  const source = isRecord(raw) ? raw : {};
  const limit = boundedInteger(source.limit, 6, 1, 100);
  const seen = new Set<string>();
  const items = (Array.isArray(source.items) ? source.items : [])
    .map(normalizeBrowserCapture)
    .filter((item): item is BrowserCaptureDocument => {
      if (!item || seen.has(item.documentId)) return false;
      seen.add(item.documentId);
      return true;
    }).slice(0, limit);
  return {
    items, limit,
    offset: boundedInteger(source.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    totalCount: Math.max(items.length, boundedInteger(source.total_count, 0, 0, Number.MAX_SAFE_INTEGER)),
  };
}

export async function getBrowserCaptureDocuments(limit = 6, offset = 0): Promise<BrowserCapturePage> {
  const raw = await invokeCommand("get_browser_capture_documents", {
    limit: boundedInteger(limit, 6, 1, 100),
    offset: boundedInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER),
  });
  return normalizeBrowserCapturePage(raw);
}
