import type {
  AudioCheckpoint, AudioCommandRequest, AudioCommandResult, AudioPauseReason,
  AudioPlaybackError, AudioPlaybackSnapshot, AudioPolicyInterval, AudioSourceKey, ResolvedAudioItem,
} from "../../types/audioEdition";
import { audioDuration, finiteSeconds, globalAudioPosition, locateAudioPosition, withAudioBoundaries } from "./audioCoordinates";
import { AudioPlaybackException, classifyAudioPlaybackError } from "./audioErrors";
import { audioSourceId, AudioPlaybackPersistence } from "./audioPlaybackPersistence";
import type { AudioEngine, AudioEngineSample } from "./htmlAudioEngine";
import type { DesktopAudioLifecycleEvent } from "./audioPlaybackOwner";
import { adjacentAudioSource, validateAudioQueue } from "./audioQueue";

const NETWORK_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

export interface GlobalAudioDependencies {
  createEngine: () => AudioEngine;
  resolve: (key: AudioSourceKey, signal: AbortSignal) => Promise<ResolvedAudioItem>;
  beforeLoadPart?: (item: ResolvedAudioItem, partIndex: number) => Promise<ResolvedAudioItem>;
  persistence: AudioPlaybackPersistence;
  now?: () => number;
  uuid?: () => string;
  beforePlay?: () => Promise<{ isCurrent: () => boolean }>;
  afterStop?: () => Promise<void>;
}

