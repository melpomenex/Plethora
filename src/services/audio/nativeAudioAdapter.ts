import type { AudioCheckpoint, AudioCommandRequest, AudioCommandResult, AudioPauseReason, AudioPlaybackCommand, AudioPlaybackSnapshot, AudioSourceKey, ResolvedAudioItem } from "../../types/audioEdition";
import type { AudioPlaybackOwner } from "./audioPlaybackOwner";
import { validateAudioQueue } from "./audioQueue";
import { CoalescingAudioWriter } from "./coalescingAudioWriter";
import { withAudioBoundaries } from "./audioCoordinates";
import type { DeferredStudyCapture } from "./deferredStudyCapture";

interface NativeAudioState {
  schemaVersion: 1;
  generationFloor?: number;
  activeProfileKey?: string | null;
  item?: ResolvedAudioItem | null;
  snapshot: AudioPlaybackSnapshot | null;
  importedCheckpoints?: AudioCheckpoint[];
  journal?: { captures?: DeferredStudyCapture[] } | null;
}
interface ClearObservation {
  schemaVersion: 1;
  ownerEpoch: string;
  ownerSequence: number;
  generation: number;
  revision: number;
  snapshot: null;
}
export interface NativeAudioDependencies {
  isAndroid: () => boolean;
  call: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
  observe: (listener: (value: unknown) => void) => () => void;
  observeResume?: (listener: () => void) => () => void;
  beforePlay: () => Promise<{ isCurrent: () => boolean }>;
  mirrorCheckpoint?: (checkpoint: AudioCheckpoint) => Promise<void>;
  studyConfiguration?: () => Record<string, unknown> | null;
  deferredCapture?: (capture: DeferredStudyCapture) => Promise<void>;
  onStorageError?: (error: unknown | null) => void;
  uuid?: () => string;
}

function snapshotObservation(value: unknown): value is AudioPlaybackSnapshot {
  if (!value || typeof value !== "object") return false;
  const sample = value as Partial<AudioPlaybackSnapshot>;
  return sample.schemaVersion === 1 && typeof sample.ownerEpoch === "string" && Number.isSafeInteger(sample.ownerSequence) &&
    Number.isSafeInteger(sample.generation) && Number.isSafeInteger(sample.revision) &&
    typeof sample.metadata?.sessionId === "string" && typeof sample.sourceKey?.profileKey === "string" &&
    Number.isFinite(sample.positionSec) && typeof sample.playIntent === "boolean";
}

/** No HTML/Audio constructor exists in this adapter. Native observations never replay transport. */
export class NativeAudioAdapter implements AudioPlaybackOwner {
  private snapshot: AudioPlaybackSnapshot | null = null;
  private item: ResolvedAudioItem | null = null;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private profile: string | null = null;
  private generation = 0;
  private operation = 0;
  private intent = 0;
  private suppressProjection = false;
  private cursor: { ownerEpoch: string; ownerSequence: number; generation: number; revision: number } | null = null;
  private attachment: { profile: string; promise: Promise<void> } | null = null;
  private processedCaptures = new Set<string>();
  private uuid: () => string;
  private clientId: string;
  private reconciler: CoalescingAudioWriter<{ profile: string; cursor: string }>;

  constructor(private deps: NativeAudioDependencies) {
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
    this.clientId = this.uuid();
    this.reconciler = new CoalescingAudioWriter({
      key: value => value.profile,
      fingerprint: value => value.cursor,
      commit: async value => { await this.reconcile(value.profile); },
      onError: error => this.deps.onStorageError?.(error),
      onSaved: () => this.deps.onStorageError?.(null),
    });
  }

