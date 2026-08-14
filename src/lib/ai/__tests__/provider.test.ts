import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    isOnDeviceAiSupportedPlatform: vi.fn(() => true),
    isOnDeviceAiAvailable: vi.fn(async () => ({ status: "available" as const })),
    getOnDeviceRequirementStatus: vi.fn(async () => ({ status: "available" as const })),
    getOnDeviceAiCapabilities: vi.fn(async () => ({
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
      checkedAt: Date.now(),
    })),
  };
});

import { useLLMProvidersStore, type LLMProviderConfig } from "../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useToastStore } from "../../../components/common/Toast";
import {
  OnDeviceAiError,
  getOnDeviceRequirementStatus,
  isOnDeviceAiAvailable,
  isOnDeviceAiSupportedPlatform,
} from "../onDeviceAI";
import { hasCloudProvider, resolveAiPath, runAiAction } from "../provider";

/** Minimal enabled provider row. */
function provider(overrides: Partial<LLMProviderConfig> = {}): LLMProviderConfig {
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

function setProviders(providers: LLMProviderConfig[]) {
  useLLMProvidersStore.setState({ providers });
}

function setPreferOnDevice(preferOnDevice: boolean) {
  const state = useSettingsStore.getState();
  useSettingsStore.setState({
    settings: { ...state.settings, ai: { ...state.settings.ai, preferOnDevice } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setProviders([]);
  setPreferOnDevice(true);
  useToastStore.setState({ toasts: [] });
  vi.mocked(isOnDeviceAiSupportedPlatform).mockReturnValue(true);
  vi.mocked(isOnDeviceAiAvailable).mockResolvedValue({ status: "available" });
  vi.mocked(getOnDeviceRequirementStatus).mockResolvedValue({ status: "available" });
});

describe("hasCloudProvider", () => {
  it("is false with no providers", () => {
    expect(hasCloudProvider()).toBe(false);
  });

  it("is false when the only provider is disabled", () => {
    setProviders([provider({ enabled: false })]);
    expect(hasCloudProvider()).toBe(false);
  });

  it("is false when an enabled provider has no key", () => {
    setProviders([provider({ apiKey: "  " })]);
    expect(hasCloudProvider()).toBe(false);
  });

  it("is true for a keyless provider like Ollama", () => {
    setProviders([provider({ provider: "ollama", apiKey: "" })]);
    expect(hasCloudProvider()).toBe(true);
  });
});

describe("resolveAiPath", () => {
  it("prefers on-device when the model is ready", async () => {
    setProviders([provider()]);
    await expect(resolveAiPath()).resolves.toBe("ondevice");
  });

  it("uses cloud when the user turned the preference off", async () => {
    setProviders([provider()]);
    setPreferOnDevice(false);

    await expect(resolveAiPath()).resolves.toBe("cloud");
    expect(isOnDeviceAiAvailable).not.toHaveBeenCalled();
  });

  it("uses cloud when the model is only downloadable", async () => {
    setProviders([provider()]);
    vi.mocked(getOnDeviceRequirementStatus).mockResolvedValue({
      status: "downloadable",
      reason: "model_downloadable",
    });

    await expect(resolveAiPath()).resolves.toBe("cloud");
  });

  it("is none when neither path exists", async () => {
    vi.mocked(getOnDeviceRequirementStatus).mockResolvedValue({
      status: "unavailable",
      reason: "device_unsupported",
    });

    await expect(resolveAiPath()).resolves.toBe("none");
  });

  it("is on-device with no cloud provider configured at all", async () => {
    await expect(resolveAiPath()).resolves.toBe("ondevice");
  });
});

describe("runAiAction", () => {
  it("returns null without running anything when no path exists", async () => {
    vi.mocked(isOnDeviceAiSupportedPlatform).mockReturnValue(false);
    const onDevice = vi.fn();
    const cloud = vi.fn();

    await expect(runAiAction({ onDevice, cloud }, "Summarization")).resolves.toBeNull();
    expect(onDevice).not.toHaveBeenCalled();
    expect(cloud).not.toHaveBeenCalled();
  });

  it("runs the cloud path directly when it is the resolved path", async () => {
    setProviders([provider()]);
    setPreferOnDevice(false);
    const onDevice = vi.fn();

    await expect(
      runAiAction({ onDevice, cloud: async () => "cloud result" }, "Summarization")
    ).resolves.toBe("cloud result");
    expect(onDevice).not.toHaveBeenCalled();
  });

  it("falls back to cloud and toasts when the on-device call fails mid-run", async () => {
    setProviders([provider()]);

    const result = await runAiAction(
      {
        onDevice: async () => {
          throw new OnDeviceAiError("inference_failed", "nano gave up");
        },
        cloud: async () => "cloud result",
      },
      "Summarization"
    );

    expect(result).toBe("cloud result");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toContain("Summarization");
    expect(toasts[0].message).toContain("inference_failed");
  });

  it("rethrows when on-device fails and no cloud provider is configured", async () => {
    await expect(
      runAiAction(
        {
          onDevice: async () => {
            throw new OnDeviceAiError("inference_failed", "nano gave up");
          },
          cloud: async () => "cloud result",
        },
        "Summarization"
      )
    ).rejects.toMatchObject({ code: "inference_failed" });

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("does not route a user cancellation to the cloud", async () => {
    setProviders([provider()]);
    const cloud = vi.fn();

    await expect(
      runAiAction(
        {
          onDevice: async () => {
            throw new OnDeviceAiError("cancelled", "user cancelled");
          },
          cloud,
        },
        "Summarization"
      )
    ).rejects.toMatchObject({ code: "cancelled" });

    expect(cloud).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
