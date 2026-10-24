import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioCheckpoint, AudioSourceKey, ResolvedAudioItem, SavedAudioSession } from "../../../types/audioEdition";
import { withAudioBoundaries } from "../audioCoordinates";
import { GlobalAudioController } from "../globalAudioController";
import { AudioPlaybackPersistence } from "../audioPlaybackPersistence";
import type { AudioEngine } from "../htmlAudioEngine";
import { NativeAudioAdapter } from "../nativeAudioAdapter";
import { useAudioPlaybackStore } from "../../../stores/audioPlaybackStore";

const mocks = vi.hoisted(() => ({
  rolloutEnabled: true,
  sessions: new Map<string, { ownerEpoch: string; session: SavedAudioSession | null; invalidSession?: boolean }>(),
  checkpoints: new Map<string, AudioCheckpoint>(),
  savedSessions: [] as { profileKey: string; session: SavedAudioSession }[],
}));

vi.mock("../audioPlaybackRollout", () => ({
  get GLOBAL_AUDIO_PLAYBACK_ENABLED() {
    return mocks.rolloutEnabled;
  },
}));

vi.mock("../../../api/audioPlayback", () => ({
  getAudioSession: vi.fn(async (profileKey: string) => mocks.sessions.get(profileKey) ?? null),
  getAudioCheckpoint: vi.fn(async (sourceKey: AudioSourceKey) => mocks.checkpoints.get(JSON.stringify(sourceKey)) ?? null),
  mirrorAudioEditionCheckpoint: vi.fn(async () => undefined),
  AudioPlaybackRepository: class {
    commit = vi.fn(async () => undefined);
    saveSession = vi.fn(async (profileKey: string, _ownerEpoch: string, session: SavedAudioSession) => {
      mocks.savedSessions.push({ profileKey, session });
      mocks.sessions.set(profileKey, { ownerEpoch: "epoch-saved", session });
    });
  },
}));

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn(async (id: string) => ({
    id,
    title: `Doc-${id}`,
    fileType: "audio",
    filePath: `/managed/${id}.mp3`,
    contentHash: "rev-1",
  })),
  getDocuments: vi.fn(async () => []),
}));
vi.mock("../../../api/position", () => ({
  getDocumentPosition: vi.fn(async () => null),
}));
vi.mock("../../../api/audioEditions", () => ({
  getAudioEditionByDocument: vi.fn(async () => null),
  getAudioEditionSections: vi.fn(async () => []),
}));

import {
  reconcileResolvedItemWithCheckpoint,
  resetAudioRuntimeForTests,
  restoreAudioProfilePaused,
} from "../audioRuntime";
import { completeAudioAccountChange, prepareAudioAccountChange } from "../audioAccountBoundary";

function makeKey(sourceId: string, profileKey = "local", kind: AudioSourceKey["kind"] = "audiobook"): AudioSourceKey {
  return { profileKey, kind, sourceId };
}

function makeEngine() {
  const sample = { timeInPart: 0, durationSec: 120, paused: true, seekable: true };
  const engine: AudioEngine = {
    sample: () => ({ ...sample }),
    load: vi.fn(async () => { sample.timeInPart = 0; }),
    play: vi.fn(async () => { sample.paused = false; }),
    pause: vi.fn(async () => { sample.paused = true; }),
    seek: vi.fn(sec => { sample.timeInPart = sec; }),
    setRate: vi.fn(),
    setVolume: vi.fn(),
    unload: vi.fn(),
    dispose: vi.fn(),
  };
  return { engine, sample };
}

beforeEach(async () => {
  mocks.rolloutEnabled = true;
  mocks.sessions.clear();
  mocks.checkpoints.clear();
  mocks.savedSessions.length = 0;
  await resetAudioRuntimeForTests(null);
});

afterEach(async () => {
  await resetAudioRuntimeForTests(null);
});

