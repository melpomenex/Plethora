/**
 * Read-only readiness probes + shared revision-keyed cache (F0 tasks 1.2/1.3).
 *
 * Everything here is a READ. Nothing in this module starts inference,
 * downloads a model, enqueues indexing, writes settings or sends private
 * content anywhere. Probes have their own bounded timeout and failures degrade
 * to `unknown`, never to an exception storm or an optimistic `ready`.
 *
 * The cache is keyed by a configuration revision computed from settings and
 * the provider registry: a provider change, endpoint change, consent change or
 * capability toggle invalidates the cached snapshot immediately. In-flight
 * probes are deduplicated; a superseded result can never be returned for a
 * newer revision.
 */

import { fnv1aHash } from "../providers/types";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { getActiveCloudConfig } from "../providers/cloudProvider";
import {
  getOnDeviceAiCapabilities,
  isOnDeviceAiSupportedPlatform,
  type OnDeviceCapabilitySnapshot,
} from "../onDeviceAI";
import { getAppleIntelligenceSnapshot, isAppleOsPlatform } from "../apple/capabilities";
import {
  getWindowsIntelligenceSnapshot,
  isWindowsDesktop,
} from "../windows/capabilities";
import { getFoundryStatus } from "../foundryLocal/client";
import { getAIIndexStatus, type IndexStatusResponse } from "../../../api/ai-learning";
import { getAvailableOCRProviders } from "../../../api/ocrCommands";
import { isCloudAiDisclosed, resolveCloudAiProviderClass } from "../../privacy/cloudAiDisclosure";
import {
  cloudEmbeddingRequiresConsent,
  paidEmbeddingsEnabled,
} from "../../../utils/aiBillingConsent";
import type { Settings } from "../../../stores/settingsStore";
import {
  classifyCloudDestination,
  classifyEmbeddingDestination,
  classifyNativeDestination,
} from "./destinations";
import type {
  CapabilityProbe,
  EmbeddingProbeDetail,
  FeatureDependencyContext,
  GenerationProbeDetail,
  IndexProbe,
  ProviderClass,
} from "./types";

const PROBE_TIMEOUT_MS = 4_000;

