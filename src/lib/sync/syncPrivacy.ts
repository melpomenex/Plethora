const SENSITIVE_KEY = /(token|secret|password|api[_-]?key|credential|private[_-]?key|file[_-]?path|local[_-]?path)/i;
const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Reject secrets, machine paths, and oversized/binary payloads before journaling. */
export function isSyncPayloadSafe(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > MAX_PAYLOAD_BYTES || /^\s*data:[^,]+,/i.test(encoded)) return false;
    return !containsSensitiveKey(value);
  } catch {
    return false;
  }
}

function containsSensitiveKey(value: unknown): boolean {
  if (typeof value === "string") return /^\s*data:[^,]+,/i.test(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSensitiveKey);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => SENSITIVE_KEY.test(key) || containsSensitiveKey(child));
}
