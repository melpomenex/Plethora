import { describe, expect, it } from "vitest";
import { isLocalBaseUrl, providerRequiresApiKey } from "../llmProviderUtils";

describe("llmProviderUtils", () => {
  it("treats localhost OpenAI-compatible endpoints as local", () => {
    expect(isLocalBaseUrl("http://localhost:8080/v1")).toBe(true);
    expect(isLocalBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalBaseUrl("https://api.openai.com/v1")).toBe(false);
  });

  it("does not require an API key for local openai-compatible endpoints, but still requires one for cloud providers", () => {
    expect(providerRequiresApiKey("openai", "http://localhost:8080/v1")).toBe(false);
    expect(providerRequiresApiKey("openai", "https://api.openai.com/v1")).toBe(true);
    expect(providerRequiresApiKey("anthropic", "https://api.anthropic.com/v1")).toBe(true);
    expect(providerRequiresApiKey("ollama", "http://localhost:11434/v1")).toBe(false);
  });

  it("always requires an API key for DeepSeek, even against a local-looking base URL", () => {
    expect(providerRequiresApiKey("deepseek", "https://api.deepseek.com/v1")).toBe(true);
    expect(providerRequiresApiKey("deepseek", "http://localhost:8080/v1")).toBe(true);
    expect(providerRequiresApiKey("deepseek", undefined)).toBe(true);
  });
});
