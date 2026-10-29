import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultTTSSettings, sanitizeTTSSettings } from "../../../utils/ttsSettings";
import { LFM3_MODEL_ID, lfm3Language } from "../../../utils/lfm3Tts";
import { lfm3Adapter } from "../providers/lfm3";
import type { TTSAdapterContext } from "../types";
import { generateLfm3Speech } from "../../lfm3Tts";
vi.mock("../../lfm3Tts", () => ({ generateLfm3Speech: vi.fn(async () => ({ audioUrl: "data:audio/wav;base64,UklGRg==", durationSec: 1, backend: "CPU" })) }));
vi.mock("../../hfModels", () => ({ getInstalledHfModels: vi.fn(async () => []) }));
function context(): TTSAdapterContext {
  const tts = createDefaultTTSSettings();
  return { settings: { tts } as TTSAdapterContext["settings"], tts, config: tts.providers.lfm3 };
}
afterEach(() => vi.unstubAllGlobals());
describe("LFM3 optional provider", () => {
  it("keeps existing selection and gives LFM3 its own defaults", () => {
    const tts = sanitizeTTSSettings({ ...createDefaultTTSSettings(), provider: "pocket" });
    expect(tts.provider).toBe("pocket");
    expect(tts.providers.lfm3).toMatchObject({ modelId: LFM3_MODEL_ID, voiceId: "female", language: "en-US", responseFormat: "wav" });
    expect(tts.providers.pocket.voiceId).toBe("alba");
  });
  it("preserves LFM3 locale independently of Fal", () => {
    const tts = createDefaultTTSSettings();
    tts.providers.lfm3.language = "en-GB";
    expect(sanitizeTTSSettings(tts).providers.lfm3.language).toBe("en-GB");
    expect(sanitizeTTSSettings(tts).providers.fal.language).toBe(tts.providers.fal.language);
    expect(lfm3Language("en-US")).toBe("en");
    expect(lfm3Language("en-GB")).toBe("en-gb");
    expect(() => lfm3Language("unsupported")).toThrow("supported LFM3 language");
  });
  it("offers two real voices and truthful local capabilities", async () => {
    expect(lfm3Adapter.kind).toBe("local");
    expect(lfm3Adapter.auth.mode).toBe("none");
    expect(lfm3Adapter.capabilities).toMatchObject({ supportsSpeed: false, supportsInstructions: false, supportsCloning: false, supportsWordTimings: false, audioFormats: ["wav"] });
    expect((await lfm3Adapter.listVoices(context(), LFM3_MODEL_ID)).map((v) => v.id)).toEqual(["female", "male"]);
  });
  it("routes the configured locale and cancellation to native synthesis", async () => {
    const ctx = context(); ctx.config.language = "en-GB";
    const signal = new AbortController().signal;
    const result = await lfm3Adapter.synthesize(ctx, { text: "A short sample.", model: LFM3_MODEL_ID, voice: "male", responseFormat: "wav", signal });
    expect(generateLfm3Speech).toHaveBeenCalledWith(expect.objectContaining({ language: "en-gb", voice: "male", signal }));
    expect(result.mimeType).toBe("audio/wav");
    expect(result.audioData?.byteLength).toBe(4);
  });
  it("decodes local WAV bytes without a fetch blocked by the desktop CSP", async () => {
    const fetchBlockedByCsp = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetchBlockedByCsp);
    const result = await lfm3Adapter.synthesize(context(), { text: "A short sample.", model: LFM3_MODEL_ID, voice: "female", responseFormat: "wav" });
    expect(Array.from(new Uint8Array(result.audioData!))).toEqual([82, 73, 70, 70]);
    expect(result.mimeType).toBe("audio/wav");
    expect(fetchBlockedByCsp).not.toHaveBeenCalled();
  });
  it("rejects unsupported model and voice instead of substituting a provider", async () => {
    const ctx = context();
    await expect(lfm3Adapter.synthesize(ctx, { text: "Sample", model: "other", responseFormat: "wav" })).rejects.toThrow("installed LFM3");
    await expect(lfm3Adapter.synthesize(ctx, { text: "Sample", model: LFM3_MODEL_ID, voice: "cloned", responseFormat: "wav" })).rejects.toThrow("supported LFM3 voice");
  });
});
