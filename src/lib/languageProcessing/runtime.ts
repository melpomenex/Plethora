import {
  contentFingerprint,
  createAnalysisVersion,
  digestText128,
} from "./fingerprints";
import { splitTextIntoChunks } from "./unicode";
import {
  LanguageProcessingError,
  canonicalizeLanguageTag,
} from "./types";
import type {
  AnalysisChunk,
  AnalysisRequest,
  AnalysisRequestOptions,
  AnalysisSummary,
  LanguageAnalysisResult,
  LanguageProcessingAdapter,
  ProcessingJobCheckpoint,
  ProcessingProgress,
} from "./types";
import type { LanguageProcessingAdapterRegistry } from "./registry";
import {
  createDefaultLanguageProcessingRegistry,
} from "./registry";
import {
  createLanguageProcessingStore,
  type LanguageProcessingStore,
  type ProcessingResultRecord,
} from "./persistence";

export interface LanguageProcessingRuntimeOptions extends AnalysisRequestOptions {
  signal?: AbortSignal;
  online?: boolean;
  allowCloud?: boolean;
  hasCredentials?: (adapter: LanguageProcessingAdapter) => boolean;
  onProgress?: (progress: ProcessingProgress) => void;
}

export interface LanguageProcessingRuntimeConfig {
  registry?: LanguageProcessingAdapterRegistry;
  store?: LanguageProcessingStore;
  defaultChunkCodeUnits?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const DEFAULT_CHUNK_CODE_UNITS = 16_384;
const DEFAULT_MAX_RETRIES = 2;

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LanguageProcessingError("cancelled", "Language analysis was cancelled"));
      return;
    }
    const timer = setTimeout(resolve, Math.max(0, milliseconds));
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new LanguageProcessingError("cancelled", "Language analysis was cancelled"));
    }, { once: true });
  });
}

function isAbortLike(error: unknown): boolean {
  return error instanceof LanguageProcessingError && error.code === "cancelled" ||
    error instanceof DOMException && error.name === "AbortError" ||
    error instanceof Error && error.name === "AbortError";
}

function toProcessingError(error: unknown, adapter: LanguageProcessingAdapter): LanguageProcessingError {
  if (error instanceof LanguageProcessingError) return error;
  if (isAbortLike(error)) return new LanguageProcessingError("cancelled", "Language analysis was cancelled", { providerId: adapter.id });
  return new LanguageProcessingError("unknown", error instanceof Error ? error.message : String(error), {
    retryable: false,
    providerId: adapter.id,
  });
}

function jobIdFor(processingKey: string): string {
  return `language_processing_${digestText128(processingKey).slice(0, 24)}`;
}

function expectedVersion(request: AnalysisRequest, adapter: LanguageProcessingAdapter) {
  const languageTag = canonicalizeLanguageTag(String(request.languageTag));
  if (!languageTag) throw new LanguageProcessingError("unsupported-language", `Invalid language tag: ${String(request.languageTag)}`, { providerId: adapter.id });
  return createAnalysisVersion({
    contentFingerprint: request.contentFingerprint ?? contentFingerprint(request.text),
    languageTag,
    adapterId: adapter.id,
    adapterVersion: adapter.version,
    providerKind: adapter.kind,
    configuration: request.configuration,
  });
}

function summarizeChunks(chunks: readonly AnalysisChunk[], capabilities: AnalysisSummary["capabilities"]): AnalysisSummary {
  return {
    sentenceCount: chunks.reduce((count, chunk) => count + chunk.sentences.length, 0),
    tokenCount: chunks.reduce((count, chunk) => count + chunk.tokens.length, 0),
    lexicalTokenCount: chunks.reduce((count, chunk) => count + chunk.summary.lexicalTokenCount, 0),
    characterCount: chunks.reduce((count, chunk) => count + chunk.summary.characterCount, 0),
    capabilities,
  };
}

function assembleResult(text: string, chunks: readonly AnalysisChunk[], record: ProcessingResultRecord): LanguageAnalysisResult {
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  return {
    chunkIndex: 0,
    sourceStart: ordered[0]?.sourceStart ?? 0,
    sourceEnd: ordered.at(-1)?.sourceEnd ?? text.length,
    text,
    sentences: ordered.flatMap((chunk) => chunk.sentences),
    tokens: ordered.flatMap((chunk) => chunk.tokens),
    phraseCandidates: ordered.flatMap((chunk) => chunk.phraseCandidates),
    version: record.version,
    summary: record.summary,
    chunks: ordered,
  };
}

