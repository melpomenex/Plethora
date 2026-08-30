import type { TranscriptionErrorCode, TranscriptionProviderId } from "./types";

export type { TranscriptionErrorCode };

export class TranscriptionError extends Error {
  code: TranscriptionErrorCode;
  recoverable: boolean;
  status?: number;
  providerId?: TranscriptionProviderId | string;
  cause?: unknown;
  retryAfterMs?: number;

  constructor(
    message: string,
    code: TranscriptionErrorCode = "UNKNOWN",
    options?: {
      recoverable?: boolean;
      status?: number;
      providerId?: TranscriptionProviderId | string;
      cause?: unknown;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.status = options?.status;
    this.providerId = options?.providerId;
    this.cause = options?.cause;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export async function readProviderMessage(response: Response): Promise<string | undefined> {
  try {
    const payload: unknown = await response.clone().json();
    if (typeof payload === "object" && payload !== null) {
      const record = payload as Record<string, unknown>;
      if (typeof record.error === "string") return record.error;
      if (typeof record.message === "string") return record.message;
      if (typeof record.error === "object" && record.error !== null) {
        const nested = record.error as Record<string, unknown>;
        if (typeof nested.message === "string") return nested.message;
      }
    }
  } catch {
    // Some providers return plain text or an empty body on failure.
  }
  try {
    const text = await response.clone().text();
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function mapHttpStatusToTranscriptionError(
  status: number,
  message?: string,
): TranscriptionError {
  if (status === 401 || status === 403) {
    return new TranscriptionError(
      message || "Authentication failed. Check the configured API key.",
      "AUTH_FAILED",
      { status },
    );
  }
  if (status === 402) {
    return new TranscriptionError(
      message || "Account is out of credits. Add credits before trying again.",
      "INSUFFICIENT_BALANCE",
      { status },
    );
  }
  if (status === 408 || status === 504 || status === 524) {
    return new TranscriptionError(
      message || "Transcription timed out. Try again with a shorter clip.",
      "TIMEOUT",
      { recoverable: true, status },
    );
  }
  if (status === 413 || status === 415) {
    return new TranscriptionError(
      message || "Unsupported or oversized audio.",
      "UNSUPPORTED_AUDIO",
      { status },
    );
  }
  if (status === 422) {
    return new TranscriptionError(
      message || "Unsupported language.",
      "UNSUPPORTED_LANGUAGE",
      { status },
    );
  }
  if (status === 429) {
    return new TranscriptionError(
      message || "Rate limit reached. Retry in a few seconds.",
      "RATE_LIMITED",
      { recoverable: true, status },
    );
  }
  if (status === 404 || status === 502 || status === 503 || status === 500 || status === 529) {
    return new TranscriptionError(
      message || "The transcription provider is temporarily unavailable.",
      "PROVIDER_UNAVAILABLE",
      { recoverable: true, status },
    );
  }
  return new TranscriptionError(message || "Transcription request failed.", "UNKNOWN", { status });
}

/** @deprecated Use mapHttpStatusToTranscriptionError */
export const mapHttpError = mapHttpStatusToTranscriptionError;

export function isRetryableTranscriptionError(error: TranscriptionError): boolean {
  return error.recoverable || error.code === "RATE_LIMITED" || error.code === "TIMEOUT"
    || error.code === "NETWORK_ERROR" || error.code === "PROVIDER_UNAVAILABLE";
}

export function normalizeError(
  error: unknown,
  providerId?: TranscriptionProviderId | string,
): TranscriptionError {
  if (error instanceof TranscriptionError) {
    if (providerId && !error.providerId) {
      return new TranscriptionError(error.message, error.code, {
        recoverable: error.recoverable,
        status: error.status,
        providerId,
        cause: error.cause ?? error,
        retryAfterMs: error.retryAfterMs,
      });
    }
    return error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new TranscriptionError("Transcription cancelled.", "CANCELLED", { providerId });
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (lower.includes("network") || lower.includes("fetch")) {
      return new TranscriptionError(error.message, "NETWORK_ERROR", { providerId, recoverable: true, cause: error });
    }
    if (lower.includes("timeout")) {
      return new TranscriptionError(error.message, "TIMEOUT", { providerId, recoverable: true, cause: error });
    }
    if (lower.includes("rate limit")) {
      return new TranscriptionError(error.message, "RATE_LIMITED", { providerId, recoverable: true, cause: error });
    }
    if (lower.includes("auth") || lower.includes("api key")) {
      return new TranscriptionError(error.message, "AUTH_FAILED", { providerId, cause: error });
    }
    if (lower.includes("disclosure declined")) {
      return new TranscriptionError(error.message, "DISCLOSURE_DECLINED", { providerId, cause: error });
    }
    if (lower.includes("local_model_missing")) {
      return new TranscriptionError(error.message, "LOCAL_MODEL_MISSING", { providerId, cause: error });
    }
    return new TranscriptionError(error.message, "UNKNOWN", { providerId, cause: error });
  }

  return new TranscriptionError("Unknown transcription error.", "UNKNOWN", { providerId, cause: error });
}
