import { lazy, Suspense, useEffect, useRef } from "react";
import type { AudioSourceKey } from "../../types/audioEdition";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import { useI18n } from "../../lib/i18n";
import { runAudioAction, audioTime } from "./audioPlayerActions";
import { AudioTransport } from "./MiniAudioPlayer";

/** Structural source-identity comparison shared by source views and the EPUB sync view. */
export function sameAudioSourceKey(left: AudioSourceKey | undefined | null, right: AudioSourceKey | undefined | null): boolean {
  return Boolean(left && right && left.profileKey === right.profileKey && left.kind === right.kind && left.sourceId === right.sourceId);
}

/** Source pages issue explicit intent and subscribe. Mount/unmount never owns media or saves time. */
export function AudioSourceControls({ sourceKey, title, initialSeekTime, autoPlay = false, seekTime, onTimeUpdate, onDurationChange, onPlayStateChange, onEnded, unavailable, className }: {
  sourceKey: AudioSourceKey; title: string; initialSeekTime?: number; autoPlay?: boolean; seekTime?: number | null;
  onTimeUpdate?: (seconds: number) => void; onDurationChange?: (seconds: number) => void; onPlayStateChange?: (playing: boolean) => void; onEnded?: () => void;
  unavailable?: string; className?: string;
}) {
  const { t } = useI18n();
  const signature = JSON.stringify(sourceKey);
  const active = useAudioPlaybackStore(state => sameAudioSourceKey(state.snapshot?.sourceKey, sourceKey));
  const position = useAudioPlaybackStore(state => sameAudioSourceKey(state.snapshot?.sourceKey, sourceKey) ? state.snapshot!.positionSec : 0);
  const state = useAudioPlaybackStore(state => sameAudioSourceKey(state.snapshot?.sourceKey, sourceKey) ? state.snapshot!.state : null);
  const error = useAudioPlaybackStore(state => state.controlError);
  const callbacks = useRef({ onTimeUpdate, onDurationChange, onPlayStateChange, onEnded });
  callbacks.current = { onTimeUpdate, onDurationChange, onPlayStateChange, onEnded };
  const request = useRef("");
  useEffect(() => {
    const hasExplicitInitialSeek = typeof initialSeekTime === "number" && Number.isFinite(initialSeekTime) && initialSeekTime > 0;
    const token = JSON.stringify([signature, hasExplicitInitialSeek ? initialSeekTime : null, autoPlay]);
    if (request.current === token || unavailable) return;
    const previous = request.current;
    request.current = token;
    // Restored/reattached tabs must not apply their old initial seek over a live session.
    if (sameAudioSourceKey(useAudioPlaybackStore.getState().snapshot?.sourceKey, sourceKey)) {
      if (previous && hasExplicitInitialSeek) void runAudioAction(async owner => { await owner.seekTo(initialSeekTime); if (autoPlay) await owner.play(); });
      return;
    }
    if (!autoPlay && !hasExplicitInitialSeek) return;
    void runAudioAction(owner => owner.load(sourceKey, { intent: autoPlay ? "play" : "paused", explicitPosition: hasExplicitInitialSeek ? initialSeekTime : undefined }));
  }, [signature, initialSeekTime, autoPlay, unavailable]);
  useEffect(() => {
    if (seekTime === undefined || seekTime === null || unavailable) return;
    void runAudioAction(async owner => {
      if (sameAudioSourceKey(owner.getSnapshot()?.sourceKey, sourceKey)) await owner.seekTo(seekTime);
      else await owner.load(sourceKey, { intent: "paused", explicitPosition: seekTime });
    });
  }, [signature, seekTime, unavailable]);
  useEffect(() => {
    let duration: number | null | undefined;
    let playing: boolean | undefined;
    let position: number | undefined;
    let ended: string | undefined;
    const report = () => {
      const snapshot = useAudioPlaybackStore.getState().snapshot;
      if (!snapshot || !sameAudioSourceKey(snapshot.sourceKey, sourceKey)) return;
      if (snapshot.positionSec !== position) { position = snapshot.positionSec; callbacks.current.onTimeUpdate?.(position); }
      if (snapshot.durationSec !== duration) { duration = snapshot.durationSec; if (duration !== null) callbacks.current.onDurationChange?.(duration); }
      if (snapshot.playIntent !== playing) { playing = snapshot.playIntent; callbacks.current.onPlayStateChange?.(playing); }
      if (snapshot.state === "ended" && ended !== snapshot.metadata.sessionId) {
        ended = snapshot.metadata.sessionId;
        if (!snapshot.queue?.length) callbacks.current.onEnded?.();
      }
    };
    report(); return useAudioPlaybackStore.subscribe(report);
  }, [signature]);
  return <section className={className} aria-label={t("audio.player")}>
    <div className="flex flex-col gap-4 rounded-xl border border-outline-variant bg-surface-container p-4">
      <h2 className="truncate font-medium" title={title}>{title}</h2>
      {unavailable ? <p className="text-sm text-on-surface-variant">{unavailable}</p> : active ? <>
        <div className="flex items-center justify-between gap-3"><AudioTransport mobile /><span className="tabular-nums text-sm">{audioTime(position)}</span></div>
        <button type="button" className="md-focus-ring min-h-12 rounded-full border border-outline px-4" onClick={() => useAudioPlaybackStore.setState({ expanded: true })}>{t("audio.expand")}</button>
        <p className="sr-only" role="status">{state === "playing" ? t("audio.playing") : t("audio.paused")}</p>
      </> : <button type="button" className="md-focus-ring min-h-12 rounded-full bg-primary px-5 text-on-primary" onClick={() => void runAudioAction(owner => owner.load(sourceKey, { intent: "play" }))}>{t("audio.play")}</button>}
      {error && <p role="status" className="text-sm text-error">{error}</p>}
    </div>
  </section>;
}

const LazyAudiobookViewer = lazy(() =>
  import("../viewer/AudiobookViewer").then((mod) => ({ default: mod.AudiobookViewer })),
);

export function ControllerAudiobookView(props: import("../viewer/AudiobookViewer").AudiobookViewerProps) {
  return (
    <Suspense fallback={null}>
      <LazyAudiobookViewer {...props} controllerBacked />
    </Suspense>
  );
}

export { useAudioProfileKey } from "./useAudioProfileKey";
