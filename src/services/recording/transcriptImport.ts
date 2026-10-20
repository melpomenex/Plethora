/**
 * Transcript Import Service for Session Ingestion.
 *
 * Implements truthful, boundary-enforced transcript parsing:
 * - Parses SRT, VTT, and plain TXT files with 20 MiB bound.
 * - Single-pass line-ending normalization (\r\n / \r -> \n) and UTF-8 BOM stripping.
 * - Preserves multiline cues, overlapping cues, Unicode, math equations, and formatting.
 * - Strips unsafe HTML/VTT styling markup while preserving text.
 * - Enforces timing honesty: plain text paragraphs have timing_kind: 'none' without synthetic timestamps.
 * - Deterministic, stable source-unit keys (seg_1, seg_2, ...).
 * - Commits valid imported revisions atomically through importSessionTranscript.
 */

import { importSessionTranscript, type SessionTranscriptSegmentInput } from "../../api/recordingSessions";

export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024; // 20 MiB

export type TranscriptFormat = "srt" | "vtt" | "txt";

export interface ParsedTranscriptCue {
  segmentKey: string;
  ordinal: number;
  startMs?: number | null;
  endMs?: number | null;
  text: string;
  timingKind: "imported" | "none";
}

export class TranscriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptParseError";
  }
}

/**
 * Strips HTML and WebVTT formatting tags (<v Speaker>, <b>, <i>, <c.color>, <00:01.000>, etc.)
 * while preserving safe characters, brackets, and math notation.
 */
export function stripCueMarkup(text: string): string {
  // Remove WebVTT voice/class tags e.g. <v Speaker>, <v.loud Speaker>
  let cleaned = text.replace(/<v(?:\.[^>]+)*\s+([^>]+)>/gi, "$1: ");
  // Remove closing voice tags
  cleaned = cleaned.replace(/<\/v>/gi, "");
  // Remove WebVTT timestamp tags <00:12.000>
  cleaned = cleaned.replace(/<\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{3})?>/g, "");
  // Remove generic HTML/formatting tags: <b>, </i>, <font color="...">, etc.
  cleaned = cleaned.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  return cleaned.trim();
}

/**
 * Converts timestamp string (HH:MM:SS,mmm or MM:SS.mmm) to milliseconds.
 */
export function parseTimestampToMs(timestampStr: string): number {
  const normalized = timestampStr.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseFloat(parts[2]);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      throw new TranscriptParseError(`Invalid timestamp: ${timestampStr}`);
    }
    return Math.round(hours * 3600000 + minutes * 60000 + seconds * 1000);
  } else if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10);
    const seconds = parseFloat(parts[1]);
    if (isNaN(minutes) || isNaN(seconds)) {
      throw new TranscriptParseError(`Invalid timestamp: ${timestampStr}`);
    }
    return Math.round(minutes * 60000 + seconds * 1000);
  }
  throw new TranscriptParseError(`Unrecognized timestamp format: ${timestampStr}`);
}

/**
 * Parses WebVTT content into cues.
 */
function parseVttContent(normalizedText: string): ParsedTranscriptCue[] {
  // Must begin with WEBVTT (possibly after comments)
  if (!normalizedText.startsWith("WEBVTT")) {
    throw new TranscriptParseError("Invalid WebVTT: Missing 'WEBVTT' signature.");
  }

  const cues: ParsedTranscriptCue[] = [];
  // Split into blocks by double newlines
  const blocks = normalizedText.split(/\n\n+/);
  let ordinal = 0;

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // Skip WEBVTT header and NOTE comments
    if (lines[0].startsWith("WEBVTT") || lines[0].startsWith("NOTE")) {
      continue;
    }

    // Find timestamp line containing "-->"
    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("-->")) {
        timeLineIdx = i;
        break;
      }
    }

    if (timeLineIdx === -1) {
      continue; // metadata block or comment
    }

    const timeLine = lines[timeLineIdx];
    const timeMatch = timeLine.match(/((?:\d{1,2}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}\.\d{3})/);
    if (!timeMatch) {
      continue;
    }

    const startMs = parseTimestampToMs(timeMatch[1]);
    const endMs = parseTimestampToMs(timeMatch[2]);

    // Text lines follow the timestamp line
    const textLines = lines.slice(timeLineIdx + 1);
    const rawText = textLines.join("\n");
    const cleanedText = stripCueMarkup(rawText);

    if (cleanedText.length > 0) {
      cues.push({
        segmentKey: `seg_${ordinal + 1}`,
        ordinal,
        startMs,
        endMs,
        text: cleanedText,
        timingKind: "imported",
      });
      ordinal++;
    }
  }

  if (cues.length === 0) {
    throw new TranscriptParseError("No valid cues found in WebVTT document.");
  }

  return cues;
}

