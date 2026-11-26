import { lookupDictionaryEntry } from "../../utils/dictionaryLookup";
import { dictionaryQueryForText } from "../../components/viewer/selectionInteraction/intent";
import type {
  LanguagePeekFailure,
  LanguagePeekLookupResult,
  LanguagePeekProvider,
  LanguagePeekProviderResult,
  LanguagePeekTargetContext,
} from "./contracts";
import { createLanguagePeekCacheKey, isLanguagePeekFailure } from "./contracts";

const MAX_CACHE_ENTRIES = 128;

function abortResult(): LanguagePeekLookupResult {
  return { ok: false, failure: { kind: "cancelled" } };
}

function pickAggregateFailure(failures: LanguagePeekFailure[]): LanguagePeekFailure {
  if (failures.length === 0) return { kind: "unsupported-language" };
  if (failures.length === 1) return failures[0]!;
  const offline = failures.find((failure) => failure.kind === "offline-uncached");
  if (offline) return offline;
  const notFound = failures.find((failure) => failure.kind === "not-found");
  if (notFound) return notFound;
  const unavailable = failures.find((failure) => failure.kind === "unavailable");
  if (unavailable) return unavailable;
  return failures[failures.length - 1]!;
}

/**
 * Default English online dictionary provider (dictionaryapi.dev) retained for
 * compatibility; provenance is `"dedicated"` since requests hit the network.
 */
export const localDictionaryProvider: LanguagePeekProvider = {
  id: "dictionaryapi.dev",
  version: "v2",
  supports: (languageTag) => !languageTag || languageTag.toLowerCase().startsWith("en"),
  async lookup({ text, languageTag, signal, context }) {
    if (signal?.aborted) return abortResult();
    if (!localDictionaryProvider.supports(languageTag)) {
      return { ok: false, failure: { kind: "unsupported-language" } };
    }
    const dictionary = await lookupDictionaryEntry(text);
    if (signal?.aborted) return abortResult();
    if (dictionary.ok === false) return { ok: false, failure: dictionary.failure };
    const result: LanguagePeekProviderResult = {
      providerId: localDictionaryProvider.id,
      providerVersion: localDictionaryProvider.version,
      dictionary: dictionary.entry,
      analysis: context?.analysis,
      provenance: "dedicated",
    };
    return { ok: true, result };
  },
};

export interface LanguagePeekServiceOptions {
  providers?: LanguagePeekProvider[];
  maxCacheEntries?: number;
}

export interface RegisterProviderOptions {
  prepend?: boolean;
}

interface InFlightEntry {
  promise: Promise<LanguagePeekLookupResult>;
  controller: AbortController;
  waiters: number;
}

/**
 * Profile-aware composition service. It owns provider priority ordering,
 * fallback across matching providers, cache identity, and in-flight dedupe so
 * React re-renders never become extra provider requests.
 */
export class LanguagePeekService {
  private providers: LanguagePeekProvider[];
  private readonly maxCacheEntries: number;
  private readonly cache = new Map<string, LanguagePeekLookupResult>();
  private readonly inFlight = new Map<string, InFlightEntry>();

  constructor(options: LanguagePeekServiceOptions = {}) {
    this.providers = options.providers !== undefined
      ? [...options.providers]
      : [localDictionaryProvider];
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? MAX_CACHE_ENTRIES);
  }

  registerProvider(provider: LanguagePeekProvider, options: RegisterProviderOptions = {}): void {
    this.providers = this.providers.filter((existing) => existing.id !== provider.id);
    if (options.prepend) {
      this.providers.unshift(provider);
    } else {
      this.providers.push(provider);
    }
    this.clear();
  }

  unregisterProvider(id: string): boolean {
    const before = this.providers.length;
    this.providers = this.providers.filter((existing) => existing.id !== id);
    if (this.providers.length !== before) {
      this.clear();
      return true;
    }
    return false;
  }

  getProviders(): readonly LanguagePeekProvider[] {
    return [...this.providers];
  }

  async lookup(
    text: string,
    context: LanguagePeekTargetContext & { allowAiFallback?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<LanguagePeekLookupResult> {
    if (signal?.aborted) return abortResult();
    const query = dictionaryQueryForText(text) || text.trim();
    if (!query) return { ok: false, failure: { kind: "not-found" } };

    const matching = this.providers.filter((candidate) => candidate.supports(context.languageTag));
    if (matching.length === 0) return { ok: false, failure: { kind: "unsupported-language" } };

    const key = createLanguagePeekCacheKey({
      text: query,
      profileId: context.profileId,
      languageTag: context.languageTag,
      analysisKey: context.analysis?.processingKey,
      phraseId: context.phrase?.phraseId,
      providerId: matching.map((provider) => provider.id).join(","),
      providerVersion: matching.map((provider) => provider.version ?? "").join(","),
    });

    const cached = this.cache.get(key);
    if (
      cached &&
      !(cached.ok && cached.result.provenance === "ai" && context.allowAiFallback === false)
    ) {
      return cached;
    }

    const active = this.inFlight.get(key);
    if (active) return this.subscribe(active, signal);

    const controller = new AbortController();
    const execution = this.runFallbackChain(matching, query, context, controller.signal)
      .then((result) => {
        if (result.ok) {
          this.cache.set(key, result);
          while (this.cache.size > this.maxCacheEntries) {
            this.cache.delete(this.cache.keys().next().value!);
          }
        }
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    const entry: InFlightEntry = { promise: execution, controller, waiters: 0 };
    this.inFlight.set(key, entry);
    return this.subscribe(entry, signal);
  }

  clear(): void {
    this.cache.clear();
  }

  private async runFallbackChain(
    matching: LanguagePeekProvider[],
    query: string,
    context: LanguagePeekTargetContext & { allowAiFallback?: boolean },
    signal: AbortSignal,
  ): Promise<LanguagePeekLookupResult> {
    const failures: LanguagePeekFailure[] = [];

    for (const provider of matching) {
      if (signal.aborted) return abortResult();
      let result: LanguagePeekLookupResult;
      try {
        result = await provider.lookup({
          text: query,
          languageTag: context.languageTag,
          context,
          signal,
        });
      } catch (error) {
        result = {
          ok: false,
          failure: {
            kind: "unavailable",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
      if (result.ok === true) return result;
      if (isLanguagePeekFailure(result)) {
        if (result.failure.kind === "cancelled" && signal.aborted) {
          return abortResult();
        }
        failures.push(result.failure);
      }
    }

    return { ok: false, failure: pickAggregateFailure(failures) };
  }

  private subscribe(entry: InFlightEntry, signal?: AbortSignal): Promise<LanguagePeekLookupResult> {
    if (signal?.aborted) return Promise.resolve(abortResult());
    entry.waiters += 1;
    return new Promise<LanguagePeekLookupResult>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        entry.waiters = Math.max(0, entry.waiters - 1);
        if (entry.waiters === 0) entry.controller.abort();
        resolve(abortResult());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          entry.waiters = Math.max(0, entry.waiters - 1);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          entry.waiters = Math.max(0, entry.waiters - 1);
          reject(error);
        },
      );
    });
  }
}

export const languagePeekService = new LanguagePeekService();
