/**
 * Audio Edition Source-to-Audio Anchor Computation & Smart Capture Resolution
 *
 * Splits section text into sentences and computes proportional audio time spans
 * aligning each sentence with its playback interval. On capture, resolves the
 * recent window into typed outcomes (`resolved` / `needs_confirmation` /
 * `pending_audio_bookmark`) with paragraph-aware boundary snapping — never
 * synthetic placeholder text.
 */

import type {
  AudioEditionAnchor,
  CaptureConfidence,
  CaptureOutcomeKind,
  CaptureWindow,
} from "../types/audioEdition";

export interface SentenceChunk {
  text: string;
  startChar: number;
  endChar: number;
}

/** Smart-window bounds (design Decision 7/9): ≤ 90 s and ≤ 3 semantic units. */
export const SMART_WINDOW_MAX_SEC = 90;
export const SMART_WINDOW_MAX_UNITS = 3;

/** Default repeat-extension cap (design Decision 7): ≤ 3 backward extensions. */
export const MAX_CAPTURE_EXTENSIONS = 3;

/**
 * Split text into clean sentence segments preserving character offsets
 */
export function splitTextIntoSentences(text: string, baseOffset = 0): SentenceChunk[] {
  if (!text || !text.trim()) return [];

  const chunks: SentenceChunk[] = [];
  // Regex for sentence terminators followed by whitespace or end of string
  const sentenceRegex = /[^.!?\n]+(?:[.!?]+|\n+|$)/g;
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const leadingSpaces = raw.length - raw.trimStart().length;
      const startChar = baseOffset + match.index + leadingSpaces;
      const endChar = startChar + trimmed.length;

      chunks.push({
        text: trimmed,
        startChar,
        endChar,
      });
    }
  }

  // Fallback if regex found nothing
  if (chunks.length === 0 && text.trim().length > 0) {
    chunks.push({
      text: text.trim(),
      startChar: baseOffset,
      endChar: baseOffset + text.trim().length,
    });
  }

  return chunks;
}

/**
 * Compute audio start and end timestamps for each sentence based on character weights
 */
export function computeSentenceAnchors(
  sectionId: string,
  sectionText: string,
  totalAudioDurationSec: number,
  sourceStartAnchor = "0"
): AudioEditionAnchor[] {
  const baseOffset = parseInt(sourceStartAnchor.replace(/\D/g, ""), 10) || 0;
  const sentences = splitTextIntoSentences(sectionText, baseOffset);

  if (sentences.length === 0 || totalAudioDurationSec <= 0) {
    return [];
  }

  const totalChars = sentences.reduce((sum, s) => sum + s.text.length, 0);
  if (totalChars === 0) return [];

  let currentAudioTime = 0;
  const anchors: AudioEditionAnchor[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const ratio = s.text.length / totalChars;
    const duration = ratio * totalAudioDurationSec;
    const audioStartSec = currentAudioTime;
    const audioEndSec = i === sentences.length - 1 ? totalAudioDurationSec : currentAudioTime + duration;

    anchors.push({
      id: `anc-${sectionId}-${i}`,
      sectionId,
      audioStartSec: Math.round(audioStartSec * 100) / 100,
      audioEndSec: Math.round(audioEndSec * 100) / 100,
      sourceStartAnchor: String(s.startChar),
      sourceEndAnchor: String(s.endChar),
      textContent: s.text,
    });

    currentAudioTime += duration;
  }

  return anchors;
}

