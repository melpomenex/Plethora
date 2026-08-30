import { useCallback, useEffect, useRef } from "react";
import { startTimedTextWordTracking } from "../lib/timedText/wordTrackingLoop";
import type { TTSChunk } from "../utils/readerSpeechIndex";
import type { WordTiming } from "../utils/wordTimings";

export interface UseTimedTextPlaybackOptions {
  /** Whether playback is active (playing, not paused/ended). */
  active: boolean;
  /** Chunk text for timing resolution. */
  chunkText: string;
  /** Measured provider timings when available. */
  measuredTimings?: WordTiming[];
  /** Optional anchored chunk for locator-bearing entries. */
  chunk?: TTSChunk | null;
  /** Audio element driving the clock (cloud TTS path). */
  audio?: HTMLAudioElement | null;
  /** Seed word index on resume (avoids redundant commit). */
  initialWordIndex?: number;
  /** Called when active word index changes. */
  onWordIndex: (wordIndex: number, currentTimeMs: number, approximate: boolean) => void;
}

/**
 * React hook wrapper around `startTimedTextWordTracking` for declarative consumers.
 */
export function useTimedTextPlayback(options: UseTimedTextPlaybackOptions): void {
  const {
    active,
    chunkText,
    measuredTimings,
    chunk,
    audio,
    initialWordIndex = 0,
    onWordIndex,
  } = options;
  const handleRef = useRef<ReturnType<typeof startTimedTextWordTracking> | null>(null);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
  }, []);

  useEffect(() => {
    if (!active || !audio) {
      stop();
      return;
    }

    handleRef.current = startTimedTextWordTracking({
      audio,
      chunkText,
      measuredTimings,
      chunk,
      initialWordIndex,
      onWordIndex,
    });

    return stop;
  }, [active, audio, chunk, chunkText, initialWordIndex, measuredTimings, onWordIndex, stop]);
}
