/**
 * Multi-format transcript serialization and file export utilities.
 * Supports Plain Text (.txt), Markdown (.md), SubRip (.srt), WebVTT (.vtt), and JSON (.json).
 */

export interface ExportableTranscriptSegment {
  id?: string;
  start?: number; // Start time in seconds (optional for untimed segments)
  end?: number; // End time in seconds (optional for untimed segments)
  text: string;
  speaker?: string;
}

export type TranscriptExportFormat = "txt" | "md" | "srt" | "vtt" | "json";

export interface TranscriptExportOptions {
  title?: string;
  includeTimestamps?: boolean;
  includeSpeakers?: boolean;
  sourceUrl?: string;
  exportedAt?: string;
}

export const TRANSCRIPT_EXPORT_FORMATS: Array<{
  format: TranscriptExportFormat;
  label: string;
  extension: string;
  mimeType: string;
}> = [
  { format: "txt", label: "Plain Text (.txt)", extension: ".txt", mimeType: "text/plain;charset=utf-8" },
  { format: "md", label: "Markdown (.md)", extension: ".md", mimeType: "text/markdown;charset=utf-8" },
  { format: "srt", label: "SRT Subtitles (.srt)", extension: ".srt", mimeType: "application/x-subrip;charset=utf-8" },
  { format: "vtt", label: "WebVTT (.vtt)", extension: ".vtt", mimeType: "text/vtt;charset=utf-8" },
  { format: "json", label: "JSON (.json)", extension: ".json", mimeType: "application/json;charset=utf-8" },
];

/**
 * Format seconds into human-readable clock (MM:SS or H:MM:SS)
 */
export function formatTranscriptClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format seconds into SubRip timestamp (HH:MM:SS,mmm)
 */
export function formatSRTTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(safe * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms
    .toString()
    .padStart(3, "0")}`;
}

/**
 * Format seconds into WebVTT timestamp (HH:MM:SS.mmm)
 */
export function formatVTTTimestamp(seconds: number): string {
  return formatSRTTimestamp(seconds).replace(",", ".");
}

/**
 * Format a single segment with timestamp and speaker for clipboard copy
 */
export function formatSegmentWithTimestamp(segment: ExportableTranscriptSegment): string {
  const hasStart = typeof segment.start === "number" && Number.isFinite(segment.start);
  const timePrefix = hasStart ? `[${formatTranscriptClock(segment.start!)}] ` : "";
  const speakerPrefix = segment.speaker ? `${segment.speaker}: ` : "";
  return `${timePrefix}${speakerPrefix}${segment.text.trim()}`;
}

/**
 * Serialize transcript segments to Plain Text (.txt)
 */
export function serializeTranscriptToPlainText(
  segments: ExportableTranscriptSegment[],
  options: TranscriptExportOptions = {}
): string {
  const { includeTimestamps = true, includeSpeakers = true } = options;

  return (segments || [])
    .map((seg) => {
      const hasStart =
        includeTimestamps && typeof seg.start === "number" && Number.isFinite(seg.start);
      const timestamp = hasStart ? `[${formatTranscriptClock(seg.start!)}] ` : "";
      const speaker = includeSpeakers && seg.speaker ? `${seg.speaker}: ` : "";
      return `${timestamp}${speaker}${seg.text.trim()}`;
    })
    .join("\n");
}

/**
 * Serialize transcript segments to Markdown (.md)
 */
export function serializeTranscriptToMarkdown(
  segments: ExportableTranscriptSegment[],
  options: TranscriptExportOptions = {}
): string {
  const {
    title = "Transcript",
    includeTimestamps = true,
    includeSpeakers = true,
    sourceUrl,
  } = options;

  const lines: string[] = [`# ${title}`, ""];
  if (sourceUrl) {
    lines.push(`**Source:** ${sourceUrl}`, "");
  }

  for (const seg of segments || []) {
    const hasStart =
      includeTimestamps && typeof seg.start === "number" && Number.isFinite(seg.start);
    const timePart = hasStart ? `**[${formatTranscriptClock(seg.start!)}]** ` : "";
    const speakerPart = includeSpeakers && seg.speaker ? `**${seg.speaker}:** ` : "";
    lines.push(`- ${timePart}${speakerPart}${seg.text.trim()}`);
  }

  return lines.join("\n");
}

/**
 * Serialize transcript segments to SubRip (.srt)
 */
export function serializeTranscriptToSRT(segments: ExportableTranscriptSegment[]): string {
  return (segments || [])
    .map((seg, index) => {
      const start =
        typeof seg.start === "number" && Number.isFinite(seg.start)
          ? Math.max(0, seg.start)
          : index * 5;
      const end =
        typeof seg.end === "number" && Number.isFinite(seg.end) && seg.end > start
          ? seg.end
          : start + 5;
      const speaker = seg.speaker ? `${seg.speaker}: ` : "";
      return `${index + 1}\n${formatSRTTimestamp(start)} --> ${formatSRTTimestamp(end)}\n${speaker}${seg.text.trim()}\n`;
    })
    .join("\n");
}

