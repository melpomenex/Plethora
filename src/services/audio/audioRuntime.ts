import * as tauriLib from "../../lib/tauri";
const { invokeCommand, isNativeAndroid } = tauriLib;
import { AudioPlaybackRepository, getAudioCheckpoint, getAudioSession, mirrorAudioEditionCheckpoint } from "../../api/audioPlayback";
import { useAudioPlaybackStore, bindAudioPlaybackProjection } from "../../stores/audioPlaybackStore";
import { AudioPlaybackPersistence } from "./audioPlaybackPersistence";
import { GlobalAudioController } from "./globalAudioController";
import { HtmlAudioEngine } from "./htmlAudioEngine";
import { describeAudioSource, resolveBrowserOrDesktopAudio, touchEditionWorkingSet } from "./audioSourceResolver";
import { globalAudioPosition } from "./audioCoordinates";
import { classifyAudioPlaybackError } from "./audioErrors";
import { CoalescingAudioWriter } from "./coalescingAudioWriter";
import { audioSourceId } from "./audioPlaybackPersistence";
import type { AudioCheckpoint, AudioSourceKey, ResolvedAudioItem, SavedAudioSession } from "../../types/audioEdition";
import { appAudioFocus } from "./audioFocus";
import { NativeAudioAdapter } from "./nativeAudioAdapter";
import type { AudioPlaybackOwner, DesktopAudioLifecycleEvent } from "./audioPlaybackOwner";
import { GLOBAL_AUDIO_PLAYBACK_ENABLED } from "./audioPlaybackRollout";
import { longFormPlaybackSessions } from "../../utils/longFormPlaybackSession";
import { registerAudioDeletionHook, type AudioDeletedSourcePredicate } from "./audioDeletionHook";
import { installListeningQueueProjection } from "./listeningQueueProjection";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  SESSION_INACTIVITY_CLOSE_MS,
  closeListeningSession,
  ensureListeningSession,
  getActiveSession,
  touchListeningSession,
} from "../../utils/listeningSessionService";

let singleton: AudioPlaybackOwner | null = null;
const repository = new AudioPlaybackRepository();
let startup: Promise<void> | null = null;
let sessionWriter: CoalescingAudioWriter<{ profile: string; session: SavedAudioSession }> | null = null;

async function flushSessionIntent(): Promise<void> {
  if (!sessionWriter) return;
  for (const value of sessionWriter.getDirty()) await sessionWriter.enqueue(value, true);
  if (sessionWriter.getDirty().length) throw new Error("Audio session is still unsaved. Retry before changing accounts.");
}

export function initializeAudioApplication(): Promise<void> {
  if (!GLOBAL_AUDIO_PLAYBACK_ENABLED) return Promise.resolve();
  if (startup) return startup;
  startup = (async () => {
    const { useAccountStore } = await import("../../stores/accountStore");
    const profile = useAccountStore.getState().user?.id;
    await restoreAudioProfilePaused(profile ? `account:${profile}` : "local");
  })().catch(error => { useAudioPlaybackStore.setState({ controlError: String(error) }); });
  return startup;
}

