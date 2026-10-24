import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appAudioFocus } from "../audioFocus";
import { executeStudyAction, type RemoteMediaContext } from "../../../utils/remoteMediaDispatcher";

vi.mock("../audioPlaybackRollout", () => ({ GLOBAL_AUDIO_PLAYBACK_ENABLED: true }));
vi.mock("../../../lib/tauri", async importOriginal => ({
  ...await importOriginal<typeof import("../../../lib/tauri")>(),
  isNativeMobile: () => true,
}));

const nativeListeners = vi.hoisted(() => ({
  state: null as ((s: "loading" | "playing" | "paused" | "stopped" | "idle" | "error") => void) | null,
  sentence: null as ((e: { utteranceId: number; index: number; sentence: string }) => void) | null,
  complete: null as ((e: { utteranceId: number }) => void) | null,
  error: null as ((e: { message: string }) => void) | null,
}));
const nativeCalls = vi.hoisted(() => ({
  speak: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  pause: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  startMediaSession: vi.fn(async () => undefined),
  stopMediaSession: vi.fn(async () => undefined),
  updateMediaMetadata: vi.fn(async () => undefined),
}));

vi.mock("../../../api/tts/android/bridge", async importOriginal => ({
  ...await importOriginal<typeof import("../../../api/tts/android/bridge")>(),
  isAndroidTtsAvailable: () => true,
  pluginSpeak: nativeCalls.speak,
  pluginStop: nativeCalls.stop,
  pluginPause: nativeCalls.pause,
  pluginResume: nativeCalls.resume,
  pluginStartMediaSession: nativeCalls.startMediaSession,
  pluginStopMediaSession: nativeCalls.stopMediaSession,
  pluginUpdateMediaMetadata: nativeCalls.updateMediaMetadata,
  onPlaybackState: vi.fn(async (cb: typeof nativeListeners.state) => {
    nativeListeners.state = cb;
    return () => { nativeListeners.state = null; };
  }),
  onSentencePosition: vi.fn(async (cb: typeof nativeListeners.sentence) => {
    nativeListeners.sentence = cb;
    return () => { nativeListeners.sentence = null; };
  }),
  onUtteranceComplete: vi.fn(async (cb: typeof nativeListeners.complete) => {
    nativeListeners.complete = cb;
    return () => { nativeListeners.complete = null; };
  }),
  onTtsError: vi.fn(async (cb: typeof nativeListeners.error) => {
    nativeListeners.error = cb;
    return () => { nativeListeners.error = null; };
  }),
}));

vi.mock("../../recording/desktopCapture", () => ({
  startDesktopCapture: vi.fn(async (opts: { sessionId: string; writerEpoch: number }) => ({
    sessionId: opts.sessionId,
    writerEpoch: opts.writerEpoch,
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    finish: vi.fn(async () => ({ assetId: "asset-focus", incomplete: false })),
    abort: vi.fn(async () => undefined),
  })),
}));
vi.mock("../../recording/androidCapture", () => ({
  isAndroidCaptureAvailable: () => false,
  startAndroidCapture: vi.fn(),
}));
vi.mock("../../recording/appleCapture", () => ({
  isAppleCaptureAvailable: () => false,
  startAppleCapture: vi.fn(),
}));
vi.mock("../../../api/recordingSessions", () => ({
  isRecordingPersistenceAvailable: () => false,
  createRecordingSession: vi.fn(),
  finalizeRecordingSession: vi.fn(),
  recoverRecordingSession: vi.fn(async () => null),
}));
vi.mock("../../../utils/audioFeedback", () => ({
  playChime: vi.fn(),
  duckAudio: vi.fn(),
}));
vi.mock("../../../utils/listeningSessionService", () => ({
  ensureListeningSession: vi.fn(async () => ({ id: "ls-1" })),
}));
vi.mock("../../../api/listeningSessions", () => ({
  addListeningSessionItem: vi.fn(async () => ({ id: "item-1" })),
  updateListeningSessionItem: vi.fn(async () => undefined),
}));

