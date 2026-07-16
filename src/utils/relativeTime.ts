const UNIX_SECONDS_THRESHOLD = 1_000_000_000_000;

/**
 * Normalize a Unix timestamp to the JavaScript-millisecond unit used by the UI.
 * Values below the threshold are treated as Unix seconds for compatibility with
 * the native and browser position APIs.
 */
export function normalizeUnixTimestampMs(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;

  const timestampMs = Math.abs(value) < UNIX_SECONDS_THRESHOLD ? value * 1000 : value;
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

/**
 * Format a timestamp relative to now. The timestamp must be in JavaScript
 * milliseconds after crossing the API boundary.
 */
export function formatRelativeTime(
  timestampMs: number | null | undefined,
  nowMs = Date.now(),
): string {
  if (
    timestampMs == null ||
    !Number.isFinite(timestampMs) ||
    timestampMs <= 0 ||
    !Number.isFinite(nowMs)
  ) {
    return "—";
  }

  const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}
