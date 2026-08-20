import type {
  AnalyticsDateRange,
  AnalyticsEventCursor,
  LanguageAnalyticsEvent,
  LanguageAnalyticsFilter,
} from "./types";

export const DEFAULT_ANALYTICS_TIME_ZONE = "UTC";

export type NormalizedAnalyticsFilter = LanguageAnalyticsFilter & {
  dateRange: Required<AnalyticsDateRange>;
};

function requiredFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

export function normalizeDateRange(range: AnalyticsDateRange): Required<AnalyticsDateRange> {
  const from = requiredFinite(range.from, "dateRange.from");
  const to = requiredFinite(range.to, "dateRange.to");
  if (from >= to) throw new RangeError("dateRange.from must be before dateRange.to");
  const timeZone = range.timeZone ?? DEFAULT_ANALYTICS_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
  } catch {
    throw new RangeError(`Invalid analytics timezone: ${timeZone}`);
  }
  return { from, to, timeZone };
}

export function normalizeAnalyticsFilter(filter: LanguageAnalyticsFilter, fallbackRange?: AnalyticsDateRange): NormalizedAnalyticsFilter {
  if (!filter.profileId.trim()) throw new Error("Language analytics requires a profileId");
  return {
    ...filter,
    profileId: filter.profileId,
    dateRange: normalizeDateRange(
      filter.dateRange ??
        fallbackRange ?? {
          from: 0,
          to: Number.MAX_SAFE_INTEGER,
          timeZone: DEFAULT_ANALYTICS_TIME_ZONE,
        },
    ),
  };
}

function eventDocumentId(event: LanguageAnalyticsEvent): string | undefined {
  if (event.documentId) return event.documentId;
  const payload = event.payload as unknown as { documentId?: unknown };
  return typeof payload.documentId === "string" ? payload.documentId : undefined;
}

export function eventMatchesFilter(event: LanguageAnalyticsEvent, filter: NormalizedAnalyticsFilter): boolean {
  if (event.profileId !== filter.profileId) return false;
  if (event.occurredAt < filter.dateRange.from || event.occurredAt >= filter.dateRange.to) return false;
  if (filter.documentId && eventDocumentId(event) !== filter.documentId) return false;
  if (filter.sourceType && event.sourceType !== filter.sourceType) return false;
  if (filter.languageTag && event.languageTag?.toLocaleLowerCase() !== filter.languageTag.toLocaleLowerCase()) return false;
  return true;
}

function localDateParts(timestamp: number, timeZone: string, includeHour: boolean): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeHour ? { hour: "2-digit", hourCycle: "h23" as const } : {}),
  });
  return Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
}

/** Return a stable local bucket label; the label is not a UTC timestamp. */
export function analyticsBucketStart(timestamp: number, granularity: "hour" | "day", timeZone = DEFAULT_ANALYTICS_TIME_ZONE): string {
  requiredFinite(timestamp, "timestamp");
  const parts = localDateParts(timestamp, timeZone, granularity === "hour");
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (granularity === "day") return date;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${date}T${hour}:00:00`;
}

export function eventCursor(event: LanguageAnalyticsEvent): AnalyticsEventCursor {
  return { occurredAt: event.occurredAt, eventId: event.eventId };
}

export function compareEventCursors(a: AnalyticsEventCursor, b: AnalyticsEventCursor): number {
  return a.occurredAt - b.occurredAt || a.eventId.localeCompare(b.eventId);
}
