/**
 * Regression gate for the `optimize-ondevice-gemini-nano` scenarios, ported
 * onto the task layer (task 1.15): adaptive context, streaming summarization,
 * output-token caps, speculative warmup, and the cancelled-never-falls-back
 * rule for the unified error taxonomy.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    isOnDeviceAiSupportedPlatform: vi.fn(() => true),
    getOnDeviceRequirementStatus: vi.fn(async () => ({ status: "available" as const })),
    generateStreamingPrompt: vi.fn(),
    generateNativePrompt: vi.fn(),
    countNativePromptTokens: vi.fn(),
    summarize: vi.fn(),
    warmUpOnDevicePrompt: vi.fn(),
    getOnDeviceAiCapabilities: vi.fn(),
  };
});

import {
  OnDeviceAiError,
  generateStreamingPrompt,
  getOnDeviceAiCapabilities,
  summarize,
  warmUpOnDevicePrompt,
  type OnDeviceCapabilitySnapshot,
} from "../onDeviceAI";
import { runAiAction } from "../provider";
import { AIError } from "../errors";
import { getOnDeviceProvider } from "../providers/onDeviceProvider";
import { explainPassage, summarizePassage } from "../passageAI";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useToastStore } from "../../../components/common/Toast";

function nanoSnapshot(
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

function streamed(text: string) {
  vi.mocked(generateStreamingPrompt).mockResolvedValue({
    requestId: "req-nano",
    text,
    inputTokens: 20,
    tokenLimit: 4096,
    baseModelName: "gemini-nano",
    candidates: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOnDeviceAiCapabilities).mockResolvedValue(nanoSnapshot());
  vi.mocked(summarize).mockResolvedValue("ml-kit summary");
  vi.mocked(warmUpOnDevicePrompt).mockResolvedValue(undefined);
  streamed("nano output");
  useLLMProvidersStore.setState({ providers: [] });
  useToastStore.setState({ toasts: [] });
  const settings = useSettingsStore.getState().settings;
  useSettingsStore.setState({
    settings: { ...settings, ai: { ...settings.ai, preferOnDevice: true } },
  });
});

describe("adaptive context window (passage actions)", () => {
  it("short selections pass through untrimmed", async () => {
    const passage = "The heart pumps blood through the circulatory system.";
    await summarizePassage(passage);

    const request = vi.mocked(generateStreamingPrompt).mock.calls[0][0];
    expect(request.text).toContain(passage);
    // Inside the untrusted containment block, not appended as extra context.
    expect(request.text).toContain('<untrusted_source id="passage">');
  });

  it("long selections are trimmed to the input budget and flagged truncated", async () => {
    const paragraph = "word ".repeat(1200); // ~6000 chars each; two → over budget
    const full = `${paragraph}\n\n${paragraph}`;
    const result = await explainPassage(full);

    expect(result.truncated).toBe(true);
    const request = vi.mocked(generateStreamingPrompt).mock.calls[0][0];
    // Only the first budget-fitting chunk is sent, never the whole selection.
    expect(request.text).toContain(paragraph.trim().slice(0, 200));
    expect(request.text.length).toBeLessThan(full.length);
  });
});

describe("streaming on-device summarization", () => {
  it("streams tokens progressively via the Prompt API, not batch ML Kit", async () => {
    vi.mocked(generateStreamingPrompt).mockImplementation(async (request, options) => {
      options?.onChunk?.("Blood ");
      options?.onChunk?.("carries oxygen.");
      return {
        requestId: request.requestId,
        text: "Blood carries oxygen.",
        inputTokens: 12,
        tokenLimit: 4096,
        baseModelName: "gemini-nano",
        candidates: [],
      };
    });

    const chunks: string[] = [];
    const result = await summarizePassage("Some long passage.", {
      onChunk: (c) => chunks.push(c),
    });

    expect(generateStreamingPrompt).toHaveBeenCalledTimes(1);
    expect(summarize).not.toHaveBeenCalled();
    expect(result.text).toBe("Blood carries oxygen.");
    expect(chunks).toEqual(["Blood ", "carries oxygen."]);
  });
});

describe("concise prompt formats and output caps", () => {
  it("caps standard explanation output at 192 tokens", async () => {
    await explainPassage("Blood flows through veins.");
    expect(vi.mocked(generateStreamingPrompt).mock.calls[0][0].maxOutputTokens).toBe(192);
  });

  it("allows the detailed preset 256 tokens but stays within the 128-256 band", async () => {
    await explainPassage("Blood flows through veins.", { preset: "detailed" });
    const cap = vi.mocked(generateStreamingPrompt).mock.calls[0][0].maxOutputTokens;
    expect(cap).toBe(256);
    expect(cap).toBeLessThanOrEqual(256);
    expect(cap).toBeGreaterThanOrEqual(128);
  });

  it("instructs a concise 1-2 sentence explanation with no filler", async () => {
    await explainPassage("Dense paragraph.");
    const request = vi.mocked(generateStreamingPrompt).mock.calls[0][0];
    const prompt = request.systemInstruction
      ? `${request.systemInstruction}\n${request.text}`
      : request.text;
    expect(prompt).toContain("1-2");
    expect(prompt).toContain("No preamble");
  });

  it("study-note preset asks for exactly 3 compact bullets", async () => {
    await explainPassage("Dense paragraph.", { preset: "study-note" });
    const request = vi.mocked(generateStreamingPrompt).mock.calls[0][0];
    const prompt = request.systemInstruction
      ? `${request.systemInstruction}\n${request.text}`
      : request.text;
    expect(prompt).toContain("3 concise bullet points");
  });
});

describe("speculative foreground warmup", () => {
  it("warms the prompt model without producing a completion", async () => {
    // SelectionActionsSheet fires this on sheet open; the provider exposes it
    // through the AIProvider surface.
    await getOnDeviceProvider().warmUp();
    expect(warmUpOnDevicePrompt).toHaveBeenCalledTimes(1);
  });

  it("does not warm up when the prompt capability is unavailable", async () => {
    // Mirror the real capability gate bound to the mocked snapshot (the
    // actual `warmUpOnDevicePrompt` closure cannot see the mocked resolver).
    vi.mocked(warmUpOnDevicePrompt).mockImplementation(async () => {
      const caps = await getOnDeviceAiCapabilities();
      if (caps.prompt.status !== "available") {
        throw new OnDeviceAiError(
          (caps.prompt.reason as "model_downloadable") || "model_unavailable",
          "On-device Prompt capability is not available for warm-up."
        );
      }
    });
    vi.mocked(getOnDeviceAiCapabilities).mockResolvedValue(
      nanoSnapshot({ prompt: { status: "downloadable", reason: "model_downloadable" } })
    );
    await expect(getOnDeviceProvider().warmUp()).rejects.toMatchObject({
      category: "ModelDownloadRequired",
    });
  });
});

describe("fast path: no blocking token-count IPC before inference", () => {
  it("short inputs go straight to streaming without a count-tokens round trip", async () => {
    const { countNativePromptTokens } = await import("../onDeviceAI");
    await summarizePassage("Short selection.");
    expect(vi.mocked(countNativePromptTokens)).not.toHaveBeenCalled();
    expect(generateStreamingPrompt).toHaveBeenCalledTimes(1);
  });
});
describe("cancelled never falls back to cloud (unified taxonomy)", () => {
  it("rethrows AIError(Cancelled) without invoking the cloud branch", async () => {
    const provider: LLMProviderConfig = {
      id: "p1",
      provider: "openai",
      name: "OpenAI",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      enabled: true,
      temperature: 0.7,
      maxTokens: 1024,
    };
    useLLMProvidersStore.setState({ providers: [provider] });
    const cloud = vi.fn(async () => "cloud result");

    await expect(
      runAiAction(
        {
          onDevice: async () => {
            throw new AIError("Cancelled", "user cancelled", { code: "cancelled" });
          },
          cloud,
        },
        "Summarization"
      )
    ).rejects.toMatchObject({ category: "Cancelled", code: "cancelled" });

    expect(cloud).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("still rethrows OnDeviceAiError(cancelled) untouched", async () => {
    const cloud = vi.fn(async () => "cloud result");
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
  });
});
