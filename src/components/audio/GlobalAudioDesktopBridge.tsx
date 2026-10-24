import { useSyncExternalStore } from "react";
import { useRemoteMediaBridge } from "../../hooks/useRemoteMediaBridge";
import { isNativeAndroid } from "../../lib/tauri";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import { getGlobalAudioController } from "../../services/audio/audioRuntime";
import { longFormPlaybackSessions } from "../../utils/longFormPlaybackSession";
import { runAudioAction } from "./audioPlayerActions";

function getActiveCompatibilitySessionId(): string | null {
  return longFormPlaybackSessions.getActive()?.sessionId ?? null;
}

/** One bridge anchored beside the owner. Source presentation never registers ordinary media. */
export function GlobalAudioDesktopBridge() {
  const snapshot = useAudioPlaybackStore(state => state.snapshot);
  const activeCompatibilitySessionId = useSyncExternalStore(
    longFormPlaybackSessions.subscribe,
    getActiveCompatibilitySessionId,
    getActiveCompatibilitySessionId,
  );
  const isOwnerActiveSession = Boolean(
    snapshot && activeCompatibilitySessionId === snapshot.metadata.sessionId,
  );
  const album =
    snapshot?.metadata.album ??
    (snapshot?.sourceKey.kind === "podcast"
      ? "Podcast"
      : snapshot?.sourceKey.kind === "recording"
        ? "Recording"
        : "Audiobook");

  useRemoteMediaBridge({
    ownerManaged: true,
    enabled: Boolean(snapshot) && isOwnerActiveSession && !isNativeAndroid(),
    title: snapshot?.metadata.title ?? "",
    artist: snapshot?.metadata.artist,
    album,
    artworkUrl: snapshot?.metadata.artworkUrl,
    isPlaying: snapshot?.state === "playing",
    playbackState: snapshot?.state,
    duration: snapshot?.durationSec ?? undefined,
    currentTime: snapshot ? Math.floor(snapshot.positionSec) : 0,
    playbackRate: snapshot?.playbackRate,
    section: snapshot?.section,
    capabilities: snapshot?.capabilities,
    sourceId: snapshot?.sourceKey.sourceId,
    sessionId: snapshot?.metadata.sessionId,
    sourceKind: snapshot?.sourceKey.kind,
    session: snapshot ?? undefined,
    onAdapterError: error => useAudioPlaybackStore.setState({ adapterError: error }),
    getContext: () => {
      const owner = getGlobalAudioController();
      const current = owner.getSnapshot();
      const item = owner.getItem();
      return {
        documentId: item?.documentId ?? "",
        documentTitle: current?.metadata.title ?? "",
        editionId: item?.editionId ?? (current?.sourceKey.kind === "audio_edition" ? current.sourceKey.sourceId : undefined),
        sessionId: current?.metadata.sessionId,
        sourceId: current?.sourceKey.sourceId,
        playbackSessionId: current?.metadata.sessionId,
        audioElement: null,
        currentTimestampSec: current?.positionSec ?? 0,
        anchors: [],
        onPlay: () => { void runAudioAction(o => o.play()); },
        onPause: () => { void runAudioAction(o => o.pause("user")); },
        onPlayPause: () => { void runAudioAction(o => o.toggle()); },
        onSeekRelative: delta => { void runAudioAction(o => o.seekRelative(delta)); },
        onSeekAbsolute: seconds => { void runAudioAction(o => o.seekTo(seconds)); },
        onDuckAudio: (ratio, durationMs) => { owner.duckForFeedback?.(ratio, durationMs); },
        onNextChapter: () => { void runAudioAction(o => o.selectChapter((o.getSnapshot()?.partIndex ?? 0) + 1)); },
        onPrevChapter: () => { void runAudioAction(o => o.selectChapter(Math.max(0, (o.getSnapshot()?.partIndex ?? 0) - 1))); },
      };
    },
  });
  return null;
}
