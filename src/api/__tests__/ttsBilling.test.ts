/**
 * Billing-safety tests for the TTS synthesis pipeline (ai-billing-safety
 * #14): a paid cloud provider must not synthesize without explicit consent;
 * explicit consent allows the request.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSpeech, TTSServiceError } from "../tts";
import { defaultSettings } from "../../stores/settingsStore";
import { createDefaultTTSSettings } from "../../utils/ttsSettings";
import {
  clearPaidConsentDenials,
  setPaidConsentHandler,
} from "../../utils/aiBillingConsent";

vi.mock("../../utils/ttsCache", () => ({
  makeCacheKey: vi.fn(() => "test:cache:key"),
  makeTTSCacheKeyV2: vi.fn(() => "test:v2:key"),
  digestJson128: vi.fn(() => "d1"),
  digestText128: vi.fn(() => "d2"),
  getCachedAudio: vi.fn(() => Promise.resolve(null)),
  setCachedAudioDurable: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
}));

function makeSettings(paidTts = false) {
  return {
    ...defaultSettings,
    tts: {
      ...createDefaultTTSSettings(),
      enabled: true,
      paidTtsEnabled: paidTts,
      apiKey: "test-key",
      voiceProfiles: createDefaultTTSSettings().voiceProfiles,
      presets: createDefaultTTSSettings().presets,
    },
  };
}

describe("generateSpeech paid gate (ai-billing-safety #14)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setPaidConsentHandler(null);
    clearPaidConsentDenials();
  });

  it("throws paid_consent_required for a paid provider when consent is off and no request is sent", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { audio: { url: "https://cdn.fal.ai/audio.mp3" } } }),
    } as Response);

    await expect(
      generateSpeech(makeSettings(false), { text: "Hello" })
    ).rejects.toMatchObject({ code: "paid_consent_required", consentRequired: true });

    // No provider request was made (the billable call never fired).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the opt-in surface (registered handler) before blocking", async () => {
    const consentHandler = vi.fn(async () => false);
    setPaidConsentHandler(consentHandler);
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { audio: { url: "https://cdn.fal.ai/audio.mp3" } } }),
    } as Response);

    await expect(
      generateSpeech(makeSettings(false), { text: "Hello" })
    ).rejects.toMatchObject({ code: "paid_consent_required" });

    expect(consentHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tts", provider: "fal" })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the request when paid TTS consent is explicitly enabled", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { audio: { url: "https://cdn.fal.ai/audio.mp3" } } }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response);

    const result = await generateSpeech(makeSettings(true), { text: "Hello" });
    expect(result.audioUrl).toBe("https://cdn.fal.ai/audio.mp3");
    // Synthesis happened (the provider endpoint was contacted).
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not gate a free/local provider (pocket)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { audio_url: "https://example.com/pocket.mp3" } }),
    } as Response);

    const settings = makeSettings(false);
    settings.tts = {
      ...settings.tts,
      provider: "pocket",
      modelId: "pocket-tts",
    };
    // The consent gate is skipped for free/local providers: the failure (if
    // any) is a normal provider error (Pocket needs the desktop shell), never
    // a paid_consent_required block.
    const error = await generateSpeech(settings, { text: "Hello" }).catch((e) => e);
    expect(error).toBeInstanceOf(TTSServiceError);
    expect((error as TTSServiceError).code).not.toBe("paid_consent_required");
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("consent"),
      expect.anything()
    );
  });

  it("does not require consent for a cached result (no billable request)", async () => {
    const { getCachedAudio } = await import("../../utils/ttsCache");
    vi.mocked(getCachedAudio).mockResolvedValueOnce({
      audioData: new ArrayBuffer(8),
      durationSec: 1,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch" as any);
    const result = await generateSpeech(makeSettings(false), { text: "cached" });
    expect(result.cacheSource).toBe("persistent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("errors are TTSServiceError instances", async () => {
    try {
      await generateSpeech(makeSettings(false), { text: "Hello" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TTSServiceError);
      expect((error as TTSServiceError).code).toBe("paid_consent_required");
    }
  });
});
