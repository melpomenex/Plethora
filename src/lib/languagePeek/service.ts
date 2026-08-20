import { lookupDictionaryEntry } from "../../utils/dictionaryLookup";
import { dictionaryQueryForText } from "../../components/viewer/selectionInteraction/intent";
import type {
  LanguagePeekLookupResult,
  LanguagePeekProvider,
  LanguagePeekTargetContext,
  LanguagePeekProviderResult,
} from "./contracts";
import { createLanguagePeekCacheKey } from "./contracts";

const MAX_CACHE_ENTRIES = 128;

function abortResult(): LanguagePeekLookupResult {
  return { ok: false, failure: { kind: "cancelled" } };
}

/** Local provider used by Dictionary Peek when no dedicated language provider is configured. */
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
      provenance: "local",
    };
    return { ok: true, result };
  },
};

export interface LanguagePeekServiceOptions {
  providers?: LanguagePeekProvider[];
  maxCacheEntries?: number;
}

/**
 * Profile-aware composition service. It owns cache identity and in-flight
 * dedupe so React re-renders never become extra provider requests.
 */
export class LanguagePeekService {
  private readonly providers: LanguagePeekProvider[];
  private readonly maxCacheEntries: number;
  private readonly cache = new Map<string, LanguagePeekLookupResult>();
  private readonly inFlight = new Map<string, Promise<LanguagePeekLookupResult>>();

  constructor(options: LanguagePeekServiceOptions = {}) {
    this.providers = options.providers?.length ? options.providers : [localDictionaryProvider];
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? MAX_CACHE_ENTRIES);
  }

  async lookup(text: string, context: LanguagePeekTargetContext = {}, signal?: AbortSignal): Promise<LanguagePeekLookupResult> {
    const query = dictionaryQueryForText(text) || text.trim();
    if (!query) return { ok: false, failure: { kind: "not-found" } };
    const provider = this.providers.find((candidate) => candidate.supports(context.languageTag));
    if (!provider) return { ok: false, failure: { kind: "unsupported-language" } };
    const key = createLanguagePeekCacheKey({
      text: query,
      profileId: context.profileId,
      languageTag: context.languageTag,
      analysisKey: context.analysis?.processingKey,
      phraseId: context.phrase?.phraseId,
      providerId: provider.id,
      providerVersion: provider.version,
    });
    const cached = this.cache.get(key);
    if (cached) return cached;
    const active = this.inFlight.get(key);
    if (active) return this.withAbort(active, signal);
    const pending = provider.lookup({ text: query, languageTag: context.languageTag, context, signal });
    this.inFlight.set(key, pending);
    const settled = pending.then((result) => {
      if (result.ok) {
        this.cache.set(key, result);
        while (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, settled);
    return this.withAbort(settled, signal);
  }

  clear(): void {
    this.cache.clear();
  }

  private withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.resolve(abortResult() as T);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => resolve(abortResult() as T);
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
        (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
      );
    });
  }
}

export const languagePeekService = new LanguagePeekService();