function emitProgress(
  callback: ((progress: ProcessingProgress) => void) | undefined,
  progress: ProcessingProgress,
): void {
  callback?.(progress);
}

/**
 * Background-friendly processor. It owns chunk boundaries, retries, durable
 * checkpoints, and paging; callers can keep only ProcessingProgress in UI
 * state and request token pages on demand.
 */
export class LanguageProcessingRuntime {
  readonly registry: LanguageProcessingAdapterRegistry;
  readonly store: LanguageProcessingStore;
  private readonly defaultChunkCodeUnits: number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(config: LanguageProcessingRuntimeConfig = {}) {
    this.registry = config.registry ?? createDefaultLanguageProcessingRegistry();
    this.store = config.store ?? createLanguageProcessingStore();
    this.defaultChunkCodeUnits = Math.max(1, Math.floor(config.defaultChunkCodeUnits ?? DEFAULT_CHUNK_CODE_UNITS));
    this.sleep = config.sleep ?? defaultSleep;
    this.now = config.now ?? Date.now;
  }

  async process(request: AnalysisRequest, options: LanguageProcessingRuntimeOptions = {}): Promise<LanguageAnalysisResult> {
    const languageTag = canonicalizeLanguageTag(String(request.languageTag));
    if (!languageTag) throw new LanguageProcessingError("unsupported-language", `Invalid language tag: ${String(request.languageTag)}`);
    const canonicalRequest: AnalysisRequest = {
      ...request,
      languageTag,
      contentFingerprint: request.contentFingerprint ?? contentFingerprint(request.text),
    };
    const selection = this.registry.select({
      languageTag,
      requiredCapabilities: request.requestedCapabilities,
      allowCloud: options.allowCloud,
      online: options.online,
    }, {
      online: options.online ?? true,
      allowCloud: options.allowCloud ?? false,
      hasCredentials: options.hasCredentials,
    });
    const adapter = selection.adapter;
    const version = expectedVersion(canonicalRequest, adapter);
    const cached = await this.store.getResult(version.processingKey);
    if (cached) {
      const cachedChunks = await this.store.getChunks(version.processingKey);
      if (cachedChunks.length === cached.chunkCount && cachedChunks.every((chunk) => chunk.version.processingKey === version.processingKey)) {
        return assembleResult(request.text, cachedChunks, cached);
      }
    }

    const chunks = splitTextIntoChunks(request.text, options.chunkCodeUnits ?? adapter.manifest.maxChunkCodeUnits ?? this.defaultChunkCodeUnits, String(languageTag));
    const jobId = options.jobId ?? jobIdFor(version.processingKey);
    let checkpoint = await this.store.getJob(jobId);
    if (!checkpoint || checkpoint.processingKey !== version.processingKey || checkpoint.totalChunks !== chunks.length) {
      checkpoint = {
        jobId,
        processingKey: version.processingKey,
        state: "queued",
        nextChunkIndex: 0,
        totalChunks: chunks.length,
        completedChunks: 0,
        retryCount: 0,
        updatedAt: this.now(),
      };
      await this.store.putJob(checkpoint);
    }

    const existingChunks = await this.store.getChunks(version.processingKey);
    const existingIndexes = new Set(existingChunks.map((chunk) => chunk.chunkIndex));
    let contiguousChunks = 0;
    while (existingIndexes.has(contiguousChunks)) contiguousChunks += 1;
    if (checkpoint.nextChunkIndex !== contiguousChunks) {
      checkpoint = {
        ...checkpoint,
        nextChunkIndex: contiguousChunks,
        completedChunks: contiguousChunks,
        updatedAt: this.now(),
      };
      await this.store.putJob(checkpoint);
    }
    const completed = existingChunks.filter((chunk) => chunk.chunkIndex < checkpoint!.nextChunkIndex);
    checkpoint = { ...checkpoint, state: "running", updatedAt: this.now() };
    await this.store.putJob(checkpoint);
    emitProgress(options.onProgress, this.progress(checkpoint, completed));

    try {
      for (let chunkIndex = checkpoint.nextChunkIndex; chunkIndex < chunks.length; chunkIndex += 1) {
        this.throwIfCancelled(options.signal);
        const sourceChunk = chunks[chunkIndex];
        let attempt = 0;
        let analyzed: AnalysisChunk | null = null;
        while (!analyzed) {
          this.throwIfCancelled(options.signal);
          try {
            analyzed = await adapter.analyze({
              ...canonicalRequest,
              text: sourceChunk.text,
              sourceOffset: (request.sourceOffset ?? 0) + sourceChunk.start,
              contentFingerprint: canonicalRequest.contentFingerprint,
            }, options.signal);
            if (analyzed.version.processingKey !== version.processingKey) {
              throw new LanguageProcessingError("invalid-response", "Adapter returned a mismatched processing version", {
                providerId: adapter.id,
                details: { expected: version.processingKey, received: analyzed.version.processingKey },
              });
            }
            analyzed = { ...analyzed, chunkIndex, sourceStart: (request.sourceOffset ?? 0) + sourceChunk.start, sourceEnd: (request.sourceOffset ?? 0) + sourceChunk.end, text: sourceChunk.text };
          } catch (error) {
            const processingError = toProcessingError(error, adapter);
            if (processingError.code === "cancelled") throw processingError;
            if (!processingError.retryable || attempt >= (options.maxRetries ?? DEFAULT_MAX_RETRIES)) throw processingError;
            attempt += 1;
            checkpoint = {
              ...checkpoint!,
              state: "running",
              retryCount: checkpoint!.retryCount + 1,
              updatedAt: this.now(),
              error: processingError.code,
              message: processingError.message,
            };
            await this.store.putJob(checkpoint);
            await this.sleep((options.retryDelayMs ?? 100) * 2 ** (attempt - 1), options.signal);
          }
        }

        await this.store.putChunk(version.processingKey, analyzed);
        const currentChunks = await this.store.getChunks(version.processingKey);
        checkpoint = {
          ...checkpoint!,
          state: "running",
          nextChunkIndex: chunkIndex + 1,
          completedChunks: chunkIndex + 1,
          error: undefined,
          message: undefined,
          updatedAt: this.now(),
        };
        await this.store.putJob(checkpoint);
        emitProgress(options.onProgress, this.progress(checkpoint, currentChunks));
      }

      const completedChunks = await this.store.getChunks(version.processingKey);
      const summary = summarizeChunks(completedChunks, adapter.manifest.capabilities);
      const result: ProcessingResultRecord = {
        processingKey: version.processingKey,
        version,
        chunkCount: completedChunks.length,
        summary,
        updatedAt: this.now(),
      };
      await this.store.putResult(result);
      checkpoint = {
        ...checkpoint!,
        state: "completed",
        completedChunks: completedChunks.length,
        nextChunkIndex: chunks.length,
        updatedAt: this.now(),
      };
      await this.store.putJob(checkpoint);
      emitProgress(options.onProgress, this.progress(checkpoint, completedChunks));
      return assembleResult(request.text, completedChunks, result);
    } catch (error) {
      const processingError = toProcessingError(error, adapter);
      const state = processingError.code === "cancelled" ? "cancelled" : "failed";
      checkpoint = {
        ...checkpoint!,
        state,
        error: processingError.code,
        message: processingError.message,
        updatedAt: this.now(),
      };
      await this.store.putJob(checkpoint);
      const currentChunks = await this.store.getChunks(version.processingKey);
      emitProgress(options.onProgress, { ...this.progress(checkpoint, currentChunks), error: processingError });
      throw processingError;
    }
  }

