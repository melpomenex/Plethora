/**
 * PinnedCloudProvider (change 2.1): a frozen LLMProviderConfig snapshot serves
 * every request; mid-run store edits cannot alter served requests; the
 * existing singleton + chat path are untouched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PinnedCloudProvider, getCloudProvider, CLOUD_PROVIDER_ID } from "../cloudProvider";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../../stores/llmProvidersStore";

function cfg(overrides: Partial<LLMProviderConfig> = {}): LLMProviderConfig {
  return {
    id: "cfg-1",
    provider: "ollama",
    name: "Config",
    apiKey: "",
    baseUrl: "http://localhost:11434",
    model: "llama3",
    enabled: true,
    temperature: 0.7,
    maxTokens: 4096,
    ...overrides,
  } as LLMProviderConfig;
}

beforeEach(() => {
  useLLMProvidersStore.setState({ providers: [cfg()] as never });
});

describe("PinnedCloudProvider", () => {
  it("serves from the frozen snapshot even after store edits", async () => {
    const chat = vi.fn(async (request: { model?: string }) => ({
      content: "ok",
      baseModelName: request.model,
    }));
    const pinnedRow = cfg({ model: "gemini-2.0-flash", provider: "gemini", apiKey: "sk" });
    const pinned = new PinnedCloudProvider(pinnedRow, { chat: chat as never });

    // Mutate the source object AND the store after construction.
    pinnedRow.model = "changed-after-construction";
    useLLMProvidersStore.setState({ providers: [cfg({ model: "llama3.3" })] as never });

    const response = await pinned.generateStream({
      requestId: "req-1",
      text: "hi",
      maxOutputTokens: 256,
    });
    expect(chat).toHaveBeenCalledTimes(1);
    const servedRequest = chat.mock.calls[0][0] as { model?: string };
    expect(servedRequest.model).toBe("gemini-2.0-flash");
    expect(response.baseModelName).toBe("gemini-2.0-flash");
    expect(response.text).toBe("ok");
  });

  it("exposes the pinned config id and unchanged cloud classification", async () => {
    const pinned = new PinnedCloudProvider(cfg({ provider: "ollama" }), {
      chat: (async () => ({ content: "x" })) as never,
    });
    expect(pinned.id).toBe(`${CLOUD_PROVIDER_ID}:cfg-1`);
    expect(pinned.kind).toBe("cloud");
    const caps = await pinned.getCapabilities();
    expect(caps.textGeneration).toBe(true);
    expect(caps.structuredGeneration).toBe(false);
    expect(caps.offlineAvailable).toBe(true); // ollama stays local-classified
  });

  it("keyless classification works for local endpoints", async () => {
    const pinned = new PinnedCloudProvider(cfg({ provider: "ollama", apiKey: "" }), {
      chat: (async () => ({ content: "x" })) as never,
    });
    const caps = await pinned.getCapabilities();
    expect(caps.offlineAvailable).toBe(true);
    // Local keyless stays non-billable in classification through the task layer.
    expect(pinned.id).toBe(`${CLOUD_PROVIDER_ID}:cfg-1`);
  });
});

describe("shared singleton unchanged", () => {
  it("still resolves the active cloud config per request (live)", async () => {
    const singleton = getCloudProvider();
    expect(singleton.id).toBe(CLOUD_PROVIDER_ID);
    useLLMProvidersStore.setState({
      providers: [cfg({ model: "live-model" })] as never,
    });
    const caps = await singleton.getCapabilities();
    expect(caps.textGeneration).toBe(true);
  });
});
