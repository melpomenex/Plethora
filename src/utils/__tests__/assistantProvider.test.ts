import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  ASSISTANT_PROVIDER_STORAGE_KEY,
  getStoredAssistantProvider,
  isAssistantProviderId,
  persistAssistantProvider,
} from "../assistantProvider";

describe("assistant provider persistence", () => {
  const KEY = ASSISTANT_PROVIDER_STORAGE_KEY;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("isAssistantProviderId accepts every known provider", () => {
    for (const id of [
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "ollama",
      "openrouter",
      "ondevice-apple-foundation",
    ]) {
      expect(isAssistantProviderId(id)).toBe(true);
    }
  });

  it("isAssistantProviderId accepts ondevice-apple-foundation", () => {
    expect(isAssistantProviderId("ondevice-apple-foundation")).toBe(true);
  });

  it("isAssistantProviderId rejects unknown values", () => {
    expect(isAssistantProviderId("groq")).toBe(false);
    expect(isAssistantProviderId("")).toBe(false);
    expect(isAssistantProviderId(null)).toBe(false);
    expect(isAssistantProviderId(42)).toBe(false);
    expect(isAssistantProviderId(undefined)).toBe(false);
  });

  it("returns the stored provider when valid", () => {
    localStorage.setItem(KEY, "anthropic");
    expect(getStoredAssistantProvider()).toBe("anthropic");
  });

  it("falls back to the default when nothing is stored", () => {
    expect(getStoredAssistantProvider()).toBe("openai");
  });

  it("falls back to the default when the stored value is invalid", () => {
    localStorage.setItem(KEY, "not-a-provider");
    expect(getStoredAssistantProvider()).toBe("openai");
  });

  it("honors a custom fallback", () => {
    localStorage.setItem(KEY, "bogus");
    expect(getStoredAssistantProvider("ollama")).toBe("ollama");
  });

  it("persists the provider", () => {
    persistAssistantProvider("deepseek");
    expect(localStorage.getItem(KEY)).toBe("deepseek");
  });

  it("survives a reload: persisted value is read back by a fresh call", () => {
    persistAssistantProvider("openrouter");
    // Simulate a page reload: fresh read from the same storage.
    expect(getStoredAssistantProvider()).toBe("openrouter");
  });

  it("persists and restores ondevice-apple-foundation", () => {
    persistAssistantProvider("ondevice-apple-foundation");
    expect(localStorage.getItem(KEY)).toBe("ondevice-apple-foundation");
    expect(getStoredAssistantProvider()).toBe("ondevice-apple-foundation");
  });

  it("does not throw when localStorage.setItem is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => persistAssistantProvider("ollama")).not.toThrow();
  });

  it("does not throw and falls back when localStorage.getItem is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => getStoredAssistantProvider()).not.toThrow();
    expect(getStoredAssistantProvider()).toBe("openai");
  });
});
