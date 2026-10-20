import type {
  TranscriptionMode,
  TranscriptionResult,
  SessionTranscriptionPlan,
  SessionTranscriptionAuthorization,
} from "../types";

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

export interface StartSessionJobInput {
  sessionId: string;
  documentId: string;
  assetId?: string;
  audioPath: string;
  transcriptRevision: number;
  plan: SessionTranscriptionPlan;
  authorization?: SessionTranscriptionAuthorization;
  priority?: number;
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
  sessionId?: string;
  transcriptRevision?: number;
}
