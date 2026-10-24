import React from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalAudioDesktopBridge } from "../GlobalAudioDesktopBridge";
import { useRemoteMediaBridge } from "../../../hooks/useRemoteMediaBridge";
import { GlobalAudioController } from "../../../services/audio/globalAudioController";
import { AudioPlaybackPersistence } from "../../../services/audio/audioPlaybackPersistence";
import { resetAudioRuntimeForTests } from "../../../services/audio/audioRuntime";
import { withAudioBoundaries } from "../../../services/audio/audioCoordinates";
import { longFormPlaybackSessions } from "../../../utils/longFormPlaybackSession";
import type { AudioEngine, AudioEngineEvents, AudioEngineSample } from "../../../services/audio/htmlAudioEngine";
import type { AudioSourceKey, ResolvedAudioItem, ResolvedAudioPart } from "../../../types/audioEdition";
import type { RemoteMediaContext } from "../../../utils/remoteMediaDispatcher";

const runtimeFlags = vi.hoisted(() => ({
  tauri: true,
  mobile: false,
  android: false,
}));

const remoteListeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());

const invokeCommandMock = vi.hoisted(() =>
  vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => null),
);

const listenMock = vi.hoisted(() =>
  vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    remoteListeners.set(eventName, handler);
    return () => {
      if (remoteListeners.get(eventName) === handler) {
        remoteListeners.delete(eventName);
      }
    };
  }),
);

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => runtimeFlags.tauri,
  isNativeMobile: () => runtimeFlags.mobile,
  isNativeAndroid: () => runtimeFlags.android,
  invokeCommand: invokeCommandMock,
  listen: listenMock,
}));

class FakeEngine implements AudioEngine {
  currentTime = 0;
  duration: number | null = 240;
  paused = true;
  events: AudioEngineEvents | null = null;

  async load(part: ResolvedAudioPart, events: AudioEngineEvents): Promise<void> {
    this.events = events;
    this.currentTime = 0;
    this.duration = part.durationSec ?? 240;
    this.paused = true;
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
    this.events = null;
  }

  dispose(): void {
    this.unload();
  }
}

