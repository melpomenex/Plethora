import { useSettingsStore } from "../../../stores/settingsStore";
import { estimateTokens } from "../chunkTextByTokens";
import { getWindowsIntelligenceSnapshot } from "../windows/capabilities";
import {
  windowsLmAvailability,
  windowsLmCancel,
  windowsLmGenerate,
  windowsLmGenerateStream,
  windowsLmWarmup,
} from "../windows/languageModel";
import { AIError } from "../errors";
import type {
  AIModelCapabilities,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
  AIUsageMetadata,
  AIDownloadState,
} from "./types";

export const WINDOWS_SYSTEM_PROVIDER_ID = "ondevice-windows-system";

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

function downloadStateFrom(feature: { status: string; reason?: string }): AIDownloadState {
  switch (feature.status) {
    case "available":
      return "downloaded";
    case "downloadable":
      return "downloadable";
    case "downloading":
      return "downloading";
    default:
      return feature.reason === "platform_unsupported" ? "not-applicable" : "unavailable";
  }
}

function contextTokensFromAvailability(avail: {
  contextSize?: number;
  tokenLimit?: number;
}): number {
  return avail.contextSize ?? avail.tokenLimit ?? 4096;
}

export function getWindowsSystemProvider(): WindowsSystemProvider {
  return new WindowsSystemProvider();
}

export class WindowsSystemProvider implements AIProvider {
  readonly id = WINDOWS_SYSTEM_PROVIDER_ID;
  readonly kind = "ondevice" as const;

  async getCapabilities(): Promise<AIModelCapabilities> {
    const flags = useSettingsStore.getState().settings.features;
    if (flags.windowsSystemAi === false) return DEAD_CAPS;
    const snap = await getWindowsIntelligenceSnapshot();
    const avail = await windowsLmAvailability();
    const lmReady = snap.languageModel.status === "available" || avail.status === "available";
    const visionReady = snap.imageDescription.status === "available";
    const embedReady = snap.embeddings.status === "available";
    const experimental = flags.windowsAiExperimental === true;
    return {
      ...DEAD_CAPS,
      textGeneration: lmReady,
      structuredGeneration: lmReady && experimental,
      vision: visionReady,
      embeddings: embedReady,
      streaming: lmReady,
      downloadState: downloadStateFrom(snap.languageModel),
      contextTokens: contextTokensFromAvailability(avail),
    };
  }

  async generateStream(req: AIRequest, opts?: AIStreamOptions): Promise<AIResponse> {
    if (opts?.signal?.aborted) {
      throw new AIError("Cancelled", "Request cancelled", { code: "cancelled", providerId: this.id });
    }
    const args = {
      requestId: req.requestId,
      text: req.text,
      systemInstruction: req.systemInstruction,
      maxOutputTokens: req.maxOutputTokens,
      temperature: req.temperature,
      schemaName: req.schemaName,
      structured: req.structured,
    };

    try {
      if (opts?.stream === false) {
        const res = await windowsLmGenerate(args);
        return this.toResponse(res);
      }
      const res = await windowsLmGenerateStream(args, opts);
      return this.toResponse(res);
    } catch (error) {
      if (error instanceof AIError) throw error;
      throw new AIError("GenerationFailed", "Windows generation failed", {
        code: "inference_failed",
        providerId: this.id,
        cause: error,
      });
    }
  }

  async countTokens(req: AIRequest): Promise<AIUsageMetadata> {
    const caps = await this.getCapabilities();
    return {
      inputTokens: estimateTokens(`${req.systemInstruction ?? ""}${req.text}`),
      tokenLimit: caps.contextTokens,
    };
  }

  async warmUp(): Promise<void> {
    await windowsLmWarmup();
  }

  async cancel(requestId: string): Promise<void> {
    await windowsLmCancel(requestId);
  }

  private toResponse(res: {
    requestId: string;
    text: string;
    finishReason?: string;
    inputTokens?: number;
    tokenLimit?: number;
    baseModelName?: string;
  }): AIResponse {
    return {
      requestId: res.requestId,
      text: res.text,
      finishReason: res.finishReason,
      baseModelName: res.baseModelName,
      usage: {
        inputTokens: res.inputTokens,
        tokenLimit: res.tokenLimit,
      },
    };
  }
}
