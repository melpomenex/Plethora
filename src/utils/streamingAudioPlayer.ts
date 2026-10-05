/**
 * Streaming Audio Player for 24kHz 16-bit PCM and Web Audio playback.
 * Supports cross-fade boundaries to prevent clicks and micro-silences.
 */

export interface StreamingAudioPlayerOptions {
  sampleRate?: number;
  crossFadeDurationSec?: number;
  onSentenceEnded?: (index: number) => void;
  onPlaybackEnded?: () => void;
}

export class StreamingAudioPlayer {
  private ctx: AudioContext | null = null;
  private sampleRate: number;
  private crossFadeDurationSec: number;
  private nextScheduleTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private isPlaying: boolean = false;
  private playbackRate: number = 1.0;
  private onSentenceEnded?: (index: number) => void;
  private onPlaybackEnded?: () => void;

  constructor(options: StreamingAudioPlayerOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24000;
    this.crossFadeDurationSec = options.crossFadeDurationSec ?? 0.02; // 20ms crossfade
    this.onSentenceEnded = options.onSentenceEnded;
    this.onPlaybackEnded = options.onPlaybackEnded;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: this.sampleRate });
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(3.0, rate));
    for (const src of this.activeSources) {
      try {
        src.playbackRate.value = this.playbackRate;
      } catch {
        // Source may have ended
      }
    }
  }

  /**
   * Enqueue a raw 16-bit mono PCM buffer (ArrayBuffer or Int16Array)
   */
  public enqueuePcmChunk(pcmData: ArrayBuffer | Int16Array, sentenceIndex?: number): void {
    const ctx = this.ensureContext();
    const int16Array = pcmData instanceof Int16Array ? pcmData : new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);

    // Convert 16-bit signed integer [-32768, 32767] to [-1.0, 1.0]
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32Array.length, this.sampleRate);
    audioBuffer.copyToChannel(float32Array, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = this.playbackRate;

    const gainNode = ctx.createGain();
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Schedule seamlessly
    const now = ctx.currentTime;
    const startTime = Math.max(now, this.nextScheduleTime);
    const duration = audioBuffer.duration / this.playbackRate;

    // Apply 20ms cross-fade envelope
    const crossFade = Math.min(this.crossFadeDurationSec, duration * 0.25);
    gainNode.gain.setValueAtTime(0.001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(1.0, startTime + crossFade);
    gainNode.gain.setValueAtTime(1.0, startTime + duration - crossFade);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.start(startTime);
    this.nextScheduleTime = startTime + duration;
    this.isPlaying = true;
    this.activeSources.push(source);

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (sentenceIndex !== undefined && this.onSentenceEnded) {
        this.onSentenceEnded(sentenceIndex);
      }
      if (this.activeSources.length === 0) {
        this.isPlaying = false;
        if (this.onPlaybackEnded) {
          this.onPlaybackEnded();
        }
      }
    };
  }

  public pause(): void {
    if (this.ctx && this.ctx.state === "running") {
      void this.ctx.suspend();
    }
  }

  public resume(): void {
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  public stop(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Already stopped
      }
    }
    this.activeSources = [];
    this.nextScheduleTime = 0;
    this.isPlaying = false;
  }

  public close(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
