import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { AudioSourceKey } from "../../types/audioEdition";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import { cn } from "../../utils/cn";
import { runAudioAction } from "./audioPlayerActions";
import { useAudioProfileKey } from "./useAudioProfileKey";
import { formatTime, type SessionPlayerProps } from "../recording/SessionPlayer";

const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75] as const;

function sameSource(left: AudioSourceKey | undefined, right: AudioSourceKey): boolean {
  return (
    left?.profileKey === right.profileKey &&
    left.kind === right.kind &&
    left.sourceId === right.sourceId
  );
}

export function ControllerSessionPlayer({
  session,
  mediaAsset,
  initialSeekTimeSec,
  seekTimeSec,
  seekRequestId,
  onTimeUpdate,
  onPlayStateChange,
  className,
}: SessionPlayerProps) {
  const profileKey = useAudioProfileKey();
  const sourceKey = useMemo<AudioSourceKey>(
    () => ({ profileKey, kind: "recording", sourceId: session.id }),
    [profileKey, session.id],
  );
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const sourceSignature = `${sourceKey.profileKey}:${sourceKey.kind}:${sourceKey.sourceId}`;

  const isTranscriptOnly = !session.mediaAssetId && !mediaAsset;
  const isPartial =
    session.captureState === "recording" ||
    session.captureState === "recoverable" ||
    mediaAsset?.state === "partial";

  const active = useAudioPlaybackStore(state => sameSource(state.snapshot?.sourceKey, sourceKey));
  const activeState = useAudioPlaybackStore(state =>
    sameSource(state.snapshot?.sourceKey, sourceKey) ? state.snapshot!.state : null,
  );
  const activePosition = useAudioPlaybackStore(state =>
    sameSource(state.snapshot?.sourceKey, sourceKey) ? state.snapshot!.positionSec : 0,
  );
  const activeDuration = useAudioPlaybackStore(state =>
    sameSource(state.snapshot?.sourceKey, sourceKey) ? state.snapshot!.durationSec : null,
  );
  const activeRate = useAudioPlaybackStore(state =>
    sameSource(state.snapshot?.sourceKey, sourceKey) ? state.snapshot!.playbackRate : null,
  );
  const activeVolume = useAudioPlaybackStore(state =>
    sameSource(state.snapshot?.sourceKey, sourceKey) ? state.snapshot!.volume : null,
  );
  const activeErrorCode = useAudioPlaybackStore(state =>
    sameSource(state.snapshot?.sourceKey, sourceKey) ? state.snapshot?.error?.code ?? null : null,
  );
  const activeErrorMessage = useAudioPlaybackStore(state =>
    sameSource(state.snapshot?.sourceKey, sourceKey) ? state.snapshot?.error?.message ?? null : null,
  );
  const otherActiveTitle = useAudioPlaybackStore(state =>
    state.snapshot && !sameSource(state.snapshot.sourceKey, sourceKey)
      ? state.snapshot.metadata.title
      : null,
  );

  const [localTime, setLocalTime] = useState<number>(() =>
    initialSeekTimeSec !== undefined && initialSeekTimeSec > 0 ? initialSeekTimeSec : 0,
  );
  const [localRate, setLocalRate] = useState<number>(1);
  const [localMuted, setLocalMuted] = useState<boolean>(false);
  const [localLoadError, setLocalLoadError] = useState<string | null>(null);
  const unmutedVolumeRef = useRef<number>(1);

  useEffect(() => {
    setLocalLoadError(null);
    setLocalTime(initialSeekTimeSec !== undefined && initialSeekTimeSec > 0 ? initialSeekTimeSec : 0);
  }, [sourceSignature]);

  useEffect(() => {
    if (activeRate !== null) {
      setLocalRate(activeRate);
    }
  }, [activeRate]);

  useEffect(() => {
    if (activeVolume !== null) {
      if (activeVolume > 0) unmutedVolumeRef.current = activeVolume;
      setLocalMuted(activeVolume === 0);
    }
  }, [activeVolume]);

  const isMissingMedia =
    mediaAsset?.state === "missing" ||
    (active && activeErrorCode === "source_missing") ||
    localLoadError !== null;

  const unavailableForPlayback = isTranscriptOnly || isMissingMedia || isPartial;

  const callbacksRef = useRef({ onTimeUpdate, onPlayStateChange });
  callbacksRef.current = { onTimeUpdate, onPlayStateChange };

  // Subscribe to owner state and immediately project position/playing state on mount & reattachment.
  useEffect(() => {
    let lastReportedTime: number | undefined;
    let lastReportedPlaying: boolean | undefined;

    const syncFromStore = () => {
      const snap = useAudioPlaybackStore.getState().snapshot;
      if (snap && sameSource(snap.sourceKey, sourceKeyRef.current)) {
        if (snap.positionSec !== lastReportedTime) {
          lastReportedTime = snap.positionSec;
          callbacksRef.current.onTimeUpdate?.(snap.positionSec);
        }
        const playingNow = snap.state === "playing";
        if (playingNow !== lastReportedPlaying) {
          lastReportedPlaying = playingNow;
          callbacksRef.current.onPlayStateChange?.(playingNow);
        }
      } else if (lastReportedPlaying === true) {
        lastReportedPlaying = false;
        callbacksRef.current.onPlayStateChange?.(false);
      }
    };

    syncFromStore();
    return useAudioPlaybackStore.subscribe(syncFromStore);
  }, [sourceSignature]);

  // Explicit initialSeekTimeSec (> 0) loads paused only when not already attached to a live session for this source.
  const initialRequestRef = useRef("");
  useEffect(() => {
    const hasExplicitInitialSeek =
      typeof initialSeekTimeSec === "number" &&
      Number.isFinite(initialSeekTimeSec) &&
      initialSeekTimeSec > 0;
    const token = `${sourceSignature}:${hasExplicitInitialSeek ? initialSeekTimeSec : "none"}`;
    if (initialRequestRef.current === token || unavailableForPlayback) return;
    const previous = initialRequestRef.current;
    initialRequestRef.current = token;
    if (!hasExplicitInitialSeek) return;

    const currentSnap = useAudioPlaybackStore.getState().snapshot;
    if (sameSource(currentSnap?.sourceKey, sourceKeyRef.current)) {
      if (previous.startsWith(`${sourceSignature}:`)) {
        void runAudioAction(owner => owner.seekTo(initialSeekTimeSec));
      }
      return;
    }

    setLocalTime(initialSeekTimeSec);
    if (currentSnap === null) {
      void runAudioAction(owner =>
        owner.load(sourceKeyRef.current, {
          intent: "paused",
          explicitPosition: initialSeekTimeSec,
        }),
      );
    }
  }, [sourceSignature, initialSeekTimeSec, unavailableForPlayback]);

  // Transcript / marker explicit seeks.
  const lastSeekTokenRef = useRef("");
  useEffect(() => {
    if (
      seekTimeSec === null ||
      seekTimeSec === undefined ||
      !Number.isFinite(seekTimeSec) ||
      unavailableForPlayback
    ) {
      return;
    }
    const token = `${sourceSignature}:${seekTimeSec}:${seekRequestId ?? 0}`;
    if (lastSeekTokenRef.current === token) return;
    lastSeekTokenRef.current = token;

    const target = Math.max(0, seekTimeSec);
    setLocalTime(target);
    void runAudioAction(async owner => {
      if (sameSource(owner.getSnapshot()?.sourceKey, sourceKeyRef.current)) {
        await owner.seekTo(target);
      } else {
        await owner.load(sourceKeyRef.current, {
          intent: "paused",
          explicitPosition: target,
        });
      }
    });
  }, [sourceSignature, seekTimeSec, seekRequestId, unavailableForPlayback]);

  const fallbackDurationSec =
    mediaAsset?.durationMs && Number.isFinite(mediaAsset.durationMs) && mediaAsset.durationMs > 0
      ? mediaAsset.durationMs / 1000
      : 0;
  const displayDuration = active ? (activeDuration ?? fallbackDurationSec) : fallbackDurationSec;
  const displayTime = active ? activePosition : localTime;
  const displayRate = active && activeRate !== null ? activeRate : localRate;
  const isMuted = active && activeVolume !== null ? activeVolume === 0 : localMuted;
  const isLoading = active && activeState === "loading";
  const isPlaying = active && activeState === "playing";

  const togglePlay = useCallback(() => {
    if (unavailableForPlayback || isLoading) return;
    void (async () => {
      try {
        const { getGlobalAudioController } = await import("../../services/audio/audioRuntime");
        const owner = getGlobalAudioController();
        if (sameSource(owner.getSnapshot()?.sourceKey, sourceKeyRef.current)) {
          await owner.toggle();
        } else {
          await owner.load(sourceKeyRef.current, {
            intent: "play",
            explicitPosition: localTime > 0 ? localTime : undefined,
          });
          if (localRate !== 1) await owner.setRate(localRate);
          if (localMuted) await owner.setVolume(0);
        }
        useAudioPlaybackStore.setState({ controlError: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string })?.code;
        if (code === "source_missing") {
          setLocalLoadError(message);
        } else {
          useAudioPlaybackStore.setState({ controlError: message });
        }
      }
    })();
  }, [unavailableForPlayback, isLoading, localTime, localRate, localMuted]);

  const skip = useCallback(
    (deltaSec: number) => {
      if (unavailableForPlayback) return;
      if (active) {
        void runAudioAction(owner => owner.seekRelative(deltaSec));
      } else {
        const maxSec = displayDuration > 0 ? displayDuration : Infinity;
        setLocalTime(prev => Math.max(0, Math.min(maxSec, prev + deltaSec)));
      }
    },
    [unavailableForPlayback, active, displayDuration],
  );

  const cycleSpeed = useCallback(() => {
    const currentIdx = PLAYBACK_SPEEDS.indexOf(displayRate as (typeof PLAYBACK_SPEEDS)[number]);
    const nextRate = PLAYBACK_SPEEDS[(currentIdx + 1) % PLAYBACK_SPEEDS.length];
    setLocalRate(nextRate);
    if (active) {
      void runAudioAction(owner => owner.setRate(nextRate));
    }
  }, [displayRate, active]);

  const handleSeekChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (unavailableForPlayback) return;
      const targetTime = Math.max(0, parseFloat(e.target.value) || 0);
      setLocalTime(targetTime);
      if (active) {
        void runAudioAction(owner => owner.seekTo(targetTime));
      }
    },
    [unavailableForPlayback, active],
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setLocalMuted(nextMuted);
    if (active) {
      const targetVolume = nextMuted ? 0 : unmutedVolumeRef.current || 1;
      void runAudioAction(owner => owner.setVolume(targetVolume));
    }
  }, [isMuted, active]);

  if (isTranscriptOnly) {
    return (
      <div
        data-testid="session-player-transcript-only"
        className={cn(
          "flex items-center gap-2 p-3 bg-muted/40 rounded-lg border border-border/50 text-muted-foreground text-sm",
          className,
        )}
      >
        <FileText className="w-5 h-5 text-muted-foreground/80 shrink-0" />
        <span className="font-medium">Transcript-only session</span>
        <span className="text-xs text-muted-foreground/60">· No audio recording attached</span>
      </div>
    );
  }

  if (isMissingMedia) {
    const detail =
      localLoadError ??
      activeErrorMessage ??
      "The media file could not be found or verified on disk.";
    return (
      <div
        data-testid="session-player-missing-media"
        className={cn(
          "flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm",
          className,
        )}
      >
        <WarningCircle className="w-5 h-5 shrink-0" />
        <div>
          <p className="font-medium">Audio unavailable</p>
          <p className="text-xs opacity-80">{detail}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="session-player"
      className={cn(
        "flex flex-col gap-2 p-3 bg-card border border-border rounded-lg shadow-sm select-none",
        className,
      )}
    >
      {otherActiveTitle && (
        <div
          data-testid="session-player-playing-elsewhere"
          className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
        >
          <span className="truncate">Playing elsewhere: {otherActiveTitle}</span>
        </div>
      )}

      {/* Scrubber row */}
      <div className="flex items-center gap-2 w-full text-xs text-muted-foreground font-mono">
        <span>{formatTime(displayTime)}</span>
        <input
          type="range"
          min={0}
          max={displayDuration || 1}
          step={0.1}
          value={displayTime}
          disabled={isPartial}
          onChange={handleSeekChange}
          aria-label="Seek audio"
          className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span>{formatTime(displayDuration)}</span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isPartial}
            onClick={() => skip(-10)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Rewind 10 seconds"
            aria-label="Rewind 10 seconds"
          >
            <ArrowCounterClockwise className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            disabled={isLoading || isPartial}
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

          <button
            type="button"
            disabled={isPartial}
            onClick={() => skip(30)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Fast forward 30 seconds"
            aria-label="Fast forward 30 seconds"
          >
            <ArrowClockwise className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={cycleSpeed}
            className="px-2 py-1 text-xs font-semibold rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-1"
            title="Playback speed"
            aria-label={`Playback speed: ${displayRate}x`}
          >
            {displayRate}x
          </button>

          {isPartial && (
            <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 ml-2">
              Partial
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={toggleMute}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={isMuted ? "Unmute" : "Mute"}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <SpeakerSlash className="w-4 h-4" /> : <SpeakerHigh className="w-4 h-4" />}
        </button>
      </div>

      {active && activeErrorMessage && activeErrorCode !== "source_missing" && (
        <p role="status" className="text-xs text-destructive">
          {activeErrorMessage}
        </p>
      )}
    </div>
  );
}
