/**
 * Provider abstraction for the AI Learning System (design D1/D2).
 *
 * Two implementations live beside this file:
 *  - `OnDeviceProvider` wraps `../onDeviceAI.ts` (Gemini Nano via the
 *    android-genai Tauri plugin).
 *  - `CloudProvider` wraps `src/api/llm` (+ `src/api/ai`) for explicitly
 *    configured cloud/local-host providers.
 *
 * Capabilities are a METHOD (`getCapabilities()`), not a property, because the
 * spec requires live detection: on-device values come from the TTL-cached
 * native capability snapshot, cloud values from the provider registry — both
 * asynchronous and able to change mid-session (model download, provider
 * configured/removed).
 */

/** Lifecycle of an optional on-device model artifact (Nano, EmbeddingGemma). */
export type AIDownloadState =
  | "downloaded"
  | "downloadable"
  | "downloading"
  | "unavailable"
  /** The concept does not apply (e.g. server-side cloud models). */
  | "not-applicable";

/**
 * Capability contract (design D2), mirrored from the Kotlin
 * `CapabilitySnapshotDto` / Rust `OnDeviceCapabilitySnapshot` where native.
 * Values are detected, never assumed.
 */
export interface AIModelCapabilities {
  /** Basic text generation is possible right now. */
  textGeneration: boolean;
  /** Native schema-enforced structured output (schema-compiler path). */
  structuredGeneration: boolean;
  /** Single image + text input. */
  vision: boolean;
  /** Multiple images in one request. */
  multiImage: boolean;
  /** Provider honours a separate system-instruction/prompt-prefix field. */
  systemInstructions: boolean;
  /** Tool/function calling. False everywhere initially (design D2). */
  toolCalling: boolean;
  /** Provider declares chain-of-thought/reasoning ability. False for Nano. */
  reasoning: boolean;
  /** On-device embedding runtime available. */
  embeddings: boolean;
  /** Context window in tokens (best known value). */
  contextTokens: number;
  /** Streaming generation supported. */
  streaming: boolean;
  /** Prompt-prefix KV caching supported (static prefix reuse). */
  prefixCaching: boolean;
  /** Fully usable without network. */
  offlineAvailable: boolean;
  /** Optional model-artifact download lifecycle. */
  downloadState: AIDownloadState;
}

export interface AIImagePayload {
  mimeType: string;
  /** Base64-encoded image bytes (no data-url prefix). */
  data: string;
}

/** A generation request in provider-neutral shape. */
export interface AIRequest {
  /** Unique per attempt; used for cancellation and event filtering. */
  requestId: string;
  /**
   * Static, cache-friendly instruction prefix (design D4/D9). Providers that
   * support system instructions send it out-of-band so the KV-cached prefix is
   * reusable across invocations of the same task; others fold it into the text.
   */
  systemInstruction?: string;
  /** The user turn: task instructions output plus untrusted-content blocks. */
  text: string;
  image?: AIImagePayload;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask for schema-enforced structured output when the provider supports it. */
  structured?: boolean;
  /** Canonical schema name for providers that compile schemas natively. */
  schemaName?: string;
}

export interface AIUsageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  tokenLimit?: number;
}

export interface AIResponse {
  requestId: string;
  text: string;
  /** Native structured payload when `structured` was requested and supported. */
  structured?: unknown;
  finishReason?: string;
  baseModelName?: string;
  usage?: AIUsageMetadata;
}

export interface AIStreamOptions {
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
  /**
   * Explicitly request a non-streaming execution. Providers that have a
   * distinct non-streaming fast path (the on-device native prompt) use it;
   * streaming-only providers may ignore this hint.
   */
  stream?: boolean;
}

/**
 * A model backend the task layer can route to (design D1).
 *
 * Errors thrown from `generateStream`/`countTokens` should be `AIError`s (see
 * `../errors.ts`) so the task layer can branch on category.
 */
export interface AIProvider {
  readonly id: string;
  readonly kind: "ondevice" | "cloud";
  /** Live capability snapshot. */
  getCapabilities(): Promise<AIModelCapabilities>;
  generateStream(req: AIRequest, opts?: AIStreamOptions): Promise<AIResponse>;
  countTokens?(req: AIRequest): Promise<AIUsageMetadata>;
  warmUp?(): Promise<void>;
  cancel?(requestId: string): Promise<void>;
}

/** Deterministic FNV-1a 32-bit hash, hex-encoded. */
export function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Stable short hash of a capability snapshot for diagnostics (no content). */
export function hashCapabilities(caps: AIModelCapabilities): string {
  const keys = Object.keys(caps).sort() as (keyof AIModelCapabilities)[];
  const serialized = keys
    .map((key) => `${key}=${String(caps[key])}`)
    .join("|");
  return fnv1aHash(serialized);
}