/** Application-lifetime authority. React surfaces only subscribe and issue commands. */
export class GlobalAudioController {
  private engine: AudioEngine | null = null;
  private item: ResolvedAudioItem | null = null;
  private snapshot: AudioPlaybackSnapshot | null = null;
  private listeners = new Set<() => void>();
  private serial: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private revision = 0;
  private sequence = 0;
  private intentRevision = 0;
  private abort: AbortController | null = null;
  private partToken = 0;
  private ready = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private sleepTimer: ReturnType<typeof setTimeout> | undefined;
  private sleepDeadline: number | null = null;
  private networkRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshedExpiredGeneration = -1;
  private feedbackDuck: { generation: number; sessionId: string; ratio: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private lastPublished = 0;
  private accepted = new Set<string>();
  private requests = new Map<string, Promise<AudioCommandResult>>();
  private policyIntervals: readonly AudioPolicyInterval[] = [];
  private skippedPolicy = new Set<string>();
  private silenceTimer: ReturnType<typeof setInterval> | undefined;
  private silenceLastLoudAt = 0;
  private ownerEpoch: string;
  private now: () => number;
  private uuid: () => string;

  constructor(private deps: GlobalAudioDependencies) {
    this.now = deps.now ?? Date.now;
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
    this.ownerEpoch = this.uuid();
  }

  initialize(): void {
    if (this.engine) return;
    this.engine = this.deps.createEngine();
    this.timer = setInterval(() => {
      if (!this.snapshot?.playIntent || this.snapshot.state !== "playing") return;
      this.sample(this.engine!.sample(), true);
      void this.flush(false).catch(error => this.publish({ error: { code: "persistence", message: String(error) } }));
    }, 5000);
  }

  getSnapshot = (): AudioPlaybackSnapshot | null => this.snapshot;
  getIntentVersion = (): number => this.intentRevision;
  getItem = (): ResolvedAudioItem | null => this.item;
  getOwnerEpoch = (): string => this.ownerEpoch;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(patch: Partial<AudioPlaybackSnapshot>): void {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, ...patch, revision: ++this.revision, updatedAt: this.now() };
    this.lastPublished = this.now();
    this.listeners.forEach(listener => listener());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation);
    this.serial = result.catch(() => undefined);
    return result;
  }

  private current(generation: number): boolean { return this.generation === generation; }

  private fail(error: unknown): AudioPlaybackError {
    this.ready = false;
    const failure = classifyAudioPlaybackError(error);
    this.publish({ state: "error", playIntent: false, error: failure });
    return failure;
  }

  async load(key: AudioSourceKey, options: { intent: "play" | "paused"; explicitPosition?: number; queue?: readonly AudioSourceKey[]; sleepDeadlineMs?: number | null }): Promise<void> {
    const queue = validateAudioQueue(options.queue ?? [], key);
    this.initialize();
    if (this.item && this.snapshot?.state !== "error" && audioSourceId(this.item.sourceKey) === audioSourceId(key) && this.ready && options.explicitPosition === undefined) {
      if (options.queue !== undefined) this.publish({ queue });
      return options.intent === "play" ? this.play() : Promise.resolve();
    }
    const generation = ++this.generation;
    ++this.intentRevision;
    this.clearNetworkRetry();
    this.ready = false;
    const sameProfile = this.snapshot?.sourceKey.profileKey === key.profileKey;
    const rate = sameProfile ? this.snapshot!.playbackRate : 1;
    const volume = sameProfile ? this.snapshot!.volume : 1;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    // Quiescence happens before resolution/start. Failure blocks takeover, even if resolution is quick.
    await this.enqueue(async () => {
      if (!this.current(generation)) return;
      try { await this.pauseEngine(); }
      catch (error) {
        this.publish({ state: "error", playIntent: false, error: { code: "focus_denied", message: String(error) } });
        throw error;
      }
      this.publish({ state: "paused", playIntent: false, pauseReason: "source-switch" });
      await this.flush(true);
      this.item?.release?.();
      this.item = null;
      this.ready = false;
      this.clearFeedbackDuck(false);
      this.clearSleep();
      this.sleepDeadline = options.sleepDeadlineMs ?? null;
      this.snapshot = {
        schemaVersion: 1, sourceKey: { ...key }, generation, revision: ++this.revision,
        metadata: { sourceId: key.sourceId, sourceKind: key.kind, sessionId: this.uuid(), title: key.sourceId },
        state: "loading", playIntent: options.intent === "play", pauseReason: null,
        positionSec: 0, globalPositionSec: 0, sleepDeadlineMs: this.sleepDeadline, timeInPart: 0, partIndex: 0, durationSec: null,
        playbackRate: rate, volume, mediaRevision: "", checkpointSequence: this.sequence, updatedAt: this.now(),
        queue, capabilities: { canPlay: true, canPause: true, canResume: true, canSeekRelative: false, canSeekAbsolute: false, precisePosition: true, canNext: false, canPrevious: false },
      };
      if (this.sleepDeadline !== null) this.armSleep();
      this.listeners.forEach(listener => listener());
    });
    if (!this.current(generation)) return;
    let resolved: ResolvedAudioItem | null = null;
    try {
      resolved = await this.deps.resolve(key, abort.signal);
      if (!this.current(generation)) { resolved.release?.(); return; }
      if (audioSourceId(resolved.sourceKey) !== audioSourceId(key) || !resolved.parts.length) throw new Error("Audio source identity or manifest invalid");
      const item = resolved;
      await this.enqueue(async () => {
        if (!this.current(generation)) { item.release?.(); return; }
        this.item = { ...item, parts: withAudioBoundaries(item.parts) };
        this.policyIntervals = [...(item.policyIntervals ?? [])].sort((left, right) => left.startSec - right.startSec);
        this.skippedPolicy.clear();
        this.publish({ metadata: { ...this.snapshot!.metadata, title: item.title, artist: item.artist, artworkUrl: item.artworkUrl }, mediaRevision: item.mediaRevision, durationSec: audioDuration(this.item.parts), capabilities: { ...this.snapshot!.capabilities, canBoostVolume: Boolean(this.engine?.setVolumeBoost), canSkipSilence: Boolean(this.engine?.sampleAmplitude) } });
        const target = options.explicitPosition === undefined ? (item.resume ?? { partIndex: 0, timeInPart: 0 }) : locateAudioPosition(this.item.parts, options.explicitPosition);
        if (!target || !this.item.parts[target.partIndex]) throw new Error("Audio resume position unavailable");
        await this.loadPart(target.partIndex, target.timeInPart, generation);
      });
    } catch (error) {
      if (!this.current(generation)) return;
      await this.engine!.pause().catch(() => undefined);
      this.fail(error);
      throw error;
    }
  }

  /** Sponsor/pre-cut intervals stay in original-media global coordinates. */
  private enforcePolicyInterval(sample: AudioEngineSample): boolean {
    if (!this.snapshot?.playIntent || !this.item) return false;
    const part = this.item.parts[this.snapshot.partIndex];
    if (!part) return false;
    const local = Math.min(sample.timeInPart, part.durationSec ?? Infinity);
    const global = globalAudioPosition(this.item.parts, this.snapshot.partIndex, local);
    if (global === null) return false;
    for (const interval of this.policyIntervals) {
      if (global < interval.startSec || global >= interval.endSec) continue;
      if (this.skippedPolicy.has(interval.id)) return false;
      this.skippedPolicy.add(interval.id);
      this.publish({ policySkip: { id: interval.id, category: interval.category, fromSec: interval.startSec, toSec: interval.endSec, at: this.now() } });
      if (interval.endSec - global > 0.05) {
        void this.seekTo(interval.endSec).catch(() => this.skippedPolicy.delete(interval.id));
      }
      return true;
    }
    return false;
  }

  private async pauseEngine(generation?: number): Promise<void> {    if (!this.engine) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.engine.pause(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Audio pause acknowledgement timed out")), 2000); }),
      ]);
      if (!this.engine.sample().paused) throw new Error("Audio pause not acknowledged");
      if (generation === undefined || this.current(generation)) this.sample(this.engine.sample(), true);
    } finally { clearTimeout(timeout); }
  }

  private clearNetworkRetry(): void {
    if (this.networkRetryTimer !== undefined) {
      clearTimeout(this.networkRetryTimer);
      this.networkRetryTimer = undefined;
    }
  }

  private async refreshExpiredSourceOnce(index: number, generation: number): Promise<boolean> {
    if (this.refreshedExpiredGeneration === generation || !this.snapshot || !this.item || !this.abort) {
      return false;
    }
    this.refreshedExpiredGeneration = generation;
    const expectedId = audioSourceId(this.snapshot.sourceKey);
    const expectedRevision = this.item.mediaRevision;
    const refreshed = await this.deps.resolve(this.snapshot.sourceKey, this.abort.signal);
    if (!this.current(generation)) {
      refreshed.release?.();
      return false;
    }
    if (
      audioSourceId(refreshed.sourceKey) !== expectedId ||
      (expectedRevision && refreshed.mediaRevision && refreshed.mediaRevision !== expectedRevision) ||
      !refreshed.parts[index]
    ) {
      refreshed.release?.();
      throw new AudioPlaybackException("expired_url", "Episode unavailable");
    }
    this.item.release?.();
    this.item = { ...refreshed, parts: withAudioBoundaries(refreshed.parts) };
    this.publish({
      metadata: {
        ...this.snapshot.metadata,
        title: refreshed.title,
        artist: refreshed.artist,
        artworkUrl: refreshed.artworkUrl,
      },
      mediaRevision: refreshed.mediaRevision,
      durationSec: audioDuration(this.item.parts),
    });
    return true;
  }

  private handleRuntimePartError(error: unknown, index: number, generation: number, partToken: number): void {
    if (!this.current(generation) || this.partToken !== partToken || !this.snapshot) return;
    const classified = classifyAudioPlaybackError(error);
    const capturedLocal = this.engine?.sample().timeInPart ?? this.snapshot.timeInPart;
    if (classified.code === "expired_url") {
      if (this.refreshedExpiredGeneration === generation) {
        this.fail(new AudioPlaybackException("expired_url", "Episode unavailable"));
        return;
      }
      void this.enqueue(async () => {
        if (!this.current(generation) || !this.snapshot) return;
        try {
          const ok = await this.refreshExpiredSourceOnce(index, generation);
          if (!ok || !this.current(generation)) return;
          await this.loadPart(index, capturedLocal, generation);
        } catch {
          if (this.current(generation)) {
            this.fail(new AudioPlaybackException("expired_url", "Episode unavailable"));
          }
        }
      });
      return;
    }
    if (classified.code === "network" && this.snapshot.playIntent) {
      ++this.partToken;
      this.ready = false;
      const retryIntentRevision = this.intentRevision;
      this.publish({ state: "buffering", error: classified });
      this.scheduleNetworkRetry(0, index, capturedLocal, generation, retryIntentRevision, error);
      return;
    }
    this.fail(error);
  }

  private scheduleNetworkRetry(
    attempt: number,
    index: number,
    local: number,
    generation: number,
    retryIntentRevision: number,
    lastError: unknown,
  ): void {
    this.clearNetworkRetry();
    if (attempt >= NETWORK_RETRY_DELAYS_MS.length) {
      if (this.current(generation) && this.intentRevision === retryIntentRevision) {
        this.fail(lastError);
      }
      return;
    }
    this.networkRetryTimer = setTimeout(() => {
      this.networkRetryTimer = undefined;
      if (!this.current(generation) || this.intentRevision !== retryIntentRevision || !this.snapshot?.playIntent) {
        return;
      }
      void this.enqueue(async () => {
        if (!this.current(generation) || this.intentRevision !== retryIntentRevision || !this.snapshot?.playIntent) {
          return;
        }
        try {
          await this.loadPart(index, local, generation);
        } catch (retryError) {
          if (!this.current(generation) || this.intentRevision !== retryIntentRevision || !this.snapshot?.playIntent) {
            return;
          }
          if (classifyAudioPlaybackError(retryError).code === "network" && attempt + 1 < NETWORK_RETRY_DELAYS_MS.length) {
            this.publish({ state: "buffering", error: classifyAudioPlaybackError(retryError) });
            this.scheduleNetworkRetry(attempt + 1, index, local, generation, retryIntentRevision, retryError);
          } else {
            this.fail(retryError);
          }
        }
      });
    }, NETWORK_RETRY_DELAYS_MS[attempt]);
  }

  private async loadPart(index: number, local: number, generation: number): Promise<void> {
    const partToken = ++this.partToken;
    const active = () => this.current(generation) && this.partToken === partToken;
    this.ready = false;
    if (this.deps.beforeLoadPart && this.item) {
      const refreshed = await this.deps.beforeLoadPart(this.item, index);
      if (!active()) return;
      this.item = { ...refreshed, parts: withAudioBoundaries(refreshed.parts) };
    }
    const global = globalAudioPosition(this.item!.parts, index, local);
    this.publish({ state: "loading", partIndex: index, timeInPart: local, globalPositionSec: global, positionSec: global ?? local });
    try {
      await this.engine!.load(this.item!.parts[index], {
        sample: sample => { if (active()) this.sample(sample); },
        ended: () => { if (active()) void this.enqueue(() => this.ended(generation, partToken)).catch(error => { if (this.current(generation)) this.fail(error); }); },
        buffering: () => { if (active() && this.snapshot!.playIntent) this.publish({ state: "buffering" }); },
        error: error => { this.handleRuntimePartError(error, index, generation, partToken); },
      }, this.abort!.signal);
    } catch (error) {
      if (active() && classifyAudioPlaybackError(error).code === "expired_url") {
        if (this.refreshedExpiredGeneration !== generation) {
          const refreshedOk = await this.refreshExpiredSourceOnce(index, generation);
          if (refreshedOk && this.current(generation)) {
            await this.loadPart(index, local, generation);
            return;
          }
        }
        throw new AudioPlaybackException("expired_url", "Episode unavailable");
      }
      throw error;
    }
    if (!active()) return;
    const duration = this.engine!.sample().durationSec;
    if (duration !== null) {
      const parts = this.item!.parts.map((part, partIndex) => partIndex === index ? { ...part, durationSec: duration } : part);
      this.item = { ...this.item!, parts: withAudioBoundaries(parts) };
    }
    this.engine!.seek(Math.min(finiteSeconds(local), duration ?? Infinity));
    this.engine!.setRate(this.snapshot!.playbackRate);
    this.engine!.setVolume(this.effectiveEngineVolume());
    this.ready = true;
    const known = globalAudioPosition(this.item!.parts, index, 0) !== null;
    this.publish({ section: { id: this.item!.parts[index].partId, index, title: this.item!.parts[index].title }, durationSec: audioDuration(this.item!.parts), capabilities: { ...this.snapshot!.capabilities, canSeekAbsolute: known && this.engine!.sample().seekable, canSeekRelative: this.engine!.sample().seekable, canNext: index + 1 < this.item!.parts.length, canPrevious: index > 0 }, state: "paused", error: undefined });
    if (this.snapshot!.playIntent && !this.sleepExpired()) await this.playEngine(generation);
    else this.publish({ state: "paused", playIntent: false });
    this.sample(this.engine!.sample(), true);
  }

  private sample(sample: AudioEngineSample, force = false): void {
    if (!this.snapshot || !this.item || !Number.isFinite(sample.timeInPart) || sample.timeInPart < 0) return;
    if (this.enforcePolicyInterval(sample)) return;
    let semanticChange = false;
    if (sample.durationSec !== null && Number.isFinite(sample.durationSec) && sample.durationSec >= 0 && this.item.parts[this.snapshot.partIndex].durationSec !== sample.durationSec) {
      const parts = this.item.parts.map((part, index) => index === this.snapshot!.partIndex ? { ...part, durationSec: sample.durationSec } : part);
      this.item = { ...this.item, parts: withAudioBoundaries(parts) };
      semanticChange = true;
    }
    const canSeekAbsolute = this.item.parts[this.snapshot.partIndex].globalStartSec !== null && sample.seekable;
    const capabilitiesChanged = this.snapshot.capabilities.canSeekAbsolute !== canSeekAbsolute || this.snapshot.capabilities.canSeekRelative !== sample.seekable;
    if (!force && !semanticChange && !capabilitiesChanged && this.now() - this.lastPublished < 1000) return;
    const local = Math.min(sample.timeInPart, this.item.parts[this.snapshot.partIndex].durationSec ?? Infinity);
    const global = globalAudioPosition(this.item.parts, this.snapshot.partIndex, local);
    this.publish({ timeInPart: local, globalPositionSec: global, positionSec: global ?? local,
      durationSec: audioDuration(this.item.parts),
      capabilities: capabilitiesChanged ? { ...this.snapshot.capabilities, canSeekAbsolute, canSeekRelative: sample.seekable } : this.snapshot.capabilities });
  }

  private async playEngine(generation: number, focusRequest?: Promise<{ isCurrent: () => boolean }>, intentRevision = this.intentRevision): Promise<void> {
    if (!this.ready || !this.current(generation) || !this.snapshot?.playIntent) return;
    let focus: { isCurrent: () => boolean } | undefined;
    try { focus = await (focusRequest ?? this.deps.beforePlay?.()); }
    catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") throw error;
      if (this.current(generation) && intentRevision === this.intentRevision) this.publish({ state: "paused", playIntent: false, pauseReason: "focus" });
      return;
    }
    if (!this.current(generation) || !this.snapshot?.playIntent || (focus && !focus.isCurrent())) return;
    this.engine!.setVolume(this.effectiveEngineVolume());
    if (!this.engine!.sample().paused) {
      this.publish({ state: this.snapshot.state === "buffering" ? "buffering" : "playing", pauseReason: null, error: undefined });
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.engine!.play(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Audio play acknowledgement timed out")), 15_000); }),
      ]);
    } catch (error) {
      await this.engine!.pause();
      throw error;
    } finally { clearTimeout(timeout); }
    if (!this.current(generation) || !this.snapshot?.playIntent || (focus && !focus.isCurrent())) { await this.engine!.pause(); return; }
    this.publish({ state: "playing", pauseReason: null, error: undefined });
  }

  play = (): Promise<void> => {
    if (!this.snapshot) return Promise.resolve();
    if (this.snapshot.state === "error") return this.load(this.snapshot.sourceKey, { intent: "play", queue: this.snapshot.queue });
    if (this.snapshot.state === "ended") return this.load(this.snapshot.sourceKey, { intent: "play", explicitPosition: 0, queue: this.snapshot.queue });
    if (!this.ready) return this.load(this.snapshot.sourceKey, { intent: "play", explicitPosition: this.snapshot.positionSec, queue: this.snapshot.queue });
    if (this.sleepExpired()) this.clearSleep();
    const generation = this.generation;
    const intentRevision = ++this.intentRevision;
    const focusRequest = this.deps.beforePlay?.();
    void focusRequest?.catch(() => undefined);
    this.publish({ playIntent: true, pauseReason: null, sleepDeadlineMs: this.sleepDeadline });
    return this.enqueue(async () => {
      if (!this.current(generation)) return;
      try { await this.playEngine(generation, focusRequest, intentRevision); } catch (error) { this.fail(error); throw error; }
    });
  };

  pause = (reason: AudioPauseReason = "user"): Promise<void> => {
    if (!this.snapshot) return Promise.resolve();
    const generation = this.generation;
    ++this.intentRevision;
    this.clearNetworkRetry();
    this.clearFeedbackDuck(true);
    // Clear intent immediately so in-flight prepare/play cannot override Pause.
    this.publish({ playIntent: false, pauseReason: reason });
    return this.enqueue(async () => {
      if (!this.current(generation)) return;
      await this.pauseEngine();
      this.publish({ state: "paused" });
      await this.flush(true);
    });
  };

  toggle = (): Promise<void> => this.snapshot?.playIntent ? this.pause() : this.play();

  /** Revocation can preempt a Play awaiting focus; enqueuing here would deadlock the focus handover. */
  pauseForFocus = async (): Promise<void> => {
    if (!this.snapshot) return;
    const generation = this.generation;
    ++this.intentRevision;
    this.clearNetworkRetry();
    this.clearFeedbackDuck(true);
    this.publish({ playIntent: false, pauseReason: "focus" });
    await this.pauseEngine(generation);
    if (!this.current(generation)) return;
    this.publish({ state: "paused" });
    await this.flush(true);
  };

  /**
   * Normalized desktop OS lifecycle handler (`audio-lifecycle`):
   * - `suspend`: pauses with reason `"suspend"` and flushes checkpoint.
   * - `wake`: samples the actual engine without adding suspended wall-clock time,
   *   pauses/checkpoints if pre-suspend was missed, and stays paused.
   * - `outputInterrupted`: pauses with reason `"headphones"` and flushes checkpoint.
   * - `appExiting`: pauses, checkpoints, and unloads decoder while preserving saved session identity.
   */
  handleLifecycleEvent = (event: DesktopAudioLifecycleEvent): Promise<void> => {
    if (!this.snapshot) return Promise.resolve();
    if (event.kind === "suspend") {
      return this.pause("suspend");
    }
    if (event.kind === "outputInterrupted") {
      return this.pause("headphones");
    }
    if (event.kind === "wake") {
      const generation = this.generation;
      const needsPause = this.snapshot.playIntent || this.snapshot.state === "playing" || this.snapshot.state === "buffering";
      if (needsPause) {
        ++this.intentRevision;
        this.clearFeedbackDuck(true);
        this.publish({ playIntent: false, pauseReason: "suspend" });
      }
      return this.enqueue(async () => {
        if (!this.current(generation) || !this.snapshot) return;
        if (this.engine) {
          if (needsPause || !this.engine.sample().paused) {
            await this.pauseEngine(generation);
          } else if (this.ready) {
            this.sample(this.engine.sample(), true);
          }
        }
        if (!this.current(generation) || !this.snapshot) return;
        this.publish({
          state: "paused",
          playIntent: false,
          pauseReason: this.snapshot.pauseReason ?? "suspend",
        });
        await this.flush(true);
      });
    }
    if (event.kind === "appExiting") {
      const generation = this.generation;
      ++this.intentRevision;
      this.clearFeedbackDuck(false);
      this.clearSleep();
      this.publish({ playIntent: false, pauseReason: "user" });
      return this.enqueue(async () => {
        if (!this.current(generation) || !this.snapshot) return;
        await this.pauseEngine(generation).catch(() => undefined);
        this.publish({ state: "paused" });
        await this.flush(true).catch(() => undefined);
        this.engine?.unload();
        this.ready = false;
        await this.deps.afterStop?.().catch(() => undefined);
      });
    }
    return Promise.resolve();
  };

  seekTo = (seconds: number): Promise<void> => this.enqueue(async () => {
    if (!this.item || !this.snapshot || !this.ready) return;
    const target = locateAudioPosition(this.item.parts, seconds);
    if (!target || !this.snapshot.capabilities.canSeekAbsolute) throw new Error("Absolute seek unavailable");
    await this.seekPart(target.partIndex, target.timeInPart);
  });

  seekRelative = (delta: number): Promise<void> => this.enqueue(async () => {
    if (!Number.isFinite(delta)) throw new Error("Invalid relative seek");
    if (!this.item || !this.snapshot || !this.ready || !this.snapshot.capabilities.canSeekRelative) return;
    const sample = this.engine!.sample();
    const global = globalAudioPosition(this.item.parts, this.snapshot.partIndex, sample.timeInPart);
    const target = global === null ? { partIndex: this.snapshot.partIndex, timeInPart: Math.max(0, sample.timeInPart + delta) } : locateAudioPosition(this.item.parts, Math.max(0, global + delta));
    if (!target) throw new Error("Seek crosses an unknown part boundary");
    await this.seekPart(target.partIndex, target.timeInPart);
  });

  private async seekPart(index: number, local: number): Promise<void> {
    if (index !== this.snapshot!.partIndex) {
      await this.pauseEngine();
      await this.flush(true);
      await this.loadPart(index, local, this.generation);
    } else {
      this.engine!.seek(local);
      this.sample(this.engine!.sample(), true);
    }
    await this.flush(true);
  }

  selectChapter = (index: number): Promise<void> => this.enqueue(async () => {
    if (!Number.isInteger(index) || !this.item?.parts[index]) throw new Error("Audio chapter unavailable");
    await this.seekPart(index, 0);
  });

  private queueMove(direction: -1 | 1): Promise<void> {
    const current = this.snapshot;
    if (!current) return Promise.resolve();
    const next = adjacentAudioSource(current.queue ?? [], current.sourceKey, direction);
    if (!next) return Promise.resolve();
    return this.load(next, { intent: current.playIntent ? "play" : "paused", explicitPosition: 0, queue: current.queue, sleepDeadlineMs: this.sleepDeadline });
  }
  queueNext = (): Promise<void> => this.queueMove(1);
  queuePrevious = (): Promise<void> => this.queueMove(-1);

  setRate = (rate: number): Promise<void> => this.enqueue(async () => {
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 3) throw new Error("Invalid playback rate");
    this.engine?.setRate(rate);
    this.publish({ playbackRate: rate });
    await this.flush(true);
  });

  setVolume = (volume: number): Promise<void> => this.enqueue(async () => {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error("Invalid playback volume");
    this.clearFeedbackDuck(false);
    this.engine?.setVolume(volume);
    this.publish({ volume });
  });

  /** Owner-lifetime volume boost through the engine's single WebAudio chain. */
  setVolumeBoost = (enabled: boolean): Promise<boolean> => this.enqueue(async () => {
    const supported = Boolean(this.engine?.setVolumeBoost?.(enabled));
    if (this.snapshot) {
      this.publish({ capabilities: { ...this.snapshot.capabilities, canBoostVolume: supported } });
    }
    return supported;
  });

  setSilenceSkip = (enabled: boolean): Promise<boolean> => this.enqueue(async () => {
    const supported = Boolean(this.engine?.sampleAmplitude);
    if (!supported) return false;
    if (enabled) this.startSilenceMonitor();
    else this.stopSilenceMonitor();
    return supported;
  });

  private startSilenceMonitor(): void {
    this.stopSilenceMonitor();
    this.silenceLastLoudAt = this.now();
    this.silenceTimer = setInterval(() => {
      if (!this.snapshot?.playIntent || !this.engine) return;
      const amplitude = this.engine.sampleAmplitude?.();
      if (amplitude === null || amplitude === undefined) return;
      if (amplitude > 8) {
        this.silenceLastLoudAt = this.now();
        return;
      }
      if (this.now() - this.silenceLastLoudAt < 500) return;
      this.silenceLastLoudAt = this.now();
      void this.seekRelative(0.5).catch(() => undefined);
    }, 100);
  }

  private stopSilenceMonitor(): void {
    if (this.silenceTimer !== undefined) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }

  setPolicyIntervals = (intervals: readonly AudioPolicyInterval[]): void => {
    this.policyIntervals = intervals
      .filter(interval => interval && interval.id && Number.isFinite(interval.startSec) && Number.isFinite(interval.endSec) && interval.endSec > interval.startSec)
      .map(interval => ({ id: String(interval.id), category: String(interval.category ?? "sponsor"), startSec: Math.max(0, interval.startSec), endSec: Math.max(0, interval.endSec) }))
      .sort((left, right) => left.startSec - right.startSec);
    this.skippedPolicy.clear();
  };

  private effectiveEngineVolume(): number {
    const base = this.snapshot?.volume ?? 1;
    const duck = this.feedbackDuck;
    if (duck && this.current(duck.generation) && this.snapshot?.metadata.sessionId === duck.sessionId && this.snapshot.playIntent) {
      return Math.max(0, Math.min(1, base * duck.ratio));
    }
    return base;
  }

  private clearFeedbackDuck(restoreEngine: boolean): void {
    const duck = this.feedbackDuck;
    if (!duck) return;
    clearTimeout(duck.timer);
    this.feedbackDuck = null;
    if (restoreEngine && this.current(duck.generation) && this.snapshot?.metadata.sessionId === duck.sessionId) {
      this.engine?.setVolume(this.snapshot.volume);
    }
  }

  /**
   * Scoped hands-free feedback ducking. Never mutates saved/snapshot user volume,
   * never compounds across rapid captures, and restores only the same still-playing generation.
   */
  duckForFeedback = (duckRatio = 0.25, durationMs = 700): (() => void) => {
    if (!this.engine || !this.snapshot || !this.snapshot.playIntent) return () => {};
    const generation = this.generation;
    const sessionId = this.snapshot.metadata.sessionId;
    const ratio = Number.isFinite(duckRatio) ? Math.max(0.05, Math.min(1, duckRatio)) : 0.25;
    const ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 700;
    if (this.feedbackDuck) clearTimeout(this.feedbackDuck.timer);
    const finish = () => {
      if (!this.feedbackDuck || this.feedbackDuck.timer !== timer) return;
      this.feedbackDuck = null;
      if (this.current(generation) && this.snapshot?.metadata.sessionId === sessionId && this.snapshot.playIntent) {
        this.engine?.setVolume(this.snapshot.volume);
      }
    };
    const timer = setTimeout(finish, ms);
    this.feedbackDuck = { generation, sessionId, ratio, timer };
    this.engine.setVolume(Math.max(0, Math.min(1, this.snapshot.volume * ratio)));
    return () => {
      if (!this.feedbackDuck || this.feedbackDuck.timer !== timer) return;
      clearTimeout(timer);
      this.feedbackDuck = null;
      if (this.current(generation) && this.snapshot?.metadata.sessionId === sessionId && this.snapshot.playIntent) {
        this.engine?.setVolume(this.snapshot.volume);
      }
    };
  };

  setSleepTimer(deadlineMs: number | null): void {
    if (deadlineMs !== null && !Number.isFinite(deadlineMs)) throw new Error("Invalid sleep deadline");
    this.clearSleep();
    this.sleepDeadline = deadlineMs;
    this.publish({ sleepDeadlineMs: deadlineMs });
    if (deadlineMs !== null) this.armSleep();
  }

  refreshManifest = async (): Promise<void> => {
    const snapshot = this.snapshot;
    if (!snapshot || !this.item || snapshot.sourceKey.kind !== "audio_edition") return;
    const generation = this.generation;
    const sourceKey = { ...snapshot.sourceKey };
    const signal = this.abort?.signal ?? new AbortController().signal;
    let next: ResolvedAudioItem;
    try {
      next = await this.deps.resolve(sourceKey, signal);
    } catch {
      return;
    }
    if (!this.current(generation)) {
      next.release?.();
      return;
    }
    await this.enqueue(async () => {
      if (!this.current(generation) || !this.item || !this.snapshot || audioSourceId(this.snapshot.sourceKey) !== audioSourceId(sourceKey)) {
        next.release?.();
        return;
      }
      const existingById = new Map(this.item.parts.map((part, idx) => [part.partId, { part, idx }]));
      const activeIndex = this.snapshot.partIndex;
      const merged = withAudioBoundaries(next.parts.map(part => {
        const currentEntry = existingById.get(part.partId);
        if (!currentEntry) return part;
        return {
          ...part,
          durationSec: currentEntry.part.durationSec ?? part.durationSec,
          browserUrl: currentEntry.idx === activeIndex ? (currentEntry.part.browserUrl ?? part.browserUrl) : (part.browserUrl ?? currentEntry.part.browserUrl),
        };
      }));
      const prevRelease = this.item.release;
      const nextRelease = next.release;
      this.item = {
        ...next,
        parts: merged,
        release: () => {
          prevRelease?.();
          nextRelease?.();
        },
      };
      const clearBoundaryError =
        this.snapshot.pauseReason === "ended" &&
        this.snapshot.error?.code === "source_missing" &&
        activeIndex + 1 < merged.length;
      this.publish({
        durationSec: audioDuration(merged),
        capabilities: {
          ...this.snapshot.capabilities,
          canNext: activeIndex + 1 < merged.length,
          canPrevious: activeIndex > 0,
        },
        ...(clearBoundaryError ? { error: undefined } : {}),
      });
    });
  };

  private armSleep(): void {
    const remaining = this.sleepDeadline! - this.now();
    if (remaining <= 0) { void this.pause("sleep"); return; }
    this.sleepTimer = setTimeout(() => this.armSleep(), Math.min(remaining, 2_147_483_647));
  }

  private sleepExpired(): boolean { return this.sleepDeadline !== null && this.now() >= this.sleepDeadline; }
  private clearSleep(): void { clearTimeout(this.sleepTimer); this.sleepDeadline = null; }

  private async ended(generation: number, token: number): Promise<void> {
    if (!this.current(generation) || token !== this.partToken || !this.snapshot?.playIntent) return;
    ++this.partToken; // Consume an end once, including duplicate events queued before the first.
    this.sample(this.engine!.sample(), true);
    await this.flush(true);
    if (!this.current(generation) || !this.snapshot?.playIntent) return;
    if (this.sleepExpired()) { this.publish({ state: "paused", playIntent: false, pauseReason: "sleep" }); return; }
    const next = this.snapshot.partIndex + 1;
    if (this.item!.parts[next]) await this.loadPart(next, 0, generation);
    else if (!this.item!.complete) this.publish({ state: "paused", playIntent: false, pauseReason: "ended", error: { code: "source_missing", message: "Open Plethora to prepare the next section" } });
    else {
      const queue = this.snapshot.queue;
      const queued = adjacentAudioSource(queue ?? [], this.snapshot.sourceKey, 1);
      this.publish({ state: "ended", playIntent: false, pauseReason: "ended" });
      // load serializes behind this consumed end. Awaiting it here would wait
      // on our own transition queue and deadlock.
      if (queued) void this.load(queued, { intent: "play", explicitPosition: 0, queue, sleepDeadlineMs: this.sleepDeadline }).catch(() => undefined);
    }
  }

  flush = async (transition = true): Promise<void> => {
    const snapshot = this.snapshot;
    if (!snapshot || !this.item) return;
    const checkpoint: AudioCheckpoint = {
      schemaVersion: 1, sourceKey: { ...snapshot.sourceKey }, ownerEpoch: this.ownerEpoch,
      checkpointSequence: ++this.sequence, sessionId: snapshot.metadata.sessionId,
      mediaRevision: snapshot.mediaRevision, partIndex: snapshot.partIndex,
      timeInPart: snapshot.timeInPart, positionSec: snapshot.globalPositionSec,
      durationSec: snapshot.durationSec, playbackRate: snapshot.playbackRate, updatedAt: this.now(),
    };
    await this.deps.persistence.enqueue(checkpoint, transition);
    if (transition && this.deps.persistence.getDirty().some(value => audioSourceId(value.sourceKey) === audioSourceId(checkpoint.sourceKey))) {
      const error = new Error("Audio progress is still unsaved. Retry before closing or switching sources.");
      this.publish({ error: { code: "persistence", message: error.message } });
      throw error;
    }
    const saved = this.deps.persistence.getAcknowledged(checkpoint.sourceKey);
    if (saved?.epoch === this.ownerEpoch && this.snapshot && audioSourceId(this.snapshot.sourceKey) === audioSourceId(checkpoint.sourceKey)) {
      this.publish({ checkpointSequence: saved.sequence });
    }
  };

  updateQueue = (queue: readonly AudioSourceKey[]): Promise<void> => this.enqueue(async () => {
    if (!this.snapshot) return;
    const validated = validateAudioQueue(queue, this.snapshot.sourceKey);
    this.publish({ queue: validated });
  });

  retireDeletedSource = (
    predicate: (key: AudioSourceKey, item: ResolvedAudioItem | null) => boolean,
  ): Promise<"active_retired" | "queue_pruned" | "unchanged"> => {
    if (!this.snapshot) return Promise.resolve("unchanged");
    const matchesActive = predicate(this.snapshot.sourceKey, this.item);
    const currentQueue = this.snapshot.queue ?? [];
    const nextQueue = currentQueue.filter(entry => !predicate(entry, null));
    const queuePruned = nextQueue.length !== currentQueue.length;
    if (!matchesActive && !queuePruned) return Promise.resolve("unchanged");

    if (!matchesActive) {
      return this.enqueue(async () => {
        if (!this.snapshot) return "unchanged";
        const filtered = (this.snapshot.queue ?? []).filter(entry => !predicate(entry, null));
        this.publish({ queue: filtered });
        return "queue_pruned";
      });
    }

    ++this.generation;
    ++this.intentRevision;
    this.clearNetworkRetry();
    this.ready = false;
    this.abort?.abort();
    this.clearFeedbackDuck(false);
    this.clearSleep();
    return this.enqueue(async (): Promise<"active_retired"> => {
      await this.pauseEngine().catch(() => undefined);
      await this.flush(false).catch(() => undefined);
      if (this.snapshot) {
        this.publish({ state: "paused", playIntent: false, pauseReason: "user", queue: nextQueue });
      }
      this.engine?.unload();
      this.item?.release?.();
      this.item = null;
      this.ready = false;
      this.snapshot = null;
      this.listeners.forEach(listener => listener());
      await this.deps.afterStop?.().catch(() => undefined);
      return "active_retired";
    });
  };

  stopAndClose = (): Promise<void> => {
    this.stopSilenceMonitor();
    ++this.generation;
    ++this.intentRevision;
    this.clearNetworkRetry();
    this.ready = false;
    this.abort?.abort();
    this.clearFeedbackDuck(false);
    this.clearSleep();
    return this.enqueue(async () => {
      try { await this.pauseEngine(); }
      catch (error) {
        this.publish({ state: "error", playIntent: false, error: { code: "focus_denied", message: String(error) } });
        throw error;
      }
      try { await this.flush(true); }
      catch (error) { this.publish({ state: "error", playIntent: false, pauseReason: "user" }); throw error; }
      this.engine?.unload();
      this.item?.release?.();
      this.item = null;
      this.ready = false;
      this.snapshot = null;
      this.listeners.forEach(listener => listener());
      await this.deps.afterStop?.();
    });
  };

  async command(request: AudioCommandRequest): Promise<AudioCommandResult> {
    if (request.schemaVersion !== 1 || request.sessionId !== this.snapshot?.metadata.sessionId || request.generation !== this.generation || (request.expectedRevision !== undefined && request.expectedRevision !== this.snapshot?.revision)) return { disposition: "stale", snapshot: this.snapshot };
    if (this.accepted.has(request.requestId)) return { disposition: "duplicate", snapshot: this.snapshot };
    const pending = this.requests.get(request.requestId);
    if (pending) { await pending; return { disposition: "duplicate", snapshot: this.snapshot }; }
    const result = this.execute(request);
    this.requests.set(request.requestId, result);
    try { return await result; } finally { this.requests.delete(request.requestId); }
  }

  private async execute(request: AudioCommandRequest): Promise<AudioCommandResult> {
    try {
      const action = request.action;
      switch (action.command) {
        case "play": await this.play(); break;
        case "pause": await this.pause(action.reason); break;
        case "toggle": await this.toggle(); break;
        case "stop": await this.stopAndClose(); break;
        case "seekTo": await this.seekTo(action.value); break;
        case "seekRelative": await this.seekRelative(action.value); break;
        case "selectChapter": await this.selectChapter(action.index); break;
        case "setRate": await this.setRate(action.value); break;
        case "setVolume": await this.setVolume(action.value); break;
        case "sleep": this.setSleepTimer(action.deadlineMs); break;
        case "next": await this.selectChapter((this.snapshot?.partIndex ?? 0) + 1); break;
        case "previous": await this.selectChapter((this.snapshot?.partIndex ?? 0) - 1); break;
        case "queueNext": await this.queueNext(); break;
        case "queuePrevious": await this.queuePrevious(); break;
      }
      this.accepted.add(request.requestId);
      if (this.accepted.size > 256) this.accepted.delete(this.accepted.values().next().value!);
      return { disposition: "accepted", snapshot: this.snapshot };
    } catch (error) { return { disposition: "failed", snapshot: this.snapshot, error: { code: "unsupported_command", message: String(error) } }; }
  }

  /** Real owner shutdown only. View cleanup must merely unsubscribe. */
  async dispose(): Promise<void> {
    await this.stopAndClose();
    this.stopSilenceMonitor();
    clearInterval(this.timer);
    this.timer = undefined;
    this.engine?.dispose();
    this.engine = null;
    this.accepted.clear();
  }
}
