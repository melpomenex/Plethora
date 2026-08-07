import { afterEach, describe, expect, it, vi } from "vitest";
import { browserInvoke, normalizeOpenRouterPricing } from "../browser-backend";

// Parity fixture with the Rust unit test in
// src-tauri/src/commands/llm.rs (openrouter_pricing_is_normalized_to_per_1k):
// the two backends must produce identical ModelPricing values.
const OPENROUTER_PAYLOAD = {
  data: [
    {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      context_length: 200000,
      pricing: {
        prompt: "0.000003",
        completion: "0.000015",
        input_cache_read: "0.0000003",
        input_cache_write: "0.00000375",
        request: "0.0000001",
        image: "0.01",
        web_search: "0.000002",
      },
    },
    {
      id: "free-model",
      pricing: { prompt: "0", completion: 0 },
    },
    {
      id: "unpriced-model",
      pricing: { prompt: "-1", completion: "abc", web_search: null },
    },
    {
      id: "no-pricing",
    },
    {
      id: "legacy-keys",
      pricing: { cache_read: "0.000001", cache_write: "0.000002" },
    },
  ],
};

describe("normalizeOpenRouterPricing", () => {
  it("parses string prices, scales per-token fields ×1000 and leaves per-call fields unscaled", () => {
    const pricing = normalizeOpenRouterPricing(OPENROUTER_PAYLOAD.data[0].pricing);
    expect(pricing).toBeDefined();
    expect(pricing!.prompt).toBeCloseTo(0.003, 12);
    expect(pricing!.completion).toBeCloseTo(0.015, 12);
    expect(pricing!.cache_read).toBeCloseTo(0.0003, 12);
    expect(pricing!.cache_write).toBeCloseTo(0.00375, 12);
    // request/image/web_search are per-call: never scaled.
    expect(pricing!.request).toBeCloseTo(0.0000001, 12);
    expect(pricing!.image).toBeCloseTo(0.01, 12);
    expect(pricing!.web_search).toBeCloseTo(0.000002, 12);
  });

  it("keeps \"0\" (string or number) as free", () => {
    const pricing = normalizeOpenRouterPricing(OPENROUTER_PAYLOAD.data[1].pricing);
    expect(pricing!.prompt).toBe(0);
    expect(pricing!.completion).toBe(0);
  });

  it("treats negative sentinels, unparseable strings and null as unknown", () => {
    const pricing = normalizeOpenRouterPricing(OPENROUTER_PAYLOAD.data[2].pricing);
    expect(pricing!.prompt).toBeUndefined();
    expect(pricing!.completion).toBeUndefined();
    expect(pricing!.web_search).toBeUndefined();
  });

  it("rejects strings with trailing junk (full-string parse, matching Rust)", () => {
    const pricing = normalizeOpenRouterPricing({
      prompt: "1.5junk",
      completion: " 0.003 ",
    });
    expect(pricing!.prompt).toBeUndefined();
    // Whitespace is trimmed, then the per-token value is scaled ×1000.
    expect(pricing!.completion).toBeCloseTo(3, 12);
  });

  it("returns undefined when pricing is missing", () => {
    expect(normalizeOpenRouterPricing(OPENROUTER_PAYLOAD.data[3].pricing)).toBeUndefined();
    expect(normalizeOpenRouterPricing(undefined)).toBeUndefined();
  });

  it("falls back to legacy cache_read/cache_write keys", () => {
    const pricing = normalizeOpenRouterPricing(OPENROUTER_PAYLOAD.data[4].pricing);
    expect(pricing!.cache_read).toBeCloseTo(0.001, 12);
    expect(pricing!.cache_write).toBeCloseTo(0.002, 12);
  });
});

describe("browser backend OpenRouter model discovery", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("returns normalized per-1K pricing (including cache fields) from the OpenRouter branch", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => OPENROUTER_PAYLOAD,
    }) as typeof fetch;

    const models = await browserInvoke<
      Array<{ id: string; pricing: { prompt: number; completion: number; cache_read: number; cache_write: number } }>
    >("llm_get_models", {
      provider: "openrouter",
      apiKey: "sk-test",
    });

    const sonnet = models.find((m) => m.id === "anthropic/claude-3.5-sonnet")!;
    expect(sonnet.pricing.prompt).toBeCloseTo(0.003, 12);
    expect(sonnet.pricing.completion).toBeCloseTo(0.015, 12);
    expect(sonnet.pricing.cache_read).toBeCloseTo(0.0003, 12);
    expect(sonnet.pricing.cache_write).toBeCloseTo(0.00375, 12);

    const free = models.find((m) => m.id === "free-model")!;
    expect(free.pricing.prompt).toBe(0);

    const unpriced = models.find((m) => m.id === "unpriced-model")!;
    expect(unpriced.pricing.prompt).toBeUndefined();
    expect(unpriced.pricing.completion).toBeUndefined();
  });
});
