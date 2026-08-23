/**
 * On-device generative AI (Android / Gemini Nano via ML Kit GenAI).
 *
 * Wraps the `plethora-android-genai` Tauri plugin. Every entry point is safe
 * to call on any platform: off Android the status check reports
 * `platform_unsupported` without touching the bridge, and the inference calls
 * reject with a typed error so callers fall back to a cloud provider.
 *
 * Chunking lives here rather than in Kotlin so it is unit-testable without an
 * emulator, and so the same utility can later serve the cloud path.
 */

import { invokeCommand, isNativeMobile, isTauri, listen, nativePlatform, type UnlistenFn } from "../tauri";
import type { GeneratedFlashcard } from "../../api/ai";
import {
  DEFAULT_TOKEN_BUDGET,
  chunkTextByTokens,
  estimateTokens,
  resolveTokenBudget,
} from "./chunkTextByTokens";
import { parseGeneratedFlashcards } from "./parseGenerated";
import {
  deduplicateOnDeviceCards,
  parseDelimitedFlashcardsWithEvidence,
  toGeneratedFlashcards,
  type InternalOnDeviceFlashcard,
} from "./cardValidator";

const PLUGIN = "plugin:plethora-android-genai";

export type OnDeviceAiStatusName = "available" | "downloadable" | "downloading" | "unavailable";

export interface OnDeviceAiStatus {
  status: OnDeviceAiStatusName;
  /** Machine-readable reason, present whenever status is not `available`. */
  reason?: string;
}

export type OnDeviceAiFeature =
  | "all"
  | "prompt"
  | "summarization"
  | "image-prompt"
  | "image-description";

export interface OnDeviceFeatureState {
  status: OnDeviceAiStatusName;
  /** Machine-readable reason, present whenever status is not `available`. */
  reason?: string;
}

/** Independent native feature states and optional Prompt runtime metadata. */
export interface OnDeviceCapabilitySnapshot {
  prompt: OnDeviceFeatureState;
  summarization: OnDeviceFeatureState;
  imagePrompt: OnDeviceFeatureState;
  /**
   * Optional Image Description specialized API. Independent of Prompt
   * (Galaxy S25-class devices may have specialized APIs without Prompt).
   * Omitted by older plugin builds.
   */
  imageDescription?: OnDeviceFeatureState;
  structuredOutputCompiled: boolean;
  structuredOutput: boolean;
  systemInstructions: boolean;
  prefixCaching: boolean;
  imageInput: boolean;
  multiImage: boolean;
  streaming: boolean;
  /** ML Kit Text Recognition (bundled) compiled in (design D18). Optional:
   * older plugin builds never send it. */
  ocr?: boolean;
  /** EmbeddingGemma embeddings usable right now (design D10 / task 4.5):
   * LiteRT feature compiled in AND the downloaded, verified artifacts on
   * disk. Optional: older plugin builds never send it. */
  embeddings?: boolean;
  baseModelName?: string;
  tokenLimit?: number;
  checkedAt: number;
}

/** One OCR text label with a percent-normalized box (design D18). */
export interface OnDeviceOcrLabel {
  id: string;
  text: string;
  confidence?: number;
  /** Percent 0–100 of the source image. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Raw pixel box [left, top, right, bottom] for diagnostics. */
  pixelBox?: number[];
}

/** Result of the on-device OCR labels command. */
export interface OnDeviceOcrLabelsResult {
  labels: OnDeviceOcrLabel[];
  sourceWidth: number;
  sourceHeight: number;
  truncated?: boolean;
}

/** Error codes the bridge and this module can produce. */
export const ON_DEVICE_AI_ERROR_CODES = [
  "platform_unsupported",
  "device_unsupported",
  "model_downloadable",
  "model_downloading",
  "model_unavailable",
  "inference_failed",
  "empty_output",
  "invalid_argument",
  "invalid_image",
  "image_too_large",
  "feature_not_compiled",
  "feature_unavailable",
  "context_too_large",
  "incomplete_output",
  "parse_failed",
  "cancelled",
  "busy",
  "battery_quota_exceeded",
  "background_use_blocked",
  "safety_blocked",
  "queue_full",
  "permission_denied",
] as const;

