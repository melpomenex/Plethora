import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../../stores/settingsStore";
import {
  FOUNDRY_LOCAL_PROVIDER_ID,
  getRoutingProviders,
  WINDOWS_SYSTEM_PROVIDER_ID,
} from "../index";
import { resolveAiPath } from "../../provider";
import { ON_DEVICE_PROVIDER_ID } from "../onDeviceProvider";

const platform = vi.hoisted(() => ({
  windowsDesktop: vi.fn(() => true),
  windowsSnapshot: vi.fn(),
  foundryStatus: vi.fn(),
}));

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

vi.mock("../../apple/capabilities", () => ({
  getAppleIntelligenceSnapshot: vi.fn(async () => ({
    appleOs: false,
    foundationModels: { status: "unavailable" },
    speech: { status: "unavailable" },
    visionDocuments: { status: "unavailable" },
    spotlightSemantic: { status: "unavailable" },
    naturalLanguageEmbeddings: { status: "unavailable" },
    coreAi: { status: "unavailable" },
    checkedAt: 0,
  })),
  isAppleOsPlatform: vi.fn(() => false),
}));

vi.mock("../../windows/capabilities", () => ({
  getWindowsIntelligenceSnapshot: () => platform.windowsSnapshot(),
  isWindowsDesktop: () => platform.windowsDesktop(),
  isWindowsDesktopPlatform: () => platform.windowsDesktop(),
}));

vi.mock("../../foundryLocal/client", () => ({
  getFoundryStatus: (...args: unknown[]) => platform.foundryStatus(...args),
}));

function cloudProvider(): LLMProviderConfig {
  return {
    id: "p1",
    provider: "openai",
    name: "OpenAI",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    enabled: true,
    temperature: 0.7,
    maxTokens: 1024,
  };
}

function availableWindowsSnapshot() {
  return {
    windowsOs: true,
    packageIdentity: true,
    languageModel: { status: "available" as const },
    ocr: { status: "unavailable" as const },
    imageDescription: { status: "unavailable" as const },
    embeddings: { status: "unavailable" as const },
    checkedAt: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  platform.windowsDesktop.mockReturnValue(true);
  platform.windowsSnapshot.mockResolvedValue(availableWindowsSnapshot());
  platform.foundryStatus.mockResolvedValue({
    status: "available",
    configuredModel: "phi-4-mini",
    loadedModels: ["phi-4-mini"],
    checkedAt: Date.now(),
  });
  useLLMProvidersStore.setState({ providers: [cloudProvider()] });
  useSettingsStore.setState((s) => ({
    ...s,
    settings: {
      ...s.settings,
      ai: {
        ...s.settings.ai,
        preferOnDevice: true,
        preferredOnDeviceProviderId: undefined,
      },
      features: {
        ...s.settings.features,
        windowsSystemAi: true,
      },
      foundryLocal: {
        enabled: true,
        baseUrl: "http://127.0.0.1:5273",
        model: "phi-4-mini",
      },
    },
  }));
});

describe("getRoutingProviders on Windows desktop", () => {
  it("orders Windows System AI before Foundry and Gemini Nano", () => {
    const ids = getRoutingProviders(true).map((p) => p.id);
    expect(ids[0]).toBe(WINDOWS_SYSTEM_PROVIDER_ID);
    expect(ids[1]).toBe(FOUNDRY_LOCAL_PROVIDER_ID);
    expect(ids).toContain(ON_DEVICE_PROVIDER_ID);
    expect(ids.at(-1)).toBe("cloud-llm");
  });

  it("omits Foundry when disabled in settings", () => {
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        foundryLocal: { ...s.settings.foundryLocal, enabled: false },
      },
    }));

    const ids = getRoutingProviders(true).map((p) => p.id);
    expect(ids).not.toContain(FOUNDRY_LOCAL_PROVIDER_ID);
    expect(ids[0]).toBe(WINDOWS_SYSTEM_PROVIDER_ID);
  });

  it("pins Foundry first when preferredOnDeviceProviderId is set", () => {
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ai: {
          ...s.settings.ai,
          preferredOnDeviceProviderId: FOUNDRY_LOCAL_PROVIDER_ID,
        },
      },
    }));

    const ids = getRoutingProviders(true).map((p) => p.id);
    expect(ids[0]).toBe(FOUNDRY_LOCAL_PROVIDER_ID);
    expect(ids[1]).toBe(WINDOWS_SYSTEM_PROVIDER_ID);
  });
});

describe("resolveAiPath on Windows desktop", () => {
  it("prefers on-device when Phi Silica is available", async () => {
    await expect(resolveAiPath()).resolves.toBe("ondevice");
  });

  it("prefers on-device when Foundry is ready and Phi Silica is unavailable", async () => {
    platform.windowsSnapshot.mockResolvedValueOnce({
      windowsOs: true,
      packageIdentity: false,
      languageModel: { status: "unavailable", reason: "package_identity_missing" },
      ocr: { status: "unavailable" },
      imageDescription: { status: "unavailable" },
      embeddings: { status: "unavailable" },
      checkedAt: Date.now(),
    });

    await expect(resolveAiPath()).resolves.toBe("ondevice");
  });

  it("uses cloud when preferOnDevice is false", async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        ai: { ...s.settings.ai, preferOnDevice: false },
      },
    }));

    await expect(resolveAiPath()).resolves.toBe("cloud");
  });

  it("is none when no native or cloud path exists", async () => {
    platform.windowsSnapshot.mockResolvedValueOnce({
      windowsOs: true,
      packageIdentity: false,
      languageModel: { status: "unavailable", reason: "package_identity_missing" },
      ocr: { status: "unavailable" },
      imageDescription: { status: "unavailable" },
      embeddings: { status: "unavailable" },
      checkedAt: Date.now(),
    });
    platform.foundryStatus.mockResolvedValueOnce({
      status: "runtime_unavailable",
      checkedAt: Date.now(),
    });
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        foundryLocal: { ...s.settings.foundryLocal, enabled: false },
      },
    }));
    useLLMProvidersStore.setState({ providers: [] });

    await expect(resolveAiPath()).resolves.toBe("none");
  });
});
