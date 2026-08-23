/**
 * Unified AI error taxonomy (design D6 of `add-ondevice-ai-learning-system`).
 *
 * Every AI failure — on-device bridge error, cloud/LLM failure, task-layer
 * validation failure — maps onto one `AIErrorCategory`. Components branch on
 * the category, never on provider-specific messages.
 *
 * `OnDeviceAiError` codes remain the machine-readable origin (`code`); this
 * taxonomy extends them rather than replacing them, so existing callers that
 * inspect `error.code` (including `runAiAction`'s cancelled-never-falls-back
 * rule) keep working.
 */

import {
  ON_DEVICE_AI_ERROR_CODES,
  OnDeviceAiError,
  type OnDeviceAiErrorCode,
} from "./onDeviceAI";

export const AI_ERROR_CATEGORIES = [
  "ModelUnavailable",
  "ModelDownloading",
  "UnsupportedDevice",
  "CapabilityUnavailable",
  "InputTooLarge",
  "GenerationFailed",
  "InvalidStructuredOutput",
  "SafetyBlocked",
  "EmbeddingUnavailable",
  "IndexUnavailable",
  "IndexBuilding",
  "VisionUnavailable",
  "OCRFailed",
  "ProviderOffline",
  "Cancelled",
  "PermissionDenied",
  "FeatureDisabled",
  "UnsupportedLanguage",
  "Busy",
  "QuotaExceeded",
  "BatteryQuotaExceeded",
  "ForegroundRequired",
  "ModelDownloadRequired",
  "ResourceExhausted",
] as const;

export type AIErrorCategory = (typeof AI_ERROR_CATEGORIES)[number];

export const APPLE_REASON_TO_CATEGORY: Readonly<Record<string, AIErrorCategory>> = {
  permission_denied: "PermissionDenied",
  apple_intelligence_disabled: "FeatureDisabled",
  unsupported_os: "UnsupportedDevice",
  device_not_eligible: "UnsupportedDevice",
  deviceNotEligible: "UnsupportedDevice",
  model_not_ready: "ModelDownloading",
  modelNotReady: "ModelDownloading",
  unsupported_language: "UnsupportedLanguage",
  platform_unsupported: "CapabilityUnavailable",
  not_implemented: "CapabilityUnavailable",
  pcc_required: "FeatureDisabled",
  off_device_unavailable: "FeatureDisabled",
  ocr_failed: "GenerationFailed",
  vision_unavailable: "CapabilityUnavailable",
  cancelled: "Cancelled",
  invalid_argument: "InputTooLarge",
  invalid_image: "VisionUnavailable",
  inference_failed: "GenerationFailed",
};

/** Unified AI failure. `code` keeps the machine-readable origin code. */
export class AIError extends Error {
  readonly category: AIErrorCategory;
  /** Origin code: an `OnDeviceAiErrorCode` or the category name itself. */
  readonly code: string;
  readonly providerId?: string;
  readonly taskId?: string;
  /** Structured detail (error codes/paths, never raw user content). */
  readonly details?: string[];