export function getGlobalAudioController(): AudioPlaybackOwner {
  if (singleton) return singleton;
  // Never silently run ordinary Android media through HTML while native acceptance is pending.
  if (isNativeAndroid()) {
    singleton = new NativeAudioAdapter({
      isAndroid: isNativeAndroid,
      call: invokeCommand,
      observe: listener => {
        const handler = (event: Event) => listener((event as CustomEvent).detail);
        window.addEventListener("media://playback-state", handler);
        return () => window.removeEventListener("media://playback-state", handler);
      },
      observeResume: listener => {
        const visible = () => { if (document.visibilityState === "visible") listener(); };
        document.addEventListener("visibilitychange", visible);
        window.addEventListener("focus", visible);
        return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
      },
      beforePlay: () => appAudioFocus.acquire("global-media", () => singleton!.pauseForFocus()),
      mirrorCheckpoint: mirrorAudioEditionCheckpoint,
      studyConfiguration: () => {
        const settings = useSettingsStore.getState().settings.handsFreeStudy;
        if (!settings?.enabled) return { schemaVersion: 1, enabled: false };
        return {
          schemaVersion: 1,
          enabled: true,
          captureWindowSec: settings.captureWindow === "smart" ? 30 : settings.captureWindow,
          mappings: {
            next: settings.mappings.next,
            previous: settings.mappings.previous,
            seekForward: settings.mappings.seekForward,
            seekBackward: settings.mappings.seekBackward,
          },
        };
      },
      deferredCapture: capture =>
        import("./deferredStudyCapture").then(module => module.executeDeferredStudyCapture(capture)),
      onStorageError: error => useAudioPlaybackStore.setState({ storageError: error ? String(error) : null }),
    });
    bindAudioPlaybackProjection(singleton);
    bindOwnerCompatibilitySession(singleton);
    bindDeletionRetirement(singleton);
    observeAudioEditionUpdates(singleton);
    registerRuntimeCleanup(singleton, installListeningQueueProjection(singleton));
    observeListeningSessionLifecycle(singleton);
    observePodcastNaturalEnd(singleton);
    return singleton;
  }
  const htmlOwner = new GlobalAudioController({
    afterStop: flushSessionIntent,
    createEngine: () => new HtmlAudioEngine(),
    beforePlay: () => appAudioFocus.acquire("global-media", () => singleton!.pauseForFocus()),
    beforeLoadPart: touchEditionWorkingSet,
    resolve: async (key, signal) => {
      const item = await resolveBrowserOrDesktopAudio(key, signal);
      try {
        const saved = await getAudioCheckpoint(key);
        return reconcileResolvedItemWithCheckpoint(item, saved);
      } catch (error) {
        useAudioPlaybackStore.setState({ storageError: `Saved audio progress is unavailable: ${String(error)}` });
        return reconcileResolvedItemWithCheckpoint(item, null);
      }
    },
    persistence: new AudioPlaybackPersistence({
      commit: repository.commit,
      onError: error => {
        const message = error instanceof Error ? error.message : String(error);
        useAudioPlaybackStore.setState({ checkpointError: message, storageError: message });
      },
      onSaved: () => useAudioPlaybackStore.setState(state => ({ checkpointError: null, storageError: state.sessionError })),
    }),
  });
  singleton = htmlOwner;
  bindAudioPlaybackProjection(htmlOwner);
  bindOwnerCompatibilitySession(htmlOwner);
  bindDeletionRetirement(htmlOwner);
  persistSessionTransitions(htmlOwner);
  observeAudioEditionUpdates(htmlOwner);
  registerRuntimeCleanup(htmlOwner, installListeningQueueProjection(htmlOwner));
  observeListeningSessionLifecycle(htmlOwner);
  observePodcastNaturalEnd(htmlOwner);
  observeDesktopLifecycleEvents(htmlOwner);
  return singleton;
}

export async function retireAudioForDeletedSource(
  predicate: AudioDeletedSourcePredicate,
): Promise<"active_retired" | "queue_pruned" | "unchanged"> {
  if (!singleton?.retireDeletedSource) return "unchanged";
  const outcome = await singleton.retireDeletedSource(predicate);
  if (outcome === "active_retired") {
    useAudioPlaybackStore.setState({ controlError: "Audio removed" });
    try {
      const { useToastStore, ToastType } = await import("../../components/common/Toast");
      useToastStore.getState()?.addToast?.({ type: ToastType.Info, title: "Audio removed", duration: 4000 });
    } catch {
      /* toast optional in headless test environments */
    }
  } else if (outcome === "queue_pruned") {
    useAudioPlaybackStore.setState({ controlError: "Audio removed" });
  }
  return outcome;
}

function bindDeletionRetirement(owner: AudioPlaybackOwner): void {
  registerAudioDeletionHook(predicate => retireAudioForDeletedSource(predicate));
  registerRuntimeCleanup(owner, () => {
    registerAudioDeletionHook(null);
  });
}