/**
 * Parses SubRip (SRT) content into cues.
 */
function parseSrtContent(normalizedText: string): ParsedTranscriptCue[] {
  const cues: ParsedTranscriptCue[] = [];
  const blocks = normalizedText.split(/\n\n+/);
  let ordinal = 0;

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // Find timestamp line containing "-->"
    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("-->")) {
        timeLineIdx = i;
        break;
      }
    }

    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const timeMatch = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/);
    if (!timeMatch) continue;

    const startMs = parseTimestampToMs(timeMatch[1]);
    const endMs = parseTimestampToMs(timeMatch[2]);

    const textLines = lines.slice(timeLineIdx + 1);
    const rawText = textLines.join("\n");
    const cleanedText = stripCueMarkup(rawText);

    if (cleanedText.length > 0) {
      cues.push({
        segmentKey: `seg_${ordinal + 1}`,
        ordinal,
        startMs,
        endMs,
        text: cleanedText,
        timingKind: "imported",
      });
      ordinal++;
    }
  }

  if (cues.length === 0) {
    throw new TranscriptParseError("No valid cues found in SubRip (SRT) document.");
  }

  return cues;
}

/**
 * Parses plain text paragraphs. No synthetic timestamps are invented.
 */
function parseTxtContent(normalizedText: string): ParsedTranscriptCue[] {
  const paragraphs = normalizedText
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    throw new TranscriptParseError("Plain text document contains no content.");
  }

  return paragraphs.map((text, ordinal) => ({
    segmentKey: `seg_${ordinal + 1}`,
    ordinal,
    startMs: null,
    endMs: null,
    text,
    timingKind: "none",
  }));
}

/**
 * Automatically detects format from content or file extension.
 */
export function detectTranscriptFormat(content: string, filename?: string): TranscriptFormat {
  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".vtt")) return "vtt";
    if (lower.endsWith(".srt")) return "srt";
    if (lower.endsWith(".txt")) return "txt";
  }

  if (content.startsWith("WEBVTT")) {
    return "vtt";
  }
  if (content.includes("-->")) {
    return "srt";
  }
  return "txt";
}

/**
 * Parses raw transcript text according to format with size and normalization checks.
 */
export function parseTranscript(
  rawContent: string,
  format?: TranscriptFormat,
  filename?: string
): ParsedTranscriptCue[] {
  // 1. Enforce 20 MiB bound
  const byteLength = new TextEncoder().encode(rawContent).length;
  if (byteLength > MAX_TRANSCRIPT_BYTES) {
    throw new TranscriptParseError(
      `Transcript file size (${(byteLength / 1024 / 1024).toFixed(1)} MiB) exceeds the 20 MiB limit.`
    );
  }

  // 2. Strip UTF-8 BOM
  let text = rawContent;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  // 3. Normalize CRLF and CR to LF once
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const resolvedFormat = format || detectTranscriptFormat(text, filename);

  switch (resolvedFormat) {
    case "vtt":
      return parseVttContent(text);
    case "srt":
      return parseSrtContent(text);
    case "txt":
      return parseTxtContent(text);
    default:
      throw new TranscriptParseError(`Unsupported transcript format: ${resolvedFormat}`);
  }
}

/**
 * Imports transcript content into an authoritative recording session.
 * Commits a full valid revision atomically into SQLite and updates document.content.
 */
export async function importTranscriptFileToSession(
  sessionId: string,
  rawContent: string,
  filename?: string
): Promise<{ count: number; segments: ParsedTranscriptCue[] }> {
  const parsedCues = parseTranscript(rawContent, undefined, filename);

  const segmentInputs: SessionTranscriptSegmentInput[] = parsedCues.map((cue) => ({
    segmentKey: cue.segmentKey,
    ordinal: cue.ordinal,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    timingKind: cue.timingKind,
    revision: 1,
  }));

  const count = await importSessionTranscript(sessionId, segmentInputs);
  return { count, segments: parsedCues };
}
