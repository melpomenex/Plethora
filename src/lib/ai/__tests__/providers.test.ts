import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    generateNativePrompt: vi.fn(),
    generateStreamingPrompt: vi.fn(),
    countNativePromptTokens: vi.fn(),
    cancelNativePromptRequest: vi.fn(),
    warmUpOnDevicePrompt: vi.fn(),
    getOnDeviceAiCapabilities: vi.fn(),
  };
});

import {
  OnDeviceAiError,
  generateNativePrompt,
  generateStreamingPrompt,
  getOnDeviceAiCapabilities,
  cancelNativePromptRequest,
  type OnDeviceCapabilitySnapshot,
} from "../onDeviceAI";
import {
  capabilitiesFromSnapshot,
  getOnDeviceProvider,
  toNativeRequest,
} from "../providers/onDeviceProvider";
import {
  CloudProvider,
  capabilitiesFromCloudConfig,
  cloudModelSupportsReasoning,
} from "../providers/cloudProvider";
import { getRoutingProviders } from "../providers";
import { AIError } from "../errors";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../stores/llmProvidersStore";
import type { LLMRequest, LLMResponse, StreamOptions } from "../../../api/llm";

function snapshot(
  overrides: Partial<OnDeviceCapabilitySnapshot> = {}
): OnDeviceCapabilitySnapshot {
  return {
    prompt: { status: "available" },
    summarization: { status: "available" },
    imagePrompt: { status: "available" },
    structuredOutputCompiled: true,
    structuredOutput: true,
    systemInstructions: true,
    prefixCaching: true,
    imageInput: true,
    multiImage: true,
    streaming: true,
    baseModelName: "gemini-nano",
    tokenLimit: 4096,
    checkedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOnDeviceAiCapabilities).mockResolvedValue(snapshot());
  useLLMProvidersStore.setState({ providers: [] });
});

describe("capabilitiesFromSnapshot", () => {
  it("maps a fully available snapshot", () => {
    const caps = capabilitiesFromSnapshot(snapshot());
    expect(caps.textGeneration).toBe(true);
    expect(caps.structuredGeneration).toBe(true);
    expect(caps.vision).toBe(true);
    expect(caps.multiImage).toBe(true);
    expect(caps.systemInstructions).toBe(true);
    expect(caps.streaming).toBe(true);
    expect(caps.prefixCaching).toBe(true);
    expect(caps.offlineAvailable).toBe(true);
    expect(caps.contextTokens).toBe(4096);
    expect(caps.downloadState).toBe("downloaded");
    // Design D2: Nano declares neither reasoning nor tools/embeddings yet.
    expect(caps.reasoning).toBe(false);
    expect(caps.toolCalling).toBe(false);
    expect(caps.embeddings).toBe(false);
  });

  it("structuredGeneration requires the compiled schema path AND the runtime flag", () => {
    expect(
      capabilitiesFromSnapshot(snapshot({ structuredOutputCompiled: false })).structuredGeneration
    ).toBe(false);
    expect(
      capabilitiesFromSnapshot(snapshot({ structuredOutput: false })).structuredGeneration
    ).toBe(false);
    expect(
      capabilitiesFromSnapshot(snapshot({ prompt: { status: "downloading" } })).structuredGeneration
    ).toBe(false);
  });

  it("vision requires both imagePrompt availability and imageInput", () => {
    expect(capabilitiesFromSnapshot(snapshot({ imageInput: false })).vision).toBe(false);
    expect(
      capabilitiesFromSnapshot(snapshot({ imagePrompt: { status: "unavailable" } })).vision
    ).toBe(false);
  });

  it("maps model download states", () => {
    expect(
      capabilitiesFromSnapshot(snapshot({ prompt: { status: "downloadable" } })).downloadState
    ).toBe("downloadable");
    expect(
      capabilitiesFromSnapshot(snapshot({ prompt: { status: "downloading" } })).downloadState
    ).toBe("downloading");
    expect(
      capabilitiesFromSnapshot(
        snapshot({ prompt: { status: "unavailable", reason: "model_unavailable" } })
      ).downloadState
    ).toBe("unavailable");
    expect(
      capabilitiesFromSnapshot(
        snapshot({ prompt: { status: "unavailable", reason: "platform_unsupported" } })
      ).downloadState
    ).toBe("not-applicable");
  });

  it("falls back to a 4096 context when tokenLimit is unknown", () => {
    expect(capabilitiesFromSnapshot(snapshot({ tokenLimit: undefined })).contextTokens).toBe(4096);
  });

  it("reports no generation on an unsupported platform", () => {
    const caps = capabilitiesFromSnapshot(
      snapshot({
        prompt: { status: "unavailable", reason: "platform_unsupported" },
        summarization: { status: "unavailable", reason: "platform_unsupported" },
        imagePrompt: { status: "unavailable", reason: "platform_unsupported" },
        structuredOutputCompiled: false,
        structuredOutput: false,
        systemInstructions: false,
        prefixCaching: false,
        imageInput: false,
        multiImage: false,
        streaming: false,
        tokenLimit: undefined,
      })
    );
    expect(caps.textGeneration).toBe(false);
    expect(caps.offlineAvailable).toBe(false);
  });
});