export type OnDeviceAiErrorCode = (typeof ON_DEVICE_AI_ERROR_CODES)[number];

/** Typed failure so callers can distinguish "can't" from "didn't work". */
export class OnDeviceAiError extends Error {
  readonly code: OnDeviceAiErrorCode;

  constructor(code: OnDeviceAiErrorCode, message: string) {
    super(message);
    this.name = "OnDeviceAiError";
    this.code = code;
  }
}

/** True when the native bridge could exist at all. */
export function isOnDeviceAiSupportedPlatform(): boolean {
  if (!isTauri() || !isNativeMobile()) return false;
  // isNativeMobile() is true on iOS too; the bridge is Android-only.
  const platform = nativePlatform();
  return platform === null ? true : platform === "android";
}

// ──────────────────────────────────────────────────────────────────────────
// Availability
// ──────────────────────────────────────────────────────────────────────────

let cachedStatus: OnDeviceAiStatus | null = null;
let cachedCapabilitySnapshot: OnDeviceCapabilitySnapshot | null = null;
let cachedSnapshotTime = 0;
const CAPABILITY_TTL_MS = 10000;

/** Drop cached status and capabilities. Call after model download or feature error. */
export function resetOnDeviceAiCache(): void {
  cachedStatus = null;
  cachedCapabilitySnapshot = null;
  cachedSnapshotTime = 0;
}

/**
 * Report on-device AI status. Never throws.
 *
 * The result is cached for the session, except `downloading`, which is
 * transient by definition — caching it would strand the UI in "downloading"
 * until the app restarts.
 */
export async function isOnDeviceAiAvailable(): Promise<OnDeviceAiStatus> {
  if (cachedStatus) return cachedStatus;

  if (!isOnDeviceAiSupportedPlatform()) {
    cachedStatus = { status: "unavailable", reason: "platform_unsupported" };
    return cachedStatus;
  }

  let result: OnDeviceAiStatus;
  try {
    result = await invokeCommand<OnDeviceAiStatus>(`${PLUGIN}|ondevice_ai_status`);
  } catch (error) {
    console.warn("[onDeviceAI] status check failed:", error);
    result = { status: "unavailable", reason: "inference_failed" };
  }

  if (result.status !== "downloading") cachedStatus = result;
  return result;
}

/**
 * Return independent Prompt, Summarization, and image-Prompt capabilities.
 * Uses a short TTL cache, bypassing when any feature is downloading.
 */
export async function getOnDeviceAiCapabilities(): Promise<OnDeviceCapabilitySnapshot> {
  const now = Date.now();
  if (
    cachedCapabilitySnapshot &&
    now - cachedSnapshotTime < CAPABILITY_TTL_MS &&
    cachedCapabilitySnapshot.prompt?.status !== "downloading" &&
    cachedCapabilitySnapshot.summarization?.status !== "downloading" &&
    cachedCapabilitySnapshot.imagePrompt?.status !== "downloading" &&
    cachedCapabilitySnapshot.imageDescription?.status !== "downloading"
  ) {
    return cachedCapabilitySnapshot;
  }

  if (!isOnDeviceAiSupportedPlatform()) return unsupportedCapabilitySnapshot();

  try {
    const res = await invokeCommand<OnDeviceCapabilitySnapshot>(
      `${PLUGIN}|ondevice_ai_capabilities`
    );
    if (
      res.prompt?.status !== "downloading" &&
      res.summarization?.status !== "downloading" &&
      res.imagePrompt?.status !== "downloading" &&
      res.imageDescription?.status !== "downloading"
    ) {
      cachedCapabilitySnapshot = res;
      cachedSnapshotTime = now;
    }
    return res;
  } catch (error) {
    console.warn("[onDeviceAI] capability check failed:", error);
    return unavailableCapabilitySnapshot("inference_failed");
  }
}

