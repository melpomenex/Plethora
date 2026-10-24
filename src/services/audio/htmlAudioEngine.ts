import type { ResolvedAudioPart } from "../../types/audioEdition";
import { AudioPlaybackException, classifyMediaElementError } from "./audioErrors";

export interface AudioEngineSample {
  timeInPart: number;
  durationSec: number | null;
  paused: boolean;
  seekable: boolean;
}

export interface AudioEngineEvents {
  sample: (sample: AudioEngineSample) => void;
  ended: () => void;
  buffering: () => void;
  error: (error: Error) => void;
}

export interface AudioEngine {
  load: (part: ResolvedAudioPart, events: AudioEngineEvents, signal: AbortSignal) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (seconds: number) => void;
  sample: () => AudioEngineSample;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  /** Optional one-chain WebAudio processing; absent means the platform cannot. */
  setVolumeBoost?: (enabled: boolean) => boolean;
  sampleAmplitude?: () => number | null;
  unload: () => void;
  dispose: () => void;
}

/** One lazily created element, with listeners scoped to a loaded part. No Blob fallback. */
export class HtmlAudioEngine implements AudioEngine {
  private audio: HTMLAudioElement;
  private cleanup: (() => void) | undefined;
  private context: AudioContext | null = null;
  private processingGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  constructor(createElement: () => HTMLAudioElement = () => new Audio()) {
    this.audio = createElement();
    this.audio.preload = "metadata";
  }

  sample = (): AudioEngineSample => ({
    timeInPart: Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0,
    durationSec: Number.isFinite(this.audio.duration) && this.audio.duration >= 0 ? this.audio.duration : null,
    paused: this.audio.paused,
    seekable: this.audio.seekable.length > 0,
  });

  load(part: ResolvedAudioPart, events: AudioEngineEvents, signal: AbortSignal): Promise<void> {
    this.cleanup?.();
    if (!part.browserUrl) return Promise.reject(new Error("Browser audio source unavailable"));
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const audio = this.audio;
      let ready = false;
      const removals: (() => void)[] = [];
      const on = (name: string, fn: () => void) => {
        audio.addEventListener(name, fn);
        removals.push(() => audio.removeEventListener(name, fn));
      };
      const finish = () => {
        if (ready) return;
        ready = true;
        clearTimeout(timer);
        resolve();
      };
      const fail = () => {
        const canPlayType = typeof audio.canPlayType === "function" ? (mime: string) => audio.canPlayType(mime) : undefined;
        const error = classifyMediaElementError(part.browserUrl!, audio.error, canPlayType);
        if (!ready) { clearTimeout(timer); reject(error); }
        else events.error(error);
      };
      const abort = () => {
        this.pause().catch(() => undefined);
        if (!ready) reject(new DOMException("Aborted", "AbortError"));
        cleanup();
      };
      const timer = setTimeout(() => {
        reject(new AudioPlaybackException("network", "Audio metadata timed out"));
        cleanup();
      }, 15_000);
      const cleanup = () => {
        clearTimeout(timer);
        removals.forEach(remove => remove());
        signal.removeEventListener("abort", abort);
      };
      this.cleanup = cleanup;
      signal.addEventListener("abort", abort, { once: true });
      on("loadedmetadata", finish);
      on("canplay", finish);
      on("error", fail);
      on("timeupdate", () => events.sample(this.sample()));
      on("durationchange", () => events.sample(this.sample()));
      on("playing", () => events.sample(this.sample()));
      on("pause", () => events.sample(this.sample()));
      on("waiting", events.buffering);
      on("ended", () => { if (audio.ended) events.ended(); });
      audio.src = part.browserUrl;
      audio.load();
      if (audio.readyState >= 1) finish();
    });
  }

  play = async (): Promise<void> => { await this.audio.play(); };
  pause = async (): Promise<void> => {
    this.audio.pause();
    if (!this.audio.paused) throw new Error("Audio did not acknowledge pause");
  };
  seek = (seconds: number): void => { this.audio.currentTime = seconds; };
  setRate = (rate: number): void => { this.audio.playbackRate = rate; };
  setVolume = (volume: number): void => { this.audio.volume = volume; };
  /** One MediaElementSource chain; never a second decoder or <audio> element. */
  private ensureProcessing(): boolean {
    if (this.processingGain) return true;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    try {
      const context = new Ctor();
      const source = context.createMediaElementSource(this.audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const gain = context.createGain();
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(context.destination);
      this.context = context;
      this.analyser = analyser;
      this.processingGain = gain;
      return true;
    } catch {
      return false;
    }
  }

  setVolumeBoost = (enabled: boolean): boolean => {
    if (!this.ensureProcessing() || !this.processingGain) return false;
    this.processingGain.gain.value = enabled ? 2.2 : 1;
    void this.context?.resume?.().catch(() => undefined);
    return true;
  };

  sampleAmplitude = (): number | null => {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    if (!data.length) return 0;
    let sum = 0;
    for (const value of data) sum += value;
    return sum / data.length;
  };

  unload = (): void => {
    this.cleanup?.();
    this.cleanup = undefined;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  };
  dispose = (): void => {
    this.unload();
    void this.context?.close?.().catch(() => undefined);
    this.context = null;
    this.processingGain = null;
    this.analyser = null;
  };
}