describe("OnDeviceProvider", () => {
  it("streams through generateStreamingPrompt and forwards chunks", async () => {
    vi.mocked(generateStreamingPrompt).mockImplementation(async (request, options) => {
      options?.onChunk?.("Hello ");
      options?.onChunk?.("world");
      return {
        requestId: request.requestId,
        text: "Hello world",
        inputTokens: 12,
        tokenLimit: 4096,
        baseModelName: "gemini-nano",
        candidates: [],
      };
    });

    const chunks: string[] = [];
    const res = await getOnDeviceProvider().generateStream(
      { requestId: "req-1", text: "Say hi", systemInstruction: "SYS" },
      { onChunk: (c) => chunks.push(c) }
    );

    expect(chunks).toEqual(["Hello ", "world"]);
    expect(res.text).toBe("Hello world");
    expect(res.baseModelName).toBe("gemini-nano");
    expect(res.usage?.inputTokens).toBe(12);
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-1", systemInstruction: "SYS", text: "Say hi" }),
      expect.anything()
    );
  });

  it("uses the non-streaming native prompt when stream:false", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "req-2",
      text: "bulk",
      inputTokens: 3,
      tokenLimit: 4096,
      candidates: [],
    });

    const res = await getOnDeviceProvider().generateStream(
      { requestId: "req-2", text: "x" },
      { stream: false }
    );

    expect(res.text).toBe("bulk");
    expect(generateStreamingPrompt).not.toHaveBeenCalled();
    // The real generateNativePrompt adds `stream: false` itself before the
    // bridge call; the provider only needs to select the non-streaming path.
    expect(generateNativePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req-2", outputMode: "text" })
    );
  });

  it("folds the system instruction into text when unsupported", () => {
    vi.mocked(getOnDeviceAiCapabilities).mockResolvedValue(
      snapshot({ systemInstructions: false })
    );
    const native = toNativeRequest(
      { requestId: "r", text: "USER", systemInstruction: "SYS" },
      false
    );
    expect(native.text).toBe("SYS\n\nUSER");
    expect(native.systemInstruction).toBeUndefined();
  });

  it("passes structured responses through via the native structured mode", async () => {
    vi.mocked(generateStreamingPrompt).mockResolvedValue({
      requestId: "req-s",
      text: '{"prerequisites":[]}',
      structured: { prerequisites: [] },
      inputTokens: 5,
      tokenLimit: 4096,
      candidates: [],
    });
    const res = await getOnDeviceProvider().generateStream(
      { requestId: "req-s", text: "x", structured: true, schemaName: "prerequisiteAnalysis" }
    );
    expect(res.structured).toEqual({ prerequisites: [] });
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ outputMode: "structured", responseSchema: "prerequisiteAnalysis" }),
      expect.anything()
    );
  });

  it("falls back to text output mode when structured is not compiled", async () => {
    vi.mocked(getOnDeviceAiCapabilities).mockResolvedValue(
      snapshot({ structuredOutputCompiled: false })
    );
    vi.mocked(generateStreamingPrompt).mockResolvedValue({
      requestId: "req-s2",
      text: "plain",
      inputTokens: 5,
      tokenLimit: 4096,
      candidates: [],
    });
    const res = await getOnDeviceProvider().generateStream(
      { requestId: "req-s2", text: "x", structured: true, schemaName: "prerequisiteAnalysis" }
    );
    expect(res.text).toBe("plain");
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ outputMode: "text", responseSchema: undefined }),
      expect.anything()
    );
  });

  it("maps bridge errors into the unified taxonomy", async () => {
    vi.mocked(generateStreamingPrompt).mockRejectedValue(
      new OnDeviceAiError("model_downloading", "42%")
    );
    await expect(
      getOnDeviceProvider().generateStream({ requestId: "req-e", text: "x" })
    ).rejects.toMatchObject({ category: "ModelDownloading", code: "model_downloading" });
  });

  it("cancels through cancelNativePromptRequest", async () => {
    vi.mocked(cancelNativePromptRequest).mockResolvedValue({ requestId: "req-c", cancelled: true });
    await getOnDeviceProvider().cancel("req-c");
    expect(cancelNativePromptRequest).toHaveBeenCalledWith("req-c");
  });
});

