/**
 * Typed X thread retrieval errors shared by the store and the native error
 * state.
 *
 * The Rust backend serializes `ThreadError` as `{type, message}` using
 * snake_case tags (`thread_unavailable`, `thread_reader_unavailable`,
 * `rate_limited`, `network_error`, `invalid_url`, `auth`) and `coerceError` in
 * `src/lib/tauri.ts` preserves `type` on thrown Errors — this module:
 *
 * - normalizes backend types (snake_case / kebab-case / camelCase) to the
 *   canonical camelCase keys used by the UI copy map, fixing the historical
 *   camelCase-vs-snake_case mismatch that made every typed error fall through
 *   to the generic "Unable to load this X thread" state;
 * - owns the single source of truth for the friendly title/detail copy so the
 *   viewer and any other consumer of `metadata.xThreadError` agree.
 */

export type XThreadErrorType =
  | "threadUnavailable"
  | "threadReaderUnavailable"
  | "rateLimited"
  | "networkError"
  | "invalidUrl"
  | "auth";

export interface XThreadErrorCopy {
  title: string;
  detail: string;
}

/**
 * Frontend copy for every Rust `ThreadError` variant (parity table mirrored
 * from `src-tauri/src/threadreader.rs` — see `docs/X_THREAD_RETRIEVAL.md`).
 * Each entry is distinct and non-generic; the parity test in
 * `src/lib/__tests__/xthreadError.test.ts` asserts no Rust variant falls back
 * to the generic copy.
 */
export const XTHREAD_ERROR_COPY: Record<XThreadErrorType, XThreadErrorCopy> = {
  threadUnavailable: {
    title: "Unable to load this X thread",
    detail:
      "This post or thread may be private, deleted, or otherwise unavailable on X.",
  },
  threadReaderUnavailable: {
    title: "Thread could not be retrieved",
    detail:
      "ThreadReaderApp could not unroll this thread. The post may still open directly on X.",
  },
  rateLimited: {
    title: "Rate limited",
    detail: "Too many requests. Wait a moment and try again.",
  },
  networkError: {
    title: "Network error",
    detail: "Could not reach the thread service. Check your connection and retry.",
  },
  invalidUrl: {
    title: "Invalid X link",
    detail: "This doesn't look like a valid X status link.",
  },
  auth: {
    title: "X API credentials unavailable",
    detail:
      "X rejected anonymous access to this post (guest token or session issue). It may still open directly on X.",
  },
};

/** True when `type` is a known, typed error (not the generic fallback). */
export function isXThreadErrorType(type: string | undefined): type is XThreadErrorType {
  return type !== undefined && type in XTHREAD_ERROR_COPY;
}

/**
 * Normalize a backend `type` tag to the canonical camelCase key. Accepts
 * snake_case (`thread_reader_unavailable`), kebab-case, and camelCase — any
 * shape Rust or a legacy consumer produced. Unknown types return `undefined`
 * (the caller falls back to generic copy).
 */
export function normalizeThreadErrorType(type: string | undefined): XThreadErrorType | undefined {
  if (!type) return undefined;
  const normalized = type
    .trim()
    .replace(/_([a-z0-9])/g, (_m, c) => String(c).toUpperCase())
    .replace(/-([a-z0-9])/g, (_m, c) => String(c).toUpperCase());
  const camel = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  return isXThreadErrorType(camel) ? camel : undefined;
}

export interface XThreadError {
  type?: string;
  message?: string;
}

export interface ResolvedThreadError extends XThreadError {
  /** Canonical camelCase type, or `undefined` when unrecognized. */
  type?: XThreadErrorType;
  /** Friendly copy for the (normalized) type; generic when unrecognized. */
  copy: XThreadErrorCopy;
  /** Whether the type mapped to a known, typed error. */
  typed: boolean;
}

/**
 * Resolve an arbitrary rejection into the typed copy + raw message pair the
 * UI renders. The raw backend message is never the primary surface — it is
 * returned separately so callers can render it as secondary detail only.
 */
export function resolveThreadError(error: unknown): ResolvedThreadError {
  const parsed = parseThreadError(error);
  const type = normalizeThreadErrorType(parsed.type);
  if (type) {
    return { type, message: parsed.message, copy: XTHREAD_ERROR_COPY[type], typed: true };
  }
  return {
    type: undefined,
    message: parsed.message,
    copy: {
      title: "Unable to load this X thread",
      detail: parsed.message ?? "Something went wrong while fetching this thread.",
    },
    typed: false,
  };
}

/**
 * Parse a Tauri rejection into a typed thread error. The returned `type` is
 * normalized to canonical camelCase so every consumer branches identically.
 */
export function parseThreadError(error: unknown): XThreadError {
  if (!error) return { message: "Unknown error" };
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error);
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        return {
          type: normalizeThreadErrorType(parsed.type),
          message: typeof parsed.message === "string" ? parsed.message : String(parsed.message ?? ""),
        };
      }
    } catch {
      /* not JSON — plain message */
    }
    return { message: error };
  }
  if (error instanceof Error) {
    const e = error as Error & { type?: string };
    // invokeCommand wraps structured rejections; the message may embed a JSON
    // blob — try to extract the typed envelope.
    if (e.type) {
      return { type: normalizeThreadErrorType(e.type), message: e.message };
    }
    const match = e.message.match(/\{"type"\s*:\s*"([^"]+)"\s*,\s*"message"\s*:\s*"([^"]*)"\s*\}/);
    if (match) return { type: normalizeThreadErrorType(match[1]), message: match[2] };
    return { message: e.message };
  }
  if (error && typeof error === "object") {
    // The persisted `metadata.xThreadError` is exactly this shape: a plain
    // `{ type, message }` object (Rust `ThreadError`). Without this branch the
    // type was lost and every stored error rendered as the generic fallback.
    const obj = error as { type?: unknown; message?: unknown };
    if (typeof obj.type === "string") {
      return {
        type: normalizeThreadErrorType(obj.type),
        message: typeof obj.message === "string" ? obj.message : "",
      };
    }
    return {
      message: typeof obj.message === "string" ? obj.message : String(error),
    };
  }
  return { message: String(error) };
}