  async resume(request: AnalysisRequest, jobId: string, options: Omit<LanguageProcessingRuntimeOptions, "jobId"> = {}): Promise<LanguageAnalysisResult> {
    return this.process(request, { ...options, jobId });
  }

  async checkpoint(jobId: string): Promise<ProcessingJobCheckpoint | null> {
    return this.store.getJob(jobId);
  }

  async pageTokens(processingKey: string, offset = 0, limit = 100): Promise<ReturnType<LanguageProcessingStore["pageTokens"]>> {
    return this.store.pageTokens(processingKey, offset, limit);
  }

  async cleanup(olderThan: number): Promise<number> {
    return this.store.cleanup(olderThan);
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new LanguageProcessingError("cancelled", "Language analysis was cancelled");
  }

  private progress(checkpoint: ProcessingJobCheckpoint, chunks: readonly AnalysisChunk[]): ProcessingProgress {
    const completedTokens = chunks.reduce((count, chunk) => count + chunk.tokens.length, 0);
    return {
      jobId: checkpoint.jobId,
      state: checkpoint.state,
      completedChunks: checkpoint.completedChunks,
      totalChunks: checkpoint.totalChunks,
      completedTokens,
      percent: checkpoint.totalChunks === 0 ? 100 : Math.round((checkpoint.completedChunks / checkpoint.totalChunks) * 100),
      retryCount: checkpoint.retryCount,
      processingKey: checkpoint.processingKey,
      error: checkpoint.error ? new LanguageProcessingError(checkpoint.error, checkpoint.message ?? checkpoint.error) : undefined,
    };
  }
}