  initialize(): void {
    if (!this.deps.isAndroid()) throw new Error("Native ordinary audio is Android-only");
    if (this.unsubscribe) return;
    const detachState = this.deps.observe(value => { this.accept(value); });
    const detachResume = this.deps.observeResume?.(() => { void this.refreshLive().catch(error => this.deps.onStorageError?.(error)); });
    this.unsubscribe = () => { detachState(); detachResume?.(); };
  }
  getSnapshot = (): AudioPlaybackSnapshot | null => this.suppressProjection ? null : this.snapshot;
  getIntentVersion = (): number => this.intent;
  getItem = (): ResolvedAudioItem | null => this.item;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private refreshing: Promise<void> | null = null;
  private refreshLive(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const profile = this.profile;
    if (!profile) return Promise.resolve();
    this.refreshing = this.attach(profile).then(async state => {
      if (profile !== this.profile) return;
      this.generation = Math.max(this.generation, state.generationFloor ?? 0);
      this.accept(state.snapshot ? { ...state.snapshot, item: state.item } : null);
      await this.reconcile(profile);
    }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private accept(value: unknown): void {
    const sample = snapshotObservation(value) ? value : null;
    const clear = value as Partial<ClearObservation> | null;
    if (!sample && !(clear?.schemaVersion === 1 && clear.snapshot === null && typeof clear.ownerEpoch === "string" && Number.isSafeInteger(clear.ownerSequence) && Number.isSafeInteger(clear.generation) && Number.isSafeInteger(clear.revision))) return;
    const next = (sample ?? clear) as AudioPlaybackSnapshot | ClearObservation;
    if (sample && sample.sourceKey.profileKey !== this.profile) return;
    const previous = this.cursor;
    if (previous) {
      if (next.ownerSequence! < previous.ownerSequence) return;
      if (next.ownerSequence === previous.ownerSequence && next.ownerEpoch !== previous.ownerEpoch) return;
      if (next.ownerSequence === previous.ownerSequence && (next.generation < previous.generation || (next.generation === previous.generation && next.revision <= previous.revision))) return;
    } else if (!sample) return;
    this.cursor = { ownerEpoch: next.ownerEpoch!, ownerSequence: next.ownerSequence!, generation: next.generation, revision: next.revision };
    this.generation = Math.max(this.generation, next.generation);
    if (sample) {
      const observed = sample as AudioPlaybackSnapshot & { item?: ResolvedAudioItem; appliedTransport?: unknown };
      if (observed.item) this.item = observed.item;
      else if (this.item && JSON.stringify(this.item.sourceKey) !== JSON.stringify(sample.sourceKey)) this.item = null;
      const { item: _item, appliedTransport: _appliedTransport, ...snapshot } = observed;
      this.snapshot = snapshot;
    } else { this.snapshot = null; this.item = null; }
    if (!this.suppressProjection) this.listeners.forEach(listener => listener());
    if (sample) {
      void this.reconciler.enqueue({ profile: sample.sourceKey.profileKey, cursor: JSON.stringify([sample.ownerEpoch, sample.checkpointSequence]) }, false).catch(error => this.deps.onStorageError?.(error));
    }
  }

  /** Subscribe first, then attach to the live owner. A live service is never loaded or re-seeked. */
  async reconnect(profile: string): Promise<void> {
    this.initialize();
    if (this.attachment?.profile === profile) return this.attachment.promise;
    if (this.profile && this.profile !== profile) throw new Error("Stop the previous audio profile before reconnecting");
    this.profile = profile;
    const promise = this.attach(profile).then(async state => {
      if (state.schemaVersion !== 1) throw new Error("Unsupported native audio state");
      this.generation = Math.max(this.generation, state.generationFloor ?? 0);
      this.item = state.item ?? null;
      this.accept(state.snapshot);
      try { await this.reconcile(profile); } catch (error) { this.deps.onStorageError?.(error); }
    }).catch(error => { this.attachment = null; throw error; });
    this.attachment = { profile, promise };
    return promise;
  }

  private async attach(profile: string): Promise<NativeAudioState> {
    const probe = await this.deps.call<NativeAudioState>("plugin:android-tts|get_audio_snapshot", { profileKey: profile });
    if (probe.activeProfileKey && probe.activeProfileKey !== profile) {
      // A recreated activity may be signed out while the previous account still owns the service.
      this.suppressProjection = true;
      try {
        this.profile = probe.activeProfileKey;
        const old = await this.deps.call<NativeAudioState>("plugin:android-tts|get_audio_snapshot", { profileKey: probe.activeProfileKey, observing: true, clientId: this.clientId });
        this.generation = Math.max(this.generation, old.generationFloor ?? 0);
        this.snapshot = old.snapshot;
        await this.stopNative();
        this.snapshot = null; this.cursor = null; this.profile = profile;
      } finally {
        if (this.profile !== profile) { this.snapshot = null; this.item = null; this.cursor = null; this.profile = null; }
        this.suppressProjection = false;
      }
    }
    return this.deps.call<NativeAudioState>("plugin:android-tts|get_audio_snapshot", { profileKey: profile, observing: true, clientId: this.clientId });
  }

  private async reconcile(profile: string): Promise<void> {
    const state = await this.deps.call<NativeAudioState>("reconcile_native_audio_journal", { profileKey: profile });
    if (state.schemaVersion !== 1) throw new Error("Unsupported native audio journal");
    if (this.profile === profile) this.accept(state.snapshot);
    for (const checkpoint of state.importedCheckpoints ?? []) await this.deps.mirrorCheckpoint?.(checkpoint);
    await this.consumeDeferredCaptures(profile, state.journal?.captures ?? []);
  }

  /**
   * Deferred Study Mode captures are executed with their journaled provenance
   * and acknowledged only after durable persistence. Failures keep the record
   * dirty; the native receipt also prevents a replay from executing twice.
   */
  private async consumeDeferredCaptures(profile: string, captures: readonly DeferredStudyCapture[]): Promise<void> {
    if (!this.deps.deferredCapture || !captures.length) return;
    const acknowledged: string[] = [];
    for (const capture of captures) {
      if (!capture?.eventId || !capture.studyAction) continue;
      if (this.processedCaptures.has(capture.eventId)) {
        acknowledged.push(capture.eventId);
        continue;
      }
      try {
        await this.deps.deferredCapture(capture);
        this.processedCaptures.add(capture.eventId);
        acknowledged.push(capture.eventId);
      } catch (error) {
        this.deps.onStorageError?.(error);
        break;
      }
    }
    if (acknowledged.length) {
      try {
        await this.deps.call("plugin:android-tts|reconcile_audio_checkpoint", {
          schemaVersion: 1,
          profileKey: profile,
          acknowledgedCaptures: acknowledged,
        });
      } catch (error) {
        this.deps.onStorageError?.(error);
      }
    }
    if (this.processedCaptures.size > 256) {
      this.processedCaptures = new Set([...this.processedCaptures].slice(-128));
    }
  }

  async load(key: AudioSourceKey, options: { intent: "play" | "paused"; explicitPosition?: number; queue?: readonly AudioSourceKey[] }): Promise<void> {
    const queue = options.queue === undefined ? undefined : validateAudioQueue(options.queue, key);
    const operation = ++this.operation;
    ++this.intent;
    if (this.profile && this.profile !== key.profileKey) {
      await this.stopNative();
      if (operation !== this.operation) return;
      this.profile = null; this.cursor = null; this.attachment = null;
    }
    await this.reconnect(key.profileKey);
    if (operation !== this.operation) return;
    if (this.snapshot && JSON.stringify(this.snapshot.sourceKey) === JSON.stringify(key) && options.explicitPosition === undefined && (queue === undefined || JSON.stringify(queue) === JSON.stringify(this.snapshot.queue ?? []))) {
      if (options.intent === "play") await this.play();
      return;
    }
    const generation = ++this.generation;
    const reserved = await this.deps.call<AudioCommandResult>("plugin:android-tts|audio_command", { profileKey: key.profileKey, clientId: this.clientId, request: null, takeoverGeneration: generation });
    this.accept(reserved.snapshot);
    if (reserved.disposition !== "accepted" || operation !== this.operation) return;
    await this.flush();
    const resolved = await this.deps.call<{ schemaVersion: 1; authorizationId: string; item?: ResolvedAudioItem }>("resolve_native_audio_source", { sourceKey: key, resumeHint: await this.editionResume(key), queueKeys: queue ?? [], studyConfig: this.deps.studyConfiguration?.() ?? null });
    if (operation !== this.operation) return;
    if (resolved.item) this.item = { ...resolved.item, parts: withAudioBoundaries(resolved.item.parts) };
    const result = await this.deps.call<AudioCommandResult>("plugin:android-tts|load_audio", { schemaVersion: 1, authorizationId: resolved.authorizationId, profileKey: key.profileKey, clientId: this.clientId, generation, intent: "paused", explicitPosition: options.explicitPosition ?? null });
    if (operation !== this.operation) return;
    this.accept(result.snapshot);
    if (result.disposition === "failed") throw new Error(result.error?.message || "Native audio load failed");
    if (result.disposition === "accepted" && options.intent === "play") await this.play();
  }

  private async editionResume(key: AudioSourceKey): Promise<{ partIndex: number; timeInPart: number } | null> {
    if (key.kind !== "audio_edition") return null;
    const [{ getAudioEdition }, { getAudioEditionPosition }] = await Promise.all([import("../../api/audioEditions"), import("../../utils/audioEditionPosition")]);
    const edition = await getAudioEdition(key.sourceId);
    const saved = edition ? await getAudioEditionPosition(edition.id, edition.sourceDocumentId) : null;
    return saved ? { partIndex: saved.partIndex, timeInPart: saved.timeInPart } : null;
  }

  private async action(action: AudioPlaybackCommand): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const result = await this.command({ schemaVersion: 1, requestId: this.uuid(), sessionId: snapshot.metadata.sessionId, generation: snapshot.generation, action });
    if (result.disposition === "failed") throw new Error(result.error?.message || "Native audio command failed");
  }
  play = async (): Promise<void> => {
    const intent = ++this.intent;
    const operation = this.operation;
    const lease = await this.deps.beforePlay();
    if (intent !== this.intent || operation !== this.operation || !lease.isCurrent()) return;
    await this.action({ command: "play" });
  };
  pause = async (reason: AudioPauseReason = "user"): Promise<void> => { ++this.intent; await this.action({ command: "pause", reason }); };
  pauseForFocus = (): Promise<void> => this.pause("focus");
  toggle = (): Promise<void> => this.snapshot?.playIntent ? this.pause() : this.play();
  seekTo = (value: number): Promise<void> => this.action({ command: "seekTo", value });
  seekRelative = (value: number): Promise<void> => this.action({ command: "seekRelative", value });
  selectChapter = (index: number): Promise<void> => this.action({ command: "selectChapter", index });
  queueNext = (): Promise<void> => this.action({ command: "queueNext" });
  queuePrevious = (): Promise<void> => this.action({ command: "queuePrevious" });
  setRate = (value: number): Promise<void> => this.action({ command: "setRate", value });
  setVolume = (value: number): Promise<void> => this.action({ command: "setVolume", value });
  setSleepTimer = (deadlineMs: number | null): Promise<void> => this.action({ command: "sleep", deadlineMs });
  refreshManifest = async (): Promise<void> => {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.sourceKey.kind !== "audio_edition") return;
    if (snapshot.state === "paused" && snapshot.pauseReason === "ended" && snapshot.error?.code === "source_missing") {
      await this.load(snapshot.sourceKey, { intent: "paused", explicitPosition: snapshot.globalPositionSec ?? snapshot.positionSec, queue: snapshot.queue });
    }
  };
  flush = async (): Promise<void> => { if (this.profile) await this.reconcile(this.profile); };
  updateQueue = async (queue: readonly AudioSourceKey[]): Promise<void> => {
    if (!this.snapshot) return;
    const validated = validateAudioQueue(queue, this.snapshot.sourceKey);
    this.snapshot = { ...this.snapshot, queue: validated, revision: this.snapshot.revision + 1, updatedAt: Date.now() };
    if (!this.suppressProjection) this.listeners.forEach(listener => listener());
  };
  retireDeletedSource = async (
    predicate: (key: AudioSourceKey, item: ResolvedAudioItem | null) => boolean,
  ): Promise<"active_retired" | "queue_pruned" | "unchanged"> => {
    if (!this.snapshot) return "unchanged";
    if (predicate(this.snapshot.sourceKey, this.item)) {
      await this.stopAndClose();
      return "active_retired";
    }
    const currentQueue = this.snapshot.queue ?? [];
    const nextQueue = currentQueue.filter(entry => !predicate(entry, null));
    if (nextQueue.length === currentQueue.length) return "unchanged";
    this.snapshot = { ...this.snapshot, queue: nextQueue, revision: this.snapshot.revision + 1, updatedAt: Date.now() };
    if (!this.suppressProjection) this.listeners.forEach(listener => listener());
    return "queue_pruned";
  };
  stopAndClose = async (): Promise<void> => {
    ++this.operation;
    ++this.intent;
    await this.stopNative();
    this.profile = null; this.attachment = null; this.cursor = null;
  };
  private async stopNative(): Promise<void> {
    const snapshot = this.snapshot;
    if (this.profile) {
      const result = await this.deps.call<AudioCommandResult>("plugin:android-tts|audio_command", { profileKey: this.profile, clientId: this.clientId, takeoverGeneration: ++this.generation, request: snapshot ? { schemaVersion: 1, requestId: this.uuid(), sessionId: snapshot.metadata.sessionId, generation: snapshot.generation, action: { command: "stop" } } : null });
      if (result.disposition === "failed") throw new Error(result.error?.message || "Native audio did not stop");
      if (result.disposition === "accepted") { this.snapshot = null; this.item = null; if (!this.suppressProjection) this.listeners.forEach(listener => listener()); }
      await this.flush();
    }
  }
  command = async (request: AudioCommandRequest): Promise<AudioCommandResult> => {
    if (!this.profile) return { disposition: "stale", snapshot: null };
    const result = await this.deps.call<AudioCommandResult>("plugin:android-tts|audio_command", { profileKey: this.profile, clientId: this.clientId, request });
    this.accept(result.snapshot);
    return result;
  };
  async dispose(): Promise<void> {
    // Closing the frontend observer never tears down an ongoing service-owned session.
    if (this.profile) await this.deps.call("plugin:android-tts|get_audio_snapshot", { profileKey: this.profile, observing: false, clientId: this.clientId });
    this.unsubscribe?.(); this.unsubscribe = null;
    this.listeners.clear();
  }
}