function bindOwnerCompatibilitySession(owner: AudioPlaybackOwner): void {
  longFormPlaybackSessions.setOwnerSessionProvider(() => {
    const snap = owner.getSnapshot();
    if (!snap) return null;
    return {
      sessionId: snap.metadata.sessionId,
      sourceId: snap.sourceKey.sourceId,
      sourceKind: snap.sourceKey.kind,
      getSnapshot: () => owner.getSnapshot() ?? snap,
      play: () => owner.play(),
      pause: () => owner.pause("user"),
      toggle: () => owner.toggle(),
      next: () => owner.selectChapter((owner.getSnapshot()?.partIndex ?? 0) + 1),
      previous: () => owner.selectChapter(Math.max(0, (owner.getSnapshot()?.partIndex ?? 0) - 1)),
      seekRelative: (deltaSec: number) => owner.seekRelative(deltaSec),
      seekTo: (positionSec: number) => owner.seekTo(positionSec),
    };
  });
  const unsub = owner.subscribe(() => {
    longFormPlaybackSessions.notifyOwnerChanged();
  });
  registerRuntimeCleanup(owner, () => {
    unsub();
    longFormPlaybackSessions.setOwnerSessionProvider(null);
  });
}

let detachRuntimeObservers: (() => void) | null = null;
const attachedOwners = new WeakSet<AudioPlaybackOwner>();

function registerRuntimeCleanup(owner: AudioPlaybackOwner, cleanup: () => void): void {
  const prev = detachRuntimeObservers;
  detachRuntimeObservers = () => {
    prev?.();
    cleanup();
  };
  void owner;
}

function observeListeningSessionLifecycle(owner: AudioPlaybackOwner): void {
  if (attachedOwners.has(owner)) return;
  attachedOwners.add(owner);
  let activeEditionId: string | null = null;
  let activeSessionId: string | undefined;
  let touchTimer: ReturnType<typeof setInterval> | null = null;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  let pausedAt: number | null = null;
  let ensuringFor: string | null = null;

  const clearTimers = () => {
    if (touchTimer) { clearInterval(touchTimer); touchTimer = null; }
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  };

  const unsubscribe = owner.subscribe(() => {
    const snapshot = owner.getSnapshot();
    const item = owner.getItem();
    const nextEditionId = snapshot
      ? (item?.editionId ?? (snapshot.sourceKey.kind === "audio_edition" ? snapshot.sourceKey.sourceId : null))
      : null;

    if (activeEditionId && activeEditionId !== nextEditionId) {
      clearTimers();
      pausedAt = null;
      const closing = activeEditionId;
      activeEditionId = null;
      activeSessionId = undefined;
      ensuringFor = null;
      void closeListeningSession(closing);
    }

    activeEditionId = nextEditionId;
    if (!nextEditionId || !snapshot) {
      clearTimers();
      pausedAt = null;
      return;
    }

    const isActivelyPlaying = snapshot.playIntent && snapshot.state === "playing";
    if (isActivelyPlaying) {
      pausedAt = null;
      if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
      const existing = getActiveSession(nextEditionId);
      if (existing) {
        activeSessionId = existing.id;
        touchListeningSession(nextEditionId, activeSessionId);
      } else if (ensuringFor !== nextEditionId) {
        ensuringFor = nextEditionId;
        void ensureListeningSession(nextEditionId).then(created => {
          if (ensuringFor === nextEditionId) ensuringFor = null;
          if (activeEditionId === nextEditionId && created) {
            activeSessionId = created.id;
            touchListeningSession(nextEditionId, created.id);
          }
        });
      }
      if (!touchTimer) {
        touchTimer = setInterval(() => {
          if (activeEditionId) touchListeningSession(activeEditionId, activeSessionId);
        }, 30_000);
      }
    } else {
      if (touchTimer) { clearInterval(touchTimer); touchTimer = null; }
      if (pausedAt === null) {
        pausedAt = Date.now();
        if (inactivityTimer) clearTimeout(inactivityTimer);
        const targetEdition = nextEditionId;
        inactivityTimer = setTimeout(() => {
          if (activeEditionId === targetEdition && pausedAt !== null && Date.now() - pausedAt >= SESSION_INACTIVITY_CLOSE_MS) {
            void closeListeningSession(targetEdition);
            activeSessionId = undefined;
          }
        }, SESSION_INACTIVITY_CLOSE_MS + 500);
      }
    }
  });

  registerRuntimeCleanup(owner, () => {
    unsubscribe();
    clearTimers();
    if (activeEditionId) {
      void closeListeningSession(activeEditionId);
      activeEditionId = null;
    }
  });
}