import { useNativeAndroidTTS } from "../../../hooks/useNativeAndroidTTS";
import { useSettingsStore } from "../../../stores/settingsStore";
import { CaptureController } from "../../recording/captureController";
import { useRecordingSessionStore } from "../../../stores/recordingSessionStore";

describe("unified focus producers (task 5.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRecordingSessionStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("useNativeAndroidTTS revokes prior media, ignores late callbacks after revocation, and releases lease on completion without resuming media", async () => {
    let mediaPaused = false;
    await appAudioFocus.acquire("global-audio", () => { mediaPaused = true; });

    const settings = useSettingsStore.getState().settings;
    const { result, unmount } = renderHook(() => useNativeAndroidTTS(settings));
    await vi.waitFor(() => expect(nativeListeners.state).toBeTypeOf("function"));

    await act(async () => {
      await result.current.speak("Hello native sentence.");
    });
    expect(mediaPaused).toBe(true);
    expect(nativeCalls.speak).toHaveBeenCalledTimes(1);

    act(() => {
      nativeListeners.state?.("playing");
      nativeListeners.sentence?.({ utteranceId: 1, index: 0, sentence: "Hello native sentence." });
    });
    expect(result.current.isSpeaking).toBe(true);

    // Revoke focus via another producer; late native callbacks must be ignored
    let videoLease!: Awaited<ReturnType<typeof appAudioFocus.acquire>>;
    await act(async () => {
      videoLease = await appAudioFocus.acquire("video", () => undefined);
    });
    expect(nativeCalls.stop).toHaveBeenCalled();
    act(() => {
      nativeListeners.state?.("playing");
      nativeListeners.sentence?.({ utteranceId: 2, index: 0, sentence: "Late callback" });
    });
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.activeSentence).toBeNull();
    videoLease.release();

    // Speak again and finish naturally; prior media must never auto-resume
    mediaPaused = true;
    await act(async () => {
      await result.current.speak("Second sentence.");
      nativeListeners.state?.("playing");
    });
    act(() => {
      nativeListeners.complete?.({ utteranceId: 3 });
    });
    expect(result.current.isSpeaking).toBe(false);
    expect(mediaPaused).toBe(true);
    unmount();
  });

  it("CaptureController pauses active media, blocks competing audio until finish, and never auto-resumes prior media", async () => {
    let mediaPlaying = true;
    await appAudioFocus.acquire("global-audio", () => { mediaPlaying = false; });

    const capture = new CaptureController();
    await capture.start({ sessionId: "rec-focus-1" });
    expect(mediaPlaying).toBe(false);

    // Competing audio output must be rejected while recording is active
    await expect(appAudioFocus.acquire("audiobook", () => undefined)).rejects.toThrow(
      "Finish recording before starting another audio source"
    );

    await capture.finish();
    // Prior media stays paused after recording finishes, and explicit new audio acquisition now succeeds
    expect(mediaPlaying).toBe(false);
    const nextAudio = await appAudioFocus.acquire("audiobook", () => undefined);
    expect(nextAudio.isCurrent()).toBe(true);
    nextAudio.release();
  });

  it("executeStudyAction routes capture ducking through owner onDuckAudio callback and skips ducking on navigation", async () => {
    const onDuckAudio = vi.fn();
    const onSeekRelative = vi.fn();
    const ctx: RemoteMediaContext = {
      documentId: "doc-1",
      documentTitle: "Book",
      audioElement: null,
      currentTimestampSec: 42,
      anchors: [],
      onDuckAudio,
      onSeekRelative,
    };

    await executeStudyAction("bookmark", ctx);
    expect(onDuckAudio).toHaveBeenCalledWith(0.25, 700);

    onDuckAudio.mockClear();
    await executeStudyAction("replay_recent_passage", ctx);
    expect(onDuckAudio).not.toHaveBeenCalled();
    expect(onSeekRelative).toHaveBeenCalledWith(-30);
  });
});
