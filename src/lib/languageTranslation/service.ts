import { contentFingerprint } from "../languageProcessing/fingerprints";
import { TranslationCache } from "./cache";
import { createTranslationCacheKey, translationCacheIdentity, type TranslationCacheKey } from "./cacheKey";
import { cancelledTranslationError, TranslationError, toTranslationError } from "./error";
import { canonicalizeTranslationLanguageTag, type CanonicalTranslationRequest, type TranslationRequest } from "./request";
import { TranslationProviderRegistry, createTranslationProviderRegistry, type TranslationProviderSelection } from "./registry";
import { createAiTranslationProvider } from "./aiTranslate";
import { createAppleTranslationProvider } from "./appleTranslate";
import { createMlKitTranslationProvider } from "./mlkitTranslate";
import { type StoredTranslationResult, type TranslationResult } from "./result";
import {
  DEFAULT_TRANSLATION_SETTINGS,
  resolveTranslationPolicy,
  resolveTranslationSettings,
  type TranslationSettings,
} from "./settings";
import type { TranslationProvider } from "./provider";

export interface TranslationCallOptions {
  signal?: AbortSignal;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface TranslationServiceOptions {
  registry?: TranslationProviderRegistry;
  cache?: TranslationCache;
  settings?: Partial<TranslationSettings>;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface InFlightTranslation {
  key: TranslationCacheKey;
  controller: AbortController;
  promise: Promise<TranslationResult>;
  activeConsumers: number;
  done: boolean;
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledTranslationError());
      return;
    }
    const timer = setTimeout(resolve, Math.max(0, milliseconds));
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(cancelledTranslationError());
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledTranslationError();
}

function storedResult(result: TranslationResult): StoredTranslationResult {
  const { fromCache: _fromCache, ...stored } = result;
  return stored;
}

/**
 * Shared sentence translation service. UI rerenders may call translate again:
 * cache lookup happens before provider work and identical misses share a
 * single provider promise keyed by the complete provider identity.
 */
export class TranslationService {
  readonly registry: TranslationProviderRegistry;
  readonly cache: TranslationCache;
  readonly settings: TranslationSettings;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly inFlight = new Map<TranslationCacheKey, InFlightTranslation>();

  constructor(options: TranslationServiceOptions = {}) {
    this.registry = options.registry ?? new TranslationProviderRegistry();
    this.cache = options.cache ?? new TranslationCache();
    this.settings = resolveTranslationSettings(options.settings);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async translate(request: TranslationRequest, options: TranslationCallOptions = {}): Promise<TranslationResult> {
    const canonical = this.canonicalRequest(request);
    const selection = this.registry.select({
      sourceLanguage: canonical.sourceLanguage,
      targetLanguage: canonical.targetLanguage,
      policy: canonical.providerPolicy,
    });

    // A cached result remains usable offline. Check every deterministic
    // provider candidate, including providers currently blocked by policy.
    for (const candidate of selection.considered) {
      const key = this.keyFor(canonical, candidate.provider);
      const cached = this.cache.get(key);
      if (cached) return { ...cached, fromCache: true };
    }

    if (!selection.provider) throw this.unavailableError(selection, canonical);

    const provider = selection.provider;
    const key = this.keyFor(canonical, provider);
    const existing = this.inFlight.get(key);
    if (existing) return this.joinInFlight(existing, options.signal);

    const controller = new AbortController();
    const record = {} as InFlightTranslation;
    const promise = this.execute(canonical, provider, key, controller.signal, options)
      .then((result) => {
        this.cache.set(storedResult(result));
        return result;
      });
    record.key = key;
    record.controller = controller;
    record.promise = promise;
    record.activeConsumers = 0;
    record.done = false;
    this.inFlight.set(key, record);
    promise.then(
      () => this.finishInFlight(record),
      () => this.finishInFlight(record),
    );
    return this.joinInFlight(record, options.signal);
  }

  getInFlightCount(): number {
    return this.inFlight.size;
  }

  getCacheMetadata() {
    return this.cache.metadata();
  }

  clearCache(): void {
    this.cache.clear();
  }

  private canonicalRequest(request: TranslationRequest): CanonicalTranslationRequest {
    const sourceLanguage = canonicalizeTranslationLanguageTag(request.sourceLanguage);
    const targetLanguage = canonicalizeTranslationLanguageTag(request.targetLanguage);
    if (!sourceLanguage || !targetLanguage) {
      throw new TranslationError("unsupported-language", "Source and target languages must be valid language tags");
    }
    if (!request.profileId.trim() || !request.text.trim()) {
      throw new TranslationError("invalid-request", "A profile id and non-empty sentence are required");
    }
    const sourceFingerprint = request.sourceFingerprint ?? request.contentFingerprint ?? contentFingerprint(request.text);
    return {
      ...request,
      sourceLanguage,
      targetLanguage,
      sourceFingerprint,
      providerPolicy: resolveTranslationPolicy(
        {
          offline: this.settings.offline,
          privacy: this.settings.privacy,
          preferredProviderId: this.settings.preferredProviderId,
        },
        request.providerPolicy,
      ),
    };
  }

  private keyFor(request: CanonicalTranslationRequest, provider: TranslationProvider): TranslationCacheKey {
    return createTranslationCacheKey(
      translationCacheIdentity({
        text: request.text,
        sourceFingerprint: request.sourceFingerprint,
        sourceAnchor: request.sourceAnchor,
        profileId: request.profileId,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        providerId: provider.id,
        providerVersion: provider.version,
        model: provider.capabilities.model,
        configuration: request.configuration,
      }),
    );
  }

  private unavailableError(
    selection: TranslationProviderSelection,
    request: CanonicalTranslationRequest,
  ): TranslationError {
    const reasons = selection.considered.map((candidate) => candidate.reason).filter(Boolean);
    const code = request.providerPolicy.offline
      ? "offline"
      : reasons.includes("privacy-blocked")
        ? "privacy-blocked"
        : reasons.includes("credentials-required")
          ? "credentials-required"
          : "unsupported-provider";
    return new TranslationError(code, "No translation provider is available for this request", {
      retryable: code === "offline",
      details: { reasons },
    });
  }

  private async execute(
    request: CanonicalTranslationRequest,
    provider: TranslationProvider,
    key: TranslationCacheKey,
    signal: AbortSignal,
    options: TranslationCallOptions,
  ): Promise<TranslationResult> {
    const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? this.settings.maxRetries));
    const retryDelayMs = Math.max(0, options.retryDelayMs ?? this.settings.retryDelayMs);
    let attempt = 0;

