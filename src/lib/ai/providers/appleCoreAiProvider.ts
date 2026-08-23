import { useSettingsStore } from "../../../stores/settingsStore";
import { getAppleIntelligenceSnapshot } from "../apple/capabilities";
import { invokeApple } from "../apple/plugin";
import { appleErrorFromUnknown } from "../apple/errors";
import { AIError } from "../errors";
import type {
  AIModelCapabilities,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
  AIUsageMetadata,
} from "./types";

export const APPLE_CORE_AI_PROVIDER_ID = "ondevice-apple-coreai";

const DEAD_CAPS: AIModelCapabilities = {
  textGeneration: false,
  structuredGeneration: false,
  vision: false,
  multiImage: false,
  systemInstructions: true,
  toolCalling: false,
  reasoning: false,
  embeddings: false,
  contextTokens: 4096,
  streaming: false,
  prefixCaching: false,
  offlineAvailable: true,
  downloadState: "not-applicable",
};

export function getAppleCoreAiProvider(): AppleCoreAiProvider {
  return new AppleCoreAiProvider();
}

export class AppleCoreAiProvider implements AIProvider {
  readonly id = APPLE_CORE_AI_PROVIDER_ID;
  readonly kind = "ondevice" as const;

  async getCapabilities(): Promise<AIModelCapabilities> {
    const flags = useSettingsStore.getState().settings.features;
    if (!flags.appleCoreAI) return DEAD_CAPS;
    const snap = await getAppleIntelligenceSnapshot();
    const ready = snap.coreAi.status === "available";
    return {
      ...DEAD_CAPS,
      textGeneration: ready,
      downloadState:
        snap.coreAi.status === "downloadable"
          ? "downloadable"
          : snap.coreAi.status === "downloading"
            ? "downloading"
            : ready
              ? "downloaded"
              : "unavailable",
    };
  }

  async generateStream(req: AIRequest, opts?: AIStreamOptions): Promise<AIResponse> {
    if (opts?.signal?.aborted) {
      throw new AIError("Cancelled", "Request cancelled", { code: "cancelled", providerId: this.id });
    }
    try {
      const result = await invokeApple<{ requestId?: string; text: string }>("apple_coreai_prompt", {
        payload: { requestId: req.requestId, text: req.text },
      });
      opts?.onChunk?.(result.text);
      return { requestId: result.requestId ?? req.requestId, text: result.text };
    } catch (error) {
      throw appleErrorFromUnknown(error, { providerId: this.id });
    }
  }

  async countTokens(req: AIRequest): Promise<AIUsageMetadata> {
    try {
      return await invokeApple("apple_coreai_count_tokens", { payload: { text: req.text } });
    } catch (error) {
      throw appleErrorFromUnknown(error, { providerId: this.id });
    }
  }

  async warmUp(): Promise<void> {
    try {
      await invokeApple("apple_coreai_warmup");
    } catch (error) {
      throw appleErrorFromUnknown(error, { providerId: this.id });
    }
  }

  async cancel(requestId: string): Promise<void> {
    try {
      await invokeApple("apple_coreai_cancel", { payload: { requestId } });
    } catch (error) {
      throw appleErrorFromUnknown(error, { providerId: this.id });
    }
  }
}
