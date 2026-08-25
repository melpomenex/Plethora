import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../../../stores/settingsStore";
import { FoundryLocalProvider, FOUNDRY_LOCAL_PROVIDER_ID } from "../foundryLocalProvider";
import { AIError } from "../../errors";

const foundry = vi.hoisted(() => ({
  status: vi.fn(),
  chat: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("../../foundryLocal/client", () => ({
  getFoundryStatus: (...args: unknown[]) => foundry.status(...args),
  chatCompletions: (...args: unknown[]) => foundry.chat(...args),
  chatCompletionsStream: (...args: unknown[]) => foundry.stream(...args),
  countFoundryTokens: vi.fn(async () => ({ tokenCount: 12 })),
}));

function enableFoundry(enabled = true) {
  useSettingsStore.setState((s) => ({
    ...s,
    settings: {
      ...s.settings,
      foundryLocal: {
        enabled,
        baseUrl: "http://127.0.0.1:5273",
        model: "phi-4-mini",
      },
    },
  }));
}

describe("FoundryLocalProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableFoundry(true);
    foundry.status.mockResolvedValue({
      status: "available",
      configuredModel: "phi-4-mini",
      loadedModels: ["phi-4-mini"],
      cachedModels: ["phi-4-mini"],
      checkedAt: Date.now(),
    });
    foundry.chat.mockResolvedValue({
      id: "chat-1",
      model: "phi-4-mini",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    });
  });

  it("reports text generation when runtime and model are ready", async () => {
    const caps = await new FoundryLocalProvider().getCapabilities();
    expect(caps.textGeneration).toBe(true);
    expect(caps.downloadState).toBe("downloaded");
    expect(caps.offlineAvailable).toBe(true);
  });

  it("returns dead capabilities when disabled in settings", async () => {
    enableFoundry(false);
    const caps = await new FoundryLocalProvider().getCapabilities();
    expect(caps.textGeneration).toBe(false);
  });

  it("maps model_downloadable to ModelDownloadRequired on generate", async () => {
    foundry.status.mockResolvedValueOnce({
      status: "model_downloadable",
      reason: "model_not_cached",
      checkedAt: Date.now(),
    });

    await expect(
      new FoundryLocalProvider().generateStream({
        requestId: "r1",
        text: "summarize",
      })
    ).rejects.toMatchObject({
      category: "ModelDownloadRequired",
      code: "model_downloadable",
      providerId: FOUNDRY_LOCAL_PROVIDER_ID,
    });
  });

  it("maps runtime_unavailable to ProviderOffline on generate", async () => {
    foundry.status.mockResolvedValueOnce({
      status: "runtime_unavailable",
      reason: "connection_failed",
      checkedAt: Date.now(),
    });

    await expect(
      new FoundryLocalProvider().generateStream({
        requestId: "r1",
        text: "summarize",
      })
    ).rejects.toMatchObject({
      category: "ProviderOffline",
      code: "runtime_unavailable",
    });
  });

  it("generates text through the chat completions client", async () => {
    const response = await new FoundryLocalProvider().generateStream(
      {
        requestId: "r1",
        text: "summarize this",
        systemInstruction: "be concise",
      },
      { stream: false }
    );

    expect(foundry.chat).toHaveBeenCalled();
    expect(response.text).toBe("hello");
    expect(response.baseModelName).toBe("phi-4-mini");
  });

  it("surfaces cancellation without wrapping as generation failure", async () => {
    foundry.stream.mockRejectedValueOnce(
      new AIError("Cancelled", "Request cancelled", {
        code: "cancelled",
        providerId: FOUNDRY_LOCAL_PROVIDER_ID,
      })
    );

    await expect(
      new FoundryLocalProvider().generateStream({
        requestId: "r1",
        text: "summarize",
      })
    ).rejects.toMatchObject({ category: "Cancelled" });
  });
});