describe("Task 3.5 — versioned restore, legacy read-through, live reconciliation, and profile boundaries", () => {
  it("restores saved identity, pruned queue, rate, and volume paused without cold autoplay", async () => {
    const { engine } = makeEngine();
    const available = new Set(["book-1", "book-3"]);
    const controller = new GlobalAudioController({
      createEngine: () => engine,
      resolve: async key => ({
        sourceKey: key,
        title: `Title ${key.sourceId}`,
        documentId: key.sourceId,
        mediaRevision: "rev-1",
        complete: true,
        resume: { partIndex: 0, timeInPart: 42 },
        parts: withAudioBoundaries([{ partId: "p0", sourceRevision: "rev-1", browserUrl: `/stream/${key.sourceId}.mp3`, durationSec: 120 }]),
      }),
      persistence: new AudioPlaybackPersistence({ commit: async () => undefined }),
    });
    await resetAudioRuntimeForTests(controller);

    mocks.sessions.set("local", {
      ownerEpoch: "prev-epoch",
      session: {
        schemaVersion: 1,
        current: makeKey("book-1"),
        queue: [makeKey("book-1"), makeKey("book-deleted"), makeKey("book-3")],
        playbackRate: 1.5,
        volume: 0.7,
        sleepDeadlineMs: null,
        updatedAt: 1000,
      },
    });

    await restoreAudioProfilePaused("local", {
      checkSourceAvailable: async key => available.has(key.sourceId),
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot).toMatchObject({
      sourceKey: makeKey("book-1"),
      state: "paused",
      playIntent: false,
      positionSec: 42,
      playbackRate: 1.5,
      volume: 0.7,
      queue: [makeKey("book-1"), makeKey("book-3")],
    });
    expect(engine.play).not.toHaveBeenCalled();
    expect(useAudioPlaybackStore.getState().controlError).toContain("Removed unavailable");
  });

  it("prunes a deleted current source with an explanation and never auto-plays the next queued item", async () => {
    const { engine } = makeEngine();
    const controller = new GlobalAudioController({
      createEngine: () => engine,
      resolve: async key => ({
        sourceKey: key,
        title: key.sourceId,
        mediaRevision: "rev-1",
        complete: true,
        parts: withAudioBoundaries([{ partId: "p0", sourceRevision: "rev-1", browserUrl: "/stream.mp3", durationSec: 60 }]),
      }),
      persistence: new AudioPlaybackPersistence({ commit: async () => undefined }),
    });
    await resetAudioRuntimeForTests(controller);

    mocks.sessions.set("local", {
      ownerEpoch: "prev-epoch",
      session: {
        schemaVersion: 1,
        current: makeKey("deleted-current"),
        queue: [makeKey("deleted-current"), makeKey("surviving-next")],
        playbackRate: 1.25,
        volume: 1,
        sleepDeadlineMs: null,
        updatedAt: 1000,
      },
    });

    await restoreAudioProfilePaused("local", {
      checkSourceAvailable: async key => key.sourceId === "surviving-next",
    });

    expect(controller.getSnapshot()).toBeNull();
    expect(engine.load).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    expect(useAudioPlaybackStore.getState().controlError).toContain("no longer available");
    expect(mocks.savedSessions.at(-1)).toMatchObject({
      profileKey: "local",
      session: {
        current: null,
        queue: [makeKey("surviving-next")],
      },
    });
  });

  it("prefers a live native service over stale UI session rows without loading or re-seeking", async () => {
    const call = vi.fn(async (name: string) => {
      if (name === "plugin:android-tts|get_audio_snapshot") {
        return {
          schemaVersion: 1 as const,
          generationFloor: 3,
          activeProfileKey: "local",
          snapshot: {
            schemaVersion: 1 as const,
            ownerEpoch: "native-epoch",
            ownerSequence: 5,
            sourceKey: makeKey("live-podcast", "local", "podcast"),
            generation: 3,
            revision: 9,
            metadata: { sourceId: "live-podcast", sourceKind: "podcast" as const, sessionId: "sess-live", title: "Live Podcast" },
            state: "playing" as const,
            playIntent: true,
            pauseReason: null,
            positionSec: 88,
            globalPositionSec: 88,
            timeInPart: 88,
            partIndex: 0,
            durationSec: 300,
            sleepDeadlineMs: null,
            playbackRate: 1.25,
            volume: 1,
            mediaRevision: "guid-live",
            checkpointSequence: 4,
            capabilities: {
              canPlay: true,
              canPause: true,
              canResume: true,
              canSeekRelative: true,
              canSeekAbsolute: true,
              precisePosition: true,
              canNext: false,
              canPrevious: false,
            },
            updatedAt: 2000,
          },
        };
      }
      if (name === "reconcile_native_audio_journal") {
        return { schemaVersion: 1 as const, snapshot: null, importedCheckpoints: [] };
      }
      throw new Error(`Unexpected native command: ${name}`);
    });

    const nativeAdapter = new NativeAudioAdapter({
      isAndroid: () => true,
      call: call as never,
      observe: () => () => undefined,
      beforePlay: async () => ({ isCurrent: () => true }),
    });
    await resetAudioRuntimeForTests(nativeAdapter);

    // Even if SQLite session row points to a different item, live service wins without load_audio
    mocks.sessions.set("local", {
      ownerEpoch: "old",
      session: {
        schemaVersion: 1,
        current: makeKey("stale-book"),
        queue: [],
        playbackRate: 1,
        volume: 1,
        sleepDeadlineMs: null,
        updatedAt: 500,
      },
    });

    await restoreAudioProfilePaused("local");

    expect(nativeAdapter.getSnapshot()).toMatchObject({
      sourceKey: makeKey("live-podcast", "local", "podcast"),
      state: "playing",
      positionSec: 88,
    });
    expect(call).not.toHaveBeenCalledWith("plugin:android-tts|load_audio", expect.anything());
  });

  it("handles mediaRevision mismatch, clamps out-of-range coordinates, respects synced rewinds without Math.max, and ignores remote updates while active", async () => {
    const parts = withAudioBoundaries([
      { partId: "p0", sourceRevision: "r0", browserUrl: "/0.mp3", durationSec: 60 },
      { partId: "p1", sourceRevision: "r1", browserUrl: "/1.mp3", durationSec: 60 },
    ]);
    const baseItem: ResolvedAudioItem = {
      sourceKey: makeKey("book-sync"),
      title: "Synced Book",
      documentId: "book-sync",
      mediaRevision: "hash-v2",
      complete: true,
      parts,
      resume: { partIndex: 0, timeInPart: 22 }, // Legacy position rewound via remote sync to 22s!
    };

    // 1. Stale local checkpoint at 95s must NOT overwrite a newer synced rewind at 22s (no Math.max!)
    const staleAheadCheckpoint: AudioCheckpoint = {
      schemaVersion: 1,
      sourceKey: makeKey("book-sync"),
      ownerEpoch: "e1",
      checkpointSequence: 5,
      sessionId: "s1",
      mediaRevision: "hash-v2",
      partIndex: 1,
      timeInPart: 35,
      positionSec: 95,
      durationSec: 120,
      playbackRate: 1,
      updatedAt: 1000,
    };
    expect(reconcileResolvedItemWithCheckpoint(baseItem, staleAheadCheckpoint).resume).toEqual({
      partIndex: 0,
      timeInPart: 22,
    });

    // 2. Matching checkpoint supplies exact multipart boundary coordinates & clamps timeInPart
    const matchingCheckpoint: AudioCheckpoint = {
      ...staleAheadCheckpoint,
      partIndex: 0,
      timeInPart: 22.4,
      positionSec: 22.4,
    };
    expect(reconcileResolvedItemWithCheckpoint(baseItem, matchingCheckpoint).resume).toEqual({
      partIndex: 0,
      timeInPart: 22.4,
    });

    // 3. mediaRevision mismatch falls back to legacy position instead of resetting or applying stale partIndex
    const mismatchedRevision: AudioCheckpoint = {
      ...matchingCheckpoint,
      mediaRevision: "hash-v1-old",
      partIndex: 1,
      timeInPart: 50,
    };
    expect(reconcileResolvedItemWithCheckpoint(baseItem, mismatchedRevision).resume).toEqual({
      partIndex: 0,
      timeInPart: 22,
    });

    // 4. Active loaded session ignores remote document sync position changes until closed and reopened
    let remoteLegacySec = 80;
    const { engine } = makeEngine();
    const controller = new GlobalAudioController({
      createEngine: () => engine,
      resolve: async key => ({
        sourceKey: key,
        title: "Book",
        mediaRevision: "rev-1",
        complete: true,
        parts,
        resume: remoteLegacySec >= 60
          ? { partIndex: 1, timeInPart: remoteLegacySec - 60 }
          : { partIndex: 0, timeInPart: remoteLegacySec },
      }),
      persistence: new AudioPlaybackPersistence({ commit: async () => undefined }),
    });
    await controller.load(makeKey("book-sync"), { intent: "paused" });
    expect(controller.getSnapshot()?.positionSec).toBe(80);
    const seeksWhileLoaded = vi.mocked(engine.seek).mock.calls.length;

    // Remote sync rewinds legacy document position to 15s while session is loaded
    remoteLegacySec = 15;
    expect(controller.getSnapshot()?.positionSec).toBe(80);
    expect(engine.seek).toHaveBeenCalledTimes(seeksWhileLoaded);

    // Explicit close and reopen observes the synced rewind (15s)
    await controller.stopAndClose();
    await controller.load(makeKey("book-sync"), { intent: "paused" });
    expect(controller.getSnapshot()?.positionSec).toBe(15);
    await controller.dispose();
  });

  it("blocks account switch when stop/checkpoint fails and isolates profile namespaces on sign-in/sign-out", async () => {
    const { engine } = makeEngine();
    let failCommit = true;
    const controller = new GlobalAudioController({
      createEngine: () => engine,
      resolve: async key => ({
        sourceKey: key,
        title: `Secret-${key.profileKey}`,
        mediaRevision: "rev-1",
        complete: true,
        parts: withAudioBoundaries([{ partId: "p0", sourceRevision: "rev-1", browserUrl: "/s.mp3", durationSec: 100 }]),
      }),
      persistence: new AudioPlaybackPersistence({
        commit: async () => {
          if (failCommit) throw new Error("SQLite busy");
        },
      }),
    });
    await resetAudioRuntimeForTests(controller);

    const accountAKey = makeKey("private-book", "account:user-a");
    await controller.load(accountAKey, { intent: "play" });

    // Failing stop prevents account handover and leaves old namespace active
    await expect(prepareAudioAccountChange()).rejects.toThrow("unsaved");
    expect(controller.getSnapshot()?.sourceKey.profileKey).toBe("account:user-a");
    expect(useAudioPlaybackStore.getState().snapshot?.metadata.title).toBe("Secret-account:user-a");

    // Once commit succeeds, handover clears old profile projection and restores new profile paused
    failCommit = false;
    mocks.sessions.set("account:user-b", {
      ownerEpoch: "ep-b",
      session: {
        schemaVersion: 1,
        current: makeKey("book-b", "account:user-b"),
        queue: [],
        playbackRate: 1.25,
        volume: 0.8,
        sleepDeadlineMs: null,
        updatedAt: 3000,
      },
    });

    await prepareAudioAccountChange();
    expect(useAudioPlaybackStore.getState().snapshot).toBeNull();

    await completeAudioAccountChange("user-b");
    expect(controller.getSnapshot()).toMatchObject({
      sourceKey: makeKey("book-b", "account:user-b"),
      state: "paused",
      playIntent: false,
      playbackRate: 1.25,
      volume: 0.8,
    });
    expect(useAudioPlaybackStore.getState().snapshot?.metadata.title).toBe("Secret-account:user-b");
  });
});
