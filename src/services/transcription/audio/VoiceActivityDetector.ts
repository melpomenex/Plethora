export interface VoiceActivityDetectorConfig {
  /** RMS energy threshold (0–1). Default 0.01. */
  energyThreshold?: number;
  /** Minimum speech duration before emitting a segment (ms). Default 300. */
  minSpeechMs?: number;
  /** Maximum buffered speech before forced emit (seconds, clamped 2–6). Default 4. */
  maxChunkSeconds?: number;
  /** PCM sample rate in Hz. Default 16000. */
  sampleRate?: number;
}

export interface VadSegment {
  samples: Float32Array;
  durationMs: number;
  startMs: number;
}

function clampMaxChunkSeconds(value: number | undefined): number {
  const seconds = value ?? 4;
  return Math.min(6, Math.max(2, seconds));
}

function computeRmsEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples.length);
}

/**
 * Simple energy-threshold voice activity detector for mono Float32 PCM chunks.
 * Buffers speech until silence (min duration met) or max chunk length is reached.
 */
export class VoiceActivityDetector {
  readonly energyThreshold: number;
  readonly minSpeechMs: number;
  readonly maxChunkSamples: number;
  readonly sampleRate: number;

  private buffer: Float32Array[] = [];
  private bufferedSamples = 0;
  private inSpeech = false;
  private speechStartMs = 0;
  private timelineMs = 0;

  constructor(config: VoiceActivityDetectorConfig = {}) {
    this.energyThreshold = config.energyThreshold ?? 0.01;
    this.minSpeechMs = config.minSpeechMs ?? 300;
    this.sampleRate = config.sampleRate ?? 16000;
    this.maxChunkSamples = Math.floor(
      clampMaxChunkSeconds(config.maxChunkSeconds) * this.sampleRate,
    );
  }

  /** Push a PCM chunk; returns any completed speech segments. */
  push(pcm: Float32Array): VadSegment[] {
    if (pcm.length === 0) return [];

    const chunkDurationMs = (pcm.length / this.sampleRate) * 1000;
    const chunkStartMs = this.timelineMs;
    this.timelineMs += chunkDurationMs;

    const energy = computeRmsEnergy(pcm);
    const isSpeech = energy >= this.energyThreshold;
    const segments: VadSegment[] = [];

    if (isSpeech) {
      if (!this.inSpeech) {
        this.inSpeech = true;
        this.speechStartMs = chunkStartMs;
      }
      this.buffer.push(pcm);
      this.bufferedSamples += pcm.length;

      while (this.bufferedSamples >= this.maxChunkSamples) {
        const forced = this.emitMaxChunk();
        if (forced) segments.push(forced);
      }
      return segments;
    }

    if (this.inSpeech) {
      this.buffer.push(pcm);
      this.bufferedSamples += pcm.length;
      const speechDurationMs = this.timelineMs - this.speechStartMs;
      if (speechDurationMs >= this.minSpeechMs) {
        const emitted = this.emitSegment();
        if (emitted) segments.push(emitted);
      } else {
        this.resetBuffer();
        this.inSpeech = false;
      }
    }

    return segments;
  }

  /** Flush any buffered speech at session end. */
  flush(): VadSegment | null {
    if (!this.inSpeech || this.bufferedSamples === 0) return null;
    const durationMs = (this.bufferedSamples / this.sampleRate) * 1000;
    if (durationMs < this.minSpeechMs) {
      this.resetBuffer();
      this.inSpeech = false;
      return null;
    }
    return this.emitSegment();
  }

  private emitSegment(): VadSegment | null {
    if (this.bufferedSamples === 0) return null;
    return this.emitSamples(this.bufferedSamples);
  }

  private emitMaxChunk(): VadSegment | null {
    if (this.bufferedSamples === 0) return null;
    const segment = this.emitSamples(this.maxChunkSamples);
    if (segment && this.bufferedSamples > 0) {
      this.speechStartMs += segment.durationMs;
      this.inSpeech = true;
    }
    return segment;
  }

  private emitSamples(sampleCount: number): VadSegment | null {
    if (sampleCount <= 0 || this.bufferedSamples === 0) return null;

    const samples = new Float32Array(sampleCount);
    let written = 0;
    while (written < sampleCount && this.buffer.length > 0) {
      const chunk = this.buffer[0]!;
      const take = Math.min(chunk.length, sampleCount - written);
      samples.set(chunk.subarray(0, take), written);
      written += take;
      if (take === chunk.length) {
        this.buffer.shift();
      } else {
        this.buffer[0] = chunk.subarray(take);
      }
    }

    this.bufferedSamples -= sampleCount;
    const fullyDrained = this.bufferedSamples === 0;
    if (fullyDrained) {
      this.inSpeech = false;
    }

    return {
      samples,
      durationMs: (samples.length / this.sampleRate) * 1000,
      startMs: this.speechStartMs,
    };
  }

  private resetBuffer(): void {
    this.buffer = [];
    this.bufferedSamples = 0;
  }
}