/** Parse a numeric source anchor; null for non-numeric schemes (e.g. EPUB CFI). */
function parseNumericAnchor(anchor: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(anchor.trim())) return null;
  const n = Number(anchor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Find the index of the anchor matching a given playback timestamp T via
 * binary search (anchors are sorted by `audioStartSec`; O(log n) regardless
 * of book size per design Decision 13). Returns -1 when no anchor exists.
 */
export function findAnchorIndexAtTimestamp(
  anchors: AudioEditionAnchor[],
  timestampSec: number
): number {
  if (!anchors || anchors.length === 0) return -1;

  let lo = 0;
  let hi = anchors.length - 1;
  let candidate = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const anchor = anchors[mid];
    const isLast = mid === anchors.length - 1;
    if (timestampSec < anchor.audioStartSec) {
      hi = mid - 1;
    } else if (
      timestampSec > anchor.audioEndSec ||
      // Shared boundary points belong to the NEXT anchor (start-inclusive,
      // end-exclusive — matching the original linear resolver).
      (timestampSec === anchor.audioEndSec && !isLast)
    ) {
      candidate = mid; // last anchor whose start is behind us
      lo = mid + 1;
    } else {
      return mid;
    }
  }

  // Past the end of the last anchor (document end): clamp to it; before the
  // first anchor (document start): clamp to it.
  if (timestampSec > anchors[anchors.length - 1].audioEndSec) {
    return anchors.length - 1;
  }
  if (timestampSec < anchors[0].audioStartSec) {
    return 0;
  }
  return candidate >= 0 ? candidate : 0;
}

/**
 * Find the anchor matching a given playback timestamp $T$
 */
export function resolveAnchorAtTimestamp(
  anchors: AudioEditionAnchor[],
  timestampSec: number
): AudioEditionAnchor | null {
  const idx = findAnchorIndexAtTimestamp(anchors, timestampSec);
  return idx >= 0 ? anchors[idx] : null;
}

/**
 * Whether a paragraph break exists between two consecutive anchors.
 *
 * Numeric-anchor editions: the sentence splitter collapses inter-sentence
 * whitespace, so a single separating space yields gap 1 and a blank-line
 * (paragraph) break yields gap ≥ 2 — a real signal recoverable from stored
 * anchors alone. Non-numeric schemes (CFI) fall back to "no paragraph info".
 */
function isParagraphBreak(prev: AudioEditionAnchor, next: AudioEditionAnchor): boolean {
  const prevEnd = parseNumericAnchor(prev.sourceEndAnchor);
  const nextStart = parseNumericAnchor(next.sourceStartAnchor);
  if (prevEnd === null || nextStart === null) return false;
  return nextStart - prevEnd >= 2;
}

/**
 * Walk backward from `index` to the first anchor of its enclosing paragraph
 * (sentence group). With no paragraph signal, the sentence is its own unit.
 */
export function paragraphStartIndex(anchors: AudioEditionAnchor[], index: number): number {
  if (!anchors || anchors.length === 0) return 0;
  let i = Math.min(Math.max(index, 0), anchors.length - 1);
  while (i > 0 && !isParagraphBreak(anchors[i - 1], anchors[i])) {
    i -= 1;
  }
  return i;
}

/**
 * Extend a capture start backward by one semantic unit: the previous whole
 * paragraph when the start already sits at a paragraph boundary, otherwise to
 * the start of the current enclosing paragraph. Returns the (clamped) new
 * start index; never crosses index 0.
 */
export function extendStartBySemanticUnit(
  anchors: AudioEditionAnchor[],
  startIndex: number
): number {
  if (!anchors || anchors.length === 0 || startIndex <= 0) return Math.max(0, startIndex);

  const currentParagraphStart = paragraphStartIndex(anchors, startIndex);
  if (currentParagraphStart > 0 && currentParagraphStart === startIndex) {
    // Already at a paragraph boundary: pull in the entire previous paragraph.
    return paragraphStartIndex(anchors, currentParagraphStart - 1);
  }
  // Mid-paragraph: snap back to this paragraph's start (a partial first
  // extension), which the next extension will then grow past.
  return currentParagraphStart;
}

/**
 * Typed capture resolution for a hands-free capture at timestamp T
 * (design Decision 9). Never produces placeholder text: when the passage
 * cannot be recovered the outcome is `pending_audio_bookmark` with empty text.
 */
export interface CaptureResolution {
  kind: CaptureOutcomeKind;
  confidence: CaptureConfidence;
  /** Recovered source text; empty string for pending audio bookmarks. */
  text: string;
  startAnchor: string;
  endAnchor: string;
  matchedAnchors: AudioEditionAnchor[];
  /** Effective window in seconds actually covered ("smart" resolves to its bound). */
  windowSec: number;
}

