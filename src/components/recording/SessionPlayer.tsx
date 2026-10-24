import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  ArrowCounterClockwise,
  ArrowClockwise,
  SpeakerHigh,
  SpeakerSlash,
  CircleNotch,
  WarningCircle,
  FileText,
} from "@phosphor-icons/react";
import type { RecordingSession, SessionMediaAsset } from "../../types/recordingSession";
import { isTauri, invokeCommand } from "../../lib/tauri";
import { cn } from "../../utils/cn";
import { GLOBAL_AUDIO_PLAYBACK_ENABLED } from "../../services/audio/audioPlaybackRollout";
import { ControllerSessionPlayer } from "../audio/ControllerSessionPlayer";

export interface SessionPlayerProps {
  session: RecordingSession;
  mediaAsset?: SessionMediaAsset | null;
  initialSeekTimeSec?: number;
  seekTimeSec?: number | null;
  seekRequestId?: number;
  onTimeUpdate?: (timeSec: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  className?: string;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const h = Math.floor(m / 60);
  if (h > 0) {
    const remM = m % 60;
    return `${h}:${remM.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const SessionPlayer: React.FC<SessionPlayerProps> = props =>
  GLOBAL_AUDIO_PLAYBACK_ENABLED ? (
    <ControllerSessionPlayer {...props} />
  ) : (
    <LegacySessionPlayer {...props} />
  );

const LegacySessionPlayer: React.FC<SessionPlayerProps> = ({
  session,
  mediaAsset,
  initialSeekTimeSec,
  seekTimeSec,
  onTimeUpdate,
  onPlayStateChange,
  className,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 1. Determine media availability state
  const isTranscriptOnly = !session.mediaAssetId && !mediaAsset;
  const isMissingMedia =
    (mediaAsset && mediaAsset.state === "missing") ||
    (session.mediaAssetId && !mediaAsset && loadError !== null);
  const isPartial =
    session.captureState === "recording" ||
    session.captureState === "recoverable" ||
    (mediaAsset && mediaAsset.state === "partial");

  // 2. Resolve loopback stream URL for Tauri runtime
  useEffect(() => {
    let active = true;
    if (isTranscriptOnly) {
      setStreamUrl(null);
      setIsLoading(false);
      return;
    }

    async function resolveSource() {
      setIsLoading(true);
      setLoadError(null);
      try {
        if (isTauri()) {
          // In Tauri, ask media_server for stream URL
          const relative = mediaAsset?.relativePath || `recordings/${session.id}/audio.wav`;
          const url = await invokeCommand<string>("get_media_stream_url", {
            filePath: relative,
          });
          if (active) {
            setStreamUrl(url);
          }
        } else {
          // Off-Tauri/web fallback: if sourceUrl or relative path
          if (mediaAsset?.sourceUrl) {
            setStreamUrl(mediaAsset.sourceUrl);
          } else {
            // Mock or relative path
            setStreamUrl(null);
          }
        }
      } catch (err) {
        if (active) {
          console.warn("[SessionPlayer] Failed to resolve media stream URL:", err);
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void resolveSource();

    return () => {
      active = false;
    };
  }, [session.id, session.mediaAssetId, mediaAsset, isTranscriptOnly]);

  // Initial seek time
  useEffect(() => {
    if (initialSeekTimeSec !== undefined && initialSeekTimeSec > 0 && audioRef.current) {
      audioRef.current.currentTime = initialSeekTimeSec;
      setCurrentTime(initialSeekTimeSec);
    }
  }, [initialSeekTimeSec]);

  // External seek updates
  useEffect(() => {
    if (
      seekTimeSec !== null &&
      seekTimeSec !== undefined &&
      audioRef.current &&
      Math.abs(audioRef.current.currentTime - seekTimeSec) > 0.5
    ) {
      audioRef.current.currentTime = seekTimeSec;
      setCurrentTime(seekTimeSec);
    }
  }, [seekTimeSec]);

  // Handle Play/Pause
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          onPlayStateChange?.(true);
        })
        .catch((err) => {
          console.warn("[SessionPlayer] Playback error:", err);
        });
    } else {
      audio.pause();
      setIsPlaying(false);
      onPlayStateChange?.(false);
    }
  }, [onPlayStateChange]);

  // Handle Skip
  const skip = useCallback((deltaSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + deltaSec));
    audio.currentTime = target;
    setCurrentTime(target);
  }, []);

  // Handle Speed change
  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.25, 1.5, 1.75, 2, 0.75];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextRate = speeds[nextIdx];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  }, [playbackRate]);

  // Handle Scrubber Seek
  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    setCurrentTime(targetTime);
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
    }
  }, []);

  // State 1: Transcript-only (no audio attached)
  if (isTranscriptOnly) {
    return (
      <div
        data-testid="session-player-transcript-only"
        className={cn(
          "flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border/50 text-muted-foreground text-sm",
          className
        )}
      >
        <FileText className="w-5 h-5 text-muted-foreground/80 shrink-0" />
        <span className="font-medium">Transcript-only session</span>
        <span className="text-xs text-muted-foreground/60">· No audio recording attached</span>
      </div>
    );
  }

  // State 2: Missing media (media asset was expected but file is missing or failed)
  if (isMissingMedia || loadError) {
    return (
      <div
        data-testid="session-player-missing-media"
        className={cn(
          "flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm",
          className
        )}
      >
        <WarningCircle className="w-5 h-5 shrink-0" />
        <div>
          <p className="font-medium">Audio unavailable</p>
          <p className="text-xs opacity-80">
            {loadError || "The media file could not be found or verified on disk."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="session-player"
      className={cn(
        "flex flex-col gap-2 p-3 bg-card border border-border rounded-lg shadow-sm select-none",
        className
      )}
    >
      {/* Audio Element */}
      {streamUrl && (
        <audio
          ref={audioRef}
          src={streamUrl}
          preload="metadata"
          onTimeUpdate={() => {
            if (audioRef.current) {
              const t = audioRef.current.currentTime;
              setCurrentTime(t);
              onTimeUpdate?.(t);
            }
          }}
          onDurationChange={() => {
            if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
              setDuration(audioRef.current.duration);
            }
          }}
          onLoadedMetadata={() => {
            if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
              setDuration(audioRef.current.duration);
            }
          }}
          onEnded={() => {
            setIsPlaying(false);
            onPlayStateChange?.(false);
          }}
          onPlay={() => {
            setIsPlaying(true);
            onPlayStateChange?.(true);
          }}
          onPause={() => {
            setIsPlaying(false);
            onPlayStateChange?.(false);
          }}
          onError={() => {
            setLoadError("Audio element playback error");
          }}
        />
      )}

      {/* Scrubber row */}
      <div className="flex items-center gap-2 w-full text-xs text-muted-foreground font-mono">
        <span>{formatTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={currentTime}
          onChange={handleSeekChange}
          aria-label="Seek audio"
          className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <span>{formatTime(duration)}</span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1">
          {/* Skip -10s */}
          <button
            type="button"
            onClick={() => skip(-10)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Rewind 10 seconds"
            aria-label="Rewind 10 seconds"
          >
            <ArrowCounterClockwise className="w-4 h-4" />
          </button>

          {/* Play / Pause */}
          <button
            type="button"
            onClick={togglePlay}
            disabled={isLoading || !streamUrl}
            className="p-2 rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            title={isPlaying ? "Pause" : "Play"}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isLoading ? (
              <CircleNotch className="w-4 h-4 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4" weight="fill" />
            ) : (
              <Play className="w-4 h-4" weight="fill" />
            )}
          </button>

          {/* Skip +30s */}
          <button
            type="button"
            onClick={() => skip(30)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Fast forward 30 seconds"
            aria-label="Fast forward 30 seconds"
          >
            <ArrowClockwise className="w-4 h-4" />
          </button>

          {/* Speed button */}
          <button
            type="button"
            onClick={cycleSpeed}
            className="px-2 py-1 text-xs font-semibold rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-1"
            title="Playback speed"
            aria-label={`Playback speed: ${playbackRate}x`}
          >
            {playbackRate}x
          </button>

          {/* Partial recording indicator */}
          {isPartial && (
            <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 ml-2">
              Partial
            </span>
          )}
        </div>

        {/* Volume toggle */}
        <button
          type="button"
          onClick={() => {
            const next = !isMuted;
            setIsMuted(next);
            if (audioRef.current) {
              audioRef.current.muted = next;
            }
          }}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={isMuted ? "Unmute" : "Mute"}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <SpeakerSlash className="w-4 h-4" /> : <SpeakerHigh className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
