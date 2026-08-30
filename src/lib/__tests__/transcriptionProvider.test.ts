import { describe, expect, it } from "vitest";
import type { ModelProfile } from "../../api/transcription";
import type { AudioTranscriptionSettings } from "../../types/settings";
import {
  describeResolution,
  resolveTranscription,
} from "../transcriptionProvider";

const settings = (overrides: Partial<AudioTranscriptionSettings> = {}): AudioTranscriptionSettings => ({
  provider: "local",
  autoTranscription: false,
  autoTranscribeLocalVideos: true,
  preferredModelId: "parakeet-tdt-ctc-110m",
  language: "en",
  timestampGeneration: true,
  speakerDiarization: false,
  confidenceScores: false,
  confidenceThreshold: 0.7,
  idleTranscriptionEnabled: false,
  idleThresholdMinutes: 10,
  groq: {
    apiKey: "key",
    model: "whisper-large-v3-turbo",
    useFreeTier: true,
    usage: { lastResetDate: "", audioSecondsProcessed: 0, requestsMade: 0 },
  },
  ...overrides,
});

const profile = (id: string, name: string, installed: boolean): ModelProfile => ({
  id,
  name,
  installed,
  description: "",
  url: "",
  sha256: "",
  size_bytes: 1,
});

const parakeet = profile("parakeet-tdt-ctc-110m", "Parakeet TDT-CTC 110M", true);
const whisper = profile("distil-small.en", "Whisper Distil Small", true);

describe("resolveTranscription", () => {
  it("honors an installed preferred local model", () => {
    expect(resolveTranscription(settings(), [parakeet], "desktop")).toMatchObject({
      ok: true,
      provider: "local",
      modelId: parakeet.id,
      modelLabel: parakeet.name,
    });
  });

  it("fails when the preferred model is not installed", () => {
    expect(resolveTranscription(settings(), [{ ...parakeet, installed: false }], "desktop")).toMatchObject({
      ok: false,
      reason: "model-not-installed",
      modelId: parakeet.id,
      modelLabel: parakeet.name,
    });
  });

  it("does not substitute another installed model for an unavailable preference", () => {
    expect(resolveTranscription(settings(), [{ ...parakeet, installed: false }, whisper], "desktop")).toMatchObject({
      ok: false,
      reason: "model-not-installed",
      modelId: parakeet.id,
    });
  });

  it("uses the ranked installed default only when no preference is set", () => {
    expect(resolveTranscription(settings({ preferredModelId: undefined }), [whisper, parakeet], "desktop")).toMatchObject({
      ok: true,
      modelId: parakeet.id,
    });
  });

  it("reports no selection when no preference or installed model exists", () => {
    expect(resolveTranscription(settings({ preferredModelId: undefined }), [], "desktop")).toEqual({
      ok: false,
      reason: "no-model-selected",
    });
  });

  it("fails when Groq has no API key", () => {
    expect(resolveTranscription(settings({
      provider: "groq",
      groq: { ...settings().groq, apiKey: "" },
    }), [], "desktop")).toMatchObject({ ok: false, reason: "missing-groq-key" });
  });

  it("resolves a configured Groq model", () => {
    expect(resolveTranscription(settings({ provider: "groq" }), [], "desktop")).toMatchObject({
      ok: true,
      provider: "groq",
      modelId: "whisper-large-v3-turbo",
      modelLabel: "Whisper Large v3 Turbo",
    });
  });

  it("prefers Apple Speech on mobile when the engine is ready", () => {
    expect(
      resolveTranscription(settings(), [parakeet], "native-mobile", { appleReady: true })
    ).toMatchObject({
      ok: true,
      provider: "apple",
      modelId: "apple-speech",
    });
  });

  it("honors an explicit apple provider", () => {
    expect(
      resolveTranscription(settings({ provider: "apple" }), [], "desktop")
    ).toMatchObject({
      ok: true,
      provider: "apple",
      modelId: "apple-speech",
    });
  });

  it("substitutes Groq when explicit Apple is unready", () => {
    expect(
      resolveTranscription(settings({ provider: "apple" }), [], "native-mobile", { appleReady: false })
    ).toMatchObject({
      ok: true,
      provider: "groq",
      substitution: "mobile-no-local",
    });
  });

  it("discloses the native-mobile local-to-Groq substitution", () => {
    expect(resolveTranscription(settings(), [parakeet], "native-mobile")).toMatchObject({
      ok: true,
      provider: "groq",
      substitution: "mobile-no-local",
    });
  });

  it("gives mobile context when the substitution lacks a Groq key", () => {
    expect(resolveTranscription(settings({
      groq: { ...settings().groq, apiKey: "" },
    }), [parakeet], "native-mobile")).toMatchObject({
      ok: false,
      reason: "missing-groq-key",
      substitution: "mobile-no-local",
    });
  });
});

