/**
 * Turn policy resolution (design D4, task 2.3).
 *
 * Consolidates provider / embedder / retriever / fallback resolution into ONE
 * step that runs *before* privacy gating, so the authorized policy shown to
 * the user and the actual destination cannot diverge. The key correctness
 * rule: **locality is derived from the actual destination, never from a
 * provider label.** A custom/remote Ollama endpoint is remote no matter what
 * it is called.
 */

export type DestinationLocality = "on-device" | "remote";

export interface ProviderCandidate {
  /** Provider id as stored (e.g. `ollama`, `openai`, `ondevice`). */
  providerId: string;
  model?: string;
  /** Configured endpoint, when the provider supports one. */
  baseUrl?: string;
  enabled?: boolean;
}

export interface ResolvedDestination {
  providerId: string;
  model?: string;
  locality: DestinationLocality;
  /** Why locality resolved this way (user-visible explanation text). */
  localityReason: string;
  /** True when the provider runs fully on this device. */
  onDevice: boolean;
}

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

/** Providers whose traffic always leaves the device. */
const CLOUD_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "openrouter",
]);

/** Providers that execute on this device regardless of configuration. */
const ON_DEVICE_PROVIDER_IDS = new Set([
  "ondevice",
  "gemini-nano",
  "apple-foundation",
  "apple-foundation-models",
  "apple-core-ai",
  "windows-ai",
  "foundry-local",
  "local-decision-engine",
]);

export function isLoopbackBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return true; // no endpoint → the provider's own on-device default
  try {
    const url = new URL(baseUrl.includes("://") ? baseUrl : `http://${baseUrl}`);
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Resolve the actual destination of a request. This is the single source of
 * truth the privacy gate, the visible label and the dispatch path all use.
 */
export function resolveDestination(candidate: ProviderCandidate): ResolvedDestination {
  const providerId = candidate.providerId.trim().toLowerCase();
  if (ON_DEVICE_PROVIDER_IDS.has(providerId)) {
    return {
      providerId: candidate.providerId,
      model: candidate.model,
      locality: "on-device",
      localityReason: "runs on this device",
      onDevice: true,
    };
  }
  if (CLOUD_PROVIDER_IDS.has(providerId)) {
    return {
      providerId: candidate.providerId,
      model: candidate.model,
      locality: "remote",
      localityReason: "cloud provider",
      onDevice: false,
    };
  }
  // Everything else (Ollama, custom OpenAI-compatible endpoints, unknown
  // ids): locality comes from the endpoint, not the label.
  const loopback = isLoopbackBaseUrl(candidate.baseUrl);
  if (loopback) {
    return {
      providerId: candidate.providerId,
      model: candidate.model,
      locality: "on-device",
      localityReason: "endpoint is on this machine",
      onDevice: true,
    };
  }
  return {
    providerId: candidate.providerId,
    model: candidate.model,
    locality: "remote",
    localityReason: `endpoint ${candidate.baseUrl} is remote`,
    onDevice: false,
  };
}

/**
 * True when a destination may process local-only source content. A remote
 * custom endpoint can never inherit on-device guarantees from its label.
 */
export function destinationAllowsLocalOnly(destination: ResolvedDestination): boolean {
  return destination.locality === "on-device";
}

/** The effective destination for a fallback chain (primary + fallbacks). */
export function resolveFallbackChain(
  candidates: ProviderCandidate[],
): ResolvedDestination[] {
  return candidates.map(resolveDestination);
}

/**
 * True when the whole chain (primary + fallbacks) stays on this device. Used
 * to decide whether `strictLocalOnly` can be satisfied — a remote fallback
 * must be disabled, not merely deprioritized.
 */
export function chainStaysLocal(chain: ResolvedDestination[]): boolean {
  return chain.every((destination) => destination.locality === "on-device");
}
