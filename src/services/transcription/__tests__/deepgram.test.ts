import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEEPGRAM_NOVA3_MODEL, TRANSCRIPTION_PROVIDER_IDS } from "../config";
import {
  DeepgramProvider,
  normalizeDeepgramResponse,
  postDeepgramTranscription,
} from "../providers/DeepgramProvider";

vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({
  ensureCloudAiDisclosure: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../../stores/settingsStore", () => {
  const state = {
    settings: {
      audioTranscription: {
        premiumMinutesUsed: 0,
        premiumMonthlyAllowance: 120,
        deepgram: { apiKey: "deepgram-test-key" },
      },
    },
    updateSettings: vi.fn(),
  };
  return {
    useSettingsStore: {
      getState: () => state,
      __testState: state,
    },
  };
});

const deepgramPayload = {
  metadata: { duration: 2.4, language: "en" },
  results: {
    channels: [{
      alternatives: [{
        transcript: "hello deepgram",
        words: [{ word: "hello", start: 0, end: 0.5 }, { word: "deepgram", start: 0.5, end: 1.2 }],
      }],
    }],
  },
};

describe("DeepgramProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch");
  });

  it("normalizes Deepgram REST responses", () => {
    const result = normalizeDeepgramResponse(
      deepgramPayload,
      TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3,
      DEEPGRAM_NOVA3_MODEL,
    );

    expect(result).toMatchObject({
      text: "hello deepgram",
      language: "en",
      durationSeconds: 2.4,
      providerId: TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3,
      segments: [{
        startMs: 0,
        endMs: 2400,
        text: "hello deepgram",
      }],
    });
  });

  it("posts audio to the Deepgram listen endpoint", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => deepgramPayload,
    } as Response);

    const result = await postDeepgramTranscription(
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
      "en",
      undefined,
      undefined,
      TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3,
    );

    expect(result.text).toBe("hello deepgram");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("api.deepgram.com/v1/listen"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Token deepgram-test-key",
        }),
      }),
    );
  });

  it("rejects missing API keys before upload", async () => {
    vi.mocked(fetch).mockClear();
    const { useSettingsStore } = await import("../../../stores/settingsStore");
    const state = (useSettingsStore as typeof useSettingsStore & {
      __testState: { settings: { audioTranscription: { deepgram: { apiKey: string } } } };
    }).__testState;
    state.settings.audioTranscription.deepgram.apiKey = "";

    await expect(postDeepgramTranscription(
      new Blob([new Uint8Array([1])], { type: "audio/wav" }),
      undefined,
      undefined,
      undefined,
      TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3,
    )).rejects.toMatchObject({
      code: "AUTH_FAILED",
      providerId: TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3,
    });
    expect(fetch).not.toHaveBeenCalled();

    state.settings.audioTranscription.deepgram.apiKey = "deepgram-test-key";
  });

  it("creates a streaming session over WebSocket", async () => {
    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      readyState = 0;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;

      constructor(public url: string, public protocols?: string[]) {
        MockWebSocket.instances.push(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }

      send() {}
      close() {
        this.readyState = 3;
        this.onclose?.();
      }

      addEventListener(event: string, handler: () => void) {
        if (event === "open") this.onopen = handler;
        if (event === "error") this.onerror = handler;
        if (event === "close") this.onclose = handler;
        if (event === "message") {
          this.onmessage = handler as (event: { data: string }) => void;
        }
      }

      removeEventListener() {}
    }

    vi.stubGlobal("WebSocket", MockWebSocket);

    const provider = new DeepgramProvider();
    const session = await provider.startStreaming({}, {});

    expect(session.providerId).toBe(TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3);
    expect(MockWebSocket.instances[0]?.url).toContain("wss://api.deepgram.com/v1/listen");
    expect(MockWebSocket.instances[0]?.protocols).toEqual(["token", "deepgram-test-key"]);

    vi.unstubAllGlobals();
  });
});
