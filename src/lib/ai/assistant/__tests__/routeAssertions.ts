/**
 * Test-only route assertion helper (change 1.2): captures which provider
 * instance actually served each `generateStream` and the model that served
 * it (AIResponse.baseModelName), so pinning and serving-model identity can
 * be proven.
 */

import type { AIProvider, AIRequest, AIResponse, AIStreamOptions, AIModelCapabilities } from "../../providers/types";

export interface ServedRequest {
  providerId: string;
  model?: string;
}

/**
 * Wrap any provider and record every served request. When the inner provider
 * does not set `baseModelName`, the probe stamps its own id so tests can
 * assert serving identity.
 */
export class ServingProbe implements AIProvider {
  readonly requests: ServedRequest[] = [];
  readonly inner: AIProvider;

  constructor(inner: AIProvider) {
    this.inner = inner;
  }

  get id(): string {
    return this.inner.id;
  }

  get kind(): "ondevice" | "cloud" {
    return this.inner.kind === "cloud" ? "cloud" : "ondevice";
  }

  async getCapabilities(): Promise<AIModelCapabilities> {
    return this.inner.getCapabilities();
  }

  async generateStream(req: AIRequest, opts?: AIStreamOptions): Promise<AIResponse> {
    const res = await this.inner.generateStream(req, opts);
    this.requests.push({
      providerId: this.inner.id,
      model: res.baseModelName ?? this.inner.id,
    });
    return { ...res, baseModelName: res.baseModelName ?? this.inner.id };
  }
}

/** Assert every served request came from the expected provider/model. */
export function expectServedBy(
  probe: ServingProbe,
  expectedProviderId: string,
  expectedModel?: string
): void {
  if (probe.requests.length === 0) {
    throw new Error(`expectServedBy: no generation request was served by ${probe.id}`);
  }
  for (const request of probe.requests) {
    if (request.providerId !== expectedProviderId) {
      throw new Error(
        `expectServedBy: request served by ${request.providerId}, expected ${expectedProviderId}`
      );
    }
    if (expectedModel !== undefined && request.model !== expectedModel) {
      throw new Error(
        `expectServedBy: model ${request.model} served, expected ${expectedModel}`
      );
    }
  }
}
