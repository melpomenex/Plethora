import { beforeEach, describe, expect, it } from "vitest";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { createDefaultTTSSettings } from "../../../utils/ttsSettings";
import { resolveProviderKey } from "../auth";
import { openrouterAdapter } from "../providers/openrouter";
import { listAdapters } from "../registry";
import { validateTTSConfiguration } from "../../../utils/ttsSettings";

describe("TTS credential borrowing", () => {
  beforeEach(() => useLLMProvidersStore.setState({ providers: [] }));

  it("never requires or uses a placeholder key for a provider without authentication", () => {
    for (const adapter of listAdapters().filter((item) => item.auth.mode === "none")) {
      const settings = createDefaultTTSSettings();
      settings.enabled = true;
      settings.provider = adapter.id as typeof settings.provider;
      settings.providers[settings.provider].apiKey = "";
      expect(validateTTSConfiguration(settings), adapter.id).toEqual({ valid: true });
      settings.providers[settings.provider].apiKey = "unnecessary placeholder";
      expect(resolveProviderKey(adapter, { tts: settings }), adapter.id).toEqual({ key: "" });
    }
  });

  it("borrows the first enabled OpenRouter entry", () => {
    useLLMProvidersStore.setState({ providers: [
      { id: "disabled", provider: "openrouter", name: "Disabled", apiKey: "wrong", model: "x", enabled: false, temperature: 0.7, maxTokens: 100 },
      { id: "enabled", provider: "openrouter", name: "Primary", apiKey: "borrowed", model: "x", enabled: true, temperature: 0.7, maxTokens: 100 },
    ] });
    const settings = createDefaultTTSSettings();
    settings.providers.openrouter.apiKey = "";
    const resolved = resolveProviderKey(openrouterAdapter, { tts: settings });
    expect(resolved.key).toBe("borrowed");
    expect(resolved.source?.id).toBe("enabled");
  });

  it("prefers a TTS-specific override", () => {
    useLLMProvidersStore.setState({ providers: [
      { id: "enabled", provider: "openrouter", name: "Primary", apiKey: "borrowed", model: "x", enabled: true, temperature: 0.7, maxTokens: 100 },
    ] });
    const settings = createDefaultTTSSettings();
    settings.providers.openrouter.apiKey = "specific";
    const resolved = resolveProviderKey(openrouterAdapter, { tts: settings });
    expect(resolved.key).toBe("specific");
    expect(resolved.source).toBeUndefined();
  });

  it("returns unconfigured when no candidate exists", () => {
    const resolved = resolveProviderKey(openrouterAdapter, { tts: createDefaultTTSSettings() });
    expect(resolved.key).toBe("");
  });
});
