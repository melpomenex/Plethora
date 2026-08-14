import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocked before importing the module under test: onDeviceAI gates on the
// platform helpers and calls invokeCommand for every bridge call.
vi.mock("../../tauri", () => ({
  isTauri: vi.fn(() => true),
  isNativeMobile: vi.fn(() => true),
  nativePlatform: vi.fn(() => "android"),
  invokeCommand: vi.fn(),
  listen: vi.fn(),
}));

import { invokeCommand, isNativeMobile, isTauri, listen, nativePlatform } from "../../tauri";
import {
  OnDeviceAiError,
  budgetNativePromptRequest,
  cancelNativePromptRequest,
  countNativePromptTokens,
  generateFlashcards,
  generateNativePrompt,
  generateStreamingPrompt,
  getOnDeviceAiCapabilities,
  getOnDeviceRequirementStatus,
  isOnDeviceAiAvailable,
  isOnDeviceAiSupportedPlatform,
  resetOnDeviceAiCache,
  summarize,
  warmUpOnDevicePrompt,
} from "../onDeviceAI";

const STATUS = "plugin:incrementum-android-genai|ondevice_ai_status";
const CAPABILITIES = "plugin:incrementum-android-genai|ondevice_ai_capabilities";
const SUMMARIZE = "plugin:incrementum-android-genai|ondevice_ai_summarize";
const PROMPT = "plugin:incrementum-android-genai|ondevice_ai_prompt";
const GENERATE = "plugin:incrementum-android-genai|ondevice_ai_generate";
const COUNT_TOKENS = "plugin:incrementum-android-genai|ondevice_ai_count_tokens";
const WARM_UP = "plugin:incrementum-android-genai|ondevice_ai_warm_up";
const START_STREAM = "plugin:incrementum-android-genai|ondevice_ai_start_prompt_stream";
const CANCEL_REQUEST = "plugin:incrementum-android-genai|ondevice_ai_cancel_prompt_request";