describe("describeResolution", () => {
  it("describes local Parakeet without mentioning Groq", () => {
    const text = describeResolution(resolveTranscription(settings(), [parakeet], "desktop"));
    expect(text).toContain("Local STT · Parakeet");
    expect(text).not.toContain("Groq");
  });

  it("describes Groq without local or offline wording", () => {
    const text = describeResolution(resolveTranscription(settings({ provider: "groq" }), [], "desktop"));
    expect(text).toContain("Groq · Whisper Large v3 Turbo");
    expect(text.toLowerCase()).not.toMatch(/local|offline/);
  });
});

describe("resolveTranscription — android-ondevice matrix", () => {
  const onDevice = (overrides: Partial<AudioTranscriptionSettings> = {}) =>
    settings({ provider: "android-ondevice", ...overrides });

  it("explicit android-ondevice resolves on mobile when a model is ready", () => {
    expect(
      resolveTranscription(onDevice(), [], "native-mobile", { androidSttReady: true })
    ).toMatchObject({
      ok: true,
      provider: "android-ondevice",
      modelId: "auto",
    });
  });

  it("explicit android-ondevice honors the configured model", () => {
    expect(
      resolveTranscription(
        onDevice({ androidOnDevice: { modelId: "parakeet-en-110m-int8", pacing: "full" } }),
        [],
        "native-mobile",
        { androidSttReady: true }
      )
    ).toMatchObject({
      ok: true,
      provider: "android-ondevice",
      modelId: "parakeet-en-110m-int8",
    });
  });

  it("explicit android-ondevice without a model falls back to Groq when keyed", () => {
    expect(
      resolveTranscription(onDevice(), [], "native-mobile", { androidSttReady: false })
    ).toMatchObject({
      ok: true,
      provider: "groq",
      substitution: "on-device-unavailable",
    });
  });

  it("explicit android-ondevice with no model and no Groq key surfaces an error", () => {
    expect(
      resolveTranscription(
        onDevice({ groq: { ...settings().groq, apiKey: "" } }),
        [],
        "native-mobile",
        { androidSttReady: false }
      )
    ).toEqual({
      ok: false,
      reason: "on-device-model-not-ready",
      substitution: "on-device-unavailable",
    });
  });

  it("android-ondevice never resolves on desktop even when ready", () => {
    expect(
      resolveTranscription(onDevice(), [], "desktop", { androidSttReady: true })
    ).toMatchObject({ ok: true, provider: "groq", substitution: "on-device-unavailable" });
  });

  it("mobile local substitution prefers on-device when a model is ready", () => {
    expect(
      resolveTranscription(settings(), [parakeet], "native-mobile", { androidSttReady: true })
    ).toMatchObject({
      ok: true,
      provider: "android-ondevice",
      autoOnDevice: true,
    });
  });

  it("mobile local substitution keeps Groq when no on-device model is ready", () => {
    expect(
      resolveTranscription(settings(), [parakeet], "native-mobile", { androidSttReady: false })
    ).toMatchObject({
      ok: true,
      provider: "groq",
      substitution: "mobile-no-local",
    });
  });

  it("desktop local stays local regardless of on-device readiness", () => {
    expect(
      resolveTranscription(settings(), [parakeet], "desktop", { androidSttReady: true })
    ).toMatchObject({ ok: true, provider: "local" });
  });

  it("apple-ready outranks the on-device default on mobile", () => {
    expect(
      resolveTranscription(settings(), [parakeet], "native-mobile", {
        appleReady: true,
        androidSttReady: true,
      })
    ).toMatchObject({ ok: true, provider: "apple" });
  });

  it("describes the on-device fallback notice", () => {
    const text = describeResolution(
      resolveTranscription(onDevice(), [], "native-mobile", { androidSttReady: false })
    );
    expect(text).toContain("Groq");
    expect(text).toContain("On-device transcription is unavailable");
  });

  it("describes the on-device engine label", () => {
    const text = describeResolution(
      resolveTranscription(onDevice(), [], "native-mobile", { androidSttReady: true })
    );
    expect(text).toContain("On-Device STT");
  });

  it("prioritizes local Nemotron when installed on desktop with preferLocal", () => {
    const res = resolveTranscription(
      settings({ preferredModelId: undefined, preferLocal: true }),
      [whisper],
      "desktop",
      { localNemotronReady: true }
    );
    expect(res).toMatchObject({
      ok: true,
      provider: "local",
      modelId: "nemotron-3.5-asr-0.6b",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
    });
  });

  it("resolves Nemotron when default distil-small.en is not installed but Nemotron is ready", () => {
    const res = resolveTranscription(
      settings({ preferredModelId: "distil-small.en", preferLocal: true }),
      [],
      "desktop",
      { localNemotronReady: true }
    );
    expect(res).toMatchObject({
      ok: true,
      provider: "local",
      modelId: "nemotron-3.5-asr-0.6b",
    });
  });

  it("honors explicit Nemotron sttModel selection", () => {
    const res = resolveTranscription(
      settings({ sttModel: "nemotron-3.5-asr-0.6b" }),
      [],
      "desktop",
      { localNemotronReady: true }
    );
    expect(res).toMatchObject({
      ok: true,
      provider: "local",
      modelId: "nemotron-3.5-asr-0.6b",
    });
  });

  it("still honors explicit Groq provider when requested even if Nemotron is ready", () => {
    const res = resolveTranscription(
      settings({ provider: "groq", sttProvider: undefined }),
      [],
      "desktop",
      { localNemotronReady: true }
    );
    expect(res).toMatchObject({
      ok: true,
      provider: "groq",
      modelId: "whisper-large-v3-turbo",
    });
  });
});

