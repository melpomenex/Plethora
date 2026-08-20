import {
  aggregateCoverageChunks,
  calculateCoverageChunk,
  createCoverageVersion,
} from "./calculator";
import type {
  CoverageChunkResult,
  CoverageDocumentInput,
  CoverageJobCheckpoint,
  CoverageJobRequest,
  CoverageJobResult,
  CoverageProgress,
} from "./types";

function jobIdFor(coverageKey: string): string {
  return `language_coverage_${coverageKey.slice(-24)}`;
}

function nowValue(now?: () => number): number {
  return now?.() ?? Date.now();
}

function progressFromCheckpoint(checkpoint: CoverageJobCheckpoint): CoverageProgress {
  return {
    jobId: checkpoint.request.jobId,
    state: checkpoint.state,
    completedChunks: checkpoint.completedChunks,
    totalChunks: checkpoint.request.totalChunks,
    completedUnits: checkpoint.completedUnits,
    percent: checkpoint.request.totalChunks === 0
      ? 100
      : Math.round((checkpoint.completedChunks / checkpoint.request.totalChunks) * 100),
    retryCount: checkpoint.retryCount,
    coverageKey: checkpoint.request.coverageKey,
    error: checkpoint.error,
  };
}

export function createCoverageJobRequest(
  input: CoverageDocumentInput,
  options: { jobId?: string; maxRetries?: number } = {},
): CoverageJobRequest {
  const coverageKey = createCoverageVersion(input).coverageKey;
  return {
    jobId: options.jobId ?? jobIdFor(coverageKey),
    documentId: input.documentId,
    profileId: input.profileId,
    coverageKey,
    totalChunks: input.chunks.length,
    maxRetries: Math.max(0, Math.floor(options.maxRetries ?? 2)),
  };
}

export interface CoverageJobOptions {
  jobId?: string;
  maxRetries?: number;
  signal?: AbortSignal;
  now?: () => number;
  yieldControl?: () => Promise<void>;
  isCurrent?: (coverageKey: string) => boolean;
  onProgress?: (progress: CoverageProgress) => void;
  /** Injectable for persistence/provider adapters; defaults to the pure calculator. */
  calculateChunk?: (chunk: CoverageDocumentInput["chunks"][number], input: CoverageDocumentInput) => CoverageChunkResult | Promise<CoverageChunkResult>;
}

export class CoverageJobGate {
  private cancelled = false;

  constructor(readonly coverageKey: string) {}

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  canCommit(resultCoverageKey: string, isCurrent?: (coverageKey: string) => boolean): boolean {
    return !this.cancelled && resultCoverageKey === this.coverageKey && (isCurrent?.(resultCoverageKey) ?? true);
  }
}

function cancelledResult(request: CoverageJobRequest, checkpoint: CoverageJobCheckpoint): CoverageJobResult {
  return {
    jobId: request.jobId,
    state: "cancelled",
    coverageKey: request.coverageKey,
    processedChunks: checkpoint.completedChunks,
  };
}

/**
 * Cooperative chunk runner. It never converts pending/cancelled/stale work
 * into a zero-valued summary, and it only exposes a completed result when the
 * caller's current-version predicate still accepts the coverage key.
 */
export async function runCoverageJob(
  input: CoverageDocumentInput,
  options: CoverageJobOptions = {},
): Promise<CoverageJobResult> {
  const request = createCoverageJobRequest(input, options);
  const gate = new CoverageJobGate(request.coverageKey);
  const checkpoint: CoverageJobCheckpoint = {
    request,
    state: "queued",
    nextChunkIndex: 0,
    completedChunks: 0,
    completedUnits: 0,
    retryCount: 0,
    updatedAt: nowValue(options.now),
  };
  const emit = () => options.onProgress?.(progressFromCheckpoint(checkpoint));
  const yieldControl = options.yieldControl ?? (() => Promise.resolve());
  emit();

  const aborted = () => Boolean(options.signal?.aborted) || gate.isCancelled;
  const chunks: CoverageChunkResult[] = [];
  checkpoint.state = "running";
  checkpoint.updatedAt = nowValue(options.now);
  emit();

  try {
    for (const chunk of [...input.chunks].sort((left, right) => left.chunkIndex - right.chunkIndex || left.chunkId.localeCompare(right.chunkId))) {
      if (aborted()) {
        checkpoint.state = "cancelled";
        checkpoint.updatedAt = nowValue(options.now);
        emit();
        return cancelledResult(request, checkpoint);
      }
      let attempt = 0;
      let result: CoverageChunkResult | undefined;
      while (!result) {
        try {
          result = await (options.calculateChunk?.(chunk, input) ?? calculateCoverageChunk(chunk, input.policy));
        } catch (error) {
          if (attempt >= request.maxRetries) throw error;
          attempt += 1;
          checkpoint.retryCount += 1;
          checkpoint.updatedAt = nowValue(options.now);
          emit();
        }
      }
      chunks.push(result);
      checkpoint.nextChunkIndex += 1;
      checkpoint.completedChunks += 1;
      checkpoint.completedUnits += result.units.length;
      checkpoint.updatedAt = nowValue(options.now);
      emit();
      await yieldControl();
    }
  } catch (error) {
    checkpoint.state = "failed";
    checkpoint.error = error instanceof Error ? error.message : String(error);
    checkpoint.updatedAt = nowValue(options.now);
    emit();
    return {
      jobId: request.jobId,
      state: "failed",
      coverageKey: request.coverageKey,
      processedChunks: checkpoint.completedChunks,
      error: checkpoint.error,
    };
  }

  if (aborted()) {
    checkpoint.state = "cancelled";
    checkpoint.updatedAt = nowValue(options.now);
    emit();
    return cancelledResult(request, checkpoint);
  }

  const calculation = aggregateCoverageChunks(input, chunks, nowValue(options.now));
  if (!gate.canCommit(calculation.version.coverageKey, options.isCurrent)) {
    checkpoint.state = "stale";
    checkpoint.updatedAt = nowValue(options.now);
    emit();
    return {
      jobId: request.jobId,
      state: "stale",
      coverageKey: request.coverageKey,
      processedChunks: checkpoint.completedChunks,
    };
  }
  checkpoint.state = "completed";
  checkpoint.updatedAt = nowValue(options.now);
  emit();
  return {
    jobId: request.jobId,
    state: "completed",
    coverageKey: request.coverageKey,
    processedChunks: checkpoint.completedChunks,
    result: calculation,
  };
}
