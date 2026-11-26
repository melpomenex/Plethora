import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultLanguageProcessingRegistry } from "../../languageProcessing/registry";
import { getLanguageAdapterPackResolver, setLanguageAdapterPackResolver } from "../../languageProcessing/adapters/shared";
import {
  clearLanguageAdapterPackBridgeCache,
  createLanguageAdapterPackResolver,
  ensureLanguageAdapterPackBridge,
} from "../adapterBridge";

vi.mock("../../../api/languagePacks", () => ({
  lookupLanguagePackDictionary: vi.fn(async () => []),
}));

describe("language pack adapter bridge", () => {
  afterEach(() => {
    setLanguageAdapterPackResolver(null);
    clearLanguageAdapterPackBridgeCache();
  });

  it("installs pack resolver idempotently and falls back to starter pack entries", async () => {
    ensureLanguageAdapterPackBridge(true);
    expect(getLanguageAdapterPackResolver()).not.toBeNull();

    const resolver = createLanguageAdapterPackResolver();
    const esHit = await resolver.lookupToken?.("hablo", "hablo", "es");
    expect(esHit?.lemma).toBe("hablar");
    expect(esHit?.pos).toBe("verb");
  });

  it("augments local registry analysis with pack lemma/reading metadata", async () => {
    setLanguageAdapterPackResolver({
      lookupToken: async (_surface, normalized) =>
        normalized === "食べた"
          ? { lemma: "食べる", pos: "verb", reading: "たべた", confidence: 0.96 }
          : null,
    });
    const registry = createDefaultLanguageProcessingRegistry();
    const adapter = registry.select({ languageTag: "ja" }).adapter!;
    expect(adapter.id).toBe("local-japanese");
    const chunk = await adapter.analyze({
      languageTag: "ja",
      text: "食べた",
      contentFingerprint: "fp-pack-bridge",
    });
    expect(chunk.tokens.length).toBeGreaterThanOrEqual(1);
    expect(chunk.tokens[0]?.lemma).toBe("食べる");
  });
});
