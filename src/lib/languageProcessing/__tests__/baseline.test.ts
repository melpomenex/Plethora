import {
  baselineAdapter,
  exactFormFallbackAdapter,
} from "../baseline";
import { LanguageProcessingAdapterRegistry } from "../registry";
import { capabilityDiagnostics } from "../diagnostics";

describe("baseline language adapter", () => {
  it("returns deterministic source-safe Spanish exact forms", async () => {
    const text = "Estoy hablando español.";
    const first = await baselineAdapter.analyze({ text, languageTag: "es" });
    const second = await baselineAdapter.analyze({ text, languageTag: "es" });
    expect(first.tokens.map((token) => token.id)).toEqual(second.tokens.map((token) => token.id));
    expect(first.tokens.map((token) => text.slice(token.start, token.end))).toEqual(first.tokens.map((token) => token.surface));
    expect(first.tokens.find((token) => token.surface === "hablando")?.lemma).toBeUndefined();
    expect(first.tokens.find((token) => token.surface === "hablando")?.normalized).toBe("hablando");
  });

  it("segments Japanese and exposes no invented morphology", async () => {
    const result = await baselineAdapter.analyze({ text: "日本語を読む。", languageTag: "ja" });
    expect(result.tokens.filter((token) => token.isLexical).length).toBeGreaterThan(1);
    expect(result.tokens.every((token) => token.lemma === undefined && token.morphology === undefined)).toBe(true);
  });

  it("chooses local first and exact-form when an advanced capability is unavailable", () => {
    const registry = new LanguageProcessingAdapterRegistry([baselineAdapter, exactFormFallbackAdapter]);
    expect(registry.select({ languageTag: "en" }).adapter.id).toBe("intl-baseline");
    const selection = registry.select({ languageTag: "ar", requiredCapabilities: ["lemma"], allowCloud: false });
    expect(selection.adapter.id).toBe("exact-form-fallback");
    expect(selection.fallbackUsed).toBe(true);
    const diagnostics = capabilityDiagnostics(registry, "ar", { requiredCapabilities: ["lemma"] });
    expect(diagnostics.unavailableCapabilities).toContain("lemma");
    expect(diagnostics.providers.some((provider) => provider.sendsTextOffDevice)).toBe(false);
  });

  it("keeps offline reading available when the only advanced provider is cloud", async () => {
    const cloud = {
      ...baselineAdapter,
      id: "configured-cloud",
      kind: "cloud" as const,
      manifest: {
        ...baselineAdapter.manifest,
        adapterId: "configured-cloud",
        kind: "cloud" as const,
        requiresCredentials: true,
        sendsTextOffDevice: true,
        capabilities: {
          ...baselineAdapter.manifest.capabilities,
          lemma: { supported: true, confidence: { score: null, label: "unknown" as const }, offline: false },
        },
        privacyDisclosure: "Sends the requested chunk to the configured cloud provider.",
      },
      supports: () => true,
    };
    const registry = new LanguageProcessingAdapterRegistry([cloud, exactFormFallbackAdapter]);
    const selection = registry.select({ languageTag: "xx", requiredCapabilities: ["lemma"], allowCloud: true, online: false }, { online: false, allowCloud: true, hasCredentials: () => true });
    expect(selection.adapter.id).toBe("exact-form-fallback");
    expect(selection.considered.find((item) => item.adapterId === "configured-cloud")?.reason).toBe("offline");
    const result = await selection.adapter.analyze({ text: "offline text", languageTag: "xx" });
    expect(result.tokens.length).toBeGreaterThan(0);
  });
});