describe("resolveTranscription — openrouter & mobile nemotron", () => {
  it("resolves explicit openrouter provider when key is provided", () => {
    const res = resolveTranscription(
      settings({ sttProvider: "openrouter", sttModel: "nemotron-3.5-asr-0.6b" }),
      [],
      "desktop",
      { openRouterKey: "sk-or-test-key" }
    );
    expect(res).toEqual({
      ok: true,
      provider: "openrouter",
      modelId: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
    });
  });

  it("works on native-mobile with openrouter provider without falling back to groq", () => {
    const res = resolveTranscription(
      settings({ sttProvider: "openrouter", sttModel: "nemotron-3.5-asr-0.6b", groq: { ...settings().groq, apiKey: "" } }),
      [],
      "native-mobile",
      { openRouterKey: "sk-or-test-key" }
    );
    expect(res).toEqual({
      ok: true,
      provider: "openrouter",
      modelId: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
    });
  });

  it("fails with missing-openrouter-key when openrouter is selected without a key", () => {
    const res = resolveTranscription(
      settings({ sttProvider: "openrouter", sttModel: "nemotron-3.5-asr-0.6b", groq: { ...settings().groq, apiKey: "valid-groq-key" } }),
      [],
      "native-mobile",
      { openRouterKey: "" }
    );
    expect(res).toEqual({
      ok: false,
      reason: "missing-openrouter-key",
      modelId: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
    });
  });

  it("substitutes cloud openrouter nemotron on mobile when local nemotron is chosen and openrouter key is present", () => {
    const res = resolveTranscription(
      settings({ provider: "local", sttProvider: "local", sttModel: "nemotron-3.5-asr-0.6b" }),
      [],
      "native-mobile",
      { openRouterKey: "sk-or-test-key" }
    );
    expect(res).toEqual({
      ok: true,
      provider: "openrouter",
      modelId: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
      substitution: "nemotron-cloud-substitute",
    });
  });

  it("reports missing-openrouter-key on mobile when local nemotron is chosen without any key", () => {
    const res = resolveTranscription(
      settings({ provider: "local", sttProvider: "local", sttModel: "nemotron-3.5-asr-0.6b", groq: { ...settings().groq, apiKey: "" } }),
      [],
      "native-mobile",
      { openRouterKey: "" }
    );
    expect(res).toMatchObject({
      ok: false,
      reason: "missing-openrouter-key",
      modelLabel: "NVIDIA Nemotron 3.5 ASR 0.6B",
    });
  });
});
