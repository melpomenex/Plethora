import type { AudioCommandRequest, AudioCommandResult, AudioPauseReason, AudioPlaybackSnapshot, AudioPolicyInterval, AudioSourceKey, ResolvedAudioItem } from "../../types/audioEdition";

export type DesktopAudioLifecycleEventKind =
  | "suspend"
  | "wake"
  | "outputInterrupted"
  | "appExiting";

export interface DesktopAudioLifecycleEvent {
  eventId?: string;
  kind: DesktopAudioLifecycleEventKind;
  source?: string;
  occurredAt?: number;
  detail?: string;
}

/** Presentation contract shared by HTML and service-owned playback. */
export interface AudioPlaybackOwner {
  initialize(): void;
  getSnapshot(): AudioPlaybackSnapshot | null;
  getIntentVersion(): number;
  getItem(): ResolvedAudioItem | null;
  subscribe(listener: () => void): () => void;
  load(key: AudioSourceKey, options: { intent: "play" | "paused"; explicitPosition?: number; queue?: readonly AudioSourceKey[] }): Promise<void>;
  play(): Promise<void>;
  pause(reason?: AudioPauseReason): Promise<void>;
  pauseForFocus(): Promise<void>;
  handleLifecycleEvent?(event: DesktopAudioLifecycleEvent): Promise<void>;
  toggle(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  seekRelative(delta: number): Promise<void>;
  selectChapter(index: number): Promise<void>;
  queueNext(): Promise<void>;
  queuePrevious(): Promise<void>;
  setRate(rate: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  /** Optional owner-lifetime audio processing; absence/rejection is a truthful unsupported result. */
  setVolumeBoost?(enabled: boolean): Promise<boolean>;
  setSilenceSkip?(enabled: boolean): Promise<boolean>;
  setPolicyIntervals?(intervals: readonly AudioPolicyInterval[]): void;
  duckForFeedback?(duckRatio: number, durationMs: number): () => void;
  setSleepTimer(deadlineMs: number | null): void | Promise<void>;
  refreshManifest?(): Promise<void>;
  updateQueue?(queue: readonly AudioSourceKey[]): Promise<void>;
  retireDeletedSource?(
    predicate: (key: AudioSourceKey, item: ResolvedAudioItem | null) => boolean,
  ): Promise<"active_retired" | "queue_pruned" | "unchanged">;
  flush(transition?: boolean): Promise<void>;
  stopAndClose(): Promise<void>;
  command(request: AudioCommandRequest): Promise<AudioCommandResult>;
  dispose(): Promise<void>;
}
