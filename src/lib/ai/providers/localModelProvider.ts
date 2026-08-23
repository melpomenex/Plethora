/**
 * Placeholder `AIProvider` for a future licensed on-device pack (OpenSpec H).
 * Throws until a licensed generative artifact exists — no unlicensed LLM.
 */

import { AIError } from "../errors";
import type { AIModelCapabilities, AIProvider, AIRequest, AIResponse, AIStreamOptions } from "./types";
import { findLicensedModel, mayShipGenerativePack } from "../modelLicense";

export const LOCAL_MODEL_PROVIDER_ID = "local-model";

export class LocalModelProvider implements AIProvider {
  readonly id = LOCAL_MODEL_PROVIDER_ID;
  readonly kind = "local-model" as const;

  constructor(private readonly modelId?: string) {}

  async getCapabilities(): Promise<AIModelCapabilities> {
    const record = this.modelId ? findLicensedModel(this.modelId) : undefined;
    const ready = mayShipGenerativePack(record);
    return {
      textGeneration: ready,
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
      offlineAvailable: ready,
      downloadState: ready ? "downloaded" : "unavailable",
    };
  }

  async generateStream(_req: AIRequest, _opts?: AIStreamOptions): Promise<AIResponse> {
    throw new AIError(
      "ModelUnavailable",
      "No licensed on-device generative pack is installed.",
      { code: "model_unavailable", providerId: this.id }
    );
  }
}
