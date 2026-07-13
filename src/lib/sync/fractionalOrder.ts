const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Return a stable lexicographic position strictly between two positions. */
export function fractionalBetween(left: string | null, right: string | null): string {
  const a = left ?? "";
  const b = right ?? "";
  let result = "";
  let i = 0;
  while (i < 64) {
    const leftIndex = i < a.length ? ALPHABET.indexOf(a[i]) : 0;
    const rightIndex = i < b.length ? ALPHABET.indexOf(b[i]) : ALPHABET.length - 1;
    const lo = leftIndex < 0 ? 0 : leftIndex;
    const hi = rightIndex < 0 ? ALPHABET.length - 1 : rightIndex;
    if (hi - lo > 1) {
      return result + ALPHABET[Math.floor((lo + hi) / 2)];
    }
    result += ALPHABET[lo];
    i += 1;
  }
  // Extremely dense neighbors: append a deterministic suffix. The caller's
  // device id is used as the final tie-breaker when positions are identical.
  return `${result}U`;
}

export interface OrderedSyncEntry {
  id: string;
  position: string;
  deviceId: string;
}

export function sortSyncOrder(entries: OrderedSyncEntry[]): OrderedSyncEntry[] {
  return entries.slice().sort((a, b) => a.position.localeCompare(b.position) || a.deviceId.localeCompare(b.deviceId) || a.id.localeCompare(b.id));
}
