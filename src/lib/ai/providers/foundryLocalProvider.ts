import { useSettingsStore } from "../../../stores/settingsStore";
import {
  chatCompletions,
  chatCompletionsStream,
  countFoundryTokens,
  getFoundryStatus,
} from "../foundryLocal/client";
import { foundryErrorFromUnknown } from "../foundryLocal/errors";
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

export const FOUNDRY_LOCAL_PROVIDER_ID = "ondevice-foundry-local";

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

function downloadStateFrom(status: string): AIDownloadState {
  switch (status) {
    case "available":
      return "downloaded";
    case "model_downloadable":
      return "downloadable";
    default:
      return "unavailable";
  }
}

function buildMessages(req: AIRequest): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  if (req.systemInstruction) {
    messages.push({ role: "system", content: req.systemInstruction });
  }
  messages.push({ role: "user", content: req.text });
  return messages;
}

export function getFoundryLocalProvider(): FoundryLocalProvider {
  return new FoundryLocalProvider();
}

export class FoundryLocalProvider implements AIProvider {
  readonly id = FOUNDRY_LOCAL_PROVIDER_ID;
  readonly kind = "local-model" as const;

  private settings() {
    return useSettingsStore.getState().settings.foundryLocal;
  }

  async getCapabilities(): Promise<AIModelCapabilities> {
    const cfg = this.settings();
    if (!cfg?.enabled) return DEAD_CAPS;
    const snap = await getFoundryStatus(cfg.baseUrl, cfg.model);
    const ready = snap.status === "available" && !!snap.configuredModel;
    return {
      ...DEAD_CAPS,
      textGeneration: ready,
      structuredGeneration: ready,
      streaming: ready,
      offlineAvailable: ready,
      downloadState: downloadStateFrom(snap.status),
      contextTokens: 4096,
    };
  }

  async generateStream(req: AIRequest, opts?: AIStreamOptions): Promise<AIResponse> {
    if (opts?.signal?.aborted) {
      throw new AIError("Cancelled", "Request cancelled", { code: "cancelled", providerId: this.id });
    }
    const cfg = this.settings();
    if (!cfg?.enabled) {
      throw foundryErrorFromUnknown(
        { code: "feature_disabled", message: "Foundry Local is disabled" },
        { providerId: this.id }
      );
    }

    const snap = await getFoundryStatus(cfg.baseUrl, cfg.model);
    if (snap.status === "runtime_unavailable") {
      throw foundryErrorFromUnknown(
        { code: "runtime_unavailable", message: snap.reason ?? "Foundry Local runtime unavailable" },
        { providerId: this.id }
      );
    }
    if (snap.status === "model_downloadable") {
      throw foundryErrorFromUnknown(
        { code: "model_downloadable", message: snap.reason ?? "Model download required" },
        { providerId: this.id }
      );
    }
    if (snap.status !== "available" || !snap.configuredModel) {
      throw foundryErrorFromUnknown(
        { code: "model_unavailable", message: snap.reason ?? "Model unavailable" },
        { providerId: this.id }
      );
    }

    const request = {
      model: snap.configuredModel,
      messages: buildMessages(req),
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens,
    };

    try {
      const useStream = opts?.stream !== false;
      const result = useStream
        ? await chatCompletionsStream(cfg.baseUrl, request, {
            signal: opts?.signal,
            onChunk: opts?.onChunk,
          })
        : await chatCompletions(cfg.baseUrl, request, opts?.signal);

      const choice = result.choices[0];
      return {
        requestId: req.requestId,
        text: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason,
        baseModelName: result.model,
        usage: {
          inputTokens: result.usage?.prompt_tokens,
          outputTokens: result.usage?.completion_tokens,
          tokenLimit: 4096,
        },
      };
    } catch (error) {
      if (error instanceof AIError) throw error;
      throw foundryErrorFromUnknown(error, { providerId: this.id });
    }
  }

  async countTokens(req: AIRequest): Promise<AIUsageMetadata> {
    const cfg = this.settings();
    if (!cfg?.enabled) {
      return { inputTokens: 0, tokenLimit: 0 };
    }
    const snap = await getFoundryStatus(cfg.baseUrl, cfg.model);
    if (snap.status !== "available" || !snap.configuredModel) {
      return { inputTokens: 0, tokenLimit: 4096 };
    }
    try {
      const result = await countFoundryTokens(cfg.baseUrl, {
        model: snap.configuredModel,
        messages: buildMessages(req),
      });
      return { inputTokens: result.tokenCount, tokenLimit: 4096 };
    } catch {
      return { inputTokens: 0, tokenLimit: 4096 };
    }
  }
}
