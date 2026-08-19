/**
 * Typed X thread retrieval errors shared by the store and the native error
 * state. The Rust backend serializes `ThreadError` as `{type, message}`
 * (e.g. `{"type":"thread_unavailable","message":"..."}`) and `coerceError` in
 * `src/lib/tauri.ts` preserves `type` on thrown Errors — this parser covers
 * both shapes.
 */

export interface XThreadError {
  type?: string;
  message?: string;
}

/** Parse a Tauri rejection into a typed thread error. */
export function parseThreadError(error: unknown): XThreadError {
  if (!error) return { message: "Unknown error" };
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error);
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        return parsed as XThreadError;
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
    if (e.type) return { type: e.type, message: e.message };
    const match = e.message.match(/\{"type"\s*:\s*"([^"]+)"\s*,\s*"message"\s*:\s*"([^"]*)"\s*\}/);
    if (match) return { type: match[1], message: match[2] };
    return { message: e.message };
  }
  return { message: String(error) };
}
