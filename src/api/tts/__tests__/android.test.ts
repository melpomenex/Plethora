import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the tauri lib before importing the modules under test. The android
// provider/bridge gate on isNativeMobile() and call invokeCommand, so we
// control both here.
vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: vi.fn(() => false),
  invokeCommand: vi.fn(),
  loadTauriAPI: vi.fn(),
}));

import { isNativeMobile, invokeCommand } from "../../../lib/tauri";
import { androidAdapter } from "../providers/android";
import {
  isAndroidTtsAvailable,
  onPlaybackState,
  pluginInitialize,
  pluginListModels,
  pluginListVoices,
  pluginSpeak,
} from "../android/bridge";

const ctx = () => ({ settings: { tts: {} } as never, tts: {} as never, config: {} as never });

describe("native android TTS availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is unavailable off Android (default mock)", () => {
    expect(isAndroidTtsAvailable()).toBe(false);
  });

  it("is unavailable when not in a Tauri build", async () => {
    vi.mocked(isNativeMobile).mockReturnValue(true);
    // isTauri() is hard-mocked true above, so available should be true here.
    expect(isAndroidTtsAvailable()).toBe(true);
  });
});

describe("native android bridge short-circuits off Android", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativeMobile).mockReturnValue(false);
  });

  it("listModels returns [] without invoking the plugin", async () => {
    const models = await pluginListModels();
    expect(models).toEqual([]);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("initialize returns available:false without invoking the plugin", async () => {
    const res = await pluginInitialize();
    expect(res.available).toBe(false);
    expect(res.installedModelIds).toEqual([]);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("listVoices returns [] without invoking the plugin", async () => {
    const voices = await pluginListVoices("kitten-nano");
    expect(voices).toEqual([]);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("speak is a no-op without invoking the plugin", async () => {
    await pluginSpeak({ sentences: ["hi"] });
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

describe("native android bridge calls the plugin on Android", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativeMobile).mockReturnValue(true);
  });

  it("listModels invokes plugin:plethora-android-tts|list_models", async () => {
    vi.mocked(invokeCommand).mockResolvedValue([
      {
        id: "kitten-nano",
        name: "KittenTTS Micro",
        kind: "kitten",
        installed: true,
        installing: false,
        bytesOnDisk: 100,
        downloadBytes: 200,
        description: "x",
        default: true,
      },
    ] as never);
    const models = await pluginListModels();
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("kitten-nano");
    expect(invokeCommand).toHaveBeenCalledWith("plugin:plethora-android-tts|list_models");
  });

  it("speak forwards sentences/model/voice/speed to the plugin", async () => {
    vi.mocked(invokeCommand).mockResolvedValue(undefined as never);
    await pluginSpeak({
      sentences: ["one", "two"],
      modelId: "kitten-nano",
      voiceId: "0",
      speed: 1.2,
    });
    expect(invokeCommand).toHaveBeenCalledWith("plugin:plethora-android-tts|speak", {
      sentences: ["one", "two"],
      modelId: "kitten-nano",
      voiceId: "0",
      speed: 1.2,
    });
  });
});

describe("android provider adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativeMobile).mockReturnValue(false);
  });

  it("declares local kind, no auth, and speed support", () => {
    expect(androidAdapter.id).toBe("android");
    expect(androidAdapter.kind).toBe("local");
    expect(androidAdapter.auth.mode).toBe("none");
    expect(androidAdapter.capabilities.supportsSpeed).toBe(true);
  });

  it("returns no models off Android", async () => {
    const models = await androidAdapter.listModels(ctx());
    expect(models).toEqual([]);
  });

  it("returns no voices off Android", async () => {
    const voices = await androidAdapter.listVoices(ctx(), "kitten-nano");
    expect(voices).toEqual([]);
  });

  it("queues native playback on Android and returns a native marker URL", async () => {
    vi.mocked(isNativeMobile).mockReturnValue(true);
    vi.mocked(invokeCommand).mockResolvedValue(undefined as never);
    const result = await androidAdapter.synthesize(ctx(), {
      text: "Hello world.",
      model: "kitten-nano",
      voice: "0",
      responseFormat: "pcm",
      speed: 1,
    });
    expect(result.audioUrl).toBe("android-native://playback");
    expect(result.rawOutput).toMatchObject({ provider: "android", native: true });
    expect(invokeCommand).toHaveBeenCalledWith(
      "plugin:plethora-android-tts|speak",
      expect.objectContaining({ sentences: ["Hello world."], modelId: "kitten-nano" })
    );
  });

  it("rejects empty text", async () => {
    await expect(
      androidAdapter.synthesize(ctx(), { text: "   ", model: "kitten-nano", responseFormat: "pcm" })
    ).rejects.toMatchObject({ code: "validation" });
  });
});

describe("native android event subscription via window.addEventListener", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativeMobile).mockReturnValue(true);
  });

  it("receives CustomEvent detail and unsubscribes", async () => {
    const states: string[] = [];
    const unlisten = await onPlaybackState((s) => states.push(s));
    window.dispatchEvent(new CustomEvent("tts://playback-state", { detail: { state: "playing" } }));
    window.dispatchEvent(new CustomEvent("tts://playback-state", { detail: { state: "paused" } }));
    unlisten();
    window.dispatchEvent(new CustomEvent("tts://playback-state", { detail: { state: "idle" } }));
    expect(states).toEqual(["playing", "paused"]);
  });
});

describe("native android word-position event bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativeMobile).mockReturnValue(false);
  });

  it("off Android: subscribing is a no-op and the event never reaches the handler", async () => {
    const { onWordPosition } = await import("../android/bridge");
    const handler = vi.fn();
    const unlisten = await onWordPosition(handler);
    window.dispatchEvent(
      new CustomEvent("tts://word-position", { detail: { utteranceId: 1, sentenceIndex: 0, charIndex: 3 } })
    );
    expect(handler).not.toHaveBeenCalled();
    unlisten();
  });

  it("exposes the word-position event key alongside the sentence events", async () => {
    const { ANDROID_TTS_EVENTS } = await import("../android/bridge");
    expect(ANDROID_TTS_EVENTS.wordPosition).toBe("tts://word-position");
    expect(ANDROID_TTS_EVENTS.sentencePosition).toBe("tts://sentence-position");
  });
});
