/**
 * Audio Feedback Chime & Playback Ducking Utilities
 * 
 * Provides subtle earcons for hands-free study mode captures and transient volume ducking.
 */

export type FeedbackChimeType =
  | "extract_captured"
  | "bookmark_added"
  | "confusing_flagged"
  | "mode_study"
  | "mode_normal";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new AudioCtx();
  }

  if (sharedAudioCtx.state === "suspended") {
    void sharedAudioCtx.resume();
  }

  return sharedAudioCtx;
}

/**
 * Play a synthesized earcon chime using Web Audio oscillators
 */
export function playChime(type: FeedbackChimeType): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (type === "extract_captured") {
      // Pleasant rising two-tone (440Hz -> 880Hz)
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === "bookmark_added") {
      // Soft gentle triple chime
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + i * 0.06);

        const subGain = ctx.createGain();
        subGain.connect(ctx.destination);
        subGain.gain.setValueAtTime(0.001, now + i * 0.06);
        subGain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.06 + 0.02);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.15);

        osc.connect(subGain);
        osc.start(now + i * 0.06);
        osc.stop(now + i * 0.06 + 0.18);
      });
    } else if (type === "confusing_flagged") {
      // Distinct low questioning tone
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(349.23, now);
      osc.frequency.linearRampToValueAtTime(329.63, now + 0.18);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === "mode_study") {
      // Affirmative double beep
      [587.33, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + i * 0.08);

        const subGain = ctx.createGain();
        subGain.connect(ctx.destination);
        subGain.gain.setValueAtTime(0.001, now + i * 0.08);
        subGain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.08 + 0.02);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.1);

        osc.connect(subGain);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.12);
      });
    } else {
      // Normal single drop
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch {
    // Non-blocking feedback
  }
}

/**
 * Temporarily ducks audio volume while feedback chime is played
 */
export function duckAudio(
  audioElement: HTMLAudioElement | null,
  duckRatio = 0.25,
  durationMs = 600
): void {
  if (!audioElement) return;

  const originalVolume = audioElement.volume;
  audioElement.volume = Math.max(0, originalVolume * duckRatio);

  setTimeout(() => {
    try {
      if (audioElement && !audioElement.paused) {
        audioElement.volume = originalVolume;
      }
    } catch {
      // ignore
    }
  }, durationMs);
}
