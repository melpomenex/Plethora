import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../../stores/settingsStore";
import { useToastStore } from "../../../../components/common/Toast";
import {
  FakeAppleFoundationProvider,
  FakeLanguageProvider,
} from "../fakes";
import {
  APPLE_FOUNDATION_PROVIDER_ID,
  getRoutingProviders,
} from "../index";
import { resolveTaskRoute } from "../../tasks/router";
import { resolveAiPath, runAiAction } from "../../provider";
import { UNTRUSTED_CONTAINMENT_CLAUSE } from "../../tasks/containment";
import type { AITaskDefinition } from "../../tasks/types";
import { AIError } from "../../errors";

vi.mock("../../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../../onDeviceAI")>("../../onDeviceAI");
  return {
    ...actual,
    isOnDeviceAiSupportedPlatform: vi.fn(() => false),
    getOnDeviceRequirementStatus: vi.fn(async () => ({
      status: "unavailable" as const,
      reason: "platform_unsupported",
    })),
  };
});

const appleCaps = vi.hoisted(() => ({
  snapshot: vi.fn(),
  isAppleOs: vi.fn(() => true),
}));

vi.mock("../../apple/capabilities", () => ({
  getAppleIntelligenceSnapshot: () => appleCaps.snapshot(),
  isAppleOsPlatform: () => appleCaps.isAppleOs(),
}));

