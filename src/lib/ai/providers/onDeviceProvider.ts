/**
 * `AIProvider` over Gemini Nano via the android-genai Tauri plugin.
 *
 * A thin adapter: every capability comes from the plugin's TTL-cached
 * capability snapshot, and generation goes through the existing
 * `onDeviceAI.ts` entry points (streaming with fallback events, non-streaming
 * native prompt, real future cancellation) so the optimized Nano pipeline is
 * preserved byte-for-byte.
 */

import {
  cancelNativePromptRequest,
  countNativePromptTokens,
  generateNativePrompt,
  generateStreamingPrompt,
  getOnDeviceAiCapabilities,
  warmUpOnDevicePrompt,
  type NativePromptRequest,
  type OnDeviceCapabilitySnapshot,
  type OnDeviceFeatureState,
} from "../onDeviceAI";
import { aiErrorFromOnDevice } from "../errors";
import type {
  AIModelCapabilities,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
  AIDownloadState,
} from "./types";

export const ON_DEVICE_PROVIDER_ID = "ondevice-gemini-nano";

function downloadStateFrom(feature: OnDeviceFeatureState | undefined): AIDownloadState {
  switch (feature?.status) {
    case "available":
      return "downloaded";
    case "downloadable":
      return "downloadable";
    case "downloading":
      return "downloading";
    default:
      // `platform_unsupported` means the concept cannot apply here; anything
      // else is a device where the model simply is not usable.
      return feature?.reason === "platform_unsupported" ? "not-applicable" : "unavailable";
  }
}

/**
 * Map the native capability snapshot onto the neutral `AIModelCapabilities`
 * contract (design D2). Exported for unit testing.
 */
export function capabilitiesFromSnapshot(
  snapshot: OnDeviceCapabilitySnapshot
): AIModelCapabilities {
  const promptReady = snapshot.prompt?.status === "available";
  const visionReady =
    snapshot.imagePrompt?.status === "available" && snapshot.imageInput === true;
  return {
    textGeneration: promptReady,
    structuredGeneration:
      promptReady &&
      snapshot.structuredOutputCompiled === true &&
      snapshot.structuredOutput === true,
    vision: visionReady,
    // Honesty: the native envelope still accepts a single ImagePart. Do not
    // advertise multi-image until `images[]` is wired through the bridge.
    multiImage: false,
    systemInstructions: snapshot.systemInstructions === true,
    // Design D2: tool calling is false everywhere initially.
    toolCalling: false,
    // Gemini Nano exposes no reasoning mode; only a future provider may declare it.
    reasoning: false,
    embeddings: snapshot.embeddings === true,
    contextTokens:
      typeof snapshot.tokenLimit === "number" && snapshot.tokenLimit > 0
        ? snapshot.tokenLimit
        : 4096,
    streaming: snapshot.streaming === true,
    prefixCaching: snapshot.prefixCaching === true,
    offlineAvailable: promptReady,
    downloadState: downloadStateFrom(snapshot.prompt),
  };
}

/**
 * Build the provider-neutral request the native bridge understands.
 *
 * When the runtime supports schema-compiled structured output and the request
 * asks for it, the request is routed through `outputMode: "structured"` with
 * the canonical envelope name in `responseSchema`.
 */
export function toNativeRequest(
  req: AIRequest,
  supportsSystemInstructions: boolean,
  supportsStructured = false
): NativePromptRequest {
  const useSystemField = supportsSystemInstructions && !!req.systemInstruction;
  const useStructured =
    supportsStructured && req.structured === true && !!req.schemaName;
  return {
    requestId: req.requestId,
    text: useSystemField || !req.systemInstruction ? req.text : `${req.systemInstruction}\n\n${req.text}`,
    systemInstruction: useSystemField ? req.systemInstruction : undefined,
    image: req.image ? { mimeType: req.image.mimeType, data: req.image.data } : undefined,
    temperature: req.temperature,
    maxOutputTokens: req.maxOutputTokens,
    outputMode: useStructured ? "structured" : "text",
    responseSchema: useStructured
      ? (req.schemaName as NativePromptRequest["responseSchema"])
      : undefined,
  };
}

export class OnDeviceProvider implements AIProvider {
  readonly id = ON_DEVICE_PROVIDER_ID;
  readonly kind = "ondevice" as const;

  async getCapabilities(): Promise<AIModelCapabilities> {
    return capabilitiesFromSnapshot(await getOnDeviceAiCapabilities());
  }

  async generateStream(req: AIRequest, opts: AIStreamOptions = {}): Promise<AIResponse> {
    const caps = await this.getCapabilities();
    const native = toNativeRequest(req, caps.systemInstructions, caps.structuredGeneration);

    try {
      if (opts.stream === false) {
        const res = await generateNativePrompt(native);
        return this.toResponse(res);
      }

      // Streaming + structured emits no incremental text events (the single
      // terminal `complete` carries the envelope), so forward only text runs.
      const structuredRun = native.outputMode === "structured";
      let accumulated = "";
      const res = await generateStreamingPrompt(native, {
        signal: opts.signal,
        onChunk: structuredRun ? undefined : (chunk) => {
          accumulated += chunk;
          opts.onChunk?.(chunk);
        },
        onRetry: opts.onRetry,
      });
      return this.toResponse(res, accumulated);
    } catch (error) {
      throw aiErrorFromOnDevice(error, { providerId: this.id });
    }
  }

  async countTokens(req: AIRequest): Promise<{
    inputTokens: number;
    outputTokens: number;
    tokenLimit: number;
  }> {
    const caps = await this.getCapabilities();
    try {
      const count = await countNativePromptTokens(
        toNativeRequest(req, caps.systemInstructions, caps.structuredGeneration)
      );
      return {
        inputTokens: count.inputTokens,
        outputTokens: count.requestedOutputTokens,
        tokenLimit: count.tokenLimit,
      };
    } catch (error) {
      throw aiErrorFromOnDevice(error, { providerId: this.id });
    }
  }

  async warmUp(): Promise<void> {
    try {
      await warmUpOnDevicePrompt();
    } catch (error) {
      throw aiErrorFromOnDevice(error, { providerId: this.id });
    }
  }

  async cancel(requestId: string): Promise<void> {
    try {
      await cancelNativePromptRequest(requestId);
    } catch (error) {
      throw aiErrorFromOnDevice(error, { providerId: this.id });
    }
  }

  private toResponse(
    res: {
      requestId: string;
      text: string;
      finishReason?: "stop" | "max_tokens" | "other";
      inputTokens: number;
      tokenLimit: number;
      baseModelName?: string;
      structured?: unknown;
    },
    streamedText?: string
  ): AIResponse {
    return {
      requestId: res.requestId,
      text: res.text || streamedText || "",
      structured: res.structured,
      finishReason: res.finishReason,
      baseModelName: res.baseModelName,
      usage: { inputTokens: res.inputTokens, tokenLimit: res.tokenLimit },
    };
  }
}

let instance: OnDeviceProvider | null = null;

/** Shared singleton — capability caching lives in `onDeviceAI.ts`'s TTL. */
export function getOnDeviceProvider(): OnDeviceProvider {
  if (!instance) instance = new OnDeviceProvider();
  return instance;
}
