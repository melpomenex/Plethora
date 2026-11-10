import { describe, expect, it } from "vitest";
import { resolveConfiguredContextTokens, resolveRequestPolicy } from "../policy";
import type { LLMProvider } from "../types";

describe("Context Window Precedence and Sizing across Provider Adapters", () => {
  const providers: LLMProvider[] = [
    "openrouter",
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "ollama",
  ];

  const testTokenSizes = [
    { label: "4k", tokens: 4096 },
    { label: "8k", tokens: 8192 },
    { label: "16k", tokens: 16384 },
    { label: "32k", tokens: 32768 },
    { label: "50k", tokens: 50000 },
    { label: "64k", tokens: 65536 },
    { label: "128k", tokens: 131072 },
  ];

  for (const provider of providers) {
    describe(`Provider: ${provider}`, () => {
      for (const { label, tokens } of testTokenSizes) {
        it(`faithfully respects explicit ${label} (${tokens}) context override`, () => {
          const resolved = resolveConfiguredContextTokens({
            configuredContextOverride: tokens,
            globalContextTokens: 8192,
          });
          expect(resolved).toBe(tokens);

          const policy = resolveRequestPolicy({
            provider,
            configuredContextOverride: tokens,
            globalContextTokens: 8192,
          });
          expect(policy.configuredContextTokens).toBe(tokens);
          expect(policy.promptBudgetTokens).toBeGreaterThan(0);
          expect(policy.promptBudgetTokens).toBeLessThan(tokens);
        });

        it(`faithfully respects ${label} (${tokens}) globalContextTokens when provider override is unset`, () => {
          const resolved = resolveConfiguredContextTokens({
            configuredContextOverride: undefined,
            providerContextTokens: undefined,
            globalContextTokens: tokens,
          });
          expect(resolved).toBe(tokens);

          const policy = resolveRequestPolicy({
            provider,
            configuredContextOverride: undefined,
            globalContextTokens: tokens,
          });
          expect(policy.configuredContextTokens).toBe(tokens);
        });
      }
    });
  }

  it("explicitly ensures a 50,000-token global setting with unset provider override does NOT fall back to 8,192 tokens", () => {
    for (const provider of providers) {
      const policy = resolveRequestPolicy({
        provider,
        configuredContextOverride: undefined,
        globalContextTokens: 50000,
      });

      expect(policy.configuredContextTokens).toBe(50000);
      expect(policy.configuredContextTokens).not.toBe(8192);
      expect(policy.promptBudgetTokens).toBeGreaterThan(40000);
    }
  });

  it("strictly enforces full precedence hierarchy", () => {
    // 1. Model override beats everything below
    expect(
      resolveConfiguredContextTokens({
        perModelOverride: 100000,
        providerContextTokens: 64000,
        autoPreset: 32000,
        globalContextTokens: 50000,
        discoveredNumCtx: 16000,
      }),
    ).toBe(100000);

    // 2. Explicit configured override beats provider setting
    expect(
      resolveConfiguredContextTokens({
        configuredContextOverride: 90000,
        providerContextTokens: 64000,
        globalContextTokens: 50000,
      }),
    ).toBe(90000);

    // 3. Provider setting beats global setting when autoPreset is false
    expect(
      resolveConfiguredContextTokens({
        providerContextTokens: 64000,
        autoPreset: false,
        globalContextTokens: 50000,
      }),
    ).toBe(64000);

    // 4. Auto preset evaluates within [4096, 16384] bounded by global setting
    expect(
      resolveConfiguredContextTokens({
        autoPreset: true,
        globalContextTokens: 50000,
      }),
    ).toBe(16384);

    // 4. Global setting beats discovered runtime and conservative fallback
    expect(
      resolveConfiguredContextTokens({
        globalContextTokens: 50000,
        discoveredNumCtx: 16000,
      }),
    ).toBe(50000);

    // 5. Discovered runtime beats conservative fallback
    expect(
      resolveConfiguredContextTokens({
        discoveredNumCtx: 16384,
      }),
    ).toBe(16384);

    // 6. Conservative fallback when nothing is configured
    expect(
      resolveConfiguredContextTokens({}),
    ).toBe(8192);
  });
});