describe("CloudProvider", () => {
  function providerConfig(
    overrides: Partial<LLMProviderConfig> = {}
  ): LLMProviderConfig {
    return {
      id: "p1",
      provider: "openai",
      name: "OpenAI",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      enabled: true,
      temperature: 0.7,
      maxTokens: 1024,
      ...overrides,
    };
  }

  it("is ModelUnavailable when nothing is configured", async () => {
    const cloud = new CloudProvider({});
    await expect(cloud.getCapabilities()).resolves.toMatchObject({ textGeneration: false });
    await expect(cloud.generateStream({ requestId: "r", text: "x" })).rejects.toMatchObject({
      category: "ModelUnavailable",
    });
  });

  it("derives capabilities from the active config", () => {
    expect(capabilitiesFromCloudConfig(null).textGeneration).toBe(false);
    expect(
      capabilitiesFromCloudConfig(providerConfig({ provider: "ollama" })).offlineAvailable
    ).toBe(true);
    expect(
      capabilitiesFromCloudConfig(providerConfig({ provider: "ollama" })).contextTokens
    ).toBe(8192);
    // Design D5: cloud uses the strict-JSON fallback, never native schemas.
    expect(capabilitiesFromCloudConfig(providerConfig()).structuredGeneration).toBe(false);
    expect(capabilitiesFromCloudConfig(providerConfig()).vision).toBe(true);
    expect(capabilitiesFromCloudConfig(providerConfig({ provider: "deepseek" })).vision).toBe(false);
    expect(
      capabilitiesFromCloudConfig(providerConfig({ model: "deepseek-reasoner" })).reasoning
    ).toBe(true);
    expect(cloudModelSupportsReasoning("gpt-4o-mini")).toBe(false);
    expect(cloudModelSupportsReasoning("o1-preview")).toBe(true);
  });

  it("sends the system instruction as a system message and emits the whole text", async () => {
    useLLMProvidersStore.setState({ providers: [providerConfig()] });
    const chat = vi.fn(async (request: LLMRequest): Promise<LLMResponse> => {
      expect(request.messages[0]).toEqual({ role: "system", content: "SYS" });
      expect(request.messages[1]).toEqual({ role: "user", content: "USER" });
      return { content: "cloud says hi", usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 } };
    });
    const cloud = new CloudProvider({ chat });

    const chunks: string[] = [];
    const res = await cloud.generateStream(
      { requestId: "rc-1", text: "USER", systemInstruction: "SYS" },
      { onChunk: (c) => chunks.push(c), stream: false }
    );

    expect(res.text).toBe("cloud says hi");
    expect(res.usage?.inputTokens).toBe(5);
    expect(chunks).toEqual(["cloud says hi"]);
  });

  it("streams chunks and reports cancellation when aborted mid-stream", async () => {
    useLLMProvidersStore.setState({ providers: [providerConfig()] });
    const cancelStream = vi.fn(async () => undefined);
    const streamChat = vi.fn<
      (request: LLMRequest, options: { onChunk: (c: string) => void }) => Promise<void>
    >(async (_request, options) => {
      options.onChunk("partial");
      return undefined;
    });
    const cloud = new CloudProvider({ streamChat, cancelStream });

    const controller = new AbortController();
    const chunks: string[] = [];
    const attempt = cloud.generateStream(
      { requestId: "rc-2", text: "x" },
      { signal: controller.signal, onChunk: (c) => chunks.push(c), stream: true }
    );
    controller.abort();
    await expect(attempt).rejects.toMatchObject({ category: "Cancelled" });
    expect(cancelStream).toHaveBeenCalledWith("rc-2");
    expect(chunks).toEqual(["partial"]);
  });

  it("classifies stream errors through the cloud heuristics", async () => {
    useLLMProvidersStore.setState({ providers: [providerConfig()] });
    const streamChat = vi.fn<
      (request: LLMRequest, options: StreamOptions) => Promise<void>
    >(async (_request, options) => {
      options.onError("connection refused by upstream");
      return undefined;
    });
    const cloud = new CloudProvider({ streamChat });
    await expect(
      cloud.generateStream({ requestId: "rc-3", text: "x" }, { stream: true })
    ).rejects.toMatchObject({ category: "ProviderOffline" });
  });

  it("rejects immediately when already aborted", async () => {
    useLLMProvidersStore.setState({ providers: [providerConfig()] });
    const cloud = new CloudProvider({});
    const controller = new AbortController();
    controller.abort();
    await expect(
      cloud.generateStream({ requestId: "rc-4", text: "x" }, { signal: controller.signal })
    ).rejects.toBeInstanceOf(AIError);
  });
});

describe("getRoutingProviders", () => {
  it("orders on-device first by default preference", () => {
    const providers = getRoutingProviders(true);
    expect(providers[0].kind).toBe("ondevice");
    expect(providers[1].kind).toBe("cloud");
  });

  it("orders cloud first when on-device is not preferred", () => {
    const providers = getRoutingProviders(false);
    expect(providers[0].kind).toBe("cloud");
  });
});
