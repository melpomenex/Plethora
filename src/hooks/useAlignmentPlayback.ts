import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AlignedWord, PlethoraAlignmentMap } from "../lib/ebookAudiobookAlignment/types";
import {
  PlaybackLookup,
  confidenceTier,
  shouldUseWordHighlight,
} from "../lib/ebookAudiobookAlignment/playbackLookup";

export interface AlignmentPlaybackState {
  activeWord: AlignedWord | null;
  activeWordIndex: number | null;
  chapterConfidence: number;
  highlightMode: "word" | "sentence" | "segment";
  lookup: PlaybackLookup | null;
}

/**
 * Drives word-level sync from a ref-backed audio clock so parent components
 * don't re-render on every `timeupdate` event (~4–10 Hz).
 */
export function useAlignmentPlayback(
  map: PlethoraAlignmentMap | null,
  getCurrentTimeSec: () => number,
  enabled: boolean,
): AlignmentPlaybackState {
  const lookup = useMemo(() => (map ? new PlaybackLookup(map) : null), [map]);
  const [activeWord, setActiveWord] = useState<AlignedWord | null>(null);
  const [activeWordIndex, setActiveWordIndex] = useState<number | null>(null);
  const lastIndexRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const chapterConfidence = useMemo(() => {
    if (!map || map.chapters.length === 0) return 0;
    return map.overallConfidence;
  }, [map]);

  const highlightMode: "word" | "sentence" | "segment" = useMemo(() => {
    if (!map) return "segment";
    if (map.overallConfidence >= 0.3) return "word";
    return "segment";
  }, [map]);

  const chapterConfidenceForIndex = useCallback(
    (wordIndex: number): number => {
      if (!map || !lookup) return 0;
      const ch = lookup.getChapterForWordIndex(wordIndex);
      return map.chapters[ch]?.chapterConfidence ?? map.overallConfidence;
    },
    [map, lookup],
  );

  useEffect(() => {
    lookup?.resetCursor();
    lastIndexRef.current = null;
  }, [lookup]);

  useEffect(() => {
    if (!enabled || !lookup) {
      setActiveWord(null);
      setActiveWordIndex(null);
      lastIndexRef.current = null;
      return;
    }

    let running = true;

    const tick = () => {
      if (!running) return;

      const ms = getCurrentTimeSec() * 1000;
      const result = lookup.advance(ms);

      if (!result) {
        if (lastIndexRef.current !== null) {
          lastIndexRef.current = null;
          setActiveWord(null);
          setActiveWordIndex(null);
        }
      } else if (result.index !== lastIndexRef.current) {
        lastIndexRef.current = result.index;
        const chConf = chapterConfidenceForIndex(result.index);
        const tier = confidenceTier(result.word.confidence);
        if (tier === "unusable" || !shouldUseWordHighlight(chConf, result.word)) {
          setActiveWord(null);
          setActiveWordIndex(null);
        } else {
          setActiveWord(result.word);
          setActiveWordIndex(result.index);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [lookup, enabled, getCurrentTimeSec, chapterConfidenceForIndex]);

  return { activeWord, activeWordIndex, chapterConfidence, highlightMode, lookup };
}

export function useSeekToAlignedWord(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  lookup: PlaybackLookup | null,
): (word: AlignedWord) => void {
  return useCallback(
    (word: AlignedWord) => {
      const audio = audioRef.current;
      if (!audio) return;
      lookup?.resetCursor();
      audio.currentTime = word.startMs / 1000;
    },
    [audioRef, lookup],
  );
}
