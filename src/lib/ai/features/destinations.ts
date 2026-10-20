/**
 * Destination classification (F0, change
 * `harden-ai-learning-feature-initialization`, task 1.2).
 *
 * Authentication, billing and *where the content is processed* are three
 * independent facts. The existing `providerAllowsKeylessAccess` helper is an
 * authentication predicate: it rightly treats a keyless Ollama endpoint as
 * usable, and it treats a LAN `.local` host as keyless. It must NOT be read as
 * "local processing" — a remote Ollama install or a LAN box processes private
 * text off-device.
 *
 * This module is the single privacy-boundary classifier. It never changes
 * existing authentication behaviour; callers use it *in addition* to the
 * existing disclosure/billing helpers.
 */

import type { ProviderClass } from "./types";

export type DestinationLocality = "device" | "loopback" | "lan" | "remote" | "unknown";

export interface DestinationClassification {
  readonly providerClass: ProviderClass;
  readonly locality: DestinationLocality;
  /** No API key is required (authentication fact). */
  readonly keyless: boolean;
  /** Calls can incur a direct provider charge (billing fact). */
  readonly billable: boolean;
  /** Content leaves the user's device (privacy fact). */
  readonly sendsOffDevice: boolean;
  /** Off-device processing requires the existing cloud disclosure. */
  readonly requiresDisclosure: boolean;
  /** Billable processing requires the existing cost authorization. */
  readonly requiresCostConsent: boolean;
  /** Safe, non-identifying reason key for the UI. */
  readonly reasonKey?: string;
}

export interface CloudDestinationInput {
  readonly provider: "openai" | "anthropic" | "gemini" | "deepseek" | "ollama" | "openrouter" | string;
  readonly baseUrl?: string | null;
  readonly hasApiKey?: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "[::]"]);
const LAN_SUFFIXES = [".local", ".lan", ".internal", ".home", ".localdomain"];

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(`[${host}]`)) return true;
  // The entire 127.0.0.0/8 block is loopback.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

function isPrivateAddress(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv6 unique-local / link-local.
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  return false;
}

function isLanHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === "host.docker.internal" || host === "gateway.docker.internal") return true;
  return LAN_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Classify a base URL by where it points. Loopback is the ONLY URL locality
 * that may be treated as on-device. Everything else (LAN, `.local`, tunnel,
 * public host, missing/invalid URL) is off-device.
 */
export function classifyBaseUrlLocality(
  baseUrl: string | null | undefined
): { locality: DestinationLocality; host?: string } {
  if (!baseUrl || !baseUrl.trim()) return { locality: "unknown" };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { locality: "unknown" };
  }
  const host = url.hostname;
  if (isLoopbackHost(host)) return { locality: "loopback", host };
  if (isPrivateAddress(host) || isLanHostname(host)) return { locality: "lan", host };
  return { locality: "remote", host };
}

function configuredCloudClass(input: CloudDestinationInput): ProviderClass {
  if (input.provider === "ollama") return "ollama-local";
  return "configured-external";
}

/**
 * Classify a configured cloud-style destination (including Ollama, keyless
 * OpenAI-compatible endpoints and remote hosts).
 */
export function classifyCloudDestination(
  input: CloudDestinationInput
): DestinationClassification {
  const { locality } = classifyBaseUrlLocality(input.baseUrl);
  const providerClass = configuredCloudClass(input);
  const isOllama = input.provider === "ollama";

  // Authentication: mirrors `providerAllowsKeylessAccess` without importing a
  // mutating store. Keyless does not imply local.
  const keyless = isOllama || (input.provider === "openai" && locality !== "remote" && locality !== "unknown");
  const billable = !keyless;

  // Privacy: an Ollama server WITHOUT a URL is assumed local by convention
  // (the backend default is 127.0.0.1), but anything with an explicit
  // non-loopback URL is off-device. A missing URL on a paid provider is
  // its normal cloud endpoint.
  let sendsOffDevice: boolean;
  if (locality === "loopback") {
    // A verified loopback endpoint is processed on this machine. This holds
    // for Ollama and for keyless/local OpenAI-compatible servers alike.
    sendsOffDevice = false;
  } else if (isOllama) {
    sendsOffDevice = locality !== "device";
    if (locality === "unknown" && !input.baseUrl) sendsOffDevice = false;
  } else {
    sendsOffDevice = true;
  }

  return {
    providerClass,
    locality,
    keyless,
    billable,
    sendsOffDevice,
    requiresDisclosure: sendsOffDevice,
    requiresCostConsent: billable,
    reasonKey: sendsOffDevice
      ? locality === "lan"
        ? "ai.destination.lan"
        : locality === "remote"
          ? "ai.destination.remote"
          : "ai.destination.offDevice"
      : "ai.destination.loopback",
  };
}

/**
 * Classify a native on-device provider. "Native" is a compile-time route, so
 * this classification says nothing about model readiness — callers pair it
 * with the platform capability snapshot.
 */
export function classifyNativeDestination(providerClass: ProviderClass): DestinationClassification {
  return {
    providerClass,
    locality: "device",
    keyless: true,
    billable: false,
    sendsOffDevice: false,
    requiresDisclosure: false,
    requiresCostConsent: false,
    reasonKey: "ai.destination.device",
  };
}

export interface EmbeddingDestinationInput {
  readonly provider: "openai" | "cohere" | "openrouter" | "ollama" | string;
  readonly ollamaBaseUrl?: string | null;
  readonly hasApiKey?: boolean;
}

/**
 * Classify the persisted embedding destination. Embeddings can process source
 * text off-device even when generation is local, so callers must check this
 * separately from the generation destination.
 */
export function classifyEmbeddingDestination(
  input: EmbeddingDestinationInput
): DestinationClassification {
  if (input.provider === "ollama") {
    return classifyCloudDestination({
      provider: "ollama",
      baseUrl: input.ollamaBaseUrl,
      hasApiKey: false,
    });
  }
  if (input.provider === "openai") {
    // A configured OpenAI-compatible base URL is not part of EmbeddingSettings
    // today; OpenAI embeddings are remote unless a future local base URL is
    // added to the settings type.
    return classifyCloudDestination({
      provider: "openai",
      baseUrl: null,
      hasApiKey: input.hasApiKey,
    });
  }
  return classifyCloudDestination({
    provider: input.provider,
    baseUrl: null,
    hasApiKey: input.hasApiKey,
  });
}

/** True when two classifications point at the same kind of destination. */
export function sameDestination(
  a: DestinationClassification,
  b: DestinationClassification
): boolean {
  return (
    a.providerClass === b.providerClass &&
    a.locality === b.locality &&
    a.sendsOffDevice === b.sendsOffDevice
  );
}