/**
 * Serialize transcript segments to WebVTT (.vtt)
 */
export function serializeTranscriptToVTT(segments: ExportableTranscriptSegment[]): string {
  const cues = (segments || [])
    .map((seg, index) => {
      const start =
        typeof seg.start === "number" && Number.isFinite(seg.start)
          ? Math.max(0, seg.start)
          : index * 5;
      const end =
        typeof seg.end === "number" && Number.isFinite(seg.end) && seg.end > start
          ? seg.end
          : start + 5;
      const speaker = seg.speaker ? `<v ${seg.speaker}>` : "";
      return `${formatVTTTimestamp(start)} --> ${formatVTTTimestamp(end)}\n${speaker}${seg.text.trim()}`;
    })
    .join("\n\n");

  return cues ? `WEBVTT\n\n${cues}\n` : "WEBVTT\n";
}

/**
 * Serialize transcript segments to JSON (.json)
 */
export function serializeTranscriptToJSON(
  segments: ExportableTranscriptSegment[],
  options: TranscriptExportOptions = {}
): string {
  const payload = {
    title: options.title || "Transcript",
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    exportedAt: options.exportedAt || new Date().toISOString(),
    segmentCount: (segments || []).length,
    segments: (segments || []).map((seg, index) => ({
      id: seg.id ?? `seg-${index + 1}`,
      ...(typeof seg.start === "number" && Number.isFinite(seg.start) ? { start: seg.start } : {}),
      ...(typeof seg.end === "number" && Number.isFinite(seg.end) ? { end: seg.end } : {}),
      ...(seg.speaker ? { speaker: seg.speaker } : {}),
      text: seg.text,
    })),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Serialize transcript segments into the specified format
 */
export function serializeTranscript(
  segments: ExportableTranscriptSegment[],
  format: TranscriptExportFormat,
  options: TranscriptExportOptions = {}
): string {
  switch (format) {
    case "txt":
      return serializeTranscriptToPlainText(segments, options);
    case "md":
      return serializeTranscriptToMarkdown(segments, options);
    case "srt":
      return serializeTranscriptToSRT(segments);
    case "vtt":
      return serializeTranscriptToVTT(segments);
    case "json":
      return serializeTranscriptToJSON(segments, options);
    default:
      return serializeTranscriptToPlainText(segments, options);
  }
}

/**
 * Build a clean filename for transcript export
 */
export function buildTranscriptFilename(
  title: string | undefined,
  format: TranscriptExportFormat
): string {
  const rawBase = (title || "transcript")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const base = rawBase || "transcript";
  const suffix = base.endsWith("transcript") ? base : `${base}-transcript`;
  return `${suffix}.${format}`;
}

/**
 * Serialize and trigger a file download in the browser / Tauri webview
 */
export function exportTranscriptToFile(
  segments: ExportableTranscriptSegment[],
  format: TranscriptExportFormat,
  options: TranscriptExportOptions = {}
): { filename: string; content: string; mimeType: string } {
  const content = serializeTranscript(segments, format, options);
  const filename = buildTranscriptFilename(options.title, format);
  const meta = TRANSCRIPT_EXPORT_FORMATS.find((f) => f.format === format);
  const mimeType = meta?.mimeType || "text/plain;charset=utf-8";

  if (typeof document !== "undefined" && typeof Blob !== "undefined") {
    const blob = new Blob([content], { type: mimeType });
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => {
        URL.revokeObjectURL?.(url);
      }, 0);
    }
  }

  return { filename, content, mimeType };
}

/**
 * Convert millisecond-based segments (e.g. from TranscriptPanel) to ExportableTranscriptSegment[]
 */
export function fromMsSegments(
  segments: Array<{ id?: string; start_ms: number; end_ms: number; text: string; speaker?: string }>
): ExportableTranscriptSegment[] {
  return (segments || []).map((seg, idx) => ({
    id: seg.id ?? `seg-${idx + 1}`,
    start: seg.start_ms / 1000,
    end: seg.end_ms / 1000,
    text: seg.text,
    speaker: seg.speaker,
  }));
}

/**
 * Convert SessionTranscriptSegment[] to ExportableTranscriptSegment[]
 */
export function fromSessionSegments(
  segments: Array<{
    segmentKey: string;
    text: string;
    speakerId?: string;
    timing?: { kind: string; startMs?: number; endMs?: number };
  }>
): ExportableTranscriptSegment[] {
  return (segments || []).map((seg) => {
    const isTimed =
      seg.timing &&
      seg.timing.kind !== "none" &&
      typeof seg.timing.startMs === "number";
    return {
      id: seg.segmentKey,
      start: isTimed ? seg.timing!.startMs! / 1000 : undefined,
      end:
        isTimed && typeof seg.timing!.endMs === "number"
          ? seg.timing!.endMs / 1000
          : undefined,
      text: seg.text,
      speaker: seg.speakerId,
    };
  });
}
