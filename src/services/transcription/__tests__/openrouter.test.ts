import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_ASR_MODELS,
  OPENROUTER_TRANSCRIPTION_URL,
  TRANSCRIPTION_PROVIDER_IDS,
} from "../config";
import {
  createNemotronProvider,
  normalizeOpenRouterResponse,
} from "../providers/OpenRouterAsrProvider";

vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({
  ensureCloudAiDisclosure: vi.fn(() => Promise.resolve(true)),
}));

const nemotronPayload = {
  text: "hello world",
  language: "en",
  segments: [
    { start: 0, end: 1.2, text: "hello world" },
  ],
};

describe("OpenRouter Nemotron provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch");
  });

  it("normalizes a successful OpenRouter response", async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => nemotronPayload,
    } as Response);

    const provider = createNemotronProvider("test-key");
    const result = await provider.transcribe({
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
      language: "en",
    });

    expect(result).toMatchObject({
      text: "hello world",
      language: "en",
      providerId: TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON,
      segments: [{ startMs: 0, endMs: 1200, text: "hello world" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      OPENROUTER_TRANSCRIPTION_URL,
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer test-key" },
      }),
    );

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("model")).toBe(OPENROUTER_ASR_MODELS.NEMOTRON);
    expect(body.get("language")).toBe("en");
  });

  it("normalizes verbose OpenRouter payloads via helper", () => {
    const result = normalizeOpenRouterResponse(
      nemotronPayload,
      TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON,
      OPENROUTER_ASR_MODELS.NEMOTRON,
    );
    expect(result.text).toBe("hello world");
    expect(result.segments[0]?.endMs).toBe(1200);
  });

  it("maps HTTP 429 to RATE_LIMITED", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "rate limited" } }),
      clone: () => ({
        json: async () => ({ error: { message: "rate limited" } }),
        text: async () => "rate limited",
      }),
    } as Response);

    const provider = createNemotronProvider("test-key");
    await expect(provider.transcribe({
      audio: new Blob([new Uint8Array([1])], { type: "audio/wav" }),
    })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      recoverable: true,
    });
  });

  it("rejects missing API keys with AUTH_FAILED", async () => {
    vi.mocked(fetch).mockClear();
    const provider = createNemotronProvider("  ");
    await expect(provider.transcribe({
      audio: new Blob([new Uint8Array([1])], { type: "audio/wav" }),
    })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      recoverable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
