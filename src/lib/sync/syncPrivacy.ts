const ALWAYS_SENSITIVE_KEY = /(token|secret|password|api[_-]?key|credential|private[_-]?key)/i;
// file-path/local-path keys aren't blocked outright: some entities (documents)
// legitimately store a portable URL under `filePath` (a YouTube watch URL, a
// fetched page, a clipboard/screenshot import — see
// documentReplication.ts's isPortableFilePath). Only a genuine device-local
// path is what this must reject; a URL-scheme value is content, not a path.
const PATH_LIKE_KEY = /(file[_-]?path|local[_-]?path)/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
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
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (ALWAYS_SENSITIVE_KEY.test(key)) return true;
    if (PATH_LIKE_KEY.test(key)) {
      if (typeof child === "string" && URL_SCHEME.test(child)) return containsSensitiveKey(child);
      return true;
    }
    return containsSensitiveKey(child);
  });
}