function pendingResolution(
  anchors: AudioEditionAnchor[],
  timestampSec: number
): CaptureResolution {
  // Keep the nearest anchor for context so the Inbox can hint at location,
  // but carry no textual content.
  const nearest = resolveAnchorAtTimestamp(anchors, timestampSec);
  return {
    kind: "pending_audio_bookmark",
    confidence: "low",
    text: "",
    startAnchor: nearest?.sourceStartAnchor ?? "0",
    endAnchor: nearest?.sourceEndAnchor ?? "0",
    matchedAnchors: nearest ? [nearest] : [],
    windowSec: 0,
  };
}

export function resolveRecentPassage(
  anchors: AudioEditionAnchor[],
  currentTimestampSec: number,
  window: CaptureWindow,
  confidence: CaptureConfidence = "high"
): CaptureResolution {
  if (!anchors || anchors.length === 0) {
    return {
      kind: "pending_audio_bookmark",
      confidence: "low",
      text: "",
      startAnchor: "0",
      endAnchor: "0",
      matchedAnchors: [],
      windowSec: 0,
    };
  }

  // Low confidence: never fabricate text — timestamp bookmark only.
  if (confidence === "low") {
    return pendingResolution(anchors, currentTimestampSec);
  }

  const endIndex = findAnchorIndexAtTimestamp(anchors, currentTimestampSec);

  let startIndex: number;
  let effectiveWindowSec: number;

  if (window === "smart") {
    // Snap to the enclosing sentence group/paragraph, bounded to ≤ 3 units
    // and ≤ 90 s of audio.
    startIndex = paragraphStartIndex(anchors, Math.max(endIndex, 0));
    let units = 1;
    while (
      units < SMART_WINDOW_MAX_UNITS &&
      startIndex > 0 &&
      anchors[endIndex].audioStartSec - anchors[startIndex].audioStartSec <
        SMART_WINDOW_MAX_SEC
    ) {
      const prevParagraph = paragraphStartIndex(anchors, startIndex - 1);
      if (
        anchors[endIndex].audioStartSec - anchors[prevParagraph].audioStartSec >
        SMART_WINDOW_MAX_SEC
      ) {
        break;
      }
      startIndex = prevParagraph;
      units += 1;
    }
    effectiveWindowSec =
      Math.round((anchors[endIndex].audioEndSec - anchors[startIndex].audioStartSec) * 10) / 10;
  } else {
    const windowStart = Math.max(0, currentTimestampSec - window);
    effectiveWindowSec = window;
    // First sentence whose audio overlaps the window; boundary-safe at the
    // document start (windowStart clamps to 0 → first anchor).
    startIndex = endIndex;
    while (
      startIndex > 0 &&
      anchors[startIndex - 1].audioEndSec > windowStart
    ) {
      startIndex -= 1;
    }
  }

  const matched = anchors.slice(startIndex, endIndex + 1);
  const first = matched[0];
  const last = matched[matched.length - 1];
  const text = matched.map((a) => a.textContent).join(" ");

  return {
    kind: confidence === "medium" ? "needs_confirmation" : "resolved",
    confidence,
    text,
    startAnchor: first.sourceStartAnchor,
    endAnchor: last.sourceEndAnchor,
    matchedAnchors: matched,
    windowSec: effectiveWindowSec,
  };
}

/**
 * Expand timestamp $T$ and window $[T - W, T]$ to clean sentence/paragraph boundaries
 * (legacy helper retained for existing callers/tests).
 */
export function expandSmartExtractBoundaries(
  anchors: AudioEditionAnchor[],
  currentTimestampSec: number,
  lookbackSeconds = 30
): {
  startAnchor: string;
  endAnchor: string;
  text: string;
  matchedAnchors: AudioEditionAnchor[];
} {
  const resolution = resolveRecentPassage(
    anchors,
    currentTimestampSec,
    lookbackSeconds === 15 || lookbackSeconds === 30 || lookbackSeconds === 60
      ? lookbackSeconds
      : 30
  );
  return {
    startAnchor: resolution.startAnchor,
    endAnchor: resolution.endAnchor,
    text: resolution.text,
    matchedAnchors: resolution.matchedAnchors,
  };
}
