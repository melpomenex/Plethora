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