export type OnDeviceRequirement =
  | "prompt"
  | "summarization"
  | "image-prompt"
  | "image-description";

/** Get the feature status for a specific requirement. */
export async function getOnDeviceRequirementStatus(
  requirement: OnDeviceRequirement = "prompt"
): Promise<OnDeviceFeatureState> {
  const snapshot = await getOnDeviceAiCapabilities();
  switch (requirement) {
    case "summarization":
      return snapshot.summarization;
    case "image-prompt":
      return snapshot.imagePrompt;
    case "image-description":
      return snapshot.imageDescription ?? { status: "unavailable", reason: "feature_not_compiled" };
    case "prompt":
    default:
      return snapshot.prompt;
  }
}

/**
 * Ask AICore to download the model. Only meaningful when status is
 * `downloadable`; resolves once the download finishes and clears the cache so
 * the next status check reflects the new state.
 */
export async function requestModelDownload(
  feature: OnDeviceAiFeature = "all"
): Promise<OnDeviceAiStatus> {
  if (!isOnDeviceAiSupportedPlatform()) {
    throw new OnDeviceAiError("platform_unsupported", "On-device AI is Android-only.");
  }
  try {
    await invokeCommand<void>(`${PLUGIN}|ondevice_ai_download`, {
      request: { feature },
    });
  } catch (error) {
    resetOnDeviceAiCache();
    throw toOnDeviceAiError(error);
  }
  resetOnDeviceAiCache();
  return isOnDeviceAiAvailable();
}

// ──────────────────────────────────────────────────────────────────────────
// On-device OCR (ML Kit Text Recognition, design D18 / task 3.2)
// ──────────────────────────────────────────────────────────────────────────

/** Whether the compiled-in bundled recognizer is available on this device. */
export async function isOnDeviceOcrAvailable(): Promise<boolean> {
  if (!isOnDeviceAiSupportedPlatform()) return false;
  const snapshot = await getOnDeviceAiCapabilities();
  return snapshot.ocr === true;
}

/**
 * Run deterministic on-device OCR over one base64 image and return labels
 * with percent-normalized boxes. Android-only; every other platform throws
 * `platform_unsupported` so callers fall back to the Rust OCR provider chain
 * (`ocr_image_bytes` with its `lines` field).
 */