describe("GlobalAudioDesktopBridge & compatibility registry (Task 5.6)", () => {
  let controller: GlobalAudioController;
  let engine: FakeEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    remoteListeners.clear();
    runtimeFlags.tauri = true;
    runtimeFlags.mobile = false;
    runtimeFlags.android = false;
    longFormPlaybackSessions.reset();

    engine = new FakeEngine();
    controller = new GlobalAudioController({
      createEngine: () => engine,
      resolve: async (key: AudioSourceKey): Promise<ResolvedAudioItem> => ({
        sourceKey: { ...key },
        title: `Title ${key.sourceId}`,
        artist: "Author A",
        artworkUrl: "https://example.test/cover.jpg",
        documentId: `doc-${key.sourceId}`,
        mediaRevision: `rev-${key.sourceId}`,
        complete: true,
        parts: withAudioBoundaries([
          {
            partId: `p1-${key.sourceId}`,
            sourceRevision: `rev-${key.sourceId}`,
            browserUrl: `http://127.0.0.1:19999/${key.sourceId}.mp3`,
            durationSec: 240,
            title: "Chapter 1",
          },
        ]),
      }),
      persistence: new AudioPlaybackPersistence({
        commit: async () => undefined,
        onError: () => undefined,
      }),
    });

    await resetAudioRuntimeForTests(controller);
  });

  afterEach(async () => {
    await resetAudioRuntimeForTests(null);
    longFormPlaybackSessions.reset();
  });

  it("exposes owner state via compatibility reads and ignores ordinary per-view registry mutations", async () => {
    expect(longFormPlaybackSessions.getActive()).toBeNull();

    await act(async () => {
      await controller.load(
        { profileKey: "local", kind: "audiobook", sourceId: "book-1" },
        { intent: "play", explicitPosition: 33 },
      );
    });

    const active = longFormPlaybackSessions.getActive();
    expect(active).not.toBeNull();
    expect(active?.sourceId).toBe("book-1");
    expect(active?.sourceKind).toBe("audiobook");
    expect(active?.getSnapshot().positionSec).toBe(33);

    // Ordinary-media attach attempts cannot overwrite the owner's compatibility session
    longFormPlaybackSessions.attach({
      sessionId: "audiobook:rogue",
      sourceId: "rogue",
      sourceKind: "audiobook",
      getSnapshot: () => active!.getSnapshot(),
      play: () => undefined,
      pause: () => undefined,
      toggle: () => undefined,
    });
    expect(longFormPlaybackSessions.getActive()?.sourceId).toBe("book-1");
  });

  it("prevents unmounting views or speech bridges from detaching OS controls of an active/paused owner session", async () => {
    render(<GlobalAudioDesktopBridge />);

    await act(async () => {
      await controller.load(
        { profileKey: "local", kind: "audiobook", sourceId: "book-owner" },
        { intent: "play", explicitPosition: 45 },
      );
    });

    await waitFor(() => {
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "update_media_metadata",
        expect.objectContaining({
          title: "Title book-owner",
          artist: "Author A",
          durationSec: 240,
          positionSec: 45,
          isPlaying: true,
        }),
      );
    });

    // Pause owner for focus and mount a transient reader_tts bridge (e.g. EPUB tab TTS)
    await act(async () => {
      await controller.pauseForFocus();
    });

    const ttsCtx: RemoteMediaContext = {
      documentId: "doc-epub",
      documentTitle: "EPUB TTS",
      audioElement: null,
      currentTimestampSec: 5,
      anchors: [],
      onPlayPause: vi.fn(),
    };
    const ttsHook = renderHook(() =>
      useRemoteMediaBridge({
        getContext: () => ttsCtx,
        title: "EPUB Read Aloud",
        sourceKind: "reader_tts",
        isPlaying: true,
        enabled: true,
      }),
    );

    expect(longFormPlaybackSessions.getActive()?.sourceKind).toBe("reader_tts");
    invokeCommandMock.mockClear();

    // Closing the EPUB tab unmounts ReaderTTSControls's bridge — MUST NOT detach OS controls
    // because the paused owner audiobook session immediately resumes active compatibility ownership!
    ttsHook.unmount();

    const detachCallsAfterTtsUnmount = invokeCommandMock.mock.calls.filter(
      ([cmd]) => cmd === "detach_media_controls",
    );
    expect(detachCallsAfterTtsUnmount).toHaveLength(0);
    expect(longFormPlaybackSessions.getActive()?.sourceId).toBe("book-owner");

    // GlobalAudioDesktopBridge re-publishes the paused audiobook metadata cleanly
    await waitFor(() => {
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "update_media_metadata",
        expect.objectContaining({
          title: "Title book-owner",
          isPlaying: false,
        }),
      );
    });

    // Explicit Stop & Close on the owner DOES detach OS controls cleanly
    invokeCommandMock.mockClear();
    await act(async () => {
      await controller.stopAndClose();
    });
    await waitFor(() => {
      expect(invokeCommandMock).toHaveBeenCalledWith("detach_media_controls");
    });
  });

  it("does not misroute iOS runtimes into Android media plugin commands", () => {
    runtimeFlags.tauri = true;
    runtimeFlags.mobile = true;
    runtimeFlags.android = false;

    const ctx: RemoteMediaContext = {
      documentId: "doc-ios",
      documentTitle: "iOS TTS",
      audioElement: null,
      currentTimestampSec: 0,
      anchors: [],
      onPlayPause: vi.fn(),
    };

    const { unmount } = renderHook(() =>
      useRemoteMediaBridge({
        getContext: () => ctx,
        title: "iOS TTS",
        sourceKind: "reader_tts",
        isPlaying: true,
        enabled: true,
      }),
    );

    expect(invokeCommandMock).not.toHaveBeenCalled();
    unmount();
    expect(invokeCommandMock).not.toHaveBeenCalled();
  });
});
