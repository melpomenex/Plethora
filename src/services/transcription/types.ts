export enum TranscriptionMode {
  Auto = "auto",
  Fast = "fast",
  Enhanced = "enhanced",
  Realtime = "realtime",
  Offline = "offline",
}

export type TranscriptionProviderId =
  | "openrouter:nemotron-3.5"
  | "openrouter:qwen3-asr-0.6b"
  | "openrouter:qwen3-asr-1.7b"
  | "local:nemotron-3.5"
  | "local:whisper"
  | "legacy:groq"
  | "gemini-transcribe"
  | "gemini-live"
  | "deepgram-nova3";

/** User-facing provider category (Settings → Speech-to-Text). */
export type SttProviderCategory = "automatic" | "local" | "openrouter" | "premium";

/** Automatic or a logical model key from `LOGICAL_STT_MODEL_KEYS`. */
export type SttModelSelection = "automatic" | string;

/** Shared logical ASR model families across cloud and local execution. */
export type LogicalSttModelKey =
  | "nemotron-3.5-asr-0.6b"
  | "qwen3-asr-0.6b"
  | "qwen3-asr-1.7b"
  | "whisper-local";

export type TranscriptionErrorCode =
  | "AUTH_FAILED"
  | "AUTH_FAILURE"
  | "RATE_LIMITED"
  | "UNSUPPORTED_LANGUAGE"
  | "UNSUPPORTED_AUDIO"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INSUFFICIENT_BALANCE"
  | "PROVIDER_UNAVAILABLE"
  | "LOCAL_MODEL_MISSING"
  | "CANCELLED"
  | "DISCLOSURE_DECLINED"
  | "INVALID_INPUT"
  | "UNKNOWN";

export type TranscriptionPricingTier = "free" | "inexpensive" | "standard" | "premium";

export interface TranscriptionPricing {
  costPerHour: number;
  currency: string;
  tier: TranscriptionPricingTier;
}

export interface TranscriptionWord {
  word: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
}

export interface TranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  words?: TranscriptionWord[];
  speakerId?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  confidence?: number;
  segments: TranscriptionSegment[];
  durationSeconds?: number;
  durationMs?: number;
  providerId: TranscriptionProviderId | string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface TranscriptionInput {
  file?: File | Blob;
  filePath?: string;
  url?: string;
  documentId?: string;
  durationSeconds?: number;
}

export interface TranscriptionProgress {
  percent: number;
  message?: string;
}

export interface TranscriptionOptions {
  mode?: TranscriptionMode;
  language?: string;
  prompt?: string;
  modelId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: TranscriptionProgress) => void;
  requiredCapabilities?: Partial<TranscriptionCapabilities>;
  allowPremiumFallback?: boolean;
}

/** OpenRouter cloud providers use this request shape at the HTTP boundary. */
export interface TranscriptionRequest {
  audio: File | Blob;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface TranscriptionCapabilities {
  fileTranscription: boolean;
  streaming: boolean;
  pseudoStreaming: boolean;
  segmentTimestamps: boolean;
  wordTimestamps: boolean;
  diarization: boolean;
  languageDetection: boolean;
  customVocabulary: boolean;
  offline: boolean;
  supportedLanguages: string | "auto";
}

export interface TranscriptionModel {
  id: string;
  providerId: TranscriptionProviderId | string;
  displayName: string;
  local: boolean;
  installed?: boolean;
  sizeBytes?: number;
  capabilities: TranscriptionCapabilities;
}

export interface ProviderHealthEntry {
  healthy: boolean;
  failureCount: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
}

export type ProviderHealthState = Partial<Record<TranscriptionProviderId, ProviderHealthEntry>>;

export interface ProviderHealthStatus {
  healthy: boolean;
  message?: string;
  checkedAt: number;
}

export interface TranscriptionRoutingContext {
  mode: TranscriptionMode;
  /** Preferred provider category from settings (overrides mode when set). */
  sttProvider?: SttProviderCategory;
  /** Explicit model selection; `automatic` uses configured defaults. */
  sttModel?: SttModelSelection;
  preferLocal?: boolean;
  automaticFallback?: boolean;
  forceOffline?: boolean;
  allowPremiumFallback?: boolean;
  legacyGroqEnabled?: boolean;
  requiredCapabilities?: Partial<TranscriptionCapabilities>;
  healthState?: ProviderHealthState;
  /** When true, local Nemotron is installed and eligible for routing. */
  localNemotronInstalled?: boolean;
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId | string;
  readonly name?: string;
  readonly label?: string;
  readonly model?: string;
  readonly kind?: "cloud" | "local";
  capabilities(): TranscriptionCapabilities | Promise<TranscriptionCapabilities>;
  transcribe(
    input: TranscriptionInput | TranscriptionRequest,
    options?: TranscriptionOptions | import("../../stores/settingsStore").Settings,
  ): Promise<TranscriptionResult>;
  startStreaming?(
    input: TranscriptionInput,
    options: TranscriptionOptions,
  ): Promise<StreamingTranscriptionSession>;
  cancel?(jobId: string): Promise<void>;
  isConfigured?(settings: import("../../stores/settingsStore").Settings): boolean;
  healthCheck?(): Promise<ProviderHealthStatus>;
}

export type TranscriptionJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface TranscriptionJob {
  id: string;
  status: TranscriptionJobStatus;
  providerId?: TranscriptionProviderId;
  mode?: TranscriptionMode;
  processedDurationMs?: number;
}

export interface Speaker {
  id: string;
  label?: string;
}

export interface PartialTranscript {
  text: string;
  isFinal: boolean;
  startMs?: number;
  endMs?: number;
}

export interface StreamingTranscriptionSession {
  id: string;
  providerId: TranscriptionProviderId;
  pushAudio(chunk: ArrayBuffer): Promise<void>;
  close(): Promise<TranscriptionResult>;
  cancel(): Promise<void>;
  onPartial(callback: (result: PartialTranscript) => void): void;
  onFinal(callback: (result: TranscriptionSegment) => void): void;
  onError(callback: (error: import("./errors").TranscriptionError) => void): void;
}
