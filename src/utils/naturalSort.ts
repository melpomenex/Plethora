/**
 * Natural (numeric-aware) comparison for filenames and paths.
 *
 * Lexicographic ordering puts "10" before "2", which scrambles every numbered
 * audiobook/podcast track list. This comparator orders embedded digit runs by
 * their numeric value ("1, 2, 10") while comparing the remaining text
 * case-insensitively.
 */

const collator: Intl.Collator | undefined = (() => {
  try {
    return new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  } catch {
    return undefined;
  }
})();

/** Split a string into alternating text / digit-run chunks. */
function chunk(value: string): string[] {
  return value.split(/(\d+)/);
}

/** Fallback comparator for environments without Intl.Collator numeric support. */
function fallbackCompare(a: string, b: string): number {
  const ca = chunk(a);
  const cb = chunk(b);
  const len = Math.min(ca.length, cb.length);
  for (let i = 0; i < len; i++) {
    const sa = ca[i];
    const sb = cb[i];
    if (sa === sb) continue;
    if (/^\d+$/.test(sa) && /^\d+$/.test(sb)) {
      const diff = parseInt(sa, 10) - parseInt(sb, 10);
      if (diff !== 0) return diff;
      // Numerically equal (e.g. "01" vs "1") — fall through to text compare.
    }
    return sa.localeCompare(sb, undefined, { sensitivity: "base" }) || (sa < sb ? -1 : 1);
  }
  return ca.length - cb.length;
}

/**
 * Compare two strings naturally: digit runs compare numerically, text compares
 * case-insensitively. Returns a negative number when `a` sorts before `b`.
 */
export function naturalCompare(a: string, b: string): number {
  if (a === b) return 0;
  if (collator) return collator.compare(a, b);
  return fallbackCompare(a, b);
}

/**
 * Extract the file name (final path segment) from a path with either separator.
 */
export function baseNameOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/**
 * Strip the extension from a file name ("01 - Track.mp3" → "01 - Track").
 */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
