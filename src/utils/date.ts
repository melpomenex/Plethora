/**
 * Date utility functions
 */

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return formatDate(d);
}

export function isDue(date: string | Date): boolean {
  const d = typeof date === "string" ? new Date(date) : date;
  return d <= new Date();
}

export function getDaysUntil(date: string | Date): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  return Math.ceil(diffMs / 86400000);
}

/**
 * Human-readable duration, scaled to its magnitude: `45s`, `12m 30s`,
 * `2h 14m`. Above an hour the seconds component is dropped — at that scale it
 * is noise, not precision.
 *
 * Non-finite and negative inputs clamp to `0s` rather than rendering `NaNs`;
 * these values arrive over IPC and a malformed one must not leak into the UI.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.floor(seconds);

  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Compact duration for dense surfaces — the popover summary and the modal's
 * timeline, where a column of `12m 30s` values is harder to scan than `13m`.
 *
 * Identical to {@link formatDuration} above an hour, where both drop the
 * seconds component; below an hour it drops them too, rounding to the nearest
 * minute.
 */
export function formatDurationCompact(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.floor(seconds);

  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.round(total / 60)}m`;
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  return `${hours}h ${mins}m`;
}
