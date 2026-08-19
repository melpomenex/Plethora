/**
 * Tests for the shared paid-operation consent gate (ai-billing-safety #14).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_EMBEDDING_PROVIDERS,
  PAID_TTS_PROVIDERS,
  clearPaidConsentDenials,
  clearPaidConsentDenialsFor,
  cloudEmbeddingRequiresConsent,
  cloudTtsRequiresConsent,
  getPaidConsentHandler,
  isPaidEmbeddingProvider,
  isPaidTtsProvider,
  paidEmbeddingsEnabled,
  paidTtsEnabled,
  requestPaidConsent,
  setPaidConsentHandler,
} from "../aiBillingConsent";
import { useSettingsStore } from "../../stores/settingsStore";

describe("paid provider classification", () => {
  it("treats OpenAI/Cohere/OpenRouter embeddings as paid, Ollama as local", () => {
    expect(isPaidEmbeddingProvider("openai")).toBe(true);
    expect(isPaidEmbeddingProvider("cohere")).toBe(true);
    expect(isPaidEmbeddingProvider("openrouter")).toBe(true);
    expect(isPaidEmbeddingProvider("ollama")).toBe(false);
    for (const provider of CLOUD_EMBEDDING_PROVIDERS) {
      expect(isPaidEmbeddingProvider(provider)).toBe(true);
    }
  });

  it("treats fal/groq/openrouter/elevenlabs/openai/plethora TTS as paid, pocket/system/android as local", () => {
    for (const provider of PAID_TTS_PROVIDERS) {
      expect(isPaidTtsProvider(provider)).toBe(true);
    }
    expect(isPaidTtsProvider("pocket")).toBe(false);
    expect(isPaidTtsProvider("system")).toBe(false);
    expect(isPaidTtsProvider("android")).toBe(false);
    // openai-compatible commonly points at a local server — not gated.
    expect(isPaidTtsProvider("openai-compatible")).toBe(false);
  });
});

describe("consent flags (persisted)", () => {
  it("reads paidEmbeddingsEnabled from an explicit settings arg", () => {
    expect(
      paidEmbeddingsEnabled({ embedding: { paidEmbeddingsEnabled: true } })
    ).toBe(true);
    expect(
      paidEmbeddingsEnabled({ embedding: { paidEmbeddingsEnabled: false } })
    ).toBe(false);
  });

  it("reads paidTtsEnabled from an explicit settings arg", () => {
    expect(paidTtsEnabled({ tts: { paidTtsEnabled: true } })).toBe(true);
    expect(paidTtsEnabled({ tts: { paidTtsEnabled: false } })).toBe(false);
  });

  it("reads the persisted flags from the settings store by default", () => {
    useSettingsStore.setState((s) => ({
      settings: {
        ...s.settings,
        embedding: { ...s.settings.embedding, paidEmbeddingsEnabled: true },
        tts: { ...s.settings.tts, paidTtsEnabled: true },
      },
    }));
    expect(paidEmbeddingsEnabled()).toBe(true);
    expect(paidTtsEnabled()).toBe(true);
  });

  it("cloudEmbeddingRequiresConsent is true only for cloud providers with consent off", () => {
    expect(
      cloudEmbeddingRequiresConsent("openai", { embedding: { paidEmbeddingsEnabled: false } })
    ).toBe(true);
    expect(
      cloudEmbeddingRequiresConsent("openai", { embedding: { paidEmbeddingsEnabled: true } })
    ).toBe(false);
    expect(
      cloudEmbeddingRequiresConsent("ollama", { embedding: { paidEmbeddingsEnabled: false } })
    ).toBe(false);
  });

  it("cloudTtsRequiresConsent is true only for paid providers with consent off", () => {
    expect(
      cloudTtsRequiresConsent("fal", { tts: { paidTtsEnabled: false } })
    ).toBe(true);
    expect(
      cloudTtsRequiresConsent("fal", { tts: { paidTtsEnabled: true } })
    ).toBe(false);
    expect(
      cloudTtsRequiresConsent("pocket", { tts: { paidTtsEnabled: false } })
    ).toBe(false);
  });
});

describe("requestPaidConsent", () => {
  beforeEach(() => {
    setPaidConsentHandler(null);
    clearPaidConsentDenials();
    // Start from the default flags (off) so earlier persisted-flag tests
    // cannot leak into the gate behavior.
    useSettingsStore.setState((s) => ({
      settings: {
        ...s.settings,
        embedding: { ...s.settings.embedding, paidEmbeddingsEnabled: false },
        tts: { ...s.settings.tts, paidTtsEnabled: false },
      },
    }));
  });

  it("denies when no handler is registered (safe default — never silently bill)", async () => {
    await expect(
      requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" })
    ).resolves.toBe(false);
  });

  it("grants when the handler consents", async () => {
    const handler = vi.fn(async () => true);
    setPaidConsentHandler(handler);
    await expect(
      requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" })
    ).resolves.toBe(true);
    expect(handler).toHaveBeenCalledWith({
      kind: "tts",
      provider: "fal",
      label: "Fal",
    });
  });

  it("denies when the handler declines", async () => {
    setPaidConsentHandler(vi.fn(async () => false));
    await expect(
      requestPaidConsent({ kind: "embeddings", provider: "openai", label: "OpenAI" })
    ).resolves.toBe(false);
  });

  it("remembers a denial for the session so queued chunks do not re-prompt", async () => {
    const handler = vi.fn(async () => false);
    setPaidConsentHandler(handler);
    expect(
      await requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" })
    ).toBe(false);
    expect(
      await requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" })
    ).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    // A different provider/kind is a fresh prompt.
    expect(
      await requestPaidConsent({ kind: "tts", provider: "elevenlabs", label: "ElevenLabs" })
    ).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("clears denials after clearPaidConsentDenials()", async () => {
    const handler = vi.fn(async () => false);
    setPaidConsentHandler(handler);
    await requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" });
    clearPaidConsentDenials();
    await requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("exposes the registered handler via getPaidConsentHandler", () => {
    const handler = vi.fn(async () => true);
    setPaidConsentHandler(handler);
    expect(getPaidConsentHandler()).toBe(handler);
  });

  it("does not deadlock after a denial once the persisted flag is enabled", async () => {
    const handler = vi.fn(async () => false);
    setPaidConsentHandler(handler);

    // Deny once — remembered for the session.
    expect(
      await requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" })
    ).toBe(false);
    expect(
      await requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" })
    ).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);

    // The user enables the flag in Settings: consent now resolves immediately,
    // without re-prompting and without a restart.
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, tts: { ...s.settings.tts, paidTtsEnabled: true } },
    }));
    expect(
      await requestPaidConsent({ kind: "tts", provider: "fal", label: "Fal" })
    ).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    // Reset the store flag for other tests.
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, tts: { ...s.settings.tts, paidTtsEnabled: false } },
    }));
  });

  it("enabling the flag via the handler clears the session denial for that kind", async () => {
    const handler = vi.fn(async () => false);
    setPaidConsentHandler(handler);
    expect(
      await requestPaidConsent({ kind: "embeddings", provider: "openai", label: "OpenAI" })
    ).toBe(false);

    // A different provider of the same kind is now enabled via the handler;
    // clearPaidConsentDenialsFor("embeddings") drops every embeddings denial.
    clearPaidConsentDenialsFor("embeddings");
    handler.mockResolvedValue(true);
    expect(
      await requestPaidConsent({ kind: "embeddings", provider: "openai", label: "OpenAI" })
    ).toBe(true);
  });
});
