import type { TimedTextEntry, TimedTextLookupResult } from "./types";

/** Post-word sticky window — matches `findActiveWordIndex` in wordTimings.ts. */
export const STICKY_TOLERANCE_MS = 200;

export interface TimedTextPlaybackLookupOptions {
  /** Skip sort when entries are already ordered by startMs (e.g. alignment flatten). */
  presorted?: boolean;
}

function stickyWindowEnd(entries: readonly TimedTextEntry[], index: number): number {
  const entry = entries[index];
  const nextStart = index + 1 < entries.length ? entries[index + 1].startMs : Infinity;
  const toleranceEnd = entry.endMs + STICKY_TOLERANCE_MS;
  return toleranceEnd >= nextStart ? nextStart - 1 : toleranceEnd;
}

function isActiveAt(entries: readonly TimedTextEntry[], index: number, ms: number): boolean {
  if (index < 0 || index >= entries.length) return false;
  const entry = entries[index];
  if (ms < entry.startMs) return false;
  return ms <= stickyWindowEnd(entries, index);
}

/**
 * Resolve the active entry index at `ms` using sticky gap semantics:
 * - 200ms hold after each word (capped before the next word starts)
 * - hold the last word through trailing silence inside a segment
 * - no nearest-neighbor snap across multi-second gaps
 */
export function resolveActiveEntryIndex(entries: readonly TimedTextEntry[], ms: number): number {
  if (entries.length === 0) return -1;
  for (let i = 0; i < entries.length; i++) {
    if (isActiveAt(entries, i, ms)) return i;
  }
  const last = entries.length - 1;
  if (ms > entries[last].endMs) return last;
  return -1;
}

/**
 * Efficient timed-text lookup for playback synchronization.
 *
 * - Normal forward playback: amortized O(1) via cursor advance + sticky windows
 * - Seeks / large jumps: O(n) sticky resolve (throttled by callers)
 */
export class TimedTextPlaybackLookup {
  private readonly entries: TimedTextEntry[];
  private cursor = 0;

  constructor(entries: readonly TimedTextEntry[], options?: TimedTextPlaybackLookupOptions) {
    if (options?.presorted) {
      this.entries = [...entries];
    } else {
      this.entries = [...entries].sort((a, b) => a.startMs - b.startMs);
    }
  }

  get length(): number {
    return this.entries.length;
  }

  getEntries(): readonly TimedTextEntry[] {
    return this.entries;
  }

  resetCursor(index = 0): void {
    this.cursor = Math.max(0, Math.min(index, this.entries.length - 1));
  }

  getEntryAtIndex(index: number): TimedTextEntry | null {
    return this.entries[index] ?? null;
  }

  /** Seek: resolve active entry at timestamp (ms) with sticky semantics. */
  findAtTime(ms: number): TimedTextLookupResult | null {
    const index = resolveActiveEntryIndex(this.entries, ms);
    if (index < 0) return null;
    this.cursor = index;
    return { entry: this.entries[index], index };
  }

  /** Amortized O(1) forward lookup during normal playback. */
  advance(ms: number): TimedTextLookupResult | null {
    if (this.entries.length === 0) return null;

    if (isActiveAt(this.entries, this.cursor, ms)) {
      return { entry: this.entries[this.cursor], index: this.cursor };
    }

    // Catch up across skipped intervals (playback rate > 1, long gaps).
    while (this.cursor + 1 < this.entries.length) {
      const next = this.cursor + 1;
      if (isActiveAt(this.entries, next, ms)) {
        this.cursor = next;
        return { entry: this.entries[this.cursor], index: this.cursor };
      }
      if (ms < this.entries[next].startMs) break;
      this.cursor = next;
    }

    if (isActiveAt(this.entries, this.cursor, ms)) {
      return { entry: this.entries[this.cursor], index: this.cursor };
    }

    if (this.cursor > 0 && isActiveAt(this.entries, this.cursor - 1, ms)) {
      this.cursor -= 1;
      return { entry: this.entries[this.cursor], index: this.cursor };
    }

    return this.findAtTime(ms);
  }

  /**
   * Returns the newly active word index, or null when unchanged since `lastIndex`.
   * Mirrors `nextActiveWordIndex` for timed-text entries.
   */
  nextActiveWordIndex(ms: number, lastIndex: number): number | null {
    const result = this.advance(ms);
    if (!result) return null;
    const index = result.entry.wordIndex ?? result.index;
    if (index === lastIndex) return null;
    return index;
  }
}