function cloudProvider(overrides: Partial<LLMProviderConfig> = {}): LLMProviderConfig {
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

function promptTask(): AITaskDefinition<unknown, string> {
  return {
    id: "apple-route-task",
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: UNTRUSTED_CONTAINMENT_CLAUSE,
    buildInput: () => ({ text: "hello" }),
    outputKind: "text",
    maxOutputTokens: 128,
    timeoutMs: 5000,
  };
}

function setPreferOnDevice(preferOnDevice: boolean) {
  useSettingsStore.setState((s) => ({
    ...s,
    settings: { ...s.settings, ai: { ...s.settings.ai, preferOnDevice } },
  }));
}

function setAllowCloudFallback(allow: boolean) {
  useSettingsStore.setState((s) => ({
    ...s,
    settings: { ...s.settings, ai: { ...s.settings.ai, allowCloudFallback: allow } },
  }));
}

function availableAppleSnapshot() {
  return {
    appleOs: true,
    foundationModels: { status: "available" as const },
    speech: { status: "unavailable" as const },
    visionDocuments: { status: "unavailable" as const },
    spotlightSemantic: { status: "unavailable" as const },
    naturalLanguageEmbeddings: { status: "unavailable" as const },
    coreAi: { status: "unavailable" as const },
    checkedAt: Date.now(),
  };
}

function unavailableAppleSnapshot() {
  return {
    appleOs: true,
    foundationModels: { status: "unavailable" as const, reason: "unsupported_os" },
    speech: { status: "unavailable" as const },
    visionDocuments: { status: "unavailable" as const },
    spotlightSemantic: { status: "unavailable" as const },
    naturalLanguageEmbeddings: { status: "unavailable" as const },
    coreAi: { status: "unavailable" as const },
    checkedAt: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useLLMProvidersStore.setState({ providers: [cloudProvider()] });
  setPreferOnDevice(true);
  setAllowCloudFallback(false);
  useToastStore.setState({ toasts: [] });
  appleCaps.isAppleOs.mockReturnValue(true);
  appleCaps.snapshot.mockResolvedValue(availableAppleSnapshot());
  useSettingsStore.setState((s) => ({
    ...s,
    settings: {
      ...s.settings,
      ai: { ...s.settings.ai, preferredOnDeviceProviderId: undefined },
      features: { ...s.settings.features, appleFoundationModels: true },
    },
  }));
});

describe("resolveAiPath on macOS", () => {
  it("prefers on-device when Apple Foundation Models are available and preferOnDevice is true", async () => {
    await expect(resolveAiPath()).resolves.toBe("ondevice");
  });

  it("uses cloud when Apple Foundation Models are unavailable", async () => {
    appleCaps.snapshot.mockResolvedValueOnce(unavailableAppleSnapshot());
    await expect(resolveAiPath()).resolves.toBe("cloud");
  });

  it("uses cloud when the user turned off on-device preference", async () => {
    setPreferOnDevice(false);
    await expect(resolveAiPath()).resolves.toBe("cloud");
  });

  it("is none when Apple FM is unavailable and no cloud provider exists", async () => {
    appleCaps.snapshot.mockResolvedValueOnce(unavailableAppleSnapshot());
    useLLMProvidersStore.setState({ providers: [] });
    await expect(resolveAiPath()).resolves.toBe("none");
  });
});

describe("resolveTaskRoute with FakeAppleFoundationProvider", () => {
  it("routes forced on-device passage tasks to Apple FM when Nano is unavailable", async () => {
    const deadNano = new FakeLanguageProvider({
      id: "ondevice-gemini-nano",
      capabilities: { textGeneration: false },
    });
    const apple = new FakeAppleFoundationProvider({
      id: APPLE_FOUNDATION_PROVIDER_ID,
      capabilities: { textGeneration: true, structuredGeneration: true },
    });

    const route = await resolveTaskRoute(promptTask(), {
      providers: [deadNano, apple],
      kind: "ondevice",
    });

    expect(route?.provider.id).toBe(APPLE_FOUNDATION_PROVIDER_ID);
  });

  it("routes to Apple FM when it is the first text-capable on-device provider", async () => {
    const deadNano = new FakeLanguageProvider({
      id: "ondevice-gemini-nano",
      capabilities: { textGeneration: false },
    });
    const apple = new FakeAppleFoundationProvider({
      id: APPLE_FOUNDATION_PROVIDER_ID,
      capabilities: { textGeneration: true, structuredGeneration: true },
    });
    const cloud = new FakeLanguageProvider({
      id: "cloud-llm",
      kind: "cloud",
      capabilities: { textGeneration: true },
    });

    const route = await resolveTaskRoute(promptTask(), {
      providers: [deadNano, apple, cloud],
    });

    expect(route?.provider.id).toBe(APPLE_FOUNDATION_PROVIDER_ID);
    expect(route?.provider.kind).toBe("ondevice");
  });

  it("skips unavailable Apple FM and uses cloud", async () => {
    const apple = new FakeAppleFoundationProvider({
      capabilities: { textGeneration: false, structuredGeneration: false },
    });
    const cloud = new FakeLanguageProvider({
      id: "cloud-llm",
      kind: "cloud",
      capabilities: { textGeneration: true },
    });

    const route = await resolveTaskRoute(promptTask(), { providers: [apple, cloud] });
    expect(route?.provider.id).toBe("cloud-llm");
  });
});

describe("getRoutingProviders Apple ordering", () => {
  it("pins Apple Foundation first when preferredOnDeviceProviderId is set", () => {
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ai: {
          ...s.settings.ai,
          preferredOnDeviceProviderId: APPLE_FOUNDATION_PROVIDER_ID,
        },
      },
    }));

    const ids = getRoutingProviders(true).map((p) => p.id);
    expect(ids[0]).toBe(APPLE_FOUNDATION_PROVIDER_ID);
    expect(ids).toContain("ondevice-gemini-nano");
    expect(ids.at(-1)).toBe("cloud-llm");
  });
});

describe("runAiAction cloud fallback on macOS", () => {
  it("does not fall back when allowCloudFallback is false", async () => {
    const cloud = vi.fn(async () => "cloud");

    await expect(
      runAiAction(
        {
          onDevice: async () => {
            throw new AIError("GenerationFailed", "apple fm failed", {
              code: "generation_failed",
            });
          },
          cloud,
        },
        "Summarization"
      )
    ).rejects.toMatchObject({ category: "GenerationFailed" });

    expect(cloud).not.toHaveBeenCalled();
    expect(
      useToastStore.getState().toasts.some((t) => t.title.includes("stayed on-device"))
    ).toBe(true);
  });

  it("falls back to cloud when allowCloudFallback is true", async () => {
    setAllowCloudFallback(true);
    const cloud = vi.fn(async () => "cloud answer");

    await expect(
      runAiAction(
        {
          onDevice: async () => {
            throw new AIError("GenerationFailed", "apple fm failed", {
              code: "generation_failed",
            });
          },
          cloud,
        },
        "Summarization"
      )
    ).resolves.toBe("cloud answer");

    expect(cloud).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.some((t) => t.title.includes("cloud provider"))).toBe(
      true
    );
  });
});
