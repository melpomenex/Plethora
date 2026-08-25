import { useSettingsStore } from "../../../stores/settingsStore";
import { getAppleIntelligenceSnapshot } from "../apple/capabilities";
import {
  appleFmAvailability,
  appleFmCancel,
  appleFmCountTokens,
  appleFmWarmup,
  runChunkedGeneration,
} from "../apple/foundation";
import { AIError } from "../errors";
import { estimateTokens } from "../chunkTextByTokens";
import type {
  AIModelCapabilities,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
  AIUsageMetadata,
} from "./types";

export const APPLE_FOUNDATION_PROVIDER_ID = "ondevice-apple-foundation";

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
  prefixCaching: true,
  offlineAvailable: true,
  downloadState: "not-applicable",
};

export function getAppleFoundationProvider(): AppleFoundationProvider {
  return new AppleFoundationProvider();
}

function contextTokensFromAvailability(avail: {
  contextSize?: number;
  tokenCount?: number;
  tokenLimit?: number;
}): number {
  return avail.contextSize ?? avail.tokenLimit ?? avail.tokenCount ?? 4096;
}

export class AppleFoundationProvider implements AIProvider {
  readonly id = APPLE_FOUNDATION_PROVIDER_ID;
  readonly kind = "ondevice" as const;

  async getCapabilities(): Promise<AIModelCapabilities> {
    const flags = useSettingsStore.getState().settings.features;
    if (flags.appleFoundationModels === false) return DEAD_CAPS;
    const snap = await getAppleIntelligenceSnapshot();
    const avail = await appleFmAvailability();
    const ready = snap.foundationModels.status === "available" || avail.status === "available";
    return {
      ...DEAD_CAPS,
      textGeneration: ready,
      structuredGeneration: ready,
      streaming: ready,
      downloadState:
        snap.foundationModels.status === "downloadable" || avail.status === "downloadable"
          ? "downloadable"
          : snap.foundationModels.status === "downloading" || avail.status === "downloading"
            ? "downloading"
            : ready
              ? "downloaded"
              : snap.foundationModels.reason === "platform_unsupported"
                ? "not-applicable"
                : "unavailable",
      contextTokens: contextTokensFromAvailability(avail),
    };
  }

  async generateStream(req: AIRequest, opts?: AIStreamOptions): Promise<AIResponse> {
    if (opts?.signal?.aborted) {
      throw new AIError("Cancelled", "Request cancelled", { code: "cancelled", providerId: this.id });
    }
    const caps = await this.getCapabilities();
    const prompt = `${req.systemInstruction ?? ""}${req.text}`;
    if (estimateTokens(prompt) > caps.contextTokens && req.schemaName === "libraryAnswer") {
      throw new AIError("InputTooLarge", "Prompt exceeds the Foundation Models context window", {
        code: "invalid_argument",
        providerId: this.id,
      });
    }
    return runChunkedGeneration(req, caps.contextTokens, opts);
  }

  async countTokens(req: AIRequest): Promise<AIUsageMetadata> {
    return appleFmCountTokens(req.text, req.systemInstruction);
  }

  async warmUp(): Promise<void> {
    await appleFmWarmup();
  }

  async cancel(requestId: string): Promise<void> {
    await appleFmCancel(requestId);
  }
}
