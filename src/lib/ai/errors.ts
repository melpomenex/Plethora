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
import { t } from "../i18n";

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

export const WINDOWS_REASON_TO_CATEGORY: Readonly<Record<string, AIErrorCategory>> = {
  permission_denied: "PermissionDenied",
  limited_access_denied: "PermissionDenied",
  package_identity_missing: "CapabilityUnavailable",
  platform_unsupported: "UnsupportedDevice",
  unsupported_os: "UnsupportedDevice",
  device_not_eligible: "UnsupportedDevice",
  model_not_ready: "ModelDownloading",
  model_downloadable: "ModelDownloadRequired",
  model_downloading: "ModelDownloading",
  unsupported_language: "UnsupportedLanguage",
  unsupported_schema: "CapabilityUnavailable",
  not_implemented: "CapabilityUnavailable",
  feature_disabled: "FeatureDisabled",
  ocr_failed: "GenerationFailed",
  vision_unavailable: "CapabilityUnavailable",
  cancelled: "Cancelled",
  safety_blocked: "SafetyBlocked",
  context_too_large: "InputTooLarge",
  invalid_argument: "InputTooLarge",
  invalid_image: "VisionUnavailable",
  inference_failed: "GenerationFailed",
  busy: "Busy",
  winrt_bindings_pending: "CapabilityUnavailable",
};

export const FOUNDRY_REASON_TO_CATEGORY: Readonly<Record<string, AIErrorCategory>> = {
  runtime_unavailable: "ProviderOffline",
  model_unavailable: "ModelUnavailable",
  model_downloadable: "ModelDownloadRequired",
  model_not_cached: "ModelDownloadRequired",
  model_not_loaded: "ModelUnavailable",
  no_models_cached: "ModelDownloadRequired",
  connection_failed: "ProviderOffline",
  timeout: "ProviderOffline",
  cancelled: "Cancelled",
  feature_disabled: "FeatureDisabled",
  inference_failed: "GenerationFailed",
};

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
  unsupported_schema: "CapabilityUnavailable",
  not_implemented: "CapabilityUnavailable",
  pcc_required: "FeatureDisabled",
  off_device_unavailable: "FeatureDisabled",
  ocr_failed: "GenerationFailed",
  vision_unavailable: "CapabilityUnavailable",
  cancelled: "Cancelled",
  safety_blocked: "SafetyBlocked",
  context_too_large: "InputTooLarge",
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

const DEFAULT_SAFETY_BLOCKED_MESSAGE =
  "Apple Intelligence blocked this text on-device. It may be a false positive on literary, medical, or historical content.";

/** True when a provider message indicates on-device safety guardrails fired. */
export function isSafetyBlockedMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("safety_blocked") ||
    lower.includes("likely to be unsafe") ||
    lower.includes("content likely to be unsafe") ||
    (lower.includes("unsafe") && lower.includes("content")) ||
    (lower.includes("blocked") && lower.includes("content")) ||
    lower.includes("content policy") ||
    lower.includes("content filter") ||
    (lower.includes("refusal") && lower.includes("guardrail"))
  );
}

/** Parse `{ code, message }` from flattened Tauri plugin rejections. */
export function parseTauriPluginErrorPayload(
  error: unknown
): { code?: string; message?: string } | null {
  const raw = error instanceof Error ? error.message : String(error);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { code?: unknown; message?: unknown };
    return {
      code: typeof parsed.code === "string" ? parsed.code : undefined,
      message: typeof parsed.message === "string" ? parsed.message : undefined,
    };
  } catch {
    return null;
  }
}

function safetyBlockedError(
  message: string,
  context: { providerId?: string; taskId?: string },
  cause?: unknown
): AIError {
  return new AIError("SafetyBlocked", message || DEFAULT_SAFETY_BLOCKED_MESSAGE, {
    code: "safety_blocked",
    ...context,
    cause,
  });
}

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
    if (isSafetyBlockedMessage(message)) {
      return safetyBlockedError(DEFAULT_SAFETY_BLOCKED_MESSAGE, context, error);
    }
    return new AIError("GenerationFailed", message || "On-device generation failed.", {
      code: "inference_failed",
      ...context,
      cause: error,
    });
  }

  if (code === "inference_failed" && isSafetyBlockedMessage(message)) {
    return safetyBlockedError(DEFAULT_SAFETY_BLOCKED_MESSAGE, context, error);
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
  if (isSafetyBlockedMessage(message)) {
    return safetyBlockedError(DEFAULT_SAFETY_BLOCKED_MESSAGE, context, error);
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
  const pluginPayload = parseTauriPluginErrorPayload(error);
  if (pluginPayload?.code === "safety_blocked" || isSafetyBlockedMessage(pluginPayload?.message ?? message)) {
    return safetyBlockedError(DEFAULT_SAFETY_BLOCKED_MESSAGE, context, error);
  }
  // A message carrying a known on-device code maps through the bridge table
  // (flattened bridge rejections); anything else is a cloud/generic failure.
  const hasBridgeCode = ON_DEVICE_AI_ERROR_CODES.some((c) => message.includes(c));
  if (hasBridgeCode) return aiErrorFromOnDevice(error, context);
  const windowsReason = Object.keys(WINDOWS_REASON_TO_CATEGORY).find((c) => message.includes(c));
  if (windowsReason) {
    return new AIError(WINDOWS_REASON_TO_CATEGORY[windowsReason], message, {
      code: windowsReason,
      ...context,
      cause: error,
    });
  }
  const foundryReason = Object.keys(FOUNDRY_REASON_TO_CATEGORY).find((c) => message.includes(c));
  if (foundryReason) {
    return new AIError(FOUNDRY_REASON_TO_CATEGORY[foundryReason], message, {
      code: foundryReason,
      ...context,
      cause: error,
    });
  }
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
/** User-facing copy for any mapped AI failure. */
export function formatAIErrorMessage(error: unknown): string {
  const mapped = toAIError(error);
  if (mapped.category === "SafetyBlocked") {
    return t("aiErrors.safetyBlocked");
  }
  return mapped.message || t("aiErrors.generationFailed");
}

export function isCancelledError(error: unknown): boolean {
  if (error instanceof AIError) return error.category === "Cancelled";
  if (error instanceof OnDeviceAiError) return error.code === "cancelled";
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    return error.name === "AbortError" || /\bcancelled\b|\bcanceled\b/i.test(error.message);
  }
  return false;
}
