/**
 * Android media-session reliability gating (openspec
 * fix-mobile-layout-and-android-media-controls, task 5.5).
 *
 * The Android bridge must start the native Media3 service only for a real
 * playable/paused session (never during generation/loading), publish honest
 * snapshot states, surface failed plugin pushes, and stop the service on
 * unmount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRemoteMediaBridge } from "../useRemoteMediaBridge";
import type { RemoteMediaContext } from "../../utils/remoteMediaDispatcher";

const invokeCommand =
  vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => null);

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => true,
  invokeCommand: (command: string, args?: Record<string, unknown>) =>
    invokeCommand(command, args),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("../useMediaSession", () => ({
  // The browser adapter must stay disabled inside Tauri (single-adapter rule).
  useMediaSession: vi.fn(),
}));

function makeContext(): RemoteMediaContext {
  return {
    documentId: "doc-android",
    documentTitle: "Android Bridge",
    editionId: "ed-android",
    sessionId: "sess-android",
    audioElement: null,
    currentTimestampSec: 0,
    anchors: [],
    captureConfidence: "high",
    onPlayPause: vi.fn(),
    onSeekRelative: vi.fn(),
  };
}

const START = "plugin:plethora-android-tts|start_media_session";
const STOP = "plugin:plethora-android-tts|stop_media_session";
const METADATA = "plugin:plethora-android-tts|update_media_metadata";

function callsFor(command: string) {
  return invokeCommand.mock.calls.filter(([name]) => name === command);
}

describe("useRemoteMediaBridge (Android gating)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    invokeCommand.mockClear();
    invokeCommand.mockImplementation(async () => null);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    document.body.innerHTML = "";
  });

  it("does not start the service while the source is generating (buffering)", () => {
    const ctx = makeContext();
    const { unmount } = renderHook(() =>
      useRemoteMediaBridge({
        getContext: () => ctx,
        title: "Read aloud",
        sourceKind: "reader_tts",
        isPlaying: false,
        playbackState: "buffering",
        enabled: true,
      })
    );
    expect(callsFor(START)).toHaveLength(0);
    unmount();
  });

  it("starts the service lazily once a real playing session appears", () => {
    const ctx = makeContext();
    const { rerender, unmount } = renderHook(
      ({ playing, state }: { playing: boolean; state: "buffering" | "playing" }) =>
        useRemoteMediaBridge({
          getContext: () => ctx,
          title: "Read aloud",
          sourceKind: "reader_tts",
          isPlaying: playing,
          playbackState: state,
          enabled: true,
        }),
      { initialProps: { playing: false, state: "buffering" as const } }
    );

    expect(callsFor(START)).toHaveLength(0);

    rerender({ playing: true, state: "playing" });
    expect(callsFor(START)).toHaveLength(1);
    unmount();
  });

  it("starts immediately for a paused-and-resumable session and stops on unmount", () => {
    const ctx = makeContext();
    const { unmount } = renderHook(() =>
      useRemoteMediaBridge({
        getContext: () => ctx,
        title: "Audiobook",
        sourceKind: "audiobook",
        isPlaying: false,
        enabled: true,
      })
    );
    // Classic audio default: isPlaying=false maps to paused (OS-visible).
    expect(callsFor(START)).toHaveLength(1);
    expect(callsFor(METADATA).length).toBeGreaterThan(0);

    unmount();
    expect(callsFor(STOP)).toHaveLength(1);
  });

  it("publishes honest snapshot states to the native metadata channel", () => {
    const ctx = makeContext();
    const { rerender, unmount } = renderHook(
      ({ state }: { state: "buffering" | "playing" }) =>
        useRemoteMediaBridge({
          getContext: () => ctx,
          title: "Read aloud",
          sourceKind: "reader_tts",
          isPlaying: state === "playing",
          playbackState: state,
          enabled: true,
        }),
      { initialProps: { state: "buffering" as const } }
    );

    const first = callsFor(METADATA).at(-1)![1] as { payload: { state: string } };
    expect(first.payload.state).toBe("buffering");

    rerender({ state: "playing" });
    const second = callsFor(METADATA).at(-1)![1] as { payload: { state: string } };
    expect(second.payload.state).toBe("playing");
    unmount();
  });

  it("surfaces failed snapshot pushes instead of swallowing them", async () => {
    invokeCommand.mockImplementation(async (command: string) => {
      if (command === METADATA) throw new Error("bridge dead");
      return null;
    });
    const ctx = makeContext();
    const { unmount } = renderHook(() =>
      useRemoteMediaBridge({
        getContext: () => ctx,
        title: "Audiobook",
        sourceKind: "audiobook",
        isPlaying: true,
        enabled: true,
      })
    );
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("update_media_metadata"),
        expect.any(Error)
      );
    });
    unmount();
  });
});
