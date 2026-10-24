import { create } from "zustand";
import type { AudioPlaybackSnapshot } from "../types/audioEdition";
import type { AudioPlaybackOwner } from "../services/audio/audioPlaybackOwner";

interface AudioPlaybackProjection {
  snapshot: AudioPlaybackSnapshot | null;
  storageError: string | null;
  checkpointError: string | null;
  sessionError: string | null;
  controlError: string | null;
  adapterError: string | null;
  expanded: boolean;
}

/** Subscribe to narrow primitives. Shell/reader roots must never select the whole snapshot. */
export const useAudioPlaybackStore = create<AudioPlaybackProjection>(() => ({
  snapshot: null,
  storageError: null,
  checkpointError: null,
  sessionError: null,
  controlError: null,
  adapterError: null,
  expanded: false,
}));

export const selectHasActiveAudio = (state: AudioPlaybackProjection): boolean => state.snapshot !== null;
export const selectAudioIsPlaying = (state: AudioPlaybackProjection): boolean => state.snapshot?.playIntent ?? false;
export const selectAudioSessionId = (state: AudioPlaybackProjection): string | null => state.snapshot?.metadata.sessionId ?? null;
export const selectAudioTitle = (state: AudioPlaybackProjection): string | null => state.snapshot?.metadata.title ?? null;
export const selectAudioPositionSec = (state: AudioPlaybackProjection): number => state.snapshot?.positionSec ?? 0;
export const selectAudioDurationSec = (state: AudioPlaybackProjection): number | null => state.snapshot?.durationSec ?? null;
export const selectAudioExpanded = (state: AudioPlaybackProjection): boolean => state.expanded && state.snapshot !== null;

export function bindAudioPlaybackProjection(controller: Pick<AudioPlaybackOwner, "getSnapshot" | "subscribe">): () => void {
  const update = () => {
    const next = controller.getSnapshot();
    useAudioPlaybackStore.setState(state => ({
      snapshot: next,
      expanded: next === null ? false : state.expanded,
    }));
  };
  update();
  return controller.subscribe(update);
}