function observePodcastNaturalEnd(owner: AudioPlaybackOwner): void {
  let lastMarkedSessionId: string | null = null;
  const unsubscribe = owner.subscribe(() => {
    const snapshot = owner.getSnapshot();
    if (!snapshot || snapshot.sourceKey.kind !== "podcast" || snapshot.state !== "ended") return;
    if (lastMarkedSessionId === snapshot.metadata.sessionId) return;
    lastMarkedSessionId = snapshot.metadata.sessionId;
    void import("../../api/podcast")
      .then(api => api.markEpisodePlayed(snapshot.sourceKey.sourceId, true))
      .catch(() => undefined);
  });
  registerRuntimeCleanup(owner, unsubscribe);
}

function observeDesktopLifecycleEvents(owner: AudioPlaybackOwner): void {
  const inDesktopTauri =
    typeof window !== "undefined" &&
    "isTauri" in tauriLib &&
    typeof tauriLib.isTauri === "function" &&
    tauriLib.isTauri() &&
    !("isNativeMobile" in tauriLib && typeof tauriLib.isNativeMobile === "function" && tauriLib.isNativeMobile()) &&
    "listen" in tauriLib &&
    typeof tauriLib.listen === "function";
  if (!inDesktopTauri) return;
  const seenEventIds = new Set<string>();
  let unlistenFn: (() => void) | null = null;
  let disposed = false;

  void Promise.resolve(
    tauriLib.listen<DesktopAudioLifecycleEvent>("audio-lifecycle", event => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object") return;
      if (payload.eventId) {
        if (seenEventIds.has(payload.eventId)) return;
        seenEventIds.add(payload.eventId);
        if (seenEventIds.size > 128) {
          seenEventIds.delete(seenEventIds.values().next().value!);
        }
      }
      void owner.handleLifecycleEvent?.(payload)?.catch(() => undefined);
    }),
  )
    .then(unlisten => {
      if (typeof unlisten !== "function") return;
      if (disposed) unlisten();
      else unlistenFn = unlisten;
    })
    .catch(() => undefined);

  registerRuntimeCleanup(owner, () => {
    disposed = true;
    unlistenFn?.();
    unlistenFn = null;
  });
}

function observeAudioEditionUpdates(owner: AudioPlaybackOwner): void {
  let subscribedGenerationStore = false;
  owner.subscribe(() => {
    if (subscribedGenerationStore || owner.getSnapshot()?.sourceKey.kind !== "audio_edition") return;
    subscribedGenerationStore = true;
    void import("../../stores/audioEditionGenerationStore").then(({ useAudioEditionGenerationStore }) => {
      useAudioEditionGenerationStore.subscribe((state, prevState) => {
        const active = owner.getSnapshot();
        if (active?.sourceKey.kind !== "audio_edition") return;
        const editionId = active.sourceKey.sourceId;
        const job = state.jobs[editionId];
        const prev = prevState.jobs[editionId];
        if (!job) return;
        if (job.completedSections !== prev?.completedSections || job.status !== prev?.status) {
          void owner.refreshManifest?.();
        }
      });
    }).catch(() => {
      subscribedGenerationStore = false;
    });
  });
}

