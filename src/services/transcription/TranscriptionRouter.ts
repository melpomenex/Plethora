import {
  getDefaultProviderChains,
  modeFromSttProvider,
  PREMIUM_PROVIDER_IDS,
  resolveLogicalModelProviderIds,
  ROUTER_DEFAULTS,
  TRANSCRIPTION_PROVIDER_IDS,
} from "./config";
import {
  isRetryableTranscriptionError,
  normalizeError,
  TranscriptionError,
} from "./errors";
import type {
  TranscriptionCapabilities,
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionRoutingContext,
} from "./types";
import { TranscriptionMode } from "./types";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerTier(providerId: TranscriptionProviderId): "local" | "inexpensive" | "premium" | "legacy" {
  if (
    providerId === TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER ||
    providerId === TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON
  ) {
    return "local";
  }
  if (PREMIUM_PROVIDER_IDS.has(providerId)) return "premium";
  if (providerId === TRANSCRIPTION_PROVIDER_IDS.LEGACY_GROQ) return "legacy";
  return "inexpensive";
}

function isProviderHealthy(
  providerId: TranscriptionProviderId,
  healthState?: TranscriptionRoutingContext["healthState"],
): boolean {
  const entry = healthState?.[providerId];
  if (!entry) return true;
  if (entry.healthy) return true;
  if (
    entry.failureCount >= ROUTER_DEFAULTS.healthFailureThreshold &&
    entry.lastFailureAt &&
    Date.now() - entry.lastFailureAt < ROUTER_DEFAULTS.healthWindowMs
  ) {
    return false;
  }
  return true;
}

function satisfiesCapabilities(
  provider: TranscriptionProvider,
  capabilities: TranscriptionCapabilities,
  required?: Partial<TranscriptionCapabilities>,
): boolean {
  if (!required) return true;
  return Object.entries(required).every(([key, value]) => {
    if (value === undefined) return true;
    return capabilities[key as keyof TranscriptionCapabilities] === value;
  });
}

export function buildFallbackChain(context: TranscriptionRoutingContext): TranscriptionProviderId[] {
  const forceOffline =
    context.forceOffline ||
    context.sttProvider === "local" ||
    context.mode === TranscriptionMode.Offline;

  if (forceOffline) {
    const localChain: TranscriptionProviderId[] = [];
    if (context.localNemotronInstalled !== false) {
      localChain.push(TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON);
    }
    localChain.push(TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER);
    const explicitLocal = resolveLogicalModelProviderIds(context.sttModel ?? "automatic", "local");
    if (explicitLocal.length > 0) {
      return explicitLocal.filter((id) => localChain.includes(id));
    }
    return [...new Set(localChain)];
  }

  if (context.sttProvider === "openrouter") {
    const explicit = resolveLogicalModelProviderIds(context.sttModel ?? "automatic", "cloud");
    if (explicit.length > 0) {
      return context.automaticFallback === false
        ? explicit
        : [...explicit, ...getDefaultProviderChains()[TranscriptionMode.Fast].filter((id) => !explicit.includes(id))];
    }
    return [...getDefaultProviderChains()[TranscriptionMode.Fast]];
  }

  if (context.sttProvider === "premium") {
    return [...getDefaultProviderChains()[TranscriptionMode.Enhanced]];
  }

  const effectiveMode = context.sttProvider
    ? modeFromSttProvider(context.sttProvider)
    : context.mode;

  let chain = [...getDefaultProviderChains()[effectiveMode]];

  if (
    context.preferLocal &&
    context.localNemotronInstalled &&
    (context.sttProvider === "automatic" || context.sttProvider === undefined) &&
    effectiveMode === TranscriptionMode.Auto
  ) {
    chain = [
      TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON,
      ...chain.filter((id) => id !== TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON),
    ];
  }

  if (!context.legacyGroqEnabled) {
    chain = chain.filter((id) => id !== TRANSCRIPTION_PROVIDER_IDS.LEGACY_GROQ);
  }

  if (context.automaticFallback === false && context.sttModel && context.sttModel !== "automatic") {
    const explicit = resolveLogicalModelProviderIds(context.sttModel, "cloud");
    if (explicit.length > 0) return explicit;
  }

  return chain;
}

