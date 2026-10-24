import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalAudioController } from "../globalAudioController";
import { AudioPlaybackPersistence } from "../audioPlaybackPersistence";
import { resetAudioRuntimeForTests } from "../audioRuntime";
import { withAudioBoundaries } from "../audioCoordinates";
import type { DesktopAudioLifecycleEvent } from "../audioPlaybackOwner";
import type { AudioEngine, AudioEngineEvents, AudioEngineSample } from "../htmlAudioEngine";
import type { AudioCheckpoint, AudioSourceKey, ResolvedAudioItem, ResolvedAudioPart } from "../../../types/audioEdition";

const lifecycleListeners = vi.hoisted(
  () => new Set<(event: { payload: DesktopAudioLifecycleEvent }) => void>(),
);

const listenUnregisterCount = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  isNativeAndroid: () => false,
  invokeCommand: vi.fn(async () => null),
  listen: vi.fn(async (eventName: string, handler: (event: { payload: DesktopAudioLifecycleEvent }) => void) => {
    if (eventName === "audio-lifecycle") {
      lifecycleListeners.add(handler);
    }
    return () => {
      if (lifecycleListeners.delete(handler)) {
        listenUnregisterCount.count += 1;
      }
    };
  }),
}));

class FakeEngine implements AudioEngine {
  currentTime = 0;
  duration: number | null = 600;
  paused = true;
  unloaded = false;
  events: AudioEngineEvents | null = null;

  async load(part: ResolvedAudioPart, events: AudioEngineEvents): Promise<void> {
    this.events = events;
    this.currentTime = 0;
    this.duration = part.durationSec ?? 600;
    this.paused = true;
    this.unloaded = false;
    events.sample(this.sample());
  }

  async play(): Promise<void> {
    this.paused = false;
    this.events?.sample(this.sample());
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.events?.sample(this.sample());
  }

  seek(seconds: number): void {
    this.currentTime = seconds;
    this.events?.sample(this.sample());
  }

  setRate(): void {}
  setVolume(): void {}

  sample(): AudioEngineSample {
    return {
      timeInPart: this.currentTime,
      durationSec: this.duration,
      paused: this.paused,
      seekable: true,
    };
  }

  unload(): void {
    this.paused = true;
    this.unloaded = true;
    this.events = null;
  }

  dispose(): void {
    this.unload();
  }
}