/** Route mocked invokes by command name. */
function bridge(handlers: Record<string, (args?: Record<string, unknown>) => unknown>) {
  vi.mocked(invokeCommand).mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected command ${command}`);
    return handler(args) as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOnDeviceAiCache();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(isNativeMobile).mockReturnValue(true);
  vi.mocked(nativePlatform).mockReturnValue("android");
});

describe("platform gating", () => {
  it("is unsupported in the browser build", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(isOnDeviceAiSupportedPlatform()).toBe(false);
  });

  it("is unsupported on desktop", () => {
    vi.mocked(isNativeMobile).mockReturnValue(false);
    expect(isOnDeviceAiSupportedPlatform()).toBe(false);
  });

  it("is unsupported on iOS", () => {
    vi.mocked(nativePlatform).mockReturnValue("ios");
    expect(isOnDeviceAiSupportedPlatform()).toBe(false);
  });

  it("reports platform_unsupported without calling the bridge", async () => {
    vi.mocked(isNativeMobile).mockReturnValue(false);

    const status = await isOnDeviceAiAvailable();

    expect(status).toEqual({ status: "unavailable", reason: "platform_unsupported" });
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects summarize with a typed platform_unsupported error off Android", async () => {
    vi.mocked(isNativeMobile).mockReturnValue(false);

    await expect(summarize("some text")).rejects.toMatchObject({
      name: "OnDeviceAiError",
      code: "platform_unsupported",
    });
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

describe("availability cache", () => {
  it("caches an available result for the session", async () => {
    bridge({ [STATUS]: () => ({ status: "available" }) });

    await isOnDeviceAiAvailable();
    await isOnDeviceAiAvailable();

    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("caches unavailable too — a device does not sprout AICore mid-session", async () => {
    bridge({ [STATUS]: () => ({ status: "unavailable", reason: "device_unsupported" }) });

    await isOnDeviceAiAvailable();
    const second = await isOnDeviceAiAvailable();

    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(second.reason).toBe("device_unsupported");
  });

  it("does not cache downloading — it is transient by definition", async () => {
    bridge({ [STATUS]: () => ({ status: "downloading", reason: "model_downloading" }) });

    await isOnDeviceAiAvailable();
    await isOnDeviceAiAvailable();

    expect(invokeCommand).toHaveBeenCalledTimes(2);
  });

  it("re-queries after the cache is reset", async () => {
    bridge({ [STATUS]: () => ({ status: "available" }) });

    await isOnDeviceAiAvailable();
    resetOnDeviceAiCache();
    await isOnDeviceAiAvailable();

    expect(invokeCommand).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable rather than throwing when the bridge itself fails", async () => {
    bridge({
      [STATUS]: () => {
        throw new Error("bridge exploded");
      },
    });

    await expect(isOnDeviceAiAvailable()).resolves.toEqual({
      status: "unavailable",
      reason: "inference_failed",
    });
  });
});

describe("configured native prompt contract", () => {
  it("forwards request options and preserves native token and finish metadata", async () => {
    const response = {
      requestId: "request-1",
      text: "answer",
      finishReason: "max_tokens" as const,
      inputTokens: 37,
      tokenLimit: 4096,
      baseModelName: "gemini-nano",
      candidates: [{ text: "answer", finishReason: "max_tokens" as const }],
    };
    bridge({ [GENERATE]: () => response });

    await expect(
      generateNativePrompt({
        requestId: "request-1",
        text: "question",
        promptPrefix: "study-prefix",
        temperature: 0.25,
        seed: 17,
        candidateCount: 2,
        maxOutputTokens: 256,
        systemInstruction: "Be concise.",
      })
    ).resolves.toEqual(response);

    expect(invokeCommand).toHaveBeenCalledWith(GENERATE, {
      request: {
        requestId: "request-1",
        text: "question",
        promptPrefix: "study-prefix",
        temperature: 0.25,
        seed: 17,
        candidateCount: 2,
        maxOutputTokens: 256,
        systemInstruction: "Be concise.",
        outputMode: "text",
        stream: false,
      },
    });
  });

  it("counts the complete configured request without invoking inference", async () => {
    bridge({
      [COUNT_TOKENS]: () => ({
        requestId: "request-2",
        inputTokens: 512,
        tokenLimit: 4096,
        requestedOutputTokens: 1024,
      }),
    });

    await expect(
      countNativePromptTokens({ requestId: "request-2", text: "source", maxOutputTokens: 1024 })
    ).resolves.toMatchObject({ inputTokens: 512, tokenLimit: 4096 });
    expect(invokeCommand).toHaveBeenCalledWith(COUNT_TOKENS, {
      request: {
        requestId: "request-2",
        text: "source",
        maxOutputTokens: 1024,
        outputMode: "text",
      },
    });
  });

  it("exposes explicit warm-up and preserves typed bridge failures", async () => {
    bridge({
      [CAPABILITIES]: () => ({ prompt: { status: "available" } }),
      [WARM_UP]: () => undefined,
      [GENERATE]: () => {
        throw new Error(
          'Tauri command failed: {"code":"context_too_large","message":"request exceeds token limit"}'
        );
      },
    });

    await expect(warmUpOnDevicePrompt()).resolves.toBeUndefined();
    await expect(
      generateNativePrompt({ requestId: "too-large", text: "source" })
    ).rejects.toMatchObject({ code: "context_too_large" });
  });
});

describe("summarize", () => {
  it("refuses when the model is only downloadable, naming the status", async () => {
    bridge({ [STATUS]: () => ({ status: "downloadable", reason: "model_downloadable" }) });

    await expect(summarize("text")).rejects.toMatchObject({ code: "model_downloadable" });
  });

  it("passes a single chunk straight through with the requested format", async () => {
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [SUMMARIZE]: () => "• one\n• two",
    });

    const result = await summarize("short text", { format: "bullets" });

    expect(result).toBe("• one\n• two");
    expect(invokeCommand).toHaveBeenCalledWith(SUMMARIZE, {
      request: { text: "short text", format: "bullets" },
    });
  });

  it("summarizes each chunk then summarizes the summaries", async () => {
    const calls: string[] = [];
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [SUMMARIZE]: (args) => {
        const text = (args?.request as { text: string }).text;
        calls.push(text);
        return `sum(${text.slice(0, 5)})`;
      },
    });

    // Two paragraphs, each ~3000 chars: under the 4000-char budget alone,
    // over it together, so this chunks into exactly two.
    const paragraph = (word: string) => `${word} `.repeat(500).trim();
    const text = `${paragraph("alpha")}\n\n${paragraph("beta")}`;
    const progress: Array<[number, number]> = [];

    const result = await summarize(text, {
      maxTokens: 1000,
      onProgress: (i, n) => progress.push([i, n]),
    });

    // Two chunk summaries plus one reduction pass over their concatenation.
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain("sum(alpha");
    expect(calls[2]).toContain("sum(beta");
    expect(result).toMatch(/^sum\(/);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("rejects blank input without touching the bridge", async () => {
    bridge({ [STATUS]: () => ({ status: "available" }) });

    await expect(summarize("   ")).rejects.toMatchObject({ code: "invalid_argument" });
    expect(invokeCommand).not.toHaveBeenCalledWith(SUMMARIZE, expect.anything());
  });

  it("stops between chunks when the signal aborts", async () => {
    const controller = new AbortController();
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [SUMMARIZE]: () => {
        controller.abort();
        return "partial";
      },
    });

    const paragraph = (word: string) => `${word} `.repeat(500).trim();
    const text = `${paragraph("alpha")}\n\n${paragraph("beta")}`;

    await expect(
      summarize(text, { maxTokens: 1000, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("surfaces a native rejection as a typed error", async () => {
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [SUMMARIZE]: () => {
        throw new Error('Tauri command failed: {"code":"model_unavailable","message":"gone"}');
      },
    });

    await expect(summarize("text")).rejects.toMatchObject({ code: "model_unavailable" });
  });
});

describe("generateFlashcards", () => {
  it("parses cards from the completion and applies tags", async () => {
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [PROMPT]: () => "Q: What?\nA: This.\nCLOZE: A {{c1::term}} here.",
    });

    const cards = await generateFlashcards("some extract", { count: 5, tags: ["extract"] });

    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.card_type)).toEqual(["qa", "cloze"]);
    expect(cards[0].tags).toEqual(["extract"]);
  });

  it("caps the result at the requested count across chunks", async () => {
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [PROMPT]: () => "Q: a?\nA: 1.\nQ: b?\nA: 2.\nQ: c?\nA: 3.",
    });

    const paragraph = (word: string) => `${word} `.repeat(500).trim();
    const text = `${paragraph("alpha")}\n\n${paragraph("beta")}`;

    const cards = await generateFlashcards(text, { count: 2, maxTokens: 1000 });

    expect(cards).toHaveLength(2);
    // The first chunk already satisfied the count, so the second never ran.
    expect(vi.mocked(invokeCommand).mock.calls.filter((c) => c[0] === PROMPT)).toHaveLength(1);
  });

  it("reports a parse failure when the model returned nothing usable", async () => {
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [PROMPT]: () => "I cannot do that.",
    });

    await expect(generateFlashcards("some extract")).rejects.toMatchObject({
      code: "parse_failed",
    });
  });

  it("returns an empty list when the model returned nothing at all", async () => {
    bridge({
      [STATUS]: () => ({ status: "available" }),
      [PROMPT]: () => "",
    });

    await expect(generateFlashcards("some extract")).resolves.toEqual([]);
  });

  it("refuses when on-device AI is unavailable", async () => {
    bridge({ [STATUS]: () => ({ status: "unavailable", reason: "device_unsupported" }) });

    const error = await generateFlashcards("text").catch((e) => e);

    expect(error).toBeInstanceOf(OnDeviceAiError);
    expect(error.code).toBe("device_unsupported");
  });
});

describe("capabilities and requirement status", () => {
  it("fetches capabilities and caches them within TTL", async () => {
    const mockCaps = {
      prompt: { status: "available" },
      summarization: { status: "available" },
      imagePrompt: { status: "unavailable", reason: "model_unavailable" },
      structuredOutputCompiled: true,
      structuredOutput: false,
      systemInstructions: true,
      prefixCaching: false,
      imageInput: false,
      multiImage: false,
      streaming: true,
      checkedAt: Date.now(),
    };
    bridge({ [CAPABILITIES]: () => mockCaps });

    const caps1 = await getOnDeviceAiCapabilities();
    const caps2 = await getOnDeviceAiCapabilities();

    expect(caps1).toEqual(mockCaps);
    expect(caps2).toEqual(mockCaps);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it("queries feature status per requirement", async () => {
    const mockCaps = {
      prompt: { status: "available" },
      summarization: { status: "unavailable", reason: "device_unsupported" },
      imagePrompt: { status: "downloadable", reason: "model_downloadable" },
      structuredOutputCompiled: true,
      structuredOutput: false,
      systemInstructions: true,
      prefixCaching: false,
      imageInput: false,
      multiImage: false,
      streaming: true,
      checkedAt: Date.now(),
    };
    bridge({ [CAPABILITIES]: () => mockCaps });

    await expect(getOnDeviceRequirementStatus("prompt")).resolves.toEqual({ status: "available" });
    await expect(getOnDeviceRequirementStatus("summarization")).resolves.toEqual({
      status: "unavailable",
      reason: "device_unsupported",
    });
    await expect(getOnDeviceRequirementStatus("image-prompt")).resolves.toEqual({
      status: "downloadable",
      reason: "model_downloadable",
    });
  });
});

describe("streaming and cancellation", () => {
  it("subscribes before start, handles chunk events, and cleans up listeners", async () => {
    const listeners: Record<string, (event: { payload: unknown }) => void> = {};
    const unlistenFn = vi.fn();
    vi.mocked(listen).mockImplementation(async (event: string, handler: (event: { payload: unknown }) => void) => {
      listeners[event] = handler;
      return unlistenFn;
    });

    bridge({
      [START_STREAM]: () => ({ requestId: "req-stream-1", queued: true }),
    });

    const chunks: string[] = [];
    const streamPromise = generateStreamingPrompt(
      { requestId: "req-stream-1", text: "hello" },
      { onChunk: (text) => chunks.push(text) }
    );

    // Give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 10));

    expect(listen).toHaveBeenCalledWith("ondevice-genai://text", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("ondevice-genai://complete", expect.any(Function));

    // Emit text event
    listeners["ondevice-genai://text"]?.({
      payload: { requestId: "req-stream-1", text: "Hello " },
    });
    listeners["ondevice-genai://text"]?.({
      payload: { requestId: "req-stream-1", text: "World!" },
    });

    // Emit complete event
    listeners["ondevice-genai://complete"]?.({
      payload: {
        requestId: "req-stream-1",
        text: "Hello World!",
        inputTokens: 10,
        tokenLimit: 4096,
        candidates: [],
      },
    });

    const res = await streamPromise;
    expect(res.text).toBe("Hello World!");
    expect(chunks).toEqual(["Hello ", "World!"]);
    expect(unlistenFn).toHaveBeenCalled();
  });

  it("invokes native cancel when cancelNativePromptRequest is called", async () => {
    bridge({
      [CANCEL_REQUEST]: () => ({ requestId: "req-cancel-1", cancelled: true }),
    });

    const res = await cancelNativePromptRequest("req-cancel-1");
    expect(res).toEqual({ requestId: "req-cancel-1", cancelled: true });
    expect(invokeCommand).toHaveBeenCalledWith(CANCEL_REQUEST, {
      request: { requestId: "req-cancel-1" },
    });
  });

  it("budgets native prompt request correctly", async () => {
    bridge({
      [COUNT_TOKENS]: () => ({
        requestId: "req-budget-1",
        inputTokens: 500,
        tokenLimit: 4096,
        requestedOutputTokens: 256,
      }),
    });

    const result = await budgetNativePromptRequest(
      { requestId: "req-budget-1", text: "input" },
      256,
      4096
    );

    expect(result.fits).toBe(true);
    expect(result.count.inputTokens).toBe(500);
  });
});