export async function getOnDeviceOcrLabels(
  base64Image: string,
  maxResults?: number
): Promise<OnDeviceOcrLabelsResult> {
  if (!isOnDeviceAiSupportedPlatform()) {
    throw new OnDeviceAiError(
      "platform_unsupported",
      "On-device OCR is only available in the Android build."
    );
  }
  try {
    return await invokeCommand<OnDeviceOcrLabelsResult>(
      `${PLUGIN}|ondevice_ai_ocr_labels`,
      { request: { base64Image, maxResults } }
    );
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

function unsupportedCapabilitySnapshot(): OnDeviceCapabilitySnapshot {
  return unavailableCapabilitySnapshot("platform_unsupported");
}

function unavailableCapabilitySnapshot(reason: string): OnDeviceCapabilitySnapshot {
  const feature = (): OnDeviceFeatureState => ({ status: "unavailable", reason });
  return {
    prompt: feature(),
    summarization: feature(),
    imagePrompt: feature(),
    imageDescription: feature(),
    structuredOutputCompiled: false,
    structuredOutput: false,
    systemInstructions: false,
    prefixCaching: false,
    imageInput: false,
    multiImage: false,
    streaming: false,
    ocr: false,
    embeddings: false,
    checkedAt: Date.now(),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// On-device embeddings (EmbeddingGemma via LiteRT, design D10 / task 4.5)
// ──────────────────────────────────────────────────────────────────────────

/** State of the on-device embedding model artifacts. */
export type OnDeviceEmbeddingStatusName =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export interface OnDeviceEmbeddingStatus {
  status: OnDeviceEmbeddingStatusName;
  /** Machine-readable reason, present whenever status is not `available`. */
  reason?: string;
  model: string;
  dimension?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  checkedAt: number;
}

/** One progress event while downloading an embedding artifact. */
export interface OnDeviceEmbeddingProgress {
  file: string;
  bytesDownloaded: number;
  /** -1 when the server did not advertise a length. */
  totalBytes: number;
  percent: number;
}

const EMBED_MODEL_ID = "embeddinggemma-300m";

function unsupportedEmbeddingStatus(): OnDeviceEmbeddingStatus {
  return {
    status: "unavailable",
    reason: "platform_unsupported",
    model: EMBED_MODEL_ID,
    checkedAt: Date.now(),
  };
}

/**
 * Report the embedding model state. Never throws: platforms without the
 * bridge report `platform_unsupported`, and a failed bridge call is an
 * `unavailable` status with a reason.
 */
export async function getOnDeviceEmbeddingStatus(): Promise<OnDeviceEmbeddingStatus> {
  if (!isOnDeviceAiSupportedPlatform()) return unsupportedEmbeddingStatus();
  try {
    return await invokeCommand<OnDeviceEmbeddingStatus>(
      `${PLUGIN}|ondevice_ai_embed_status`
    );
  } catch (error) {
    console.warn("[onDeviceAI] embedding status check failed:", error);
    return { ...unsupportedEmbeddingStatus(), reason: "inference_failed" };
  }
}

/**
 * Download and sha256-verify the embedding artifacts (~184 MB). Only ever
 * called from an explicit user action. Progress is streamed through a
 * command channel when available and the `ondevice-genai://embed-download-progress`
 * event otherwise. Resolves with the final status once both artifacts are
 * verified; rejects with a typed error on failure.
 */
export async function downloadOnDeviceEmbeddingModel(
  onProgress?: (progress: OnDeviceEmbeddingProgress) => void
): Promise<OnDeviceEmbeddingStatus> {
  if (!isOnDeviceAiSupportedPlatform()) {
    throw new OnDeviceAiError(
      "platform_unsupported",
      "On-device embeddings are only available in the Android build."
    );
  }

  let channel: unknown;
  if (onProgress && isTauri() && typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    try {
      const { Channel } = await import("@tauri-apps/api/core");
      channel = new Channel<any>((payload: any) => {
        if (payload?.event === "progress") onProgress(payload as OnDeviceEmbeddingProgress);
      });
    } catch (e) {
      console.warn("[onDeviceAI] embed download channel unavailable, using events", e);
    }
  }

  // The listener event mirrors every channel progress notification, so it is
  // the fallback when the Channel class could not be loaded.
  const unlisten = channel
    ? undefined
    : await listen<OnDeviceEmbeddingProgress>(
        "ondevice-genai://embed-download-progress",
        (event) => onProgress?.(event.payload)
      );

  try {
    // `onEvent` is required by the command signature; when the Channel class
    // is unavailable the invoke fails with a typed error (same contract as
    // the streaming prompt path).
    return await invokeCommand<OnDeviceEmbeddingStatus>(
      `${PLUGIN}|ondevice_ai_embed_download`,
      { onEvent: channel }
    );
  } catch (error) {
    throw toOnDeviceAiError(error);
  } finally {
    unlisten?.();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Inference
// ──────────────────────────────────────────────────────────────────────────

export type SummaryFormat = "paragraph" | "bullets";

/**
 * Output routing for the native prompt bridge. `"structured"` requests
 * schema-compiled structured output (Kotlin `@Schema` envelopes); the
 * response then carries the parsed envelope in `structured` and its JSON
 * serialization in `text`. Streaming + structured emits no incremental text
 * events — a single terminal `complete` carries the result.
 */
export type NativePromptOutputMode = "text" | "flashcards" | "tags" | "occlusions" | "structured";

/** Schema-compiled structured-output envelope names (Kotlin contract). */
export const NATIVE_RESPONSE_SCHEMA_NAMES = [
  "learningMaterialProposal",
  "answerAssessment",
  "recallQuestionProposal",
  "occlusionLabelSelection",
  "prerequisiteAnalysis",
  "passageClassification",
  "tutorTurn",
] as const;

export type NativeResponseSchemaName = (typeof NATIVE_RESPONSE_SCHEMA_NAMES)[number];

export interface NativePromptImagePayload {
  mimeType: string;
  data: string;
}

export interface NativePromptRequest {
  requestId: string;
  text: string;
  promptPrefix?: string;
  image?: NativePromptImagePayload;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  outputMode?: NativePromptOutputMode;
  /** Schema envelope name when `outputMode` is `structured`. */
  responseSchema?: NativeResponseSchemaName;
  systemInstruction?: string;
  stream?: boolean;
}

export interface NativePromptCandidate {
  text: string;
  finishReason?: "stop" | "max_tokens" | "other";
}

export interface NativePromptResponse {
  requestId: string;
  /**
   * Generated text. For `outputMode: "structured"` requests this is the JSON
   * serialization of the envelope also returned parsed in `structured`.
   */
  text: string;
  finishReason?: "stop" | "max_tokens" | "other";
  inputTokens: number;
  tokenLimit: number;
  baseModelName?: string;
  candidates: NativePromptCandidate[];
  /**
   * Parsed structured envelope when schema-compiled structured output ran.
   * `null` whenever the build/device lacks the feature — callers then use
   * their strict-JSON fallback (the bridge never errors for this).
   */
  structured?: unknown;
}

export interface NativePromptTokenCount {
  requestId: string;
  inputTokens: number;
  tokenLimit: number;
  requestedOutputTokens: number;
}

export interface OnDeviceRunOptions {
  /** Per-chunk token budget. Clamped to the supported floor. */
  maxTokens?: number;
  /** Cancels between chunks; an in-flight native call always finishes. */
  signal?: AbortSignal;
  /** Called before each chunk with 1-based index and total. */
  onProgress?: (chunk: number, total: number) => void;
}

export interface SummarizeOptions extends OnDeviceRunOptions {
  /**
   * `bullets` uses ML Kit's Summarization API; `paragraph` uses the Prompt API,
   * because SummarizerOptions offers only bullet output types. Defaults to
   * `paragraph`.
   *
   * Note: ML Kit exposes no length parameter, so on-device summaries do not
   * honour an exact word budget the way the cloud path does.
   */
  format?: SummaryFormat;
}

export interface GenerateFlashcardsOptions extends OnDeviceRunOptions {
  /** Maximum cards returned across all chunks. */
  count?: number;
  /** Tags applied to every generated card. */
  tags?: string[];
}

/** Execute one configured, native-measured non-streaming Prompt request. */
export async function generateNativePrompt(
  request: NativePromptRequest
): Promise<NativePromptResponse> {
  try {
    return await invokeCommand<NativePromptResponse>(`${PLUGIN}|ondevice_ai_generate`, {
      request: { ...request, outputMode: request.outputMode ?? "text", stream: false },
    });
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

/** Measure the complete configured request without performing inference. */
export async function countNativePromptTokens(
  request: NativePromptRequest
): Promise<NativePromptTokenCount> {
  try {
    return await invokeCommand<NativePromptTokenCount>(`${PLUGIN}|ondevice_ai_count_tokens`, {
      request: { ...request, outputMode: request.outputMode ?? "text" },
    });
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

export interface NativePromptStartReceipt {
  requestId: string;
  queued: boolean;
}

export interface NativePromptCancelReceipt {
  requestId: string;
  cancelled: boolean;
}

export interface GenerateStreamingOptions {
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onRetry?: (attempt: number, delayMs: number) => void;
}

/** Cancel queued work or active native future for a prompt request. */
export async function cancelNativePromptRequest(
  requestId: string
): Promise<NativePromptCancelReceipt> {
  try {
    return await invokeCommand<NativePromptCancelReceipt>(
      `${PLUGIN}|ondevice_ai_cancel_prompt_request`,
      { request: { requestId } }
    );
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

/**
 * Execute a request-scoped streaming Prompt run.
 * Subscribes to events before starting, filters by request ID, and removes listeners on termination.
 */
export async function generateStreamingPrompt(
  request: NativePromptRequest,
  options: GenerateStreamingOptions = {}
): Promise<NativePromptResponse> {
  if (options.signal?.aborted) {
    throw new OnDeviceAiError("cancelled", "Streaming request was cancelled.");
  }

  const unlistenFns: UnlistenFn[] = [];

  return new Promise<NativePromptResponse>((resolve, reject) => {
    void (async () => {
      let settled = false;
      const timeoutId = setTimeout(async () => {
        if (settled) return;
        console.warn(`[generateStreamingPrompt] Stream timed out for ${request.requestId}, falling back to non-streaming native prompt.`);
        cleanup();
        try {
          const fallbackRes = await generateNativePrompt(request);
          options.onChunk?.(fallbackRes.text);
          resolve(fallbackRes);
        } catch (err) {
          reject(toOnDeviceAiError(err));
        }
      }, 45000);

      const cleanup = () => {
        settled = true;
        clearTimeout(timeoutId);
        while (unlistenFns.length > 0) {
          const fn = unlistenFns.pop();
          try {
            fn?.();
          } catch {
            // ignore
          }
        }
      };

      const handleAbort = async () => {
        if (settled) return;
        try {
          await cancelNativePromptRequest(request.requestId);
        } catch {
          // ignore cancel failure
        }
        cleanup();
        reject(new OnDeviceAiError("cancelled", "Streaming prompt request was cancelled."));
      };

      if (options.signal) {
        options.signal.addEventListener("abort", handleAbort, { once: true });
      }

      let channel: unknown;
      try {
        if (isTauri() && typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
          const { Channel } = await import("@tauri-apps/api/core");
          channel = new Channel<any>((payload: any) => {
            if (settled) return;
            if (payload.event === "text" && typeof payload.text === "string") {
              options.onChunk?.(payload.text);
            } else if (payload.event === "complete" && payload.data) {
              cleanup();
              resolve(payload.data);
            } else if (payload.event === "error") {
              cleanup();
              reject(
                new OnDeviceAiError(
                  (payload.code as OnDeviceAiErrorCode) || "inference_failed",
                  payload.message || "Streaming inference failed"
                )
              );
            } else if (payload.event === "retry") {
              options.onRetry?.(payload.attempt, payload.delayMs);
            }
          });
        }
      } catch (e) {
        console.warn("[generateStreamingPrompt] Failed to initialize channel, falling back to event listeners", e);
      }

      try {
        const unlistenText = await listen<{ requestId: string; text: string }>(
          "ondevice-genai://text",
          (event) => {
            if (!settled && event.payload.requestId === request.requestId) {
              options.onChunk?.(event.payload.text);
            }
          }
        );
        unlistenFns.push(unlistenText);

        const unlistenComplete = await listen<NativePromptResponse>(
          "ondevice-genai://complete",
          (event) => {
            if (!settled && event.payload.requestId === request.requestId) {
              cleanup();
              resolve(event.payload);
            }
          }
        );
        unlistenFns.push(unlistenComplete);

        const unlistenError = await listen<{ requestId: string; code: string; message: string }>(
          "ondevice-genai://error",
          (event) => {
            if (!settled && event.payload.requestId === request.requestId) {
              cleanup();
              reject(
                new OnDeviceAiError(
                  (event.payload.code as OnDeviceAiErrorCode) || "inference_failed",
                  event.payload.message
                )
              );
            }
          }
        );
        unlistenFns.push(unlistenError);

        const unlistenRetry = await listen<{ requestId: string; attempt: number; delayMs: number }>(
          "ondevice-genai://retry",
          (event) => {
            if (!settled && event.payload.requestId === request.requestId) {
              options.onRetry?.(event.payload.attempt, event.payload.delayMs);
            }
          }
        );
        unlistenFns.push(unlistenRetry);

        await invokeCommand<NativePromptStartReceipt>(
          `${PLUGIN}|ondevice_ai_start_prompt_stream`,
          {
            request: { ...request, outputMode: request.outputMode ?? "text", stream: true },
            onEvent: channel,
          }
        );
      } catch (error) {
        cleanup();
        reject(toOnDeviceAiError(error));
      }
    })();
  });
}

/** Measure the complete configured request and check if it fits the context budget. */
export async function budgetNativePromptRequest(
  request: NativePromptRequest,
  reservedOutputTokens = 256,
  runtimeLimit = 4096
): Promise<{ count: NativePromptTokenCount; fits: boolean }> {
  const count = await countNativePromptTokens({
    ...request,
    maxOutputTokens: reservedOutputTokens,
  });
  const limit = count.tokenLimit || runtimeLimit;
  const fits = count.inputTokens + reservedOutputTokens <= limit;
  return { count, fits };
}

/** Explicit foreground warm-up; produces no completion. Checks prompt capability first. */
export async function warmUpOnDevicePrompt(): Promise<void> {
  const caps = await getOnDeviceAiCapabilities();
  if (caps.prompt.status !== "available") {
    throw new OnDeviceAiError(
      (caps.prompt.reason as OnDeviceAiErrorCode) || "model_unavailable",
      "On-device Prompt capability is not available for warm-up."
    );
  }
  try {
    await invokeCommand<void>(`${PLUGIN}|ondevice_ai_warm_up`);
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

/** Rounds of hierarchical reduction before giving up and returning what we have. */
const MAX_REDUCE_ROUNDS = 3;

/**
 * Summarize text entirely on-device.
 *
 * Input over the budget is chunked; each chunk is summarized, and the combined
 * chunk summaries are summarized again until the result fits the budget.
 */
export async function summarize(text: string, options: SummarizeOptions = {}): Promise<string> {
  await assertAvailable();

  const budget = resolveTokenBudget(options.maxTokens ?? DEFAULT_TOKEN_BUDGET);
  const format = options.format ?? "paragraph";

  const trimmed = text.trim();
  if (!trimmed) {
    throw new OnDeviceAiError("invalid_argument", "Cannot summarize empty text.");
  }

  let chunks = chunkTextByTokens(trimmed, budget);
  if (chunks.length === 1) {
    options.onProgress?.(1, 1);
    return summarizeChunk(chunks[0], format);
  }

  let round = 0;
  for (;;) {
    const summaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      throwIfAborted(options.signal);
      options.onProgress?.(i + 1, chunks.length);
      summaries.push(await summarizeChunk(chunks[i], format));
    }

    const combined = summaries.join("\n\n");
    // Fits the window, or there is nothing left to reduce.
    if (estimateTokens(combined) <= budget || summaries.length === 1) {
      throwIfAborted(options.signal);
      // One last pass so the reader gets a summary, not a list of summaries.
      return summaries.length === 1 ? combined : summarizeChunk(combined, format);
    }

    round += 1;
    const next = chunkTextByTokens(combined, budget);
    // Guard against a reduction that does not actually shrink: a model that
    // echoes its input would otherwise loop forever.
    if (round >= MAX_REDUCE_ROUNDS || next.length >= chunks.length) return combined;
    chunks = next;
  }
}

/**
 * Generate flashcards from text entirely on-device.
 *
 * Cards are generated per chunk and concatenated, stopping once `count` cards
 * exist. Throws `parse_failed` when the model produced output but none of it
 * was parsable as a card.
 */
export async function generateFlashcards(
  text: string,
  options: GenerateFlashcardsOptions = {}
): Promise<GeneratedFlashcard[]> {
  await assertAvailable();

  const budget = resolveTokenBudget(options.maxTokens ?? DEFAULT_TOKEN_BUDGET);
  const count = Math.max(1, options.count ?? 5);
  const tags = options.tags ?? [];

  const trimmed = text.trim();
  if (!trimmed) {
    throw new OnDeviceAiError("invalid_argument", "Cannot generate cards from empty text.");
  }

  // Leave room for the instruction block, which shares the context window.
  const instructionTokens = estimateTokens(flashcardPrompt("", count));
  const chunks = chunkTextByTokens(trimmed, Math.max(1, budget - instructionTokens));

  const internalCards: InternalOnDeviceFlashcard[] = [];
  let produced = false;

  for (let i = 0; i < chunks.length && internalCards.length < count; i++) {
    throwIfAborted(options.signal);
    options.onProgress?.(i + 1, chunks.length);

    const remaining = count - internalCards.length;
    const completion = await runPrompt(flashcardPrompt(chunks[i], remaining));
    if (completion.trim()) produced = true;
    const parsed = parseDelimitedFlashcardsWithEvidence(completion, chunks[i], tags, i);
    internalCards.push(...parsed);
  }

  const unique = deduplicateOnDeviceCards(internalCards);
  const cards = toGeneratedFlashcards(unique);

  if (cards.length === 0 && produced) {
    throw new OnDeviceAiError(
      "parse_failed",
      "The on-device model returned no usable question/answer or cloze lines."
    );
  }

  return cards.slice(0, count);
}

// ──────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────

/**
 * Line-oriented prompt. Kept terse: every instruction token competes with the
 * source text for Nano's small context window.
 */
function flashcardPrompt(chunk: string, count: number): string {
  return [
    `Write up to ${count} spaced-repetition flashcards from the text below.`,
    "Use exactly this line format and nothing else:",
    "Q: <question>",
    "A: <answer>",
    "CLOZE: <sentence with {{c1::the hidden part}}>",
    "One fact per card. No preamble, no numbering, no commentary.",
    "",
    chunk,
  ].join("\n");
}

async function assertAvailable(): Promise<void> {
  const status = await isOnDeviceAiAvailable();
  if (status.status === "available") return;
  throw new OnDeviceAiError(
    (status.reason as OnDeviceAiErrorCode) ?? "model_unavailable",
    `On-device AI is ${status.status}.`
  );
}

async function summarizeChunk(text: string, format: SummaryFormat): Promise<string> {
  try {
    return await invokeCommand<string>(`${PLUGIN}|ondevice_ai_summarize`, {
      request: { text, format },
    });
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

async function runPrompt(prompt: string): Promise<string> {
  try {
    return await invokeCommand<string>(`${PLUGIN}|ondevice_ai_prompt`, {
      request: { prompt },
    });
  } catch (error) {
    throw toOnDeviceAiError(error);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OnDeviceAiError("cancelled", "On-device generation was cancelled.");
  }
}

/**
 * Recover the typed code from a rejected bridge call.
 *
 * ponytail: `invokeCommand` coerces Tauri's structured `{ code, message }`
 * rejection into an `Error` whose message is the JSON text, so the code is
 * recovered by scanning for a known code rather than reading a field. Swap for
 * a field read if `invokeCommand` ever stops flattening errors to strings.
 */
export function toOnDeviceAiError(error: unknown): OnDeviceAiError {
  if (error instanceof OnDeviceAiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = ON_DEVICE_AI_ERROR_CODES.find((candidate) => message.includes(candidate));
  return new OnDeviceAiError(code ?? "inference_failed", message);
}
