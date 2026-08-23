/** ML Kit Speech Basic expects 16 kHz mono PCM. Reject other wire formats. */

export const ML_KIT_SPEECH_SAMPLE_RATE_HZ = 16_000;
export const ML_KIT_SPEECH_CHANNELS = 1;

export type PcmEncoding = "pcm16le";

export interface PcmAudioSpec {
  sampleRateHz: number;
  channels: number;
  encoding: PcmEncoding;
}

export function isMlKitSpeechPcm(spec: PcmAudioSpec): boolean {
  return (
    spec.encoding === "pcm16le" &&
    spec.sampleRateHz === ML_KIT_SPEECH_SAMPLE_RATE_HZ &&
    spec.channels === ML_KIT_SPEECH_CHANNELS
  );
}

export function assertMlKitSpeechPcm(spec: PcmAudioSpec): void {
  if (!isMlKitSpeechPcm(spec)) {
    throw new Error(
      `codec_unsupported: ML Kit Speech needs ${ML_KIT_SPEECH_SAMPLE_RATE_HZ} Hz mono PCM16LE`
    );
  }
}

/** Linear-resample Float32 audio to 16 kHz mono PCM16LE, then standard Base64. */
export function floatToPcm16leBase64(
  samples: Float32Array,
  sampleRateHz: number
): string {
  const target = ML_KIT_SPEECH_SAMPLE_RATE_HZ;
  const resampled =
    sampleRateHz === target ? samples : resampleLinear(samples, sampleRateHz, target);
  const bytes = new Uint8Array(resampled.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i] ?? 0));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function resampleLinear(input: Float32Array, fromHz: number, toHz: number): Float32Array {
  if (fromHz <= 0 || input.length === 0) return input;
  const ratio = toHz / fromHz;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac;
  }
  return out;
}
