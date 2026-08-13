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