export function canFallbackToProvider(
  fromProviderId: TranscriptionProviderId,
  toProviderId: TranscriptionProviderId,
  context: TranscriptionRoutingContext,
): boolean {
  const fromTier = providerTier(fromProviderId);
  const toTier = providerTier(toProviderId);

  if (toTier === "premium" && fromTier !== "premium") {
    if (
      context.mode === TranscriptionMode.Enhanced ||
      context.mode === TranscriptionMode.Realtime
    ) {
      return true;
    }
    return context.allowPremiumFallback === true;
  }

  if (
    context.mode === TranscriptionMode.Enhanced &&
    fromTier === "premium" &&
    toTier !== "premium"
  ) {
    return false;
  }

  if (context.mode === TranscriptionMode.Offline && toTier !== "local") {
    return false;
  }

  return true;
}

export async function selectProvider(
  mode: TranscriptionMode,
  requiredCapabilities: Partial<TranscriptionCapabilities> | undefined,
  settings: TranscriptionRoutingContext,
  providers: Map<TranscriptionProviderId, TranscriptionProvider>,
  healthState?: TranscriptionRoutingContext["healthState"],
): Promise<TranscriptionProviderId[]> {
  const context: TranscriptionRoutingContext = {
    ...settings,
    mode,
    requiredCapabilities,
    healthState: healthState ?? settings.healthState,
  };

  const chain = buildFallbackChain(context);
  const ordered: TranscriptionProviderId[] = [];

  for (const providerId of chain) {
    const provider = providers.get(providerId);
    if (!provider) continue;
    if (!isProviderHealthy(providerId, context.healthState)) continue;

    const capabilities = await Promise.resolve(provider.capabilities());
    if (!satisfiesCapabilities(provider, capabilities, requiredCapabilities)) {
      continue;
    }

    ordered.push(providerId);
  }

  return ordered;
}

export async function withExponentialBackoff<T>(
  operation: () => Promise<T>,
  options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    providerId?: TranscriptionProviderId;
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? ROUTER_DEFAULTS.maxRetries;
  const baseDelayMs = options?.baseDelayMs ?? ROUTER_DEFAULTS.baseDelayMs;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const normalized = normalizeError(error, options?.providerId);
      if (!isRetryableTranscriptionError(normalized) || attempt >= maxRetries) {
        throw normalized;
      }
      const jitter = Math.random() * 100;
      const delay = normalized.retryAfterMs ?? baseDelayMs * 2 ** attempt + jitter;
      await wait(delay);
      attempt += 1;
    }
  }

  throw normalizeError(lastError, options?.providerId);
}

export async function executeWithFallback<T>(
  providerChain: readonly TranscriptionProviderId[],
  context: TranscriptionRoutingContext,
  invoke: (providerId: TranscriptionProviderId) => Promise<T>,
): Promise<{ result: T; providerId: TranscriptionProviderId }> {
  let lastError: TranscriptionError | undefined;
  let previousProviderId: TranscriptionProviderId | undefined;
  const chain = context.automaticFallback === false
    ? providerChain.slice(0, 1)
    : providerChain;

  for (const providerId of chain) {
    if (
      previousProviderId &&
      !canFallbackToProvider(previousProviderId, providerId, context)
    ) {
      continue;
    }

    try {
      const result = await withExponentialBackoff(
        () => invoke(providerId),
        { providerId },
      );
      return { result, providerId };
    } catch (error) {
      const normalized = normalizeError(error, providerId);
      lastError = normalized;

      if (context.mode === TranscriptionMode.Enhanced && PREMIUM_PROVIDER_IDS.has(providerId)) {
        throw new TranscriptionError(
          `${normalized.message} Enhanced Accuracy does not silently fall back to a lower-quality provider.`,
          normalized.code,
          { providerId, cause: normalized },
        );
      }

      previousProviderId = providerId;
    }
  }

  throw lastError ?? new TranscriptionError(
    "No transcription providers are available for the selected mode.",
    "PROVIDER_UNAVAILABLE",
  );
}
