/**
 * useNativeAndroidTTS — React hook for the native Android TTS provider.
 *
 * The native provider does not return audio URLs; it plays through the plugin
 * (sherpa-onnx → AudioTrack) and drives the UI through events. This hook:
 *   - subscribes to playback-state, sentence-position, utterance-complete, and
 *     error events,
 *   - exposes the same surface as the rest of useTTS (isSpeaking, isPaused,
 *     isGenerating, pause/resume/stop),
 *   - exposes `activeSentenceIndex` for reader sentence highlighting,
 *   - splits text into sentences and queues them with one speak call so the
 *     plugin can prefetch.
 *
 * The main useTTS hook detects `provider === "android"` and delegates here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isNativeMobile } from "../lib/tauri";
import { chunkSpeechText, resolveTTSMaxChunkSize } from "../api/tts";
import {
  onPlaybackState,
  onSentencePosition,
  onUtteranceComplete,
  onTtsError,
  pluginPause,
  pluginResume,
  pluginSpeak,
  pluginStop,
  pluginStartMediaSession,
  pluginStopMediaSession,
  pluginUpdateMediaMetadata,
  type AndroidTtsPlaybackState,
} from "../api/tts/android/bridge";
import type { Settings } from "../stores/settingsStore";
import { getProviderSettings } from "../utils/ttsSettings";

interface UseNativeAndroidTTSOptions {
  rate?: number;
}

interface UseNativeAndroidTTSReturn {
  speak: (text: string, overrides?: { voiceId?: string; presetId?: string }) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  isSpeaking: boolean;
  isPaused: boolean;
  isGenerating: boolean;
  lastError: string | null;
  activeSentenceIndex: number;
  activeSentence: string | null;
  /** Whether this hook is usable in the current environment (Android only). */
  available: boolean;
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function useNativeAndroidTTS(
  settings: Settings,
  options: UseNativeAndroidTTSOptions = {}
): UseNativeAndroidTTSReturn {
  const rate = options.rate ?? 1;
  const available = isNativeMobile();

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState(-1);
  const [activeSentence, setActiveSentence] = useState<string | null>(null);

  // Highest native utterance id we have seen. The native side hands out ids
  // from a monotonic counter (utteranceSeq.incrementAndGet()), so "id >= the
  // one we're tracking" identifies the current utterance and anything lower is
  // a stale event from a superseded one. We adopt the id from the first event
  // that arrives rather than trying to predict it — speak() resolves natively
  // before the id exists, so the frontend cannot know it up front.
  const utteranceRef = useRef<number>(-1);

  // ── Event subscriptions ──────────────────────────────────────────────
  useEffect(() => {
    if (!available) return;

    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    (async () => {
      const u1 = await onPlaybackState((state: AndroidTtsPlaybackState) => {
        switch (state) {
          case "loading":
            setIsGenerating(true);
            setIsSpeaking(false);
            setIsPaused(false);
            setLastError(null);
            break;
          case "playing":
            setIsGenerating(false);
            setIsSpeaking(true);
            setIsPaused(false);
            break;
          case "paused":
            setIsPaused(true);
            setIsSpeaking(false);
            break;
          case "stopped":
            setIsSpeaking(false);
            setIsPaused(false);
            setIsGenerating(false);
            setActiveSentenceIndex(-1);
            setActiveSentence(null);
            break;
          case "idle":
            setIsSpeaking(false);
            setIsPaused(false);
            setIsGenerating(false);
            break;
          case "error":
            setIsSpeaking(false);
            setIsPaused(false);
            setIsGenerating(false);
            break;
        }
      });
      const u2 = await onSentencePosition((e) => {
        if (e.utteranceId < utteranceRef.current) return; // stale utterance
        utteranceRef.current = e.utteranceId;
        setActiveSentenceIndex(e.index);
        setActiveSentence(e.sentence);
      });
      const u3 = await onUtteranceComplete((e) => {
        if (e.utteranceId < utteranceRef.current) return; // stale utterance
        utteranceRef.current = e.utteranceId;
        setIsSpeaking(false);
        setIsPaused(false);
        setIsGenerating(false);
        setActiveSentenceIndex(-1);
        setActiveSentence(null);
      });
      const u4 = await onTtsError((e) => {
        setLastError(e.message);
        setIsSpeaking(false);
        setIsGenerating(false);
      });
      if (cancelled) {
        u1();
        u2();
        u3();
        u4();
        return;
      }
      unlisteners.push(u1, u2, u3, u4);
    })();

    return () => {
      cancelled = true;
      for (const u of unlisteners) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    };
  }, [available]);

  useEffect(() => {
    if (!available) return;
    const state = isGenerating ? "loading" : isSpeaking ? "playing" : isPaused ? "paused" : "idle";
    void pluginUpdateMediaMetadata({
      sourceId: "native-tts",
      sessionId: "native_android_tts:native-tts",
      sourceKind: "native_android_tts",
      title: "Read aloud",
      artist: "Plethora",
      album: "Reader",
      positionSec: 0,
      state,
      isPlaying: isSpeaking,
      canSeekRelative: false,
      canSeekAbsolute: false,
      canNext: false,
      canPrevious: false,
      precisePosition: false,
      updatedAt: Date.now(),
    }).catch(() => {});
  }, [available, isGenerating, isPaused, isSpeaking]);

  const speak = useCallback(
    async (text: string, overrides?: { voiceId?: string; presetId?: string }) => {
      if (!available) return;
      const normalized = cleanText(text);
      if (!normalized) return;

      // Stop any in-flight utterance first (single-engine ownership is also
      // enforced natively, but this keeps highlight state tidy).
      await pluginStartMediaSession().catch(() => {});
      await pluginStop().catch(() => {});
      setActiveSentenceIndex(-1);
      setActiveSentence(null);
      setLastError(null);

      const tts = settings.tts;
      const config = getProviderSettings(tts, "android");
      const modelId = config.modelId;
      const voiceId = overrides?.voiceId ?? config.voiceId ?? "0";

      // Split into sentence-sized chunks for prefetching + highlighting. The
      // plugin receives the sentence list and prefetches the next sentence
      // while the current one plays.
      let sentences: string[] = [];
      try {
        const maxChunk = await resolveTTSMaxChunkSize(settings);
        sentences = chunkSpeechText(normalized, maxChunk);
      } catch {
        sentences = [normalized];
      }
      if (sentences.length === 0) sentences = [normalized];

      setIsGenerating(true);
      // Do NOT seed utteranceRef here. It used to be set to Date.now() as a
      // "placeholder reconciled on first event", but nothing reconciled it and
      // a ~1.7e12 timestamp can never equal the native counter's small integer
      // ids — so every sentence-position and utterance-complete event was
      // discarded: no sentence highlighting, and the UI stayed stuck in the
      // speaking state after playback finished. The handlers adopt the real id
      // off the first event instead; leaving the previous (lower) id in place
      // is what lets them tell the new utterance from a superseded one.

      try {
        await pluginSpeak({
          sentences,
          modelId,
          voiceId,
          speed: rate,
        });
      } catch (error) {
        setIsGenerating(false);
        setLastError(error instanceof Error ? error.message : "Native TTS failed to start.");
      }
    },
    [available, settings, rate]
  );

  const pause = useCallback(() => {
    if (!available) return;
    void pluginPause().catch(() => {});
  }, [available]);

  const resume = useCallback(() => {
    if (!available) return;
    void pluginResume().catch(() => {});
  }, [available]);

  const stop = useCallback(() => {
    if (!available) return;
    void pluginStop().catch(() => {});
    void pluginStopMediaSession().catch(() => {});
    setActiveSentenceIndex(-1);
    setActiveSentence(null);
    setIsSpeaking(false);
    setIsPaused(false);
    setIsGenerating(false);
  }, [available]);

  // Cleanup on unmount: stop native playback.
  useEffect(() => {
    return () => {
      if (available) {
        void pluginStop().catch(() => {});
        void pluginStopMediaSession().catch(() => {});
      }
    };
  }, [available]);

  return {
    speak,
    pause,
    resume,
    stop,
    isSpeaking,
    isPaused,
    isGenerating,
    lastError,
    activeSentenceIndex,
    activeSentence,
    available,
  };
}

export default useNativeAndroidTTS;
