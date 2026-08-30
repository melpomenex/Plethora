import { describe, expect, it } from "vitest";
import {
  buildRoutingContextFromSettings,
  LOGICAL_STT_MODEL_KEYS,
  modeFromSttProvider,
  resolveLogicalModelProviderIds,
  resolveOpenRouterDefaultProviderId,
  resolveSttProvider,
  setSttOpenRouterConfig,
  sttProviderFromMode,
} from "../config";
import { normalizeAsrModels, OPENROUTER_ASR_CURATED } from "../openrouterAsrCatalog";
import { buildFallbackChain } from "../TranscriptionRouter";
import { TranscriptionMode } from "../types";

describe("STT config", () => {
  it("maps legacy modes to provider categories", () => {
    expect(sttProviderFromMode(TranscriptionMode.Offline)).toBe("local");
    expect(sttProviderFromMode(TranscriptionMode.Fast)).toBe("openrouter");
    expect(sttProviderFromMode(TranscriptionMode.Enhanced)).toBe("premium");
    expect(modeFromSttProvider("openrouter")).toBe(TranscriptionMode.Fast);
  });

  it("resolves logical model to cloud and local provider ids", () => {
    expect(
      resolveLogicalModelProviderIds(LOGICAL_STT_MODEL_KEYS.NEMOTRON, "cloud"),
    ).toEqual(["openrouter:nemotron-3.5"]);
    expect(
      resolveLogicalModelProviderIds(LOGICAL_STT_MODEL_KEYS.NEMOTRON, "local"),
    ).toEqual(["local:nemotron-3.5"]);
  });

  it("updates default OpenRouter provider from configurable default model", () => {
    setSttOpenRouterConfig({
      defaultModel: "qwen/qwen3-asr-0.6b",
    });
    expect(resolveOpenRouterDefaultProviderId()).toBe("openrouter:qwen3-asr-0.6b");
    setSttOpenRouterConfig({
      defaultModel: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
    });
  });

  it("builds routing context from settings with sttProvider", () => {
    const ctx = buildRoutingContextFromSettings({
      provider: "groq",
      sttProvider: "openrouter",
      sttModel: "automatic",
      preferLocal: false,
      automaticFallback: true,
    });
    expect(ctx.sttProvider).toBe("openrouter");
    expect(ctx.forceOffline).toBe(false);
    expect(resolveSttProvider({ provider: "groq", sttProvider: "openrouter" })).toBe("openrouter");
  });
});

describe("OpenRouter ASR catalog", () => {
  it("filters to audio-capable models and merges curated list", () => {
    const models = normalizeAsrModels([
      { id: "vendor/chat-model", architecture: { input_modalities: ["text"] } },
      {
        id: "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b",
        name: "Nemotron",
        architecture: { input_modalities: ["audio"] },
      },
    ]);
    expect(models.some((m) => m.id.includes("nemotron"))).toBe(true);
    expect(models.length).toBeGreaterThanOrEqual(OPENROUTER_ASR_CURATED.length);
  });
});

describe("STT routing adversary", () => {
  it("offline/local provider never includes cloud providers", () => {
    const chain = buildFallbackChain({
      mode: TranscriptionMode.Auto,
      sttProvider: "local",
      forceOffline: true,
      localNemotronInstalled: true,
    });
    expect(chain.every((id) => id.startsWith("local:"))).toBe(true);
    expect(chain).not.toContain("openrouter:nemotron-3.5");
  });

  it("openrouter explicit provider excludes local even when preferLocal is true", () => {
    const chain = buildFallbackChain({
      mode: TranscriptionMode.Auto,
      sttProvider: "openrouter",
      preferLocal: true,
      localNemotronInstalled: true,
    });
    expect(chain[0]).toBe("openrouter:nemotron-3.5");
    expect(chain).not.toContain("local:nemotron-3.5");
  });

  it("disables fallback chain when automaticFallback is false", () => {
    const chain = buildFallbackChain({
      mode: TranscriptionMode.Fast,
      sttProvider: "openrouter",
      sttModel: LOGICAL_STT_MODEL_KEYS.QWEN_17,
      automaticFallback: false,
    });
    expect(chain).toEqual(["openrouter:qwen3-asr-1.7b"]);
  });
});