describe("Desktop audio lifecycle observer routing (Task 5.7)", () => {
  let clockMs: number;
  let engine: FakeEngine;
  let controller: GlobalAudioController;
  let committed: AudioCheckpoint[];

  beforeEach(async () => {
    lifecycleListeners.clear();
    listenUnregisterCount.count = 0;
    clockMs = 1_700_000_000_000;
    committed = [];
    engine = new FakeEngine();

    controller = new GlobalAudioController({
      now: () => clockMs,
      createEngine: () => engine,
      resolve: async (key: AudioSourceKey): Promise<ResolvedAudioItem> => ({
        sourceKey: { ...key },
        title: "Desktop Lifecycle Audiobook",
        documentId: key.sourceId,
        mediaRevision: "rev-1",
        complete: true,
        parts: withAudioBoundaries([
          {
            partId: "part-1",
            sourceRevision: "rev-1",
            browserUrl: "http://127.0.0.1:19999/book.mp3",
            durationSec: 600,
          },
        ]),
      }),
      persistence: new AudioPlaybackPersistence({
        commit: async (cp) => {
          committed.push(cp);
        },
        onError: () => undefined,
      }),
    });

    await resetAudioRuntimeForTests(controller);
  });

  afterEach(async () => {
    await resetAudioRuntimeForTests(null);
  });

  function emitLifecycle(payload: DesktopAudioLifecycleEvent): void {
    for (const listener of lifecycleListeners) {
      listener({ payload });
    }
  }

  it("never pauses on window minimize/blur, pauses+checkpoints on suspend, and stays paused without wall-clock jump on wake", async () => {
    await controller.load(
      { profileKey: "local", kind: "audiobook", sourceId: "book-sleep" },
      { intent: "play", explicitPosition: 40 },
    );
    expect(controller.getSnapshot()?.state).toBe("playing");

    clockMs += 2_000;
    engine.currentTime = 42.5;
    engine.events?.sample(engine.sample());
    expect(controller.getSnapshot()?.positionSec).toBe(42.5);

    // Minimizing / losing focus MUST NOT pause playback
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(controller.getSnapshot()?.state).toBe("playing");
    expect(engine.paused).toBe(false);

    // Pre-suspend event pauses with reason "suspend" and flushes checkpoint
    const commitsBeforeSuspend = committed.length;
    emitLifecycle({ eventId: "ev-suspend-1", kind: "suspend", source: "linux-login1" });
    await vi.waitFor(() => {
      expect(controller.getSnapshot()?.state).toBe("paused");
      expect(controller.getSnapshot()?.pauseReason).toBe("suspend");
      expect(controller.getSnapshot()?.playIntent).toBe(false);
      expect(committed.length).toBeGreaterThan(commitsBeforeSuspend);
    });
    expect(committed.at(-1)?.positionSec).toBe(42.5);

    // System sleeps for 2 hours and wakes up: position MUST stay 42.5 and state MUST stay paused!
    clockMs += 2 * 60 * 60 * 1000;
    emitLifecycle({ eventId: "ev-wake-1", kind: "wake", source: "linux-login1" });
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(controller.getSnapshot()?.state).toBe("paused");
    expect(controller.getSnapshot()?.playIntent).toBe(false);
    expect(controller.getSnapshot()?.positionSec).toBe(42.5);
  });

  it("samples actual engine and checkpoints on wake when pre-suspend could not be delivered, and handles output interruption + shutdown unregister", async () => {
    await controller.load(
      { profileKey: "local", kind: "audiobook", sourceId: "book-missed-suspend" },
      { intent: "play", explicitPosition: 70 },
    );

    // Engine decoded up to 77.5s before sudden OS sleep (without a pre-suspend signal)
    engine.currentTime = 77.5;
    clockMs += 3_600_000; // 1 hour elapsed in wall-clock sleep!

    emitLifecycle({ eventId: "ev-wake-missed", kind: "wake", source: "windows-powrprof" });
    await vi.waitFor(() => {
      expect(controller.getSnapshot()?.state).toBe("paused");
      expect(controller.getSnapshot()?.pauseReason).toBe("suspend");
      expect(controller.getSnapshot()?.positionSec).toBe(77.5);
    });
    expect(committed.at(-1)?.positionSec).toBe(77.5);

    // Explicit Play resumes from 77.5, then Bluetooth headphone disconnect pauses with "headphones"
    await controller.play();
    expect(controller.getSnapshot()?.state).toBe("playing");

    clockMs += 2_000;
    engine.currentTime = 81;
    engine.events?.sample(engine.sample());

    emitLifecycle({ eventId: "ev-bt-disc", kind: "outputInterrupted", source: "linux-bluez" });
    await vi.waitFor(() => {
      expect(controller.getSnapshot()?.state).toBe("paused");
      expect(controller.getSnapshot()?.pauseReason).toBe("headphones");
      expect(committed.at(-1)?.positionSec).toBe(81);
    });

    // App exit flushes and unloads engine while preserving snapshot source identity
    emitLifecycle({ eventId: "ev-exit", kind: "appExiting", source: "tauri-run-event" });
    await vi.waitFor(() => {
      expect(engine.unloaded).toBe(true);
    });
    expect(controller.getSnapshot()?.sourceKey.sourceId).toBe("book-missed-suspend");

    // Runtime teardown unregisters the lifecycle listener cleanly
    await resetAudioRuntimeForTests(null);
    expect(listenUnregisterCount.count).toBe(1);
    expect(lifecycleListeners.size).toBe(0);
  });
});
