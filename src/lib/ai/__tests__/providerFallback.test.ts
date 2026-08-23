/**
 * Tests for the on-device → cloud fallback consent (ai-billing-safety #14):
 * an on-device failure must never silently retry on a paid cloud provider.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAiAction } from "../provider";
import { AIError } from "../errors";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useToastStore } from "../../../components/common/Toast";
import {
  clearPaidConsentDenials,
  setPaidConsentHandler,
} from "../../../utils/aiBillingConsent";

vi.mock("../onDeviceAI", () => ({
  isOnDeviceAiSupportedPlatform: () => true,
  getOnDeviceRequirementStatus: async () => ({ status: "available" }),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => true,
  nativePlatform: () => "android",
}));

function setCloudFallback(allow: boolean) {
  useSettingsStore.setState((s) => ({
    settings: {
      ...s.settings,
      ai: { ...s.settings.ai, preferOnDevice: true, allowCloudFallback: allow },
    },
  }));
}

function installCloudProvider() {
  useLLMProvidersStore.setState({
    providers: [
      {
        id: "prov-openai",
        name: "OpenAI",
        provider: "openai",
        apiKey: "sk-cloud-test",
        enabled: true,
      } as never,
    ],
  });
}

const onDeviceFailure = () => {
  throw new AIError("GenerationFailed", "on-device failed", {
    code: "generation_failed",
  });
};

describe("runAiAction fallback consent (ai-billing-safety #14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPaidConsentHandler(null);
    clearPaidConsentDenials();
    useToastStore.setState({ toasts: [] });
  });

  it("does NOT fall back when allowCloudFallback is undefined", async () => {
    useSettingsStore.setState((s) => ({
      settings: {
        ...s.settings,
        ai: {
          ...s.settings.ai,
          preferOnDevice: true,
          allowCloudFallback: undefined as unknown as boolean,
        },
      },
    }));
    installCloudProvider();
    const cloud = vi.fn(async () => "cloud-result");

    await expect(
      runAiAction({ onDevice: onDeviceFailure, cloud }, "Test action")
    ).rejects.toThrow("on-device failed");
    expect(cloud).not.toHaveBeenCalled();
  });

  it("does NOT fall back to the cloud provider when allowCloudFallback is off", async () => {
    setCloudFallback(false);
    installCloudProvider();
    const cloud = vi.fn(async () => "cloud-result");

    await expect(
      runAiAction({ onDevice: onDeviceFailure, cloud }, "Test action")
    ).rejects.toThrow("on-device failed");
    expect(cloud).not.toHaveBeenCalled();
  });

  it("proceeds with cloud fallback when explicitly enabled", async () => {
    setCloudFallback(true);
    installCloudProvider();
    const cloud = vi.fn(async () => "cloud-result");

    const result = await runAiAction(
      { onDevice: onDeviceFailure, cloud },
      "Test action"
    );
    expect(result).toBe("cloud-result");
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it("surfaces the ai-fallback consent surface and falls back when granted", async () => {
    setCloudFallback(false);
    installCloudProvider();
    const consentHandler = vi.fn(async () => true);
    setPaidConsentHandler(consentHandler);
    const cloud = vi.fn(async () => "cloud-result");

    const result = await runAiAction(
      { onDevice: onDeviceFailure, cloud },
      "Test action"
    );
    expect(result).toBe("cloud-result");
    expect(cloud).toHaveBeenCalledTimes(1);
    expect(consentHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ai-fallback", provider: "cloud" })
    );
    // The fallback is never silent: an informational toast discloses it.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((toast) => toast.title.includes("used the cloud provider"))).toBe(true);
  });

  it("stops with feedback when the ai-fallback consent surface denies the retry", async () => {
    setCloudFallback(false);
    installCloudProvider();
    const consentHandler = vi.fn(async () => false);
    setPaidConsentHandler(consentHandler);
    const cloud = vi.fn(async () => "cloud-result");

    await expect(
      runAiAction({ onDevice: onDeviceFailure, cloud }, "Test action")
    ).rejects.toThrow("on-device failed");
    expect(cloud).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((toast) => toast.title.includes("stayed on-device"))).toBe(true);
  });

  it("proceeds without prompting for a free/local cloud provider (still never silent)", async () => {
    setCloudFallback(false);
    // Ollama is a free/local cloud target — never a billable fallback.
    useLLMProvidersStore.setState({
      providers: [
        {
          id: "prov-ollama",
          name: "Ollama",
          provider: "ollama",
          apiKey: "",
          enabled: true,
        } as never,
      ],
    });
    const consentHandler = vi.fn(async () => false);
    setPaidConsentHandler(consentHandler);
    const cloud = vi.fn(async () => "cloud-result");

    const result = await runAiAction(
      { onDevice: onDeviceFailure, cloud },
      "Test action"
    );
    expect(result).toBe("cloud-result");
    expect(cloud).toHaveBeenCalledTimes(1);
    expect(consentHandler).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((toast) => toast.title.includes("used the cloud provider"))).toBe(true);
  });

  it("does not prompt/fallback when no cloud provider exists", async () => {
    setCloudFallback(true);
    useLLMProvidersStore.setState({ providers: [] });
    const cloud = vi.fn(async () => "cloud-result");

    await expect(
      runAiAction({ onDevice: onDeviceFailure, cloud }, "Test action")
    ).rejects.toThrow("on-device failed");
    expect(cloud).not.toHaveBeenCalled();
  });
});
