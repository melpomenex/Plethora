import { describe, expect, it } from "vitest";
import {
  AUTO_CONTEXT_CEILING,
  MIN_PROMPT_HEADROOM,
  resolveAutoContext,
  resolveRequestPolicy,
} from "../policy";

describe("resolveRequestPolicy", () => {
  it("keeps context and max output independent", () => {
    const policy = resolveRequestPolicy({
      provider: "ollama",
      configuredContextOverride: 16384,
      maxOutputOverride: 2048,
      applyOllamaDefaultGuard: true,
    });
    expect(policy.configuredContextTokens).toBe(16384);
    expect(policy.maxOutputTokens).toBe(2048);
    expect(policy.promptBudgetTokens).toBeLessThanOrEqual(14336);
  });

  it("bumps typical 4096/4096 defaults so prompt budget is usable", () => {
    const policy = resolveRequestPolicy({
      provider: "ollama",
      globalContextTokens: 4096,
      providerMaxOutput: 4096,
      applyOllamaDefaultGuard: true,
    });
    expect(policy.promptBudgetTokens).toBeGreaterThanOrEqual(MIN_PROMPT_HEADROOM);
    expect(policy.promptBudgetTokens).not.toBe(0);
  });

  it("resolves Auto within 4K–16K and never to a 128K model max", () => {
    const resolved = resolveAutoContext({
      globalContextTokens: 131072,
      discoveredNumCtx: 131072,
      autoPreset: true,
    });
    expect(resolved).toBe(AUTO_CONTEXT_CEILING);
    const policy = resolveRequestPolicy({
      provider: "ollama",
      autoPreset: true,
      globalContextTokens: 131072,
      discoveredNumCtx: 131072,
      applyOllamaDefaultGuard: true,
    });
    expect(policy.configuredContextTokens).toBeLessThanOrEqual(AUTO_CONTEXT_CEILING);
  });

  describe("precedence order", () => {
    it("respects perModelOverride over providerContextTokens, globalContextTokens, and discoveredNumCtx", () => {
      const policy = resolveRequestPolicy({
        perModelOverride: 64000,
        providerContextTokens: 32000,
        globalContextTokens: 16000,
        discoveredNumCtx: 8192,
      });
      expect(policy.configuredContextTokens).toBe(64000);
    });

    it("respects perModelOverride even when autoPreset is true", () => {
      const policy = resolveRequestPolicy({
        perModelOverride: 64000,
        autoPreset: true,
        globalContextTokens: 16000,
        discoveredNumCtx: 8192,
      });
      expect(policy.configuredContextTokens).toBe(64000);
    });

    it("respects providerContextTokens over globalContextTokens and discoveredNumCtx", () => {
      const policy = resolveRequestPolicy({
        providerContextTokens: 32000,
        globalContextTokens: 16000,
        discoveredNumCtx: 8192,
      });
      expect(policy.configuredContextTokens).toBe(32000);
    });

    it("respects globalContextTokens over discoveredNumCtx and conservative fallback", () => {
      const policy = resolveRequestPolicy({
        globalContextTokens: 50000,
        discoveredNumCtx: 8192,
      });
      expect(policy.configuredContextTokens).toBe(50000);
    });

    it("resolves globalContextTokens of 50,000 without falling back to 8,192", () => {
      const policy = resolveRequestPolicy({
        globalContextTokens: 50000,
      });
      expect(policy.configuredContextTokens).toBe(50000);
    });

    it("respects discoveredNumCtx over conservative fallback", () => {
      const policy = resolveRequestPolicy({
        discoveredNumCtx: 12000,
      });
      expect(policy.configuredContextTokens).toBe(12000);
    });

    it("falls back to CONSERVATIVE_CONTEXT_FALLBACK (8192) when all inputs unset", () => {
      const policy = resolveRequestPolicy({});
      expect(policy.configuredContextTokens).toBe(8192);
    });
  });
});
