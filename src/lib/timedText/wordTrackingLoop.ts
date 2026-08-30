import { buildTimedTextEntriesFromChunkTimings } from "./fromTtsChunk";
import { TimedTextPlaybackLookup } from "./playbackLookup";
import type { TTSChunk } from "../../utils/readerSpeechIndex";
import { resolveChunkTimings, type WordTiming } from "../../utils/wordTimings";

export interface TimedTextWordTrackingOptions {
  audio: HTMLAudioElement;
  chunkText: string;
  measuredTimings?: WordTiming[];
  chunk?: TTSChunk | null;
  initialWordIndex?: number;
  onWordIndex: (wordIndex: number, currentTimeMs: number, approximate: boolean) => void;
  onApproximateChange?: (approximate: boolean) => void;
}

export interface TimedTextWordTrackingHandle {
  stop: () => void;
}

/**
 * RAF-throttled word clock shared by document TTS and `useTimedTextPlayback`.
 * Samples `audio.currentTime`, resolves via `TimedTextPlaybackLookup`, and
 * suspends while paused/ended/hidden (restarts on visibility return).
 */
export function startTimedTextWordTracking(
  options: TimedTextWordTrackingOptions
): TimedTextWordTrackingHandle {
  const {
    audio,
    chunkText,
    measuredTimings,
    chunk,
    initialWordIndex = 0,
    onWordIndex,
    onApproximateChange,
  } = options;

  let rafId: number | null = null;
  let timings = resolveChunkTimings(chunkText, measuredTimings, undefined);
  let approximate = timings?.[0]?.source !== "measured";
  let lastWordIndex = initialWordIndex;
  let lookup: TimedTextPlaybackLookup | null = null;

  if (timings) {
    onApproximateChange?.(approximate);
  }

  const rebuildLookup = (resolved: WordTiming[]) => {
    const entries =
      buildTimedTextEntriesFromChunkTimings(resolved, chunk ?? undefined) ??
      buildTimedTextEntriesFromChunkTimings(resolved);
    if (entries) {
      lookup = new TimedTextPlaybackLookup(entries, { presorted: true });
      lookup.resetCursor(lastWordIndex);
    }
  };

  if (timings) rebuildLookup(timings);

  const scheduleTick = () => {
    rafId = requestAnimationFrame(tick);
  };

  const tick = () => {
    rafId = null;
    if (!audio || audio.paused || audio.ended) return;
    if (document.hidden) return;

    if (!timings) {
      timings = resolveChunkTimings(chunkText, undefined, audio.duration);
      approximate = timings?.[0]?.source !== "measured";
      if (timings) {
        onApproximateChange?.(approximate);
        rebuildLookup(timings);
      }
    }

    if (timings && lookup) {
      const currentMs = Math.round(audio.currentTime * 1000);
      const next = lookup.nextActiveWordIndex(currentMs, lastWordIndex);
      if (next !== null) {
        lastWordIndex = next;
        onWordIndex(next, currentMs, approximate);
      }
    }

    scheduleTick();
  };

  const onVisibilityChange = () => {
    if (!document.hidden && audio && !audio.paused && !audio.ended) {
      scheduleTick();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  scheduleTick();

  return {
    stop: () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
