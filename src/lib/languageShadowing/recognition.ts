import type { ShadowingRecognitionInput, ShadowingRecognitionProvider, ShadowingRecognitionResult, ShadowingSttRoute } from "./types";

const UNCERTAINTY_THRESHOLD = 0.7;

/** Routes a captured blob only to an explicitly supplied local/cloud STT provider. */
export class ShadowingRecognitionService {
  constructor(private readonly providers: readonly ShadowingRecognitionProvider[] = []) {}

  async recognize(input: ShadowingRecognitionInput, route: ShadowingSttRoute, signal?: AbortSignal): Promise<ShadowingRecognitionResult> {
    if (signal?.aborted) return { status: "failed", uncertain: true, reason: "cancelled" };
    if (route === "cloud" && input.privacy !== "allow-cloud") {
      return { status: "unavailable", uncertain: true, reason: "cloud-consent-required" };
    }
    const provider = this.providers.find((candidate) => candidate.route === route && candidate.supports(input.languageTag));
    if (!provider) return { status: "unavailable", uncertain: true, reason: `${route}-stt-unavailable` };
    try {
      const result = await provider.recognize(input, signal);
      if (signal?.aborted) return { status: "failed", uncertain: true, reason: "cancelled" };
      const confidence = typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : undefined;
      return { status: "ready", text: result.text, confidence, uncertain: confidence === undefined || confidence < UNCERTAINTY_THRESHOLD, providerId: provider.id, providerVersion: provider.version };
    } catch (error) {
      if (signal?.aborted) return { status: "failed", uncertain: true, reason: "cancelled" };
      return { status: "failed", uncertain: true, reason: error instanceof Error ? error.message : "stt-failed", providerId: provider.id, providerVersion: provider.version };
    }
  }
}
