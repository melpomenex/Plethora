import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle,
  CloudCheck,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SpeakerHigh,
} from "@phosphor-icons/react";
import { useSettingsStore } from "../../../stores/settingsStore";
import {
  loadCachedStudyMedia,
  saveCachedStudyMedia,
} from "../../../lib/study-plans/studyMode/studyMediaCache";
import { synthesizeStudySegment } from "../../../lib/study-plans/studyMode/studyTtsBridge";
import type { StudyModeArtifact } from "../../../types/studyMode";

export interface PlayableAudioLessonPlayerProps {
  artifact: StudyModeArtifact;
  scopeKey: string;
  sourceRevision: string;
  isOffline?: boolean;
}

interface AudioTurn {
  speaker: string;
  text: string;
  misconceptionCorrected?: boolean;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

export const PlayableAudioLessonPlayer: React.FC<PlayableAudioLessonPlayerProps> = ({
  artifact,
  scopeKey,
  sourceRevision,
  isOffline = false,
}) => {
  const settings = useSettingsStore((s) => s.settings);
  const turns: AudioTurn[] = useMemo(() => {
    const raw = artifact.payload.turns;
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      return {
        speaker: String(obj.speaker ?? "teacher"),
        text: String(obj.text ?? ""),
        misconceptionCorrected: Boolean(obj.misconceptionCorrected),
      };
    });
  }, [artifact.payload.turns]);

  const cachedManifest = useMemo(
    () => loadCachedStudyMedia(artifact.id, sourceRevision),
    [artifact.id, sourceRevision]
  );

  const [activeIndex, setActiveIndex] = useState<number>(
    cachedManifest ? Math.min(cachedManifest.lastPositionIndex, Math.max(0, turns.length - 1)) : 0
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [recallPausesEnabled, setRecallPausesEnabled] = useState<boolean>(true);
  const [awaitingRecallResume, setAwaitingRecallResume] = useState<boolean>(false);
  const [isCachedOffline, setIsCachedOffline] = useState<boolean>(Boolean(cachedManifest));
  const [playbackSource, setPlaybackSource] = useState<string>(
    cachedManifest ? "Cached for offline" : "Ready"
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopActiveAudio = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speech synthesis errors in non-browser environments
      }
    }
  }, []);

  useEffect(() => {
    return () => stopActiveAudio();
  }, [stopActiveAudio]);

  const advanceOrPauseAtTurn = useCallback(
    (completedIndex: number) => {
      const completedTurn = turns[completedIndex];
      const nextIndex = completedIndex + 1;
      if (nextIndex >= turns.length) {
        setIsPlaying(false);
        return;
      }
      if (
        recallPausesEnabled &&
        (completedTurn?.speaker.toLowerCase() === "student" || completedTurn?.misconceptionCorrected)
      ) {
        setAwaitingRecallResume(true);
        setIsPlaying(false);
        setActiveIndex(nextIndex);
        return;
      }
      setActiveIndex(nextIndex);
    },
    [recallPausesEnabled, turns]
  );

  useEffect(() => {
    if (!isPlaying || turns.length === 0) {
      stopActiveAudio();
      return;
    }
    const turn = turns[activeIndex];
    if (!turn) {
      setIsPlaying(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      const synthesized = await synthesizeStudySegment({
        artifactId: artifact.id,
        kind: "audio_script",
        scopeKey,
        sourceRevision,
        index: activeIndex,
        text: turn.text,
        settings,
        isOffline,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      const hasDurableAudio =
        synthesized.fromCache ||
        synthesized.source === "tts_cache" ||
        synthesized.source === "tts_provider";
      setIsCachedOffline(hasDurableAudio);
      setPlaybackSource(
        synthesized.fromCache
          ? "Cached for offline"
          : synthesized.source === "tts_provider"
          ? "TTS Audio"
          : synthesized.source === "speech_synthesis"
          ? "Device Speech"
          : "Synced Transcript"
      );

      if (synthesized.audioUrl && typeof Audio !== "undefined") {
        const audio = new Audio(synthesized.audioUrl);
        audio.playbackRate = speed;
        audioRef.current = audio;
        audio.onended = () => advanceOrPauseAtTurn(activeIndex);
        audio.onerror = () => advanceOrPauseAtTurn(activeIndex);
        audio.play().catch(() => {
          const ms = Math.max(1200, (synthesized.durationSec * 1000) / speed);
          timerRef.current = setTimeout(() => advanceOrPauseAtTurn(activeIndex), ms);
        });
      } else if (
        synthesized.source === "speech_synthesis" &&
        typeof window !== "undefined" &&
        typeof window.speechSynthesis !== "undefined" &&
        typeof SpeechSynthesisUtterance !== "undefined"
      ) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(turn.text);
          utterance.rate = speed;
          utterance.onend = () => {
            if (!controller.signal.aborted) advanceOrPauseAtTurn(activeIndex);
          };
          utterance.onerror = () => {
            if (!controller.signal.aborted) advanceOrPauseAtTurn(activeIndex);
          };
          window.speechSynthesis.speak(utterance);
        } catch {
          const ms = Math.max(1200, (synthesized.durationSec * 1000) / speed);
          timerRef.current = setTimeout(() => advanceOrPauseAtTurn(activeIndex), ms);
        }
      } else {
        const ms = Math.max(1200, (synthesized.durationSec * 1000) / speed);
        timerRef.current = setTimeout(() => advanceOrPauseAtTurn(activeIndex), ms);
      }
    })();

    return () => stopActiveAudio();
  }, [
    activeIndex,
    advanceOrPauseAtTurn,
    artifact.id,
    isOffline,
    isPlaying,
    scopeKey,
    settings,
    sourceRevision,
    speed,
    stopActiveAudio,
    turns,
  ]);

  const handleSeek = (nextIdx: number) => {
    const clamped = Math.max(0, Math.min(turns.length - 1, nextIdx));
    setAwaitingRecallResume(false);
    setActiveIndex(clamped);
    const existing = loadCachedStudyMedia(artifact.id, sourceRevision);
    saveCachedStudyMedia({
      artifactId: artifact.id,
      kind: "audio_script",
      scopeKey,
      sourceRevision,
      lastPositionIndex: clamped,
      segments: existing?.segments ?? [],
      cachedAt: existing?.cachedAt ?? new Date().toISOString(),
    });
  };

  if (turns.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        No audio lesson turns found.
      </div>
    );
  }

  return (
    <div
      data-testid="playable-audio-lesson"
      className="rounded-lg border border-border bg-card p-3.5 space-y-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground min-w-0">
          <SpeakerHigh className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span className="truncate">{String(artifact.payload.title ?? "Audio Lesson")}</span>
        </div>
        <span
          data-testid="audio-cache-status"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px]"
        >
          <CloudCheck className="w-3 h-3" aria-hidden="true" />
          {isCachedOffline ? "Cached for offline" : playbackSource}
        </span>
      </div>

      {/* Transport Controls, Seek Scrubber, Speed */}
      <div className="space-y-2 rounded-md border border-border bg-background/70 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Previous turn"
              disabled={activeIndex === 0}
              onClick={() => handleSeek(activeIndex - 1)}
              className="p-1.5 rounded border border-border disabled:opacity-40 hover:bg-muted"
            >
              <SkipBack className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={isPlaying ? "Pause audio lesson" : "Play audio lesson"}
              onClick={() => {
                setAwaitingRecallResume(false);
                setIsPlaying((p) => !p);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Pause Lesson</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Play Lesson</span>
                </>
              )}
            </button>
            <button
              type="button"
              aria-label="Next turn"
              disabled={activeIndex >= turns.length - 1}
              onClick={() => handleSeek(activeIndex + 1)}
              className="p-1.5 rounded border border-border disabled:opacity-40 hover:bg-muted"
            >
              <SkipForward className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>Speed</span>
              <select
                aria-label="Playback speed"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
              >
                {SPEED_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={recallPausesEnabled}
                onChange={(e) => setRecallPausesEnabled(e.target.checked)}
              />
              <span>Recall pauses</span>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            Turn {activeIndex + 1}/{turns.length}
          </span>
          <input
            type="range"
            aria-label="Seek audio lesson turn"
            min={0}
            max={Math.max(0, turns.length - 1)}
            value={activeIndex}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
        </div>
      </div>

      {/* Active Recall Pause Prompt */}
      {awaitingRecallResume && (
        <div
          data-testid="audio-recall-pause-banner"
          className="rounded-md border border-primary/40 bg-primary/10 p-2.5 flex flex-wrap items-center justify-between gap-2"
        >
          <span className="text-foreground font-medium">
            Active Recall Pause: How would you answer or correct the student&apos;s point before listening?
          </span>
          <button
            type="button"
            onClick={() => {
              setAwaitingRecallResume(false);
              setIsPlaying(true);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium"
          >
            <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
            Resume Explanation
          </button>
        </div>
      )}

      {/* Synchronized Transcript */}
      <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1" role="list" aria-label="Audio transcript">
        {turns.map((turn, idx) => {
          const active = idx === activeIndex;
          return (
            <button
              key={idx}
              type="button"
              role="listitem"
              aria-current={active ? "true" : undefined}
              onClick={() => handleSeek(idx)}
              className={`w-full text-left p-2.5 rounded-md border transition-colors ${
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/70"
              }`}
            >
              <span className="font-semibold uppercase text-[10px] mr-2 text-primary">
                {turn.speaker}:
              </span>
              <span>{turn.text}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Listening builds exposure only; use Practice to verify understanding.
      </p>
    </div>
  );
};
