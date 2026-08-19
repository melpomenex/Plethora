import { describe, expect, it } from "vitest";
import {
  createDefaultTTSSettings,
  defaultVoiceIdForProvider,
  migrateTTSSettings,
  sanitizeTTSSettings,
  validateTTSConfiguration,
} from "../ttsSettings";

describe("ttsSettings", () => {
  it("returns defaults for invalid persisted payloads", () => {
    const settings = sanitizeTTSSettings(null);
    const defaults = createDefaultTTSSettings();

    expect(settings.defaultPresetId).toBe(defaults.defaultPresetId);
    expect(settings.voiceProfiles.length).toBeGreaterThan(0);
  });

  it("includes the native android provider in default provider settings", () => {
    const defaults = createDefaultTTSSettings();
    expect(defaults.providers.android).toBeDefined();
    expect(defaults.providers.android.modelId).toBe("kitten-nano");
    expect(defaults.providers.android.voiceId).toBe("0");
  });

  it("resolves the default voice id for the android provider", () => {
    expect(defaultVoiceIdForProvider("android")).toBe("0");
  });

  it("merges custom cloned voices while preserving built-ins", () => {
    const settings = sanitizeTTSSettings({
      enabled: true,
      voiceProfiles: [
        {
          id: "cloned-1",
          name: "Narrator",
          kind: "cloned",
          speakerEmbeddingUrl: "https://cdn.fal.ai/sample.bin",
          createdAt: new Date().toISOString(),
        },
      ],
      defaultVoiceId: "cloned-1",
    });

    expect(settings.voiceProfiles.some((voice) => voice.id === "cloned-1")).toBe(true);
    expect(settings.voiceProfiles.some((voice) => voice.kind === "builtin")).toBe(true);
    expect(settings.defaultVoiceId).toBe("cloned-1");
  });

  it("validates direct and proxy configuration", () => {
    const defaults = createDefaultTTSSettings();
    expect(validateTTSConfiguration({ ...defaults, enabled: false }).valid).toBe(true);

    const directInvalid = validateTTSConfiguration({
      ...defaults,
      enabled: true,
      requestMode: "direct",
      apiKey: "",
    });
    expect(directInvalid.valid).toBe(false);

    const proxyValid = validateTTSConfiguration({
      ...defaults,
      enabled: true,
      requestMode: "proxy",
      proxyUrl: "https://proxy.example.com/fal",
    });
    expect(proxyValid.valid).toBe(true);
  });

  it("migrates every schema-2 provider field into v3 objects", () => {
    const settings = sanitizeTTSSettings({
      schemaVersion: 2,
      enabled: true,
      provider: "groq",
      apiKey: "fal-key",
      modelId: "fal-model",
      cloneModelId: "clone-model",
      requestMode: "proxy",
      proxyUrl: "https://proxy.example",
      groqModelId: "playai-tts-arabic",
      groqResponseFormat: "wav",
      pocketSpeed: 1.5,
      pocketAvailable: true,
      defaultVoiceId: "groq-builtin-fiora",
      defaultPresetId: "balanced-default",
    });
    expect(settings.schemaVersion).toBeGreaterThanOrEqual(3);
    expect(settings.providers.fal).toMatchObject({ apiKey: "fal-key", modelId: "fal-model", cloneModelId: "clone-model", requestMode: "proxy", proxyUrl: "https://proxy.example" });
    expect(settings.providers.groq).toMatchObject({ modelId: "playai-tts-arabic", responseFormat: "wav" });
    expect(settings.providers.pocket).toMatchObject({ pocketSpeed: 1.5, pocketAvailable: true });
    expect(settings.provider).toBe("groq");
    expect(settings.defaultVoiceId).toBe("groq-builtin-fiora");
  });

  it("preserves cloned profiles and is idempotent for v3", () => {
    const cloned = { id: "clone", provider: "fal", name: "Narrator", kind: "cloned", speakerEmbeddingUrl: "https://speaker", referenceText: "sample", createdAt: "2026-01-01" };
    const migrated = sanitizeTTSSettings({ schemaVersion: 2, voiceProfiles: [cloned] });
    expect(migrated.voiceProfiles.find((profile) => profile.id === "clone")).toMatchObject(cloned);
    const again = sanitizeTTSSettings(migrated);
    expect(again).toEqual(migrated);
  });

  it("sanitizes malformed provider objects without throwing", () => {
    const settings = sanitizeTTSSettings({ schemaVersion: 3, providers: { openrouter: { speed: "fast", responseFormat: null } }, voiceProfiles: "bad", favorites: ["voice", 1, "voice"] });
    expect(settings.providers.openrouter.speed).toBe(1);
    expect(settings.providers.openrouter.responseFormat).toBe("mp3");
    expect(settings.favorites).toEqual(["voice"]);
  });

  it("exposes the migration shape for callers that need to inspect it", () => {
    const migrated = migrateTTSSettings({ schemaVersion: 2, modelId: "legacy" });
    expect((migrated.providers as Record<string, { modelId: string }>).fal.modelId).toBe("legacy");
  });
});

describe("ttsSettings v4 spoken-word preferences", () => {
  it("defaults highlightSpokenWord/followSpokenWord to true for v3 payloads", () => {
    const settings = sanitizeTTSSettings({ schemaVersion: 3, providers: {} });
    expect(settings.schemaVersion).toBe(4);
    expect(settings.highlightSpokenWord).toBe(true);
    expect(settings.followSpokenWord).toBe(true);
  });

  it("preserves explicit v4 values", () => {
    const settings = sanitizeTTSSettings({
      schemaVersion: 4,
      providers: {},
      highlightSpokenWord: false,
      followSpokenWord: true,
    });
    expect(settings.highlightSpokenWord).toBe(false);
    expect(settings.followSpokenWord).toBe(true);
  });

  it("sanitizes non-boolean values back to the defaults", () => {
    const settings = sanitizeTTSSettings({
      schemaVersion: 4,
      providers: {},
      highlightSpokenWord: "yes",
      followSpokenWord: 0,
    });
    expect(settings.highlightSpokenWord).toBe(true);
    expect(settings.followSpokenWord).toBe(true);
  });
});
