/**
 * Audio Feedback Chime & Playback Ducking Utilities
 *
 * Earcons for hands-free study mode captures (success per action type, a
 * distinct failure tone, and study-mode enable/disable tones), plus transient
 * volume ducking that always restores the exact prior volume. Chime volume and
 * the chime-enabled flag are consumed from Hands-Free Study settings
 * (design Decision 11).
 */

import { useSettingsStore } from "../stores/settingsStore";

export type FeedbackChimeType =
  | "extract_captured"
  | "extract_extended"
  | "bookmark_added"
  | "interesting_marked"
  | "confusing_flagged"
  | "ask_enqueued"
  | "action_failed"
  | "mode_study"
  | "mode_normal";

export interface ChimeOptions {
  /** 0..1 override for the persisted `chimeVolume`. */
  volume?: number;
  /** Override for the persisted `chimeEnabled` flag (earcons stay skippable in tests). */
  enabled?: boolean;
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }

  if (sharedAudioCtx.state === "suspended") {
    void sharedAudioCtx.resume().catch(() => {
      /* autoplay policy — chime silently skipped */
    });
  }

  return sharedAudioCtx;
}

/** Acoustic profiles: failure must never sound like success (distinct contours). */
const CHIME_PROFILES: Record<
  FeedbackChimeType,
  { type: OscillatorType; notes: number[]; noteStep: number; gain: number; decay: number }
> = {
  // Pleasant rising two-tone — capture succeeded
  extract_captured: { type: "sine", notes: [440, 880], noteStep: 0.1, gain: 0.2, decay: 0.1 },
  // Rising two-tone plus a higher tail — the capture grew backward
  extract_extended: { type: "sine", notes: [523.25, 783.99, 1046.5], noteStep: 0.07, gain: 0.2, decay: 0.09 },
  // Soft gentle triple chime
  bookmark_added: { type: "triangle", notes: [523.25, 659.25, 783.99], noteStep: 0.06, gain: 0.15, decay: 0.09 },
  // Bright ascending sparkle
  interesting_marked: { type: "triangle", notes: [659.25, 987.77], noteStep: 0.08, gain: 0.16, decay: 0.09 },
  // Distinct low questioning tone
  confusing_flagged: { type: "sine", notes: [349.23, 329.63], noteStep: 0.18, gain: 0.18, decay: 0.07 },
  // Curious rising question — something to ask later
  ask_enqueued: { type: "sine", notes: [587.33, 740, 880], noteStep: 0.09, gain: 0.17, decay: 0.08 },
  // Harsh falling buzz — the action FAILED (never confusable with success)
  action_failed: { type: "square", notes: [233.08, 155.56], noteStep: 0.12, gain: 0.1, decay: 0.08 },
  // Affirmative double beep — study mode on
  mode_study: { type: "sine", notes: [587.33, 880], noteStep: 0.08, gain: 0.15, decay: 0.05 },
  // Single descending drop — back to normal mode
  mode_normal: { type: "sine", notes: [440, 220], noteStep: 0.15, gain: 0.12, decay: 0.06 },
};

/**
 * Play a synthesized earcon chime using Web Audio oscillators. Honors the
 * persisted chime-enabled flag and chime volume (0..1, clamped).
 */
export function playChime(type: FeedbackChimeType, options?: ChimeOptions): void {
  try {
    const settings = useSettingsStore.getState().settings.handsFreeStudy;
    const enabled = options?.enabled ?? settings?.chimeEnabled ?? true;
    if (!enabled) return;

    const volume = Math.min(1, Math.max(0, options?.volume ?? settings?.chimeVolume ?? 0.8));
    if (volume <= 0) return;

    const ctx = getAudioContext();
    if (!ctx) return;

    const profile = CHIME_PROFILES[type];
    const now = ctx.currentTime;

    profile.notes.forEach((freq, i) => {
      const startAt = now + i * profile.noteStep;
      const osc = ctx.createOscillator();
      osc.type = profile.type;
      osc.frequency.setValueAtTime(freq, startAt);
      if (i === profile.notes.length - 1 && type === "extract_captured") {
        osc.frequency.exponentialRampToValueAtTime(freq * 2, startAt + 0.12);
      }

      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, profile.gain * volume), startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + profile.decay + 0.12);

      osc.connect(gain);
      osc.start(startAt);
      osc.stop(startAt + profile.decay + 0.15);
    });
  } catch {
    // Non-blocking feedback
  }
}

interface DuckState {
  /** Monotonic token: only the latest duck may restore the volume. */
  token: number;
  /** Exact pre-duck volume to restore. */
  restoreVolume: number;
  /** Volume we ducked to; a mismatch at restore time means the user changed it manually. */
  duckedVolume: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const duckStates = new WeakMap<HTMLMediaElement, DuckState>();
let duckTokenCounter = 0;

/**
 * Temporarily duck audio volume while feedback chime is played.
 *
 * Hardened per design Decision 11: restores the EXACT prior volume, restores
 * regardless of paused state (volume never strands ducked), overlapping
 * captures cannot restore stale volumes (token-based), and a manual volume
 * change during the duck window wins (restore is skipped).
 */
export function duckAudio(
  audioElement: HTMLMediaElement | null,
  duckRatio = 0.25,
  durationMs = 600
): void {
  if (!audioElement || typeof audioElement.volume !== "number") return;

  const ratio = Math.min(1, Math.max(0, duckRatio));
  const existing = duckStates.get(audioElement);

  if (existing) {
    // Already ducked by a prior capture: keep the original restore target and
    // just extend the window — never chain ducked volumes.
    if (existing.timer) clearTimeout(existing.timer);
    existing.token = ++duckTokenCounter;
    existing.timer = setTimeout(() => restoreDuck(audioElement, existing.token), durationMs);
    return;
  }

  const restoreVolume = audioElement.volume;
  const duckedVolume = Math.max(0, restoreVolume * ratio);
  const token = ++duckTokenCounter;

  duckStates.set(audioElement, {
    token,
    restoreVolume,
    duckedVolume,
    timer: setTimeout(() => restoreDuck(audioElement, token), durationMs),
  });

  try {
    audioElement.volume = duckedVolume;
  } catch {
    duckStates.delete(audioElement);
  }
}

function restoreDuck(audioElement: HTMLMediaElement, token: number): void {
  const state = duckStates.get(audioElement);
  if (!state || state.token !== token) return; // superseded by a newer duck

  duckStates.delete(audioElement);

  try {
    // Manual volume change during the duck wins: only restore when the volume
    // is still exactly what we set it to. Restore regardless of paused state.
    if (audioElement.volume === state.duckedVolume) {
      audioElement.volume = state.restoreVolume;
    }
  } catch {
    // ignore
  }
}

/** Test/teardown helper: immediately restore any active duck. */
export function unduckAudio(audioElement: HTMLMediaElement | null): void {
  if (!audioElement) return;
  const state = duckStates.get(audioElement);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  restoreDuck(audioElement, state.token);
}

/** Test seam: drop the shared AudioContext so a fresh mock takes effect. */
export function resetSharedAudioContextForTests(): void {
  const ctx: any = sharedAudioCtx;
  sharedAudioCtx = null;
  if (ctx && ctx.state !== "closed" && typeof ctx.close === "function") {
    try {
      void ctx.close().catch(() => {});
    } catch {
      // test fakes may not implement close()
    }
  }
}