function persistSessionTransitions(controller: GlobalAudioController): void {
  let lastProfile: string | null = null;
  let lastQueue: SavedAudioSession["queue"] = [];
  let previous = "";
  const writer = new CoalescingAudioWriter<{ profile: string; session: SavedAudioSession }>({
    key: value => value.profile,
    fingerprint: value => JSON.stringify([value.session.current, value.session.queue, value.session.playbackRate, value.session.volume, value.session.sleepDeadlineMs]),
    commit: value => repository.saveSession(value.profile, controller.getOwnerEpoch(), value.session),
    onError: error => useAudioPlaybackStore.setState({ sessionError: String(error), storageError: String(error) }),
    onSaved: () => useAudioPlaybackStore.setState(state => ({ sessionError: null, storageError: state.checkpointError })),
  });
  sessionWriter = writer;
  controller.subscribe(() => {
    const snapshot = controller.getSnapshot();
    const profile = snapshot?.sourceKey.profileKey ?? lastProfile;
    if (!profile) return;
    lastProfile = profile;
    if (snapshot) lastQueue = [...(snapshot.queue ?? [])];
    const signature = JSON.stringify([snapshot?.sourceKey, snapshot?.queue, snapshot?.playbackRate, snapshot?.volume, snapshot?.sleepDeadlineMs]);
    if (signature === previous) return;
    previous = signature;
    void writer.enqueue({ profile, session: { schemaVersion: 1, current: snapshot?.sourceKey ?? null, queue: lastQueue, playbackRate: snapshot?.playbackRate ?? 1, volume: snapshot?.volume ?? 1, sleepDeadlineMs: snapshot?.sleepDeadlineMs ?? null, updatedAt: Date.now() } }, true)
      .catch(error => useAudioPlaybackStore.setState({ storageError: String(error) }));
  });
}

export function reconcileResolvedItemWithCheckpoint(
  item: ResolvedAudioItem,
  saved: AudioCheckpoint | null,
): ResolvedAudioItem {
  if (!item.parts.length) return item;
  let resume = item.resume;
  if (resume) {
    const clampedIndex = Number.isInteger(resume.partIndex)
      ? Math.min(Math.max(0, resume.partIndex), item.parts.length - 1)
      : 0;
    const maxSec = item.parts[clampedIndex].durationSec ?? Infinity;
    const clampedTime = Number.isFinite(resume.timeInPart) && resume.timeInPart >= 0
      ? Math.min(resume.timeInPart, maxSec)
      : 0;
    resume = { partIndex: clampedIndex, timeInPart: clampedTime };
  }

  if (
    saved &&
    saved.mediaRevision === item.mediaRevision &&
    Number.isInteger(saved.partIndex) &&
    saved.partIndex >= 0 &&
    saved.partIndex < item.parts.length &&
    Number.isFinite(saved.timeInPart) &&
    saved.timeInPart >= 0
  ) {
    const maxSavedSec = item.parts[saved.partIndex].durationSec ?? Infinity;
    const clampedSavedTime = Math.min(saved.timeInPart, maxSavedSec);
    const kind = item.sourceKey.kind;
    if (kind === "recording") {
      resume = { partIndex: saved.partIndex, timeInPart: clampedSavedTime };
    } else if (kind === "audio_edition") {
      if (!resume || (saved.partIndex === resume.partIndex && Math.abs(clampedSavedTime - resume.timeInPart) < 1)) {
        resume = { partIndex: saved.partIndex, timeInPart: clampedSavedTime };
      }
    } else {
      const legacyGlobal = resume ? globalAudioPosition(item.parts, resume.partIndex, resume.timeInPart) : 0;
      if (legacyGlobal !== null && saved.positionSec !== null && Math.abs(legacyGlobal - saved.positionSec) < 1) {
        resume = { partIndex: saved.partIndex, timeInPart: clampedSavedTime };
      }
    }
  }

  return { ...item, resume };
}

async function isAudioSourceAvailable(key: AudioSourceKey): Promise<boolean> {
  try {
    const description = await describeAudioSource(key);
    return description.parts.length > 0;
  } catch {
    return false;
  }
}

