import type { TranscriptionProviderId } from "./types";

export interface TranscriptionUsageRecord {
  providerId: TranscriptionProviderId;
  durationSeconds: number;
  estimatedCostUsd: number;
  timestamp: string;
  documentId?: string;
  model?: string;
}

/**
 * Phase 1 stub — records usage locally for future sync to server accounting.
 * No-op until Phase 2 wiring lands.
 */
export function recordUsage(record: TranscriptionUsageRecord): void {
  if (import.meta.env.DEV) {
    console.debug("[transcription] usage", record);
  }
}