/** Bound a probe so a hung native/IPC call cannot block readiness forever. */
export async function withProbeTimeout<T>(
  promise: Promise<T>,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Stable revision of every input that can change a readiness verdict. Index
 * state is intentionally NOT part of the revision: it is itself probed and is
 * expected to change while the rest of the configuration stays put.
 */
export function computeDependencyRevision(
  settings: Settings,
  providers: ReadonlyArray<{
    id: string;
    provider: string;
    enabled: boolean;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }>
): string {
  const features = settings.features ?? {};
  const embedding = settings.embedding ?? ({} as Settings["embedding"]);
  const ai = settings.ai ?? ({} as Settings["ai"]);
  const parts = [
    "f0-v1",
    // Feature preferences, sorted for stability.
    ...Object.keys(features)
      .sort()
      .map((key) => `${key}=${String((features as Record<string, unknown>)[key])}`),
    `activeRecallMode=${ai.activeRecallMode ?? "off"}`,
    `preferOnDevice=${String(ai.preferOnDevice)}`,
    `allowCloudFallback=${String(ai.allowCloudFallback)}`,
    `embeddingProvider=${embedding.provider ?? ""}`,
    `embeddingOllama=${embedding.ollamaBaseUrl ?? ""}`,
    `paidEmbeddings=${String(embedding.paidEmbeddingsEnabled)}`,
    `foundry=${String(settings.foundryLocal?.enabled)}:${settings.foundryLocal?.baseUrl ?? ""}:${
      settings.foundryLocal?.model ?? ""
    }`,
    `nativeApple=${String(settings.features?.appleFoundationModels)}:${String(
      settings.features?.appleCoreAI
    )}:${String(settings.features?.appleNaturalLanguageEmbeddings)}`,
    `nativeWindows=${String(settings.features?.windowsSystemAi)}`,
    // Provider endpoints/models are part of the revision; keys are hashed so
    // the revision string itself carries no credential.
    ...providers
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(
        (p) =>
          `provider=${p.id}:${p.provider}:${p.enabled ? 1 : 0}:${p.baseUrl ?? ""}:${
            p.model ?? ""
          }:${p.apiKey ? fnv1aHash(p.apiKey) : ""}`
      ),
  ];
  return fnv1aHash(parts.join("\u0000"));
}

function platformInfo(): FeatureDependencyContext["platform"] {
  if (isOnDeviceAiSupportedPlatform()) {
    return { os: "android", mobile: true };
  }
  if (isAppleOsPlatform()) {
    // Apple desktop vs mobile is not distinguished by the capability helpers;
    // the readiness contract only needs "apple native is a permitted route".
    return { os: "ios", mobile: true };
  }
  if (isWindowsDesktop()) return { os: "windows", mobile: false };
  if (typeof navigator !== "undefined" && /Mac/i.test(navigator.platform ?? "")) {
    return { os: "macos", mobile: false };
  }
  if (typeof navigator !== "undefined" && /Linux/i.test(navigator.platform ?? "")) {
    return { os: "linux", mobile: false };
  }
  return { os: "unknown", mobile: false };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function mapIndexStatus(
  response: IndexStatusResponse | undefined
): IndexProbe {
  if (!response || !response.aggregate) {
    return {
      state: "unknown",
      detail: { completeness: "unavailable" },
      reasonKey: "ai.reason.indexStatusUnknown",
    };
  }
  const aggregate = response.aggregate;
  const indexed = numberOrUndefined(aggregate.indexedDocuments) ?? 0;
  const pending =
    numberOrUndefined(aggregate.pendingDocuments) ??
    (numberOrUndefined(aggregate.queuedDocuments) ?? 0) +
      (numberOrUndefined(aggregate.indexingDocuments) ?? 0);
  const failed = numberOrUndefined(aggregate.failedDocuments) ?? 0;
  const stale = numberOrUndefined(aggregate.staleDocuments) ?? 0;
  const total = numberOrUndefined(aggregate.totalDocuments) ?? 0;

  // A document-only aggregate cannot prove cards/annotations are indexed, so
  // completeness is `partial` unless there is nothing left to index AND the
  // caller can prove every source kind. We conservatively report partial for
  // a non-empty library: never claim exhaustive coverage from this projection.
  const completeness: IndexProbe["detail"]["completeness"] =
    total === 0 ? "complete" : pending > 0 || stale > 0 ? "partial" : "partial";

  let state: IndexProbe["state"];
  if (failed > 0 && indexed === 0) state = "failed";
  else if (aggregate.paused) state = "paused";
  else if (pending > 0) state = indexed > 0 || aggregate.indexingDocuments > 0 ? "indexing" : "queued";
  else if (total === 0) state = "not-started";
  else state = "ready";

  return {
    state,
    detail: {
      completeness,
      documentsIndexed: indexed,
      documentsPending: pending,
    },
    reasonKey:
      state === "failed"
        ? "ai.reason.indexFailed"
        : state === "paused"
          ? "ai.reason.indexPaused"
          : state === "indexing" || state === "queued"
            ? "ai.reason.indexing"
            : undefined,
  };
}

interface NativeProbeResult {
  available: ProviderClass | null;
  /** True when a native model is downloadable but not installed. */
  modelDownloadRequired: boolean;
  reasonKey?: string;
  /** True when the platform has no native route at all. */
  unsupported: boolean;
  snapshot?: OnDeviceCapabilitySnapshot;
}

async function probeNativeGeneration(): Promise<NativeProbeResult> {
  let modelDownloadRequired = false;
  let unsupported = false;

  if (isOnDeviceAiSupportedPlatform()) {
    const snapshot = await withProbeTimeout(getOnDeviceAiCapabilities().catch(() => undefined));
    if (!snapshot) {
      return { available: null, modelDownloadRequired: false, unsupported: false, reasonKey: "ai.reason.nativeProbeUnknown" };
    }
    if (snapshot.prompt.status === "available") {
      return { available: "android-nano", modelDownloadRequired: false, unsupported: false, snapshot };
    }
    modelDownloadRequired = snapshot.prompt.status === "downloadable";
    unsupported = snapshot.prompt.status === "unavailable";
    return {
      available: null,
      modelDownloadRequired,
      unsupported,
      reasonKey:
        snapshot.prompt.status === "downloadable"
          ? "ai.reason.modelDownloadRequired"
          : "ai.reason.nativeModelUnavailable",
      snapshot,
    };
  }

  if (isWindowsDesktop()) {
    const flags = useSettingsStore.getState().settings.features;
    if (flags.windowsSystemAi !== false) {
      const snap = await withProbeTimeout(getWindowsIntelligenceSnapshot().catch(() => undefined));
      if (snap?.languageModel.status === "available") {
        return { available: "windows-system", modelDownloadRequired: false, unsupported: false };
      }
      modelDownloadRequired = snap?.languageModel.status === "downloadable";
    }
    const foundry = useSettingsStore.getState().settings.foundryLocal;
    if (foundry?.enabled) {
      const status = await withProbeTimeout(
        getFoundryStatus(foundry.baseUrl, foundry.model).catch(() => undefined)
      );
      if (status?.status === "available") {
        return { available: "foundry-local", modelDownloadRequired: false, unsupported: false };
      }
    }
    return {
      available: null,
      modelDownloadRequired,
      unsupported: false,
      reasonKey: modelDownloadRequired
        ? "ai.reason.modelDownloadRequired"
        : "ai.reason.nativeModelUnavailable",
    };
  }

  if (isAppleOsPlatform()) {
    const flags = useSettingsStore.getState().settings.features;
    if (flags.appleFoundationModels !== false || flags.appleCoreAI === true) {
      const snap = await withProbeTimeout(getAppleIntelligenceSnapshot().catch(() => undefined));
      if (snap?.foundationModels.status === "available") {
        return { available: "apple-native", modelDownloadRequired: false, unsupported: false };
      }
      modelDownloadRequired = snap?.foundationModels.status === "downloadable";
    }
    return {
      available: null,
      modelDownloadRequired,
      unsupported: false,
      reasonKey: modelDownloadRequired
        ? "ai.reason.modelDownloadRequired"
        : "ai.reason.nativeModelUnavailable",
    };
  }

  // Linux/desktop without a native route: a configured local or external
  // provider is the permitted path. This is NOT "unsupported".
  return { available: null, modelDownloadRequired: false, unsupported: false };
}

async function probeGeneration(): Promise<CapabilityProbe<GenerationProbeDetail>> {
  const settings = useSettingsStore.getState().settings;
  const prefersOnDevice = settings.ai?.preferOnDevice !== false;

  if (prefersOnDevice) {
    const native = await probeNativeGeneration();
    if (native.available) {
      const dest = classifyNativeDestination(native.available);
      return {
        state: "available",
        detail: {
          providerClass: native.available,
          destination: dest.locality,
          // Native reasoning capability is not asserted from compile-time
          // support alone; the task router applies its own fallback.
          reasoning: false,
          vision: native.snapshot?.imageInput === true,
        },
        reasonKey: dest.reasonKey,
      };
    }

    const config = getActiveCloudConfig();
    if (!config) {
      return {
        state: native.unsupported ? "unsupported" : "unavailable",
        reasonKey: native.reasonKey ?? "ai.reason.noGenerationRoute",
        modelDownloadRequired: native.modelDownloadRequired,
        setupAvailable: true,
      };
    }
    const dest = classifyCloudDestination({
      provider: config.provider,
      baseUrl: config.baseUrl,
      hasApiKey: config.apiKey.trim().length > 0,
    });
    if (dest.billable && !dest.keyless && config.apiKey.trim().length === 0) {
      return {
        state: "unavailable",
        reasonKey: "ai.reason.providerKeyMissing",
        setupAvailable: true,
      };
    }
    return {
      state: "degraded",
      detail: {
        providerClass: dest.providerClass,
        destination: dest.locality,
        reasoning: false,
        vision: false,
      },
      reasonKey: dest.reasonKey ?? native.reasonKey ?? "ai.reason.nativeModelUnavailable",
    };
  }

  const config = getActiveCloudConfig();
  if (!config) {
    return {
      state: "unavailable",
      reasonKey: "ai.reason.noGenerationRoute",
      setupAvailable: true,
    };
  }
  const dest = classifyCloudDestination({
    provider: config.provider,
    baseUrl: config.baseUrl,
    hasApiKey: config.apiKey.trim().length > 0,
  });
  return {
    state: "available",
    detail: {
      providerClass: dest.providerClass,
      destination: dest.locality,
      reasoning: true,
      vision: false,
    },
    reasonKey: dest.reasonKey,
  };
}

function probeEmbeddings(): CapabilityProbe<EmbeddingProbeDetail> {
  const settings = useSettingsStore.getState().settings;
  const embedding = settings.embedding;
  const provider = embedding?.provider ?? "openai";
  const dest = classifyEmbeddingDestination({
    provider,
    ollamaBaseUrl: embedding?.ollamaBaseUrl,
    hasApiKey: false,
  });

  const lexicalFallback = true;

  if (provider === "ollama") {
    return {
      state: "available",
      detail: {
        providerClass: dest.providerClass,
        destination: dest.locality,
        lexicalFallback,
      },
      reasonKey: dest.reasonKey,
    };
  }

  // Cloud embedding providers are usable only with an explicit paid-embedding
  // opt-in. Without it the feature must disclose lexical retrieval instead of
  // silently billing.
  const requiresConsent = cloudEmbeddingRequiresConsent(provider);
  const consentGranted = paidEmbeddingsEnabled(settings);
  if (requiresConsent && !consentGranted) {
    return {
      state: "unavailable",
      reasonKey: "ai.reason.paidEmbeddingsConsent",
      setupAvailable: true,
      detail: {
        providerClass: dest.providerClass,
        destination: dest.locality,
        lexicalFallback,
      },
    };
  }

  // Cloud embedding providers resolve their key from the LLM provider store
  // (the same source `resolveEmbeddingConfigForRag` uses). A missing key means
  // the route is configured but not usable — report setup, not ready.
  {
    const providers = useLLMProvidersStore.getState().providers;
    const keyPresent = providers.some(
      (candidate) =>
        candidate.provider === provider &&
        candidate.enabled &&
        candidate.apiKey.trim().length > 0
    );
    if (!keyPresent) {
      return {
        state: "unavailable",
        reasonKey: "ai.reason.providerKeyMissing",
        setupAvailable: true,
        detail: {
          providerClass: dest.providerClass,
          destination: dest.locality,
          lexicalFallback,
        },
      };
    }
  }

  return {
    state: "available",
    detail: {
      providerClass: dest.providerClass,
      destination: dest.locality,
      lexicalFallback,
    },
    reasonKey: dest.reasonKey,
  };
}

async function probeOcr(): Promise<CapabilityProbe> {
  let androidOcr = false;
  if (isOnDeviceAiSupportedPlatform()) {
    const snapshot = await withProbeTimeout(getOnDeviceAiCapabilities().catch(() => undefined));
    androidOcr = snapshot?.ocr === true;
  }
  if (androidOcr) return { state: "available" };

  const providers = await withProbeTimeout(getAvailableOCRProviders().catch(() => undefined));
  if (providers && providers.length > 0) return { state: "available" };
  if (providers === undefined) {
    return { state: "unknown", reasonKey: "ai.reason.ocrProbeUnknown", setupAvailable: true };
  }
  return { state: "unavailable", reasonKey: "ai.reason.ocrUnavailable", setupAvailable: true };
}

function probeConsent(generationClass: ProviderClass | undefined) {
  const config = getActiveCloudConfig();
  if (!config) {
    return {
      disclosure: { state: "available" as const },
      billing: { state: "available" as const },
    };
  }
  const dest = classifyCloudDestination({
    provider: config.provider,
    baseUrl: config.baseUrl,
    hasApiKey: config.apiKey.trim().length > 0,
  });
  const providerClass = resolveCloudAiProviderClass(config.provider);
  const disclosed = !dest.requiresDisclosure || isCloudAiDisclosed(providerClass);
  return {
    disclosure: disclosed
      ? { state: "available" as const }
      : { state: "unavailable" as const, reasonKey: "ai.reason.disclosureRequired", setupAvailable: true },
    // Cost consent is a PER-RUN authorization (the existing paid/fallback
    // surface), not a permanent readiness blocker. Paid embeddings have their
    // own persisted opt-in and are represented by the embeddings dependency.
    billing: { state: "available" as const },
    providerClass: generationClass,
  };
}

async function probeIndex(): Promise<IndexProbe> {
  const settings = useSettingsStore.getState().settings;
  // Read-only status call. No config is passed so the backend uses the
  // persisted/user-configured route without minting a new one.
  const response = await withProbeTimeout(getAIIndexStatus().catch(() => undefined));
  if (!response) {
    return {
      state: "unknown",
      detail: { completeness: "unavailable" },
      reasonKey: "ai.reason.indexStatusUnknown",
    };
  }
  // Avoid an unused-variable lint while keeping the settings read explicit:
  // the index probe is configuration-sensitive in future backends.
  void settings;
  return mapIndexStatus(response);
}

export interface BuildContextOptions {
  /** Injected clock for deterministic tests. */
  now?: () => number;
  /** Marks the snapshot as an in-flight probe. */
  checking?: boolean;
}

/**
 * Gather the read-only dependency context. Never inferred from a compiled
 * binary or OS marketing string; every capability is probed independently.
 */
export async function buildFeatureDependencyContext(
  options: BuildContextOptions = {}
): Promise<FeatureDependencyContext> {
  const settings = useSettingsStore.getState().settings;
  const providers = useLLMProvidersStore.getState().providers;
  const revision = computeDependencyRevision(settings, providers);
  const checkedAt = options.now ? options.now() : Date.now();

  const [generation, ocr, index] = await Promise.all([
    probeGeneration(),
    probeOcr(),
    probeIndex(),
  ]);

  const { disclosure, billing } = probeConsent(generation.detail?.providerClass);

  return {
    revision,
    checkedAt,
    checking: options.checking === true,
    flags: (settings.features ?? {}) as Record<string, boolean | undefined>,
    activeRecallMode: String(settings.ai?.activeRecallMode ?? "off"),
    platform: platformInfo(),
    generation,
    embeddings: probeEmbeddings(),
    ocr,
    index,
    relationships: {
      state: "available",
      detail: {
        prerequisites: settings.features?.aiPrerequisites === true,
        links: settings.features?.aiConceptLinks === true,
      },
    },
    passageAdapter: { state: "available" },
    source: { state: "available" },
    disclosure,
    billing,
  };
}

/* ------------------------------------------------------------------------- */
/* Shared revision-keyed cache                                               */
/* ------------------------------------------------------------------------- */

interface CacheEntry {
  revision: string;
  snapshot: FeatureDependencyContext;
}

let cache: CacheEntry | null = null;
let inFlight: { revision: string; promise: Promise<FeatureDependencyContext> } | null = null;
/** The newest revision a consumer has asked for; late older probes never win. */
let latestRequestedRevision: string | null = null;

/**
 * Latest snapshot for the given revision. A caller with a different revision
 * never receives the old snapshot; it starts (or joins) a probe for its own
 * revision.
 */
export async function getFeatureDependencyContext(
  revision: string,
  build: () => Promise<FeatureDependencyContext> = buildFeatureDependencyContext
): Promise<FeatureDependencyContext> {
  latestRequestedRevision = revision;
  if (cache?.revision === revision) return cache.snapshot;
  if (inFlight?.revision === revision) return inFlight.promise;

  const promise = build()
    .then((snapshot) => {
      // Only retain a probe that is still the newest requested revision; a
      // late superseded probe can never overwrite the replacement snapshot.
      if (snapshot.revision === revision && latestRequestedRevision === revision) {
        cache = { revision, snapshot };
      }
      return snapshot;
    })
    .finally(() => {
      if (inFlight?.revision === revision) inFlight = null;
    });

  inFlight = { revision, promise };
  return promise;
}

/** Drop the cached verdict (provider/settings/index changes, tests). */
export function invalidateFeatureReadiness(): void {
  cache = null;
  inFlight = null;
  latestRequestedRevision = null;
}

/** Test-only introspection. */
export function getCachedFeatureReadinessRevision(): string | null {
  return cache?.revision ?? null;
}