    while (true) {
      throwIfAborted(signal);
      try {
        const response = await provider.translate(
          {
            text: request.text,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            profileId: request.profileId,
            sourceAnchor: request.sourceAnchor,
            sourceFingerprint: request.sourceFingerprint,
            cacheKey: key,
          },
          { signal },
        );
        throwIfAborted(signal);
        if (!response || typeof response.translatedText !== "string" || !response.translatedText.trim()) {
          throw new TranslationError("invalid-response", "Translation provider returned empty text", {
            providerId: provider.id,
          });
        }
        if (
          response.confidence !== undefined &&
          response.confidence !== null &&
          (!Number.isFinite(response.confidence) || response.confidence < 0 || response.confidence > 1)
        ) {
          throw new TranslationError("invalid-response", "Translation provider returned invalid confidence", {
            providerId: provider.id,
          });
        }

        const generatedAt = this.now();
        return {
          sourceText: request.text,
          translatedText: response.translatedText,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          profileId: request.profileId,
          sourceFingerprint: request.sourceFingerprint!,
          sourceAnchor: request.sourceAnchor,
          providerId: provider.id,
          providerKind: provider.kind,
          providerVersion: provider.version,
          model: provider.capabilities.model,
          confidence: response.confidence,
          cacheKey: key,
          provenance: {
            sourceFingerprint: request.sourceFingerprint!,
            sourceAnchor: request.sourceAnchor,
            profileId: request.profileId,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            providerId: provider.id,
            providerKind: provider.kind,
            providerVersion: provider.version,
            model: provider.capabilities.model,
            cacheKey: key,
            generatedAt,
            confidence: response.confidence,
            privacy: {
              dataLeavesDevice: provider.capabilities.sendsTextOffDevice,
              description: provider.capabilities.privacyDisclosure,
            },
          },
          fromCache: false,
        };
      } catch (error) {
        const normalized = toTranslationError(error, { providerId: provider.id });
        if (normalized.code === "cancelled" || !normalized.retryable || attempt >= maxRetries) throw normalized;
        attempt += 1;
        await this.sleep(retryDelayMs * 2 ** (attempt - 1), signal);
      }
    }
  }

  private joinInFlight(record: InFlightTranslation, signal?: AbortSignal): Promise<TranslationResult> {
    if (signal?.aborted) {
      if (!record.done && record.activeConsumers === 0) record.controller.abort();
      return Promise.reject(cancelledTranslationError());
    }

    record.activeConsumers += 1;
    return new Promise<TranslationResult>((resolve, reject) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        record.activeConsumers = Math.max(0, record.activeConsumers - 1);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        release();
        if (!record.done && record.activeConsumers === 0) record.controller.abort();
        reject(cancelledTranslationError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      record.promise.then(
        (result) => {
          release();
          resolve(result);
        },
        (error) => {
          release();
          reject(error);
        },
      );
    });
  }

  private finishInFlight(record: InFlightTranslation): void {
    record.done = true;
    if (this.inFlight.get(record.key) === record) this.inFlight.delete(record.key);
  }
}

export function createTranslationService(options: TranslationServiceOptions = {}): TranslationService {
  if (options.registry) return new TranslationService(options);
  return new TranslationService({
    ...options,
    registry: createTranslationProviderRegistry([
      createMlKitTranslationProvider(),
      createAppleTranslationProvider(),
      createAiTranslationProvider(),
    ]),
  });
}

export { DEFAULT_TRANSLATION_SETTINGS };
