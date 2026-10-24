import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTTS } from "../useTTS";
import { useSettingsStore } from "../../stores/settingsStore";
import { createDefaultTTSSettings } from "../../utils/ttsSettings";
import { appAudioFocus } from "../../services/audio/audioFocus";

vi.mock("../../services/audio/audioPlaybackRollout", () => ({ GLOBAL_AUDIO_PLAYBACK_ENABLED: true }));
vi.mock("../useRemoteMediaBridge", () => ({ useRemoteMediaBridge: () => undefined }));
vi.mock("../../api/tts/android/bridge", () => ({ isAndroidTtsAvailable: () => false }));
const generate = vi.hoisted(() => vi.fn());
vi.mock("../../api/tts", async importOriginal => ({ ...await importOriginal<typeof import("../../api/tts")>(), generateSpeech: generate, resolveTTSMaxChunkSize: async () => 200 }));

const instances: DeferredAudio[] = [];
class DeferredAudio {
  playbackRate = 1; currentTime = 0; ended = false; paused = true;
  onplay: (() => void) | null = null; onpause: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor() { instances.push(this); }
  async play() { this.paused = false; this.onplay?.(); }
  pause() { this.paused = true; this.onpause?.(); }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.stubGlobal("Audio", DeferredAudio);
  generate.mockReset(); instances.length = 0;
  useSettingsStore.setState(state => ({ settings: { ...state.settings, tts: { ...createDefaultTTSSettings(), provider: "pocket", enabled: true } } }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("a revoked generation cannot create a decoder after delayed synthesis returns", async () => {
  const response = deferred<{ audioUrl: string }>();
  generate.mockReturnValue(response.promise);
  const { result } = renderHook(() => useTTS());
  let speaking!: Promise<void>;
  act(() => { speaking = result.current.speak("A delayed paragraph."); });
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  let next!: Awaited<ReturnType<typeof appAudioFocus.acquire>>;
  await act(async () => { next = await appAudioFocus.acquire("test-video", () => undefined); });
  await act(async () => { response.resolve({ audioUrl: "fixture:late-speech" }); await speaking; });
  expect(instances).toHaveLength(0);
  next.release();
});

it("revocation stops active output and prevents a subsequent queued chunk", async () => {
  generate.mockResolvedValue({ audioUrl: "fixture:speech" });
  const { result } = renderHook(() => useTTS());
  let speaking!: Promise<void>;
  act(() => { speaking = result.current.speak("A first paragraph. ".repeat(30)); });
  await waitFor(() => expect(instances).toHaveLength(1));
  expect(instances[0].paused).toBe(false);
  let next!: Awaited<ReturnType<typeof appAudioFocus.acquire>>;
  await act(async () => { next = await appAudioFocus.acquire("test-capture", () => undefined); await speaking; });
  expect(instances[0].paused).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
  next.release();
});

it("revokes prior ordinary media when speech starts and never auto-resumes prior media on completion or unmount", async () => {
  let mediaPlaying = true;
  const resumeMedia = vi.fn(() => { mediaPlaying = true; });
  await appAudioFocus.acquire("global-audio", () => { mediaPlaying = false; });

  generate.mockResolvedValue({ audioUrl: "fixture:complete-speech" });
  const { result, unmount } = renderHook(() => useTTS());
  let speaking!: Promise<void>;
  act(() => { speaking = result.current.speak("Short sentence."); });
  await waitFor(() => expect(instances).toHaveLength(1));
  expect(mediaPlaying).toBe(false);

  await act(async () => {
    instances[0].ended = true;
    instances[0].paused = true;
    instances[0].onended?.();
    await speaking;
  });
  unmount();
  expect(mediaPlaying).toBe(false);
  expect(resumeMedia).not.toHaveBeenCalled();
});

it("cancels WebSpeech utterance if focus is revoked before onstart fires", async () => {
  const cancel = vi.fn();
  let lastUtterance: { onstart?: (() => void) | null } | null = null;
  const speakSynth = vi.fn((u: { onstart?: (() => void) | null }) => { lastUtterance = u; });
  vi.stubGlobal("speechSynthesis", {
    cancel,
    speak: speakSynth,
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => [],
    speaking: false,
    paused: false,
    onvoiceschanged: null,
  });
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    rate = 1; pitch = 1; volume = 1; lang = "en-US"; voice = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  });
  useSettingsStore.setState(state => ({ settings: { ...state.settings, tts: { ...createDefaultTTSSettings(), provider: "system", enabled: true } } }));

  const { result } = renderHook(() => useTTS());
  let speaking!: Promise<void>;
  act(() => { speaking = result.current.speak("System speech check."); });
  await waitFor(() => expect(speakSynth).toHaveBeenCalledTimes(1));

  const takeover = await appAudioFocus.acquire("video-player", () => undefined);
  expect(cancel).toHaveBeenCalled();
  // Even a late OS onstart callback after revocation cannot mark speaking active
  act(() => { lastUtterance?.onstart?.(); });
  await speaking;
  expect(result.current.isSpeaking).toBe(false);
  takeover.release();
});
