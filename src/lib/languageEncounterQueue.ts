import { recordLanguageEncounterBatch } from "../api/languageLexicon";
import type { EncounterBatchResult, EncounterInput } from "../types/languageLexicon";

export type EncounterBatchWriter = (inputs: EncounterInput[]) => Promise<EncounterBatchResult>;

export interface LanguageEncounterQueueOptions {
  maxPending?: number;
  batchSize?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  writer?: EncounterBatchWriter;
}
type PendingEncounter = { input: EncounterInput; retries: number };

function encounterKey(input: EncounterInput): string {
  return input.id || [
    input.profileId,
    input.contentFingerprint || "",
    input.documentId || input.mediaId || input.sourceAnchor?.sourceId || "",
    input.sentenceId || "",
    input.tokenId || "",
    input.normalized || input.surface.trim().toLowerCase(),
    input.contextReference || "",
    input.audioStartMs ?? "",
  ].join("\u001f");
}

function mergeEncounter(previous: EncounterInput, next: EncounterInput): EncounterInput {
  return {
    ...previous,
    ...next,
    contextText: previous.contextText || next.contextText,
    wasLookup: Boolean(previous.wasLookup || next.wasLookup),
    wasInteracted: Boolean(previous.wasInteracted || next.wasInteracted),
  };
}

/**
 * Small, UI-independent encounter buffer. It coalesces token exposure by
 * stable source identity, writes bounded batches, retries transient failures,
 * and can be cancelled without touching Queue/review state.
 */
export class LanguageEncounterQueue {
  private readonly pending = new Map<string, PendingEncounter>();
  private readonly maxPending: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly writer: EncounterBatchWriter;
  private flushing: Promise<void> | null = null;
  private cancelled = false;

  constructor(options: LanguageEncounterQueueOptions = {}) {
    this.maxPending = Math.max(1, options.maxPending ?? 256);
    this.batchSize = Math.max(1, options.batchSize ?? 50);
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
    this.writer = options.writer ?? recordLanguageEncounterBatch;
  }

  enqueue(input: EncounterInput): boolean {
    if (this.cancelled || !input.profileId || !input.surface.trim()) return false;
    const key = encounterKey(input);
    const previous = this.pending.get(key);
    if (previous) {
      previous.input = mergeEncounter(previous.input, input);
      return true;
    }
    if (this.pending.size >= this.maxPending) return false;
    this.pending.set(key, { input, retries: 0 });
    return true;
  }

  cancel(inputOrKey?: EncounterInput | string): void {
    if (!inputOrKey) {
      this.pending.clear();
      this.cancelled = true;
      return;
    }
    this.pending.delete(typeof inputOrKey === "string" ? inputOrKey : encounterKey(inputOrKey));
  }

  resume(): void {
    this.cancelled = false;
  }

  size(): number {
    return this.pending.size;
  }

  async flush(signal?: AbortSignal): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushLoop(signal).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushLoop(signal?: AbortSignal): Promise<void> {
    while (!this.cancelled && this.pending.size > 0 && !signal?.aborted) {
      const batch = [...this.pending.entries()].slice(0, this.batchSize);
      const inputs = batch.map(([, pending]) => pending.input);
      try {
        await this.writer(inputs);
        for (const [key] of batch) this.pending.delete(key);
      } catch (error) {
        let exhausted = false;
        for (const [key, pending] of batch) {
          pending.retries += 1;
          if (pending.retries > this.maxRetries) {
            this.pending.delete(key);
            exhausted = true;
          }
        }
        if (!exhausted && this.retryDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs));
        }
        if (exhausted && this.pending.size === 0) {
          // The queue is best effort; dropping exhausted exposure events keeps
          // a failed provider from blocking the reader indefinitely.
          void error;
        }
      }
    }
  }
}
