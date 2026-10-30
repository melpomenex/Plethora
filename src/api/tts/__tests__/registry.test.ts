import { describe, expect, it, vi } from "vitest";
import { getAdapter, listAdapters } from "../registry";
import { normalizeOpenAICompatibleBaseUrl } from "../providers/openai-compatible";

describe("TTS adapter registry", () => {
  it("registers all ten providers", () => {
    expect(listAdapters()).toHaveLength(10);
    expect(listAdapters().map((adapter) => adapter.id)).toEqual(
      expect.arrayContaining([
        "fal",
        "groq",
        "pocket",
        "system",
        "openrouter",
        "elevenlabs",
        "openai",
        "openai-compatible",
        "android",
        "plethora",
      ])
    );
  });

  it("includes the native android provider as a local provider", () => {
    const android = getAdapter("android");
    expect(android.id).toBe("android");
    expect(android.kind).toBe("local");
    expect(android.auth.mode).toBe("none");
    expect(android.capabilities.supportsSpeed).toBe(true);
  });

  it("falls back unknown persisted ids to system with a notice", () => {
    const notice = vi.fn();
    expect(getAdapter("missing-provider", notice).id).toBe("system");
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("missing-provider"));
  });

  it("normalizes OpenAI-compatible base URLs", () => {
    expect(normalizeOpenAICompatibleBaseUrl("https://example.local/v1///")).toBe("https://example.local/v1");
  });
});
