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

/**
 * A user-installed local decision engine (GGUF via llama.cpp, or ONNX).
 *
 * Registered as an `AIProvider` in the *existing* registry rather than as a
 * parallel subsystem: `unified-native-on-device-ai` decided "extend this spine,
 * no second router", and a bespoke HTTP client would be exactly that. A decision
 * engine is just a fast text-generation provider that happens to be good at
 * emitting a small JSON envelope, so it participates in the same capability
 * negotiation, the same in-flight coalescing, and the same timeouts as every
 * other provider.
 *
 * Nothing is bundled. The user points Plethora at an engine they already run, so
 * the licence question that `LocalModelProvider` above declines to answer by
 * shipping an artifact does not arise.
 */
export const LOCAL_DECISION_ENGINE_PROVIDER_ID = "local-decision-engine";

/** Where the user says their engine is listening. Loopback by default. */
export interface LocalDecisionEngineConfig {
  /** Base URL of an OpenAI-compatible server, or a llama.cpp server. */
  baseUrl: string;
  /** The engine's model name, as the server reports it. */
  model: string;
  /** Per-call budget. The ranker's own timeout dominates; this bounds one call. */
  timeoutMs?: number;
}

export class LocalDecisionEngineProvider implements AIProvider {
  readonly id = LOCAL_DECISION_ENGINE_PROVIDER_ID;
  readonly kind = "local-model" as const;

  constructor(private readonly config: LocalDecisionEngineConfig) {}

  async getCapabilities(): Promise<AIModelCapabilities> {
    return {
      // A decision engine is a small instruct model: it emits a JSON envelope and
      // nothing else, so generation is on and the rest is honestly off.
      textGeneration: true,
      // The whole point of routing this task here rather than to a cloud model is
      // the JSON schema, so structured generation is what it must offer.
      structuredGeneration: true,
      vision: false,
      multiImage: false,
      systemInstructions: true,
      toolCalling: false,
      reasoning: false,
      embeddings: false,
      contextTokens: 8192,
      streaming: false,
      prefixCaching: true,
      offlineAvailable: true,
      downloadState: "downloaded",
    };
  }

  async generateStream(req: AIRequest, _opts?: AIStreamOptions): Promise<AIResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 12_000
    );
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            ...(req.systemInstruction
              ? [{ role: "system", content: req.systemInstruction }]
              : []),
            { role: "user", content: req.text },
          ],
          temperature: req.temperature ?? 0,
          max_tokens: req.maxOutputTokens ?? 300,
          ...(req.structured && req.schemaName
            ? { response_format: { type: "json_schema", json_schema: { name: req.schemaName } } }
            : {}),
          stream: false,
        }),
      });
      if (!response.ok) {
        throw new AIError("ProviderOffline", `Decision engine returned ${response.status}`, {
          code: "engine_unavailable",
          providerId: this.id,
        });
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        throw new AIError("InvalidStructuredOutput", "Decision engine returned no content", {
          code: "empty_completion",
          providerId: this.id,
        });
      }
      return { requestId: req.requestId, text };
    } catch (error) {
      if (error instanceof AIError) throw error;
      // A refusal to connect and a timeout are the same thing to the ranker:
      // this provider is unavailable for the current pass.
      throw new AIError("ProviderOffline", "Decision engine is unreachable", {
        code: "engine_unreachable",
        providerId: this.id,
        cause: String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
