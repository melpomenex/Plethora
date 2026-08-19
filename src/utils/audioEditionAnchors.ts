/**
 * Audio Edition Source-to-Audio Anchor Computation
 * 
 * Splits section text into sentences and computes proportional audio time spans
 * aligning each sentence with its playback interval.
 */

import type { AudioEditionAnchor } from "../types/audioEdition";

export interface SentenceChunk {
  text: string;
  startChar: number;
  endChar: number;
}

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

/**
 * Find the anchor matching a given playback timestamp $T$
 */
export function resolveAnchorAtTimestamp(
  anchors: AudioEditionAnchor[],
  timestampSec: number
): AudioEditionAnchor | null {
  if (!anchors || anchors.length === 0) return null;

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const isLast = i === anchors.length - 1;
    if (timestampSec >= anchor.audioStartSec && (isLast ? timestampSec <= anchor.audioEndSec : timestampSec < anchor.audioEndSec)) {
      return anchor;
    }
  }

  // Fallback to closest anchor
  return anchors.reduce((prev, curr) => {
    const prevDiff = Math.min(Math.abs(timestampSec - prev.audioStartSec), Math.abs(timestampSec - prev.audioEndSec));
    const currDiff = Math.min(Math.abs(timestampSec - curr.audioStartSec), Math.abs(timestampSec - curr.audioEndSec));
    return currDiff < prevDiff ? curr : prev;
  }, anchors[0]);
}

/**
 * Expand timestamp $T$ and window $[T - W, T]$ to clean sentence/paragraph boundaries
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
  if (!anchors || anchors.length === 0) {
    return {
      startAnchor: "0",
      endAnchor: "0",
      text: "",
      matchedAnchors: [],
    };
  }

  const windowStart = Math.max(0, currentTimestampSec - lookbackSeconds);
  const windowEnd = currentTimestampSec;

  const overlapping = anchors.filter(
    (a) => a.audioEndSec >= windowStart && a.audioStartSec <= windowEnd
  );

  if (overlapping.length === 0) {
    const current = resolveAnchorAtTimestamp(anchors, currentTimestampSec);
    if (current) {
      return {
        startAnchor: current.sourceStartAnchor,
        endAnchor: current.sourceEndAnchor,
        text: current.textContent,
        matchedAnchors: [current],
      };
    }
    return {
      startAnchor: "0",
      endAnchor: "0",
      text: "",
      matchedAnchors: [],
    };
  }

  const first = overlapping[0];
  const last = overlapping[overlapping.length - 1];
  const combinedText = overlapping.map((a) => a.textContent).join(" ");

  return {
    startAnchor: first.sourceStartAnchor,
    endAnchor: last.sourceEndAnchor,
    text: combinedText,
    matchedAnchors: overlapping,
  };
}
