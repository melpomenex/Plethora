import type { ResolvedAudioPart } from "../../types/audioEdition";

export function finiteSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid media position");
  return value;
}

export function audioDuration(parts: readonly ResolvedAudioPart[]): number | null {
  if (!parts.length || parts.some(part => part.durationSec === null)) return null;
  return parts.reduce((sum, part) => sum + part.durationSec!, 0);
}

export function globalAudioPosition(parts: readonly ResolvedAudioPart[], index: number, local: number): number | null {
  const start = parts[index]?.globalStartSec;
  return start == null ? null : start + finiteSeconds(local);
}

/** Equality selects the next part; unknown boundaries are never guessed. */
export function locateAudioPosition(parts: readonly ResolvedAudioPart[], seconds: number): { partIndex: number; timeInPart: number } | null {
  const duration = audioDuration(parts);
  const target = Math.min(finiteSeconds(seconds), duration ?? Infinity);
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part.globalStartSec === null || target < part.globalStartSec) continue;
    const local = target - part.globalStartSec;
    if (part.durationSec !== null && local > part.durationSec) return null;
    return { partIndex: index, timeInPart: local };
  }
  return null;
}

export function withAudioBoundaries(parts: readonly Omit<ResolvedAudioPart, "globalStartSec">[]): ResolvedAudioPart[] {
  let start: number | null = 0;
  return parts.map(part => {
    const result = { ...part, globalStartSec: start };
    if (part.durationSec !== null) finiteSeconds(part.durationSec);
    start = start === null || part.durationSec === null ? null : start + part.durationSec;
    return result;
  });
}
