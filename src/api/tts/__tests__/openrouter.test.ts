import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCatalogCache } from "../catalog";
import { openrouterAdapter, resetVoiceForModel } from "../providers/openrouter";
import { createDefaultTTSSettings } from "../../../utils/ttsSettings";

const catalogPayload = { data: [{ id: "hexgrad/kokoro-82m", name: "Kokoro", supported_voices: ["af_bella"], supported_parameters: ["speed"], context_length: 4096, pricing: { prompt: "0.000001" } }] };

function context() {
  const tts = createDefaultTTSSettings();
  tts.providers.openrouter.apiKey = "test-key";
  tts.providers.openrouter.modelId = "hexgrad/kokoro-82m";
  tts.providers.openrouter.voiceId = "af_bella";
  return { settings: { tts } as never, tts, config: tts.providers.openrouter };
}

describe("OpenRouter speech adapter", () => {
  beforeEach(() => {
    clearCatalogCache();
    vi.restoreAllMocks();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tts");
  });

  it("posts the OpenAI-shaped request and returns raw audio", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => catalogPayload } as Response)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer, headers: new Headers({ "content-type": "audio/mpeg" }) } as Response);
    const result = await openrouterAdapter.synthesize(context(), { text: "Hello", model: "hexgrad/kokoro-82m", voice: "af_bella", responseFormat: "mp3", speed: 1 });
    expect(result.audioUrl).toBe("blob:tts");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ model: "hexgrad/kokoro-82m", input: "Hello", voice: "af_bella", response_format: "mp3", speed: 1 });
  });

  it("resets an invalid voice to the model's first voice", () => {
    expect(resetVoiceForModel({ id: "m", name: "M", supportedVoices: ["first", "second"], supportedParameters: [] }, "missing")).toEqual({ voice: "first", changed: true });
  });

  it("rejects a zero-length response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => catalogPayload } as Response)
      .mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() } as Response);
    await expect(openrouterAdapter.synthesize(context(), { text: "Hello", model: "hexgrad/kokoro-82m", voice: "af_bella", responseFormat: "mp3" })).rejects.toMatchObject({ code: "provider", recoverable: true });
  });

  it.each([
    [401, "auth", false],
    [403, "auth", false],
    [429, "rate_limit", true],
    [402, "provider", false],
  ] as const)("maps HTTP %s into the TTS error contract", async (status, code, recoverable) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => catalogPayload } as Response)
      .mockResolvedValue({ ok: false, status, json: async () => ({ error: { message: "fixture failure" } }) } as Response);
    await expect(openrouterAdapter.synthesize(context(), { text: "Hello", model: "hexgrad/kokoro-82m", voice: "af_bella", responseFormat: "mp3" })).rejects.toMatchObject({ code, recoverable });
  });

  it("omits unsupported speed and nests tone instructions in provider options", async () => {
    clearCatalogCache();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ ...catalogPayload.data[0], supported_parameters: [] }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer, headers: new Headers() } as Response);
    await openrouterAdapter.synthesize(context(), { text: "Hello", model: "hexgrad/kokoro-82m", voice: "af_bella", responseFormat: "mp3", speed: 1.2, instructions: "calm" });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(body.speed).toBeUndefined();
    expect(body.provider).toEqual({ instructions: "calm" });
  });
});