  constructor(
    category: AIErrorCategory,
    message: string,
    options: {
      code?: string;
      providerId?: string;
      taskId?: string;
      details?: string[];
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "AIError";
    this.category = category;
    this.code = options.code ?? category;
    this.providerId = options.providerId;
    this.taskId = options.taskId;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

/** `OnDeviceAiErrorCode` → `AIErrorCategory` (design D6 mapping table). */
export const ON_DEVICE_CODE_TO_CATEGORY: Readonly<
  Record<OnDeviceAiErrorCode, AIErrorCategory>
> = {
  platform_unsupported: "UnsupportedDevice",
  device_unsupported: "UnsupportedDevice",
  // Both "can be downloaded" and "download in progress" surface the
  // actionable download UX (spec: ai-task-architecture, Model download state
  // is actionable).
  model_downloadable: "ModelDownloadRequired",
  model_downloading: "ModelDownloading",
  model_unavailable: "ModelUnavailable",
  inference_failed: "GenerationFailed",
  empty_output: "GenerationFailed",
  invalid_argument: "InputTooLarge",
  invalid_image: "VisionUnavailable",
  image_too_large: "InputTooLarge",
  feature_not_compiled: "CapabilityUnavailable",
  feature_unavailable: "CapabilityUnavailable",
  context_too_large: "InputTooLarge",
  incomplete_output: "GenerationFailed",
  parse_failed: "InvalidStructuredOutput",
  cancelled: "Cancelled",
  busy: "Busy",
  battery_quota_exceeded: "BatteryQuotaExceeded",
  background_use_blocked: "ForegroundRequired",
  safety_blocked: "SafetyBlocked",
  queue_full: "ResourceExhausted",
  permission_denied: "PermissionDenied",
};

/** Map an `OnDeviceAiError` (or any error carrying a known code) to an `AIError`. */
export function aiErrorFromOnDevice(
  error: OnDeviceAiError | unknown,
  context: { providerId?: string; taskId?: string } = {}
): AIError {
  if (error instanceof AIError) return error;

  let code: OnDeviceAiErrorCode | undefined;
  let message: string;
  if (error instanceof OnDeviceAiError) {
    code = error.code;
    message = error.message;
  } else {
    message = error instanceof Error ? error.message : String(error);
    // `toOnDeviceAiError` recovers codes from flattened bridge messages the
    // same way; reuse the same scan so raw bridge rejections map identically.
    code = ON_DEVICE_AI_ERROR_CODES.find((candidate) =>
      message.includes(candidate)
    );
  }

  if (!code) {
    return new AIError("GenerationFailed", message || "On-device generation failed.", {
      code: "inference_failed",
      ...context,
      cause: error,
    });
  }

  return new AIError(ON_DEVICE_CODE_TO_CATEGORY[code], message, {
    code,
    ...context,
    cause: error instanceof OnDeviceAiError ? undefined : error,
  });
}

/**
 * Heuristics for classifying cloud/LLM failures from generic exceptions
 * (cloud APIs surface heterogeneous message strings, not typed codes).
 */
export function aiErrorFromCloud(
  error: unknown,
  context: { providerId?: string; taskId?: string } = {}
): AIError {
  if (error instanceof AIError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (/(^|\W)cancelled|\babort(ed)?\b/.test(lower)) {
    return new AIError("Cancelled", message, { code: "cancelled", ...context, cause: error });
  }
  if (
    lower.includes("safety") ||
    lower.includes("content_policy") ||
    lower.includes("content policy") ||
    lower.includes("content filter") ||
    lower.includes("blocked") && lower.includes("content")
  ) {
    return new AIError("SafetyBlocked", message, { code: "safety_blocked", ...context, cause: error });
  }
  if (
    lower.includes("context length") ||
    lower.includes("context_length") ||
    lower.includes("too long") ||
    lower.includes("too many tokens") ||
    lower.includes("maximum context")
  ) {
    return new AIError("InputTooLarge", message, { code: "context_too_large", ...context, cause: error });
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("offline") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("unreachable") ||
    /\b401\b|\b403\b/.test(lower) ||
    lower.includes("unauthorized") ||
    lower.includes("api key") ||
    lower.includes("api_key")
  ) {
    return new AIError("ProviderOffline", message, { code: "provider_offline", ...context, cause: error });
  }
  return new AIError("GenerationFailed", message, { code: "generation_failed", ...context, cause: error });
}

/** Map any thrown value onto the taxonomy (identity for `AIError`). */
export function toAIError(
  error: unknown,
  context: { providerId?: string; taskId?: string } = {}
): AIError {
  if (error instanceof AIError) {
    if (context.providerId && !error.providerId) {
      return new AIError(error.category, error.message, {
        code: error.code,
        providerId: context.providerId,
        taskId: context.taskId ?? error.taskId,
        details: error.details,
        cause: error,
      });
    }
    return error;
  }
  if (error instanceof OnDeviceAiError) {
    return aiErrorFromOnDevice(error, context);
  }
  const message = error instanceof Error ? error.message : String(error);
  // A message carrying a known on-device code maps through the bridge table
  // (flattened bridge rejections); anything else is a cloud/generic failure.
  const hasBridgeCode = ON_DEVICE_AI_ERROR_CODES.some((c) => message.includes(c));
  if (hasBridgeCode) return aiErrorFromOnDevice(error, context);
  const appleReason = Object.keys(APPLE_REASON_TO_CATEGORY).find((c) => message.includes(c));
  if (appleReason) {
    return new AIError(APPLE_REASON_TO_CATEGORY[appleReason], message, {
      code: appleReason,
      ...context,
      cause: error,
    });
  }
  return aiErrorFromCloud(error, context);
}

/**
 * True for any cancellation signal — `AIError(Cancelled)`,
 * `OnDeviceAiError(cancelled)`, or a DOM `AbortError`.
 *
 * The task layer and `runAiAction` use this to guarantee that a user
 * cancellation NEVER triggers cloud fallback.
 */
export function isCancelledError(error: unknown): boolean {
  if (error instanceof AIError) return error.category === "Cancelled";
  if (error instanceof OnDeviceAiError) return error.code === "cancelled";
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    return error.name === "AbortError" || /\bcancelled\b|\bcanceled\b/i.test(error.message);
  }
  return false;
}
