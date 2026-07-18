/**
 * Structured, privacy-conscious diagnostics for the audiobook import/playback
 * pipeline. The console-to-logcat bridge forwards these records to Android's
 * native logger; on desktop they remain ordinary console output.
 */

export type AudiobookDiagnosticEvent =
  | "import"
  | "source_resolution"
  | "media_request"
  | "playback";

export interface AudiobookDiagnosticFields {
  documentId?: string;
  filePath?: string;
  fileSize?: number;
  extension?: string;
  strategy?: string;
  status?: string | number;
  range?: string | null;
  mediaErrorCode?: number | string;
  message?: string;
  elapsedMs?: number;
  [key: string]: unknown;
}

function getBasename(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const normalized = filePath.replaceAll("\\", "/");
  return normalized.split("/").pop() || undefined;
}

function getExtension(filePath?: string): string | undefined {
  const basename = getBasename(filePath);
  const dot = basename?.lastIndexOf(".");
  return dot !== undefined && dot >= 0 ? basename.slice(dot + 1).toLowerCase() : undefined;
}

/** Return safe fields suitable for logcat without logging full local paths. */
export function redactAudiobookDiagnosticFields(
  fields: AudiobookDiagnosticFields,
): Record<string, unknown> {
  const { filePath, ...rest } = fields;
  const redacted = { ...rest } as Record<string, unknown>;
  if (filePath) {
    redacted.fileName = getBasename(filePath);
    redacted.extension ??= getExtension(filePath);
  }
  return redacted;
}

export function logAudiobookDiagnostic(
  event: AudiobookDiagnosticEvent,
  fields: AudiobookDiagnosticFields = {},
  level: "info" | "warn" | "error" = "info",
): void {
  const payload = {
    event: `audiobook.${event}`,
    ...redactAudiobookDiagnosticFields(fields),
    timestamp: new Date().toISOString(),
  };
  const message = `[${payload.event}] ${JSON.stringify(payload)}`;
  console[level](message);
}