/** Cold recovery always loads paused; a live native service reconciles first and wins over UI storage. */
export async function restoreAudioProfilePaused(
  profileKey: string,
  options: { checkSourceAvailable?: (key: AudioSourceKey) => Promise<boolean> } = {},
): Promise<void> {
  const checkAvailable = options.checkSourceAvailable ?? isAudioSourceAvailable;
  const controller = getGlobalAudioController();
  const version = controller.getIntentVersion();
  if (controller instanceof NativeAudioAdapter) {
    await controller.reconnect(profileKey);
    if (controller.getSnapshot()) return;
  }
  const record = await getAudioSession(profileKey);
  if (record?.invalidSession) {
    useAudioPlaybackStore.setState({ storageError: "Saved audio session is invalid. Open its source to resume." });
    return;
  }
  const saved = record?.session;
  if (!saved || controller.getSnapshot() || controller.getIntentVersion() !== version) return;

  const rate = Number.isFinite(saved.playbackRate) ? Math.min(3, Math.max(0.5, saved.playbackRate)) : 1;
  const volume = Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 1;
  const seen = new Set<string>();
  const validQueue: AudioSourceKey[] = [];
  let prunedQueueCount = 0;

  for (const entry of saved.queue ?? []) {
    if (entry.profileKey !== profileKey) {
      prunedQueueCount += 1;
      continue;
    }
    const id = audioSourceId(entry);
    if (seen.has(id)) continue;
    seen.add(id);
    if (await checkAvailable(entry)) {
      validQueue.push(entry);
    } else {
      prunedQueueCount += 1;
    }
  }

  const persistPrunedSession = async (current: AudioSourceKey | null, queue: AudioSourceKey[]) => {
    const epoch = "getOwnerEpoch" in controller && typeof controller.getOwnerEpoch === "function"
      ? controller.getOwnerEpoch()
      : crypto.randomUUID();
    await repository.saveSession(profileKey, epoch, {
      schemaVersion: 1,
      current,
      queue,
      playbackRate: rate,
      volume,
      sleepDeadlineMs: null,
      updatedAt: Date.now(),
    }).catch(() => undefined);
  };

  if (!saved.current) {
    if (prunedQueueCount > 0) {
      await persistPrunedSession(null, validQueue);
      useAudioPlaybackStore.setState({ controlError: "Removed unavailable item(s) from your saved audio queue." });
    }
    return;
  }

  const currentAvailable =
    saved.current.profileKey === profileKey &&
    (validQueue.some(item => audioSourceId(item) === audioSourceId(saved.current!)) || await checkAvailable(saved.current));

  if (!currentAvailable) {
    const remainingQueue = validQueue.filter(item => audioSourceId(item) !== audioSourceId(saved.current!));
    await persistPrunedSession(null, remainingQueue);
    useAudioPlaybackStore.setState({
      controlError: "Saved audio source is no longer available and was removed from your session.",
    });
    return;
  }

  if (controller.getSnapshot() || controller.getIntentVersion() !== version) return;

  const queueForLoad = saved.queue?.length
    ? (validQueue.some(item => audioSourceId(item) === audioSourceId(saved.current!)) ? validQueue : [saved.current, ...validQueue])
    : [];

  try {
    await controller.load(saved.current, { intent: "paused", queue: queueForLoad });
  } catch (error) {
    const classified = classifyAudioPlaybackError(error);
    if (classified.code === "source_missing") {
      await controller.stopAndClose().catch(() => undefined);
      const remainingQueue = validQueue.filter(item => audioSourceId(item) !== audioSourceId(saved.current!));
      await persistPrunedSession(null, remainingQueue);
      useAudioPlaybackStore.setState({
        controlError: "Saved audio source is no longer available and was removed from your session.",
      });
      return;
    }
    throw error;
  }

  await controller.setRate(rate);
  await controller.setVolume(volume);
  if (prunedQueueCount > 0) {
    useAudioPlaybackStore.setState({ controlError: "Removed unavailable item(s) from your saved audio queue." });
  }
}

export async function resetAudioRuntimeForTests(overrideOwner?: AudioPlaybackOwner | null): Promise<void> {
  detachRuntimeObservers?.();
  detachRuntimeObservers = null;
  if (singleton) {
    await singleton.dispose().catch(() => undefined);
  }
  singleton = overrideOwner ?? null;
  startup = null;
  sessionWriter = null;
  if (singleton) {
    bindAudioPlaybackProjection(singleton);
    bindOwnerCompatibilitySession(singleton);
    bindDeletionRetirement(singleton);
    observeListeningSessionLifecycle(singleton);
    observePodcastNaturalEnd(singleton);
    observeDesktopLifecycleEvents(singleton);
  } else {
    registerAudioDeletionHook(null);
    longFormPlaybackSessions.setOwnerSessionProvider(null);
    useAudioPlaybackStore.setState({
      snapshot: null,
      expanded: false,
      storageError: null,
      checkpointError: null,
      sessionError: null,
      controlError: null,
      adapterError: null,
    });
  }
}
