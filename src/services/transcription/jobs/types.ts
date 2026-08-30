import type { TranscriptionMode, TranscriptionResult } from "../types";

export interface StartTranscriptionJobInput {
  documentId: string;
  filePath?: string;
  file?: File | Blob;
  url?: string;
  documentTitle?: string;
  mode?: TranscriptionMode;
  language?: string;
  chapterId?: string;
  /** Tauri auto-queue provider slug (local, groq, openrouter, …) */
  queueProvider?: string;
  modelId?: string;
  /** Pre-transcribed chunk results merged via reconciliation before persist. */
  chunkResults?: TranscriptionResult[];
}

export interface TranscriptionJobProgressView {
  documentId: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  percent: number;
  processedDurationMs?: number;
  totalDurationMs?: number;
  estimatedCostUsd?: number;
  providerId?: string;
  mode?: TranscriptionMode;
  message?: string;
}
