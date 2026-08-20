export type TranslationErrorCode =
  | "invalid-request"
  | "unsupported-language"
  | "unsupported-provider"
  | "offline"
  | "privacy-blocked"
  | "credentials-required"
  | "network"
  | "rate-limited"
  | "invalid-response"
  | "cancelled"
  | "cache"
  | "unknown";

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly retryable: boolean;
  readonly providerId?: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: TranslationErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      providerId?: string;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerId = options.providerId;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isTranslationError(error: unknown): error is TranslationError {
  return error instanceof TranslationError;
}

export function cancelledTranslationError(providerId?: string): TranslationError {
  return new TranslationError("cancelled", "Translation was cancelled", { providerId });
}

function isAbortLike(error: unknown): boolean {
  return Boolean(
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError"),
  );
}

/** Normalize provider-specific failures before retry or UI branching. */
export function toTranslationError(
  error: unknown,
  context: { providerId?: string } = {},
): TranslationError {
  if (error instanceof TranslationError) {
    if (!context.providerId || error.providerId) return error;
    return new TranslationError(error.code, error.message, {
      retryable: error.retryable,
      providerId: context.providerId,
      details: error.details,
      cause: error,
    });
  }
  if (isAbortLike(error)) return cancelledTranslationError(context.providerId);

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return new TranslationError("rate-limited", message, { retryable: true, ...context, cause: error });
  }
  if (
    lower.includes("offline") ||
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("econnrefused")
  ) {
    return new TranslationError("network", message, { retryable: true, ...context, cause: error });
  }
  return new TranslationError("unknown", message || "Translation provider failed", {
    providerId: context.providerId,
    cause: error,
  });
}
