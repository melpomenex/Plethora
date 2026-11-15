import { create } from "zustand";
import type { AudioPlaybackSnapshot } from "../types/audioEdition";
import type { AudioPlaybackOwner } from "../services/audio/audioPlaybackOwner";

export type AudioContentRole = "extract" | "qa_prompt" | "summary";

export const ALLOWED_PLAYBACK_RATES = [1, 1.25, 1.5, 2, 2.5] as const;

export interface VoiceRoleConfig {
  extractVoiceId: string;
  promptVoiceId: string;
  chimeEnabled: boolean;
}

export interface AudioBookmarkSnippet {
  startTime: number;
  endTime: number;
  text: string;
}

export function playRoleTransitionChime(): void {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
    setTimeout(() => {
      void ctx.close?.();
    }, 250);
  } catch {
    // Ignore audio context errors in restricted environments
  }
}

interface AudioPlaybackProjection {
  snapshot: AudioPlaybackSnapshot | null;
  storageError: string | null;
  checkpointError: string | null;
  sessionError: string | null;
  controlError: string | null;
  adapterError: string | null;
  expanded: boolean;
  playbackRate: number;
  pipCollapsed: boolean;
  contentRole: AudioContentRole;
  voiceRoleConfig: VoiceRoleConfig;
  recentTranscriptText: string;
  bookmarks: AudioBookmarkSnippet[];
  setPlaybackRate: (rate: number) => void;
  setPipCollapsed: (collapsed: boolean) => void;
  togglePipCollapsed: () => void;
  setContentRole: (role: AudioContentRole) => void;
  setVoiceRoleConfig: (partial: Partial<VoiceRoleConfig>) => void;
  setRecentTranscriptText: (text: string) => void;
  bookmarkLast30s: () => AudioBookmarkSnippet | null;
}

function isExtractRole(role: AudioContentRole): boolean {
  return role === "extract";
}

/** Subscribe to narrow primitives. Shell/reader roots must never select the whole snapshot. */
export const useAudioPlaybackStore = create<AudioPlaybackProjection>((set, get) => ({
  snapshot: null,
  storageError: null,
  checkpointError: null,
  sessionError: null,
  controlError: null,
  adapterError: null,
  expanded: false,
  playbackRate: 1.0,
  pipCollapsed: false,
  contentRole: "extract",
  voiceRoleConfig: {
    extractVoiceId: "af_bella",
    promptVoiceId: "am_adam",
    chimeEnabled: true,
  },
  recentTranscriptText: "",
  bookmarks: [],
  setPlaybackRate: (rate) => {
    const normalized = ALLOWED_PLAYBACK_RATES.includes(
      rate as (typeof ALLOWED_PLAYBACK_RATES)[number],
    )
      ? rate
      : 1.0;
    set({ playbackRate: normalized });
  },
  setPipCollapsed: (collapsed) => set({ pipCollapsed: collapsed }),
  togglePipCollapsed: () => set((state) => ({ pipCollapsed: !state.pipCollapsed })),
  setContentRole: (role) => {
    const prev = get().contentRole;
    const chimeEnabled = get().voiceRoleConfig.chimeEnabled;
    if (prev !== role && isExtractRole(prev) !== isExtractRole(role) && chimeEnabled) {
      playRoleTransitionChime();
    }
    set({ contentRole: role });
  },
  setVoiceRoleConfig: (partial) =>
    set((state) => ({
      voiceRoleConfig: { ...state.voiceRoleConfig, ...partial },
    })),
  setRecentTranscriptText: (text) => set({ recentTranscriptText: text }),
  bookmarkLast30s: () => {
    const state = get();
    if (!state.snapshot && !state.recentTranscriptText) {
      return null;
    }
    const endTime = Math.max(0, Math.round(state.snapshot?.positionSec ?? 30));
    const startTime = Math.max(0, endTime - 30);
    const text =
      state.recentTranscriptText.trim() ||
      state.snapshot?.section?.title ||
      state.snapshot?.metadata.title ||
      "Audio bookmark";
    const snippet: AudioBookmarkSnippet = { startTime, endTime, text };
    set((curr) => ({ bookmarks: [...curr.bookmarks, snippet] }));
    return snippet;
  },
}));

export function getActiveRoleVoiceId(): string {
  const { contentRole, voiceRoleConfig } = useAudioPlaybackStore.getState();
  return contentRole === "extract"
    ? voiceRoleConfig.extractVoiceId
    : voiceRoleConfig.promptVoiceId;
}

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
