/**
 * Human-readable formatting for whole-session review durations.
 *
 * Pure and unit-testable: no locale or component dependencies.
 * - `< 60s` → `"Ns"` (e.g. `"45s"`)
 * - `< 60m` → `"Mm Ss"`, omitting `"0s"` on exact minutes (e.g. `"3m 20s"`, `"4m"`)
 * - `>= 60m` → `"Hh Mm"`, omitting `"0m"` on exact hours (e.g. `"1h 5m"`, `"2h"`)
 *
 * Non-finite or non-positive input renders as `"0s"` so a completed session
 * never shows a bare `"0m"`.
 */
export function formatSessionDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0s";
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
