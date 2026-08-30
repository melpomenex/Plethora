import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_TRANSCRIBE_MODEL,
  GEMINI_TRANSCRIPTION_URL,
  TRANSCRIPTION_PROVIDER_IDS,
} from "../config";
import { GeminiTranscribeProvider, postGeminiTranscription } from "../providers/GeminiTranscribeProvider";

vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({
  ensureCloudAiDisclosure: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      settings: {
        audioTranscription: {
          premiumMinutesUsed: 0,
          premiumMonthlyAllowance: 120,
        },
      },
      updateSettings: vi.fn(),
    }),
  },
}));

vi.mock("../providers/geminiAuth", () => ({
  resolveGeminiApiKey: vi.fn(() => "gemini-test-key"),
}));

const geminiPayload = {
  text: "hello gemini",
  language: "en",
  duration: 1.5,
  segments: [{ start: 0, end: 1.5, text: "hello gemini" }],
};

describe("GeminiTranscribeProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch");
  });

  it("posts audio to the Gemini OpenAI-compatible transcription endpoint", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => geminiPayload,
    } as Response);

    const result = await postGeminiTranscription(
      {
        audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
        language: "en",
      },
      TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
      GEMINI_TRANSCRIBE_MODEL,
      () => "gemini-test-key",
    );

    expect(result).toMatchObject({
      text: "hello gemini",
      language: "en",
      providerId: TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
      segments: [{ startMs: 0, endMs: 1500, text: "hello gemini" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      GEMINI_TRANSCRIPTION_URL,
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer gemini-test-key" },
      }),
    );

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("model")).toBe(GEMINI_TRANSCRIBE_MODEL);
    expect(body.get("language")).toBe("en");
  });

  it("rejects missing API keys before upload", async () => {
    vi.mocked(fetch).mockClear();
    await expect(postGeminiTranscription(
      {
        audio: new Blob([new Uint8Array([1])], { type: "audio/wav" }),
      },
      TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
      GEMINI_TRANSCRIBE_MODEL,
      () => "",
    )).rejects.toMatchObject({
      code: "AUTH_FAILED",
      providerId: TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports configuration state via isConfigured", () => {
    const provider = new GeminiTranscribeProvider();
    expect(provider.isConfigured()).toBe(true);
  });
});
