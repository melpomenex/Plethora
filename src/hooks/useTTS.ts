/**
 * Text-to-Speech Hook
 * Supports Fal.ai generation with local fallback to Web Speech API.
 *
 * When the active provider is `android`, playback is delegated to
 * useNativeAndroidTTS — the native plugin plays audio through sherpa-onnx and
 * AudioTrack and drives the UI via events (no audio URL is returned).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { chunkSpeechText, generateSpeech, resolveTTSMaxChunkSize, TTSServiceError } from "../api/tts";
import { resolveProviderKey } from "../api/tts/auth";
import { getAdapter } from "../api/tts/registry";
import { getProviderSettings } from "../utils/ttsSettings";
import { useSettingsStore } from "../stores/settingsStore";
import { useNativeAndroidTTS } from "./useNativeAndroidTTS";
import { useRemoteMediaBridge } from "./useRemoteMediaBridge";
import type { RemoteMediaContext } from "../utils/remoteMediaDispatcher";
import { createLongFormSessionId } from "../utils/longFormPlaybackSession";
import { cloudTtsRequiresConsent, requestPaidConsent } from "../utils/aiBillingConsent";
import { t } from "../lib/i18n";

interface UseTTSOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
}

interface SpeakOverrides {
  voiceId?: string;
  presetId?: string;
}

interface UseTTSReturn {
  speak: (text: string, overrides?: SpeakOverrides) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isSpeaking: boolean;
  isPaused: boolean;
  isGenerating: boolean;
  lastError: string | null;
  isSupported: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setSelectedVoice: (voice: SpeechSynthesisVoice | null) => void;
  /** Active sentence index for reader highlighting (native provider only). */
  activeSentenceIndex?: number;
  /** Active sentence text for reader highlighting (native provider only). */
  activeSentence?: string | null;
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function useTTS(options: UseTTSOptions = {}): UseTTSReturn {
  const { rate = 1, pitch = 1, volume = 1, lang = "en-US" } = options;

  const settings = useSettingsStore((state) => state.settings);

  // ── Native Android provider: delegate the entire surface ────────────
  // The native provider is event-driven and owns playback natively, so we
  // route through useNativeAndroidTTS and adapt its return to UseTTSReturn.
  const isAndroidProvider = settings.tts?.provider === "android";
  const native = useNativeAndroidTTS(settings, { rate });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const settlePlaybackRef = useRef<(() => void) | null>(null);

  const hasSpeechSynthesis = typeof window !== "undefined" && "speechSynthesis" in window;
  const hasAudioPlayback = typeof window !== "undefined" && typeof Audio !== "undefined";
  const isSupported = hasSpeechSynthesis || hasAudioPlayback;

  // NOTE: the native-provider branch deliberately lives at the very BOTTOM of
  // this function, not here. Returning early at this point skipped the eight
  // hooks declared below, so switching the provider to or from "android" in
  // settings changed this component's hook count between renders and React
  // threw "Rendered fewer hooks than expected", blanking the app until a
  // restart. Every hook must run on every render; only the returned value may
  // branch. Keep it that way.

  const ttsSettings = settings.tts;

  // System TTS uses the device speech engine — always "configured", no key/URL.
  const isSystemProvider = ttsSettings?.provider === "system";
  const activeAdapter = getAdapter(String(ttsSettings?.provider || "system"));
  const activeConfig = ttsSettings
    ? getProviderSettings(ttsSettings, String(ttsSettings.provider))
    : null;
  const resolvedKey = ttsSettings ? resolveProviderKey(activeAdapter, settings) : { key: "" };
  const providerConfigured =
    Boolean(ttsSettings?.enabled) &&
    (activeAdapter.auth.mode === "none" ||
      (activeConfig?.requestMode === "proxy"
        ? Boolean(activeConfig.proxyUrl.trim())
        : Boolean(resolvedKey.key)));

  const stop = useCallback(() => {
    // Resolve the active `speak` promise before cancelling the underlying
    // engine. This makes stop a deliberate "skip this utterance" operation
    // for sequenced flows such as hands-free review.
    settlePlaybackRef.current?.();
    settlePlaybackRef.current = null;

    if (hasSpeechSynthesis) {
      window.speechSynthesis.cancel();
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setIsGenerating(false);
    setIsSpeaking(false);
    setIsPaused(false);
  }, [hasSpeechSynthesis]);

  useEffect(() => {
    if (!hasSpeechSynthesis) return;

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      setVoices(availableVoices);

      const defaultVoice = availableVoices.find((voice) =>
        voice.lang.startsWith(lang.split("-")[0])
      );
      if (defaultVoice && !selectedVoice) {
        setSelectedVoice(defaultVoice);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [hasSpeechSynthesis, lang, selectedVoice]);

  const speakWithWebSpeech = useCallback(
    (text: string): Promise<void> => {
      if (!hasSpeechSynthesis) return Promise.resolve();

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      utterance.lang = lang;

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (settlePlaybackRef.current === finish) {
            settlePlaybackRef.current = null;
          }
          resolve();
        };
        settlePlaybackRef.current = finish;

        utterance.onstart = () => {
          setLastError(null);
          setIsSpeaking(true);
          setIsPaused(false);
        };
        utterance.onend = () => {
          setIsSpeaking(false);
          setIsPaused(false);
          finish();
        };
        utterance.onerror = () => {
          setLastError("Web Speech API failed to read this text.");
          setIsSpeaking(false);
          setIsPaused(false);
          finish();
        };

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      });
    },
    [hasSpeechSynthesis, rate, pitch, volume, lang, selectedVoice]
  );

  const speakWithProvider = useCallback(
    async (text: string, overrides?: SpeakOverrides) => {
      if (!hasAudioPlayback) {
        throw new Error("Audio playback is not supported on this platform.");
      }

      setIsGenerating(true);
      setLastError(null);

      const result = await generateSpeech(settings, {
        text,
        voiceId: overrides?.voiceId,
        presetId: overrides?.presetId,
      });

      const audio = new Audio(result.audioUrl);
      audio.playbackRate = rate;
      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (settlePlaybackRef.current === finish) {
            settlePlaybackRef.current = null;
          }
          resolve();
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          if (settlePlaybackRef.current === finish) {
            settlePlaybackRef.current = null;
          }
          reject(error);
        };
        settlePlaybackRef.current = finish;

        audio.onplay = () => {
          setIsGenerating(false);
          setIsSpeaking(true);
          setIsPaused(false);
        };
        audio.onpause = () => {
          if (audio.ended) return;
          setIsPaused(true);
          setIsSpeaking(false);
        };
        audio.onended = () => {
          setIsSpeaking(false);
          setIsPaused(false);
          setIsGenerating(false);
          finish();
        };
        audio.onerror = () => {
          setIsGenerating(false);
          setIsSpeaking(false);
          setIsPaused(false);
          setLastError("Failed to play generated audio.");
          fail(new Error("Failed to play generated audio."));
        };

        void audio.play().catch((error: unknown) => {
          fail(error instanceof Error ? error : new Error("Failed to start generated audio."));
        });
      });
    },
    [settings, hasAudioPlayback, rate]
  );

  const speak = useCallback(
    async (text: string, overrides?: SpeakOverrides) => {
      if (!isSupported) return;

      stop();
      const normalizedText = cleanText(text);
      if (!normalizedText) return;

      const runProvider = async (): Promise<void> => {
        const maxChunkSize = await resolveTTSMaxChunkSize(settings);
        for (const chunk of chunkSpeechText(normalizedText, maxChunkSize)) {
          await speakWithProvider(chunk, overrides);
        }
      };

      try {
        // System TTS synthesizes directly via the device engine (no audio URL).
        if (isSystemProvider && hasSpeechSynthesis) {
          await speakWithWebSpeech(normalizedText);
        } else if (providerConfigured) {
          // Paid/cloud consent gate runs once BEFORE the chunk loop so
          // read-aloud prompts at most once, never once per chunk
          // (ai-billing-safety #14). A denial stops the read rather than
          // throwing a per-chunk consent error.
          if (
            cloudTtsRequiresConsent(String(ttsSettings?.provider), settings) &&
            !(await requestPaidConsent({
              kind: "tts",
              provider: String(ttsSettings?.provider),
              model: activeConfig?.modelId,
              label: activeAdapter.label,
            }))
          ) {
            setLastError(t("paid.ttsReadAloudBlocked"));
            return;
          }
          await runProvider();
        } else {
          await speakWithWebSpeech(normalizedText);
        }
      } catch (error) {
        setIsGenerating(false);
        setIsSpeaking(false);
        setIsPaused(false);

        // Defensive backstop (ai-billing-safety #14): a billable adapter was
        // reached without consent (the pre-loop gate was bypassed/stale).
        // Surface the opt-in surface; granted ⇒ retry once, denied ⇒ stop
        // with feedback instead of showing a bare provider error.
        let retryFailure: Error | undefined;
        if (error instanceof TTSServiceError && error.consentRequired) {
          const granted = await requestPaidConsent({
            kind: "tts",
            provider: String(ttsSettings?.provider),
            model: activeConfig?.modelId,
            label: activeAdapter.label,
          });
          if (granted) {
            try {
              await runProvider();
              return;
            } catch (retryError) {
              retryFailure =
                retryError instanceof Error
                  ? retryError
                  : new Error(String(retryError));
            }
          } else {
            setLastError(t("paid.ttsReadAloudBlocked"));
            return;
          }
        }

        setLastError(
          retryFailure?.message ??
            (error instanceof Error ? error.message : "TTS generation failed.")
        );

        if (hasSpeechSynthesis) {
          await speakWithWebSpeech(normalizedText);
        }
      }
    },
    [
      isSupported,
      stop,
      providerConfigured,
      isSystemProvider,
      hasSpeechSynthesis,
      speakWithProvider,
      speakWithWebSpeech,
      settings,
      ttsSettings,
      activeConfig,
      activeAdapter,
    ]
  );

  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setIsPaused(true);
      setIsSpeaking(false);
      return;
    }

    if (hasSpeechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, [hasSpeechSynthesis]);

  const resume = useCallback(() => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current
        .play()
        .then(() => {
          setIsPaused(false);
          setIsSpeaking(true);
        })
        .catch((error) => {
          setLastError(error instanceof Error ? error.message : "Failed to resume playback.");
        });
      return;
    }

    if (hasSpeechSynthesis && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      setIsSpeaking(true);
    }
  }, [hasSpeechSynthesis]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const ttsSourceKind = isAndroidProvider
    ? ("native_android_tts" as const)
    : isSystemProvider
      ? ("web_speech" as const)
      : ("generated_audio" as const);
  const ttsSourceId = "tts:active";
  const ttsSessionId = createLongFormSessionId(ttsSourceKind, ttsSourceId);
  const ttsMediaContextRef = useRef<RemoteMediaContext>({
    documentId: ttsSourceId,
    documentTitle: "Read aloud",
    playbackSessionId: ttsSessionId,
    sourceId: ttsSourceId,
    audioElement: null,
    currentTimestampSec: 0,
    anchors: [],
  });
  const activeTtsIsSpeaking = isAndroidProvider ? native.isSpeaking : isSpeaking;
  const activeTtsIsPaused = isAndroidProvider ? native.isPaused : isPaused;
  const activeTtsIsGenerating = isAndroidProvider ? native.isGenerating : isGenerating;
  ttsMediaContextRef.current = {
    documentId: ttsSourceId,
    documentTitle: "Read aloud",
    playbackSessionId: ttsSessionId,
    sourceId: ttsSourceId,
    audioElement: audioRef.current,
    currentTimestampSec: audioRef.current?.currentTime ?? 0,
    anchors: [],
    onPlayPause: () => {
      if (isAndroidProvider) {
        if (activeTtsIsSpeaking && !activeTtsIsPaused) native.pause();
        else if (activeTtsIsPaused) native.resume();
      } else if (activeTtsIsSpeaking && !activeTtsIsPaused) pause();
      else if (activeTtsIsPaused) resume();
    },
    onSeekRelative: !isAndroidProvider && !isSystemProvider
      ? (deltaSec) => {
          if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + deltaSec);
        }
      : undefined,
    onSeekAbsolute: !isAndroidProvider && !isSystemProvider
      ? (positionSec) => {
          if (audioRef.current) audioRef.current.currentTime = Math.max(0, positionSec);
        }
      : undefined,
  };
  useRemoteMediaBridge({
    getContext: () => ttsMediaContextRef.current,
    title: "Read aloud",
    artist: "Plethora",
    album: "Text to speech",
    sourceId: ttsSourceId,
    sessionId: ttsSessionId,
    sourceKind: ttsSourceKind,
    isPlaying: activeTtsIsSpeaking,
    duration: audioRef.current?.duration,
    currentTime: audioRef.current?.currentTime ?? 0,
    enabled: activeTtsIsSpeaking || activeTtsIsPaused || activeTtsIsGenerating,
    capabilities: {
      canPlay: true,
      canPause: true,
      canResume: true,
      canSeekRelative: !isAndroidProvider && !isSystemProvider,
      canSeekAbsolute: !isAndroidProvider && !isSystemProvider,
      precisePosition: !isAndroidProvider && !isSystemProvider,
      canNext: false,
      canPrevious: false,
    },
  });

  // Native provider: the native hook owns all state and playback, so we hand
  // back its surface instead of the Web Speech / audio-element one. This must
  // stay below every hook call above — see the note near the top of the hook.
  // We still expose voices/setSelectedVoice (empty/null) so callers can use the
  // same interface regardless of provider.
  if (isAndroidProvider) {
    return {
      speak: native.speak,
      stop: native.stop,
      pause: native.pause,
      resume: native.resume,
      isSpeaking: native.isSpeaking,
      isPaused: native.isPaused,
      isGenerating: native.isGenerating,
      lastError: native.lastError,
      isSupported: native.available,
      voices: [],
      selectedVoice: null,
      setSelectedVoice: () => {},
      activeSentenceIndex: native.activeSentenceIndex,
      activeSentence: native.activeSentence,
    };
  }

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
    isPaused,
    isGenerating,
    lastError,
    isSupported,
    voices,
    selectedVoice,
    setSelectedVoice,
  };
}

export default useTTS;
