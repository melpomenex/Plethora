/**
 * Deterministic transcript unit planning and token budgeting (Task 3.3, Design D8).
 *
 * Implements:
 *   - Token budget algorithm:
 *       available = min(contextTokens - systemTokens - outputReserve - 256, 6000)
 *       outputReserve = min(1500, floor(contextTokens / 3))
 *       refuse / error if available < 512
 *   - Transcript unit planning:
 *       form units of <= min(2000, available) source tokens
 *       <= 128-token previous-unit overlap, attributed as context-only
 *       split oversize single segments into deterministic code-unit ranges
 *   - Summary tree hierarchy:
 *       groups <= 8 section summaries (<= 300 tokens each) into bounded overview requests
 *       max 16 overview calls, max 64 section calls
 *   - Deterministic input hashing across restarts
 *   - Honest untimed handling (kind: 'none' preserved; no synthetic 0:00 precision)
 */

import { estimateTokens } from "../../../lib/ai/chunkTextByTokens";
import type {
  SessionTranscriptSegment,
  SessionTranscriptTiming,
} from "../../../types/recordingSession";

// ── D8 Constants ─────────────────────────────────────────────────────────────

export const DEFAULT_MAX_SECTION_REQUESTS = 64;
export const DEFAULT_MAX_OVERVIEW_REQUESTS = 16;
export const MAX_SECTION_CARDS = 8;
export const MAX_CARDS_PER_CONCEPT = 2;
export const MAX_SECTION_EXTRACTS = 3;
export const MAX_QUOTE_LENGTH_CHARS = 8000;
export const MAX_RUN_PROPOSED_CARDS = 40;
export const MAX_RUN_PROPOSED_EXTRACTS = 40;

export const MOBILE_CONCURRENCY = 1;
export const DESKTOP_CONCURRENCY = 2;

export const MIN_AVAILABLE_TOKENS = 512;
export const MAX_AVAILABLE_TOKENS = 6000;
export const MAX_SOURCE_TOKENS = 2000;
export const MAX_CONTEXT_OVERLAP_TOKENS = 128;
export const MAX_SUMMARY_GROUP_SIZE = 8;
export const MAX_SUMMARY_TOKEN_BUDGET = 300;
export const SAFETY_RESERVE_TOKENS = 256;

const CHARS_PER_TOKEN = 4;

// ── Token Budget ─────────────────────────────────────────────────────────────

export interface TokenBudgetInput {
  contextTokens: number;
  systemTokens: number;
}

export interface TokenBudgetResult {
  contextTokens: number;
  systemTokens: number;
  outputReserve: number;
  safetyReserve: number;
  available: number;
  maxSourceTokens: number;
  fits: boolean;
  error?: string;
}

/**
 * Calculate token budget according to D8 formula:
 *   outputReserve = min(1500, floor(contextTokens / 3))
 *   available = min(contextTokens - systemTokens - outputReserve - 256, 6000)
 *   refuse / error if available < 512
 *   maxSourceTokens = min(2000, available)
 */
export function calculateTokenBudget(input: TokenBudgetInput): TokenBudgetResult {
  const { contextTokens, systemTokens } = input;
  const outputReserve = Math.min(1500, Math.floor(contextTokens / 3));
  const safetyReserve = SAFETY_RESERVE_TOKENS;
  const rawAvailable = contextTokens - systemTokens - outputReserve - safetyReserve;
  const available = Math.min(rawAvailable, MAX_AVAILABLE_TOKENS);

  if (available < MIN_AVAILABLE_TOKENS) {
    return {
      contextTokens,
      systemTokens,
      outputReserve,
      safetyReserve,
      available,
      maxSourceTokens: 0,
      fits: false,
      error: `Insufficient context window: available source tokens (${available}) is less than required minimum (${MIN_AVAILABLE_TOKENS})`,
    };
  }

  const maxSourceTokens = Math.min(MAX_SOURCE_TOKENS, available);

  return {
    contextTokens,
    systemTokens,
    outputReserve,
    safetyReserve,
    available,
    maxSourceTokens,
    fits: true,
  };
}

/**
 * Concurrency recommendation per D8:
 * - 1 heavy task on mobile
 * - At most 2 units on desktop, falling back to 1 when recording or local STT is active
 */
export function getRecommendedConcurrency(options: {
  isMobile: boolean;
  isRecordingOrSttActive?: boolean;
}): number {
  if (options.isMobile) {
    return MOBILE_CONCURRENCY;
  }
  return options.isRecordingOrSttActive ? 1 : DESKTOP_CONCURRENCY;
}

// ── Unit Planning Types ──────────────────────────────────────────────────────

export interface SegmentRangeRef {
  segmentKey: string;
  startUtf16: number;
  endUtf16: number;
  text: string;
  timing?: SessionTranscriptTiming;
  speakerId?: string;
}

export interface ContextOverlap {
  text: string;
  segmentKeys: string[];
  ranges: SegmentRangeRef[];
  estimatedTokens: number;
}

export interface PlannedTranscriptUnit {
  unitIndex: number;
  unitKey: string;
  /** Exact code-unit ranges owned by this unit. Evidence must cite only owned ranges. */
  ownedRanges: SegmentRangeRef[];
  /** Segment keys owned by this unit. */
  ownedSegmentKeys: string[];
  /** Combined verbatim text owned by this unit. */
  ownedText: string;
  /** Prior unit overlap, provided strictly as context-only. */
  contextOverlap?: ContextOverlap;
  /** Estimated tokens of the owned text. */
  estimatedSourceTokens: number;
  /** Timing span across owned segments. */
  timing: SessionTranscriptTiming;
  /** Stable deterministic hash of this unit's input payload across restarts. */
  inputHash: string;
}

export interface UnitPlanningOptions {
  budget: TokenBudgetResult;
  contextOverlapTokens?: number;
  maxSectionRequests?: number;
  transcriptRevision?: number;
}

export interface UnitPlanningResult {
  units: PlannedTranscriptUnit[];
  totalPlannedUnits: number;
  deferredUnitsCount: number;
  hasDeferredUnits: boolean;
  totalSegments: number;
  totalTokens: number;
}

// ── Oversize Segment Splitting ───────────────────────────────────────────────

/**
 * Split an oversize segment text into deterministic code-unit ranges.
 * Ensures UTF-16 surrogate pairs (e.g. emoji, math symbols) are never broken.
 */
export function splitOversizeSegment(
  segment: SessionTranscriptSegment,
  maxSourceTokens: number
): SegmentRangeRef[] {
  const maxChars = Math.max(CHARS_PER_TOKEN, maxSourceTokens * CHARS_PER_TOKEN);
  const text = segment.text;

  if (text.length <= maxChars) {
    return [
      {
        segmentKey: segment.segmentKey,
        startUtf16: 0,
        endUtf16: text.length,
        text,
        timing: segment.timing,
        speakerId: segment.speakerId,
      },
    ];
  }

  const ranges: SegmentRangeRef[] = [];
  let start = 0;

  while (start < text.length) {
    let targetEnd = Math.min(start + maxChars, text.length);

    if (targetEnd < text.length) {
      // Find a sentence or whitespace boundary near targetEnd
      const windowStart = Math.max(start, targetEnd - Math.floor(maxChars * 0.25));
      const slice = text.slice(windowStart, targetEnd);

      const sentenceBreak = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? ")
      );

      if (sentenceBreak !== -1) {
        // Break after the punctuation or newline
        const offset = slice[sentenceBreak] === "\n" ? (slice[sentenceBreak + 1] === "\n" ? 2 : 1) : 2;
        targetEnd = windowStart + sentenceBreak + offset;
      } else {
        const spaceBreak = slice.lastIndexOf(" ");
        if (spaceBreak !== -1) {
          targetEnd = windowStart + spaceBreak + 1;
        }
      }

      // Safeguard against surrogate pair split
      if (
        targetEnd > 0 &&
        targetEnd < text.length &&
        isHighSurrogate(text.charCodeAt(targetEnd - 1)) &&
        isLowSurrogate(text.charCodeAt(targetEnd))
      ) {
        targetEnd += 1; // Keep surrogate pair together
      }
    }

    // Guard against zero-length progress
    if (targetEnd <= start) {
      targetEnd = Math.min(start + maxChars, text.length);
      if (
        targetEnd > 0 &&
        targetEnd < text.length &&
        isHighSurrogate(text.charCodeAt(targetEnd - 1)) &&
        isLowSurrogate(text.charCodeAt(targetEnd))
      ) {
        targetEnd += 1;
      }
    }

    const subText = text.slice(start, targetEnd);
    ranges.push({
      segmentKey: segment.segmentKey,
      startUtf16: start,
      endUtf16: targetEnd,
      text: subText,
      timing: segment.timing,
      speakerId: segment.speakerId,
    });

    start = targetEnd;
  }

  return ranges;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

// ── Deterministic Input Hashing ──────────────────────────────────────────────

/**
 * Synchronous standard SHA-256 implementation (FIPS 180-2).
 * Provides deterministic hashing across all platforms and test runners.
 */
export function sha256Sync(input: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i;
  let result = "";

  const words: number[] = [];

  // Initial hash values: first 32 bits of the fractional parts of the square roots of the first 8 primes
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  // Constants: first 32 bits of the fractional parts of the cube roots of the first 64 primes
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // Convert input to UTF-8 bytes
  const utf8: number[] = [];
  for (let b = 0; b < input.length; b++) {
    let charcode = input.charCodeAt(b);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      b++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (input.charCodeAt(b) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }

  const bitLength = utf8.length * 8;
  utf8.push(0x80);
  while ((utf8.length % 64) !== 56) utf8.push(0);

  for (let w = 0; w < utf8.length; w += 4) {
    words.push(
      (utf8[w] << 24) |
      (utf8[w + 1] << 16) |
      (utf8[w + 2] << 8) |
      utf8[w + 3]
    );
  }

  words.push(Math.floor(bitLength / maxWord));
  words.push(bitLength >>> 0);

  const w = new Array(64);
  for (let chunk = 0; chunk < words.length; chunk += 16) {
    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (i = 0; i < 64; i++) {
      if (i < 16) {
        w[i] = words[chunk + i];
      } else {
        const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }

      const temp1 = (h + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  for (i = 0; i < 8; i++) {
    result += (hash[i] >>> 0).toString(16).padStart(8, "0");
  }

  return result;
}

/**
 * Compute stable deterministic input hash for a transcript unit.
 */
export function hashUnitInput(payload: {
  unitKey: string;
  transcriptRevision?: number;
  ownedRanges: Array<{ segmentKey: string; startUtf16: number; endUtf16: number }>;
  ownedText: string;
  contextText?: string;
}): string {
  const canonical = JSON.stringify({
    unitKey: payload.unitKey,
    rev: payload.transcriptRevision ?? 1,
    ranges: payload.ownedRanges.map((r) => ({
      k: r.segmentKey,
      s: r.startUtf16,
      e: r.endUtf16,
    })),
    text: payload.ownedText,
    context: payload.contextText ?? "",
  });
  return sha256Sync(canonical);
}

// ── Timing Helpers ───────────────────────────────────────────────────────────

function deriveUnitTiming(ranges: SegmentRangeRef[]): SessionTranscriptTiming {
  const timed = ranges
    .map((r) => r.timing)
    .filter(
      (t): t is { kind: "measured" | "imported"; startMs: number; endMs: number } =>
        Boolean(t && t.kind !== "none" && typeof t.startMs === "number" && typeof t.endMs === "number")
    );

  if (timed.length === 0) {
    return { kind: "none" };
  }

  let minStart = Infinity;
  let maxEnd = -Infinity;
  let allImported = true;

  for (const t of timed) {
    if (t.startMs < minStart) minStart = t.startMs;
    if (t.endMs > maxEnd) maxEnd = t.endMs;
    if (t.kind !== "imported") allImported = false;
  }

  return {
    kind: allImported ? "imported" : "measured",
    startMs: minStart,
    endMs: maxEnd,
  };
}

// ── Context Overlap Extraction ───────────────────────────────────────────────

function extractContextOverlap(
  previousUnit: PlannedTranscriptUnit,
  maxOverlapTokens: number
): ContextOverlap | undefined {
  if (maxOverlapTokens <= 0 || previousUnit.ownedRanges.length === 0) {
    return undefined;
  }

  const maxChars = maxOverlapTokens * CHARS_PER_TOKEN;
  const fullText = previousUnit.ownedText;

  if (!fullText.trim()) {
    return undefined;
  }

  let overlapText = fullText;
  let startOffsetInUnit = 0;

  if (fullText.length > maxChars) {
    startOffsetInUnit = fullText.length - maxChars;
    // Align to sentence or word boundary
    const lookahead = fullText.slice(startOffsetInUnit);
    const breakIdx = Math.max(
      lookahead.indexOf("\n\n"),
      lookahead.indexOf(". "),
      lookahead.indexOf("? "),
      lookahead.indexOf("! ")
    );

    if (breakIdx !== -1 && breakIdx < maxChars * 0.5) {
      startOffsetInUnit += breakIdx + 2;
    } else {
      const spaceIdx = lookahead.indexOf(" ");
      if (spaceIdx !== -1 && spaceIdx < maxChars * 0.3) {
        startOffsetInUnit += spaceIdx + 1;
      }
    }

    overlapText = fullText.slice(startOffsetInUnit);
  }

  // Find which segment ranges contributed to the overlap
  const contributingRanges: SegmentRangeRef[] = [];
  const contributingKeys = new Set<string>();

  let cumulativeChars = 0;
  for (const r of previousUnit.ownedRanges) {
    const rangeLen = r.endUtf16 - r.startUtf16;
    const rangeStartInUnit = cumulativeChars;
    const rangeEndInUnit = cumulativeChars + rangeLen;

    if (rangeEndInUnit > startOffsetInUnit) {
      contributingKeys.add(r.segmentKey);
      contributingRanges.push(r);
    }
    cumulativeChars += rangeLen;
  }

  return {
    text: overlapText,
    segmentKeys: Array.from(contributingKeys),
    ranges: contributingRanges,
    estimatedTokens: estimateTokens(overlapText),
  };
}

// ── Transcript Unit Planner ──────────────────────────────────────────────────

/**
 * Plan deterministic transcript analysis units with token budgets and context overlap.
 *
 * Rules:
 *   - Each unit owns <= maxSourceTokens.
 *   - Oversize single segments are deterministically split into ranges with the same segmentKey.
 *   - Previous-unit overlap is <= 128 tokens, attributed strictly as context-only.
 *   - Units beyond maxSectionRequests (default 64) are deferred.
 *   - Timing is truthfully preserved; untimed segments never gain synthetic 0 timestamps.
 */
export function planTranscriptUnits(
  segments: SessionTranscriptSegment[],
  options: UnitPlanningOptions
): UnitPlanningResult {
  const {
    budget,
    contextOverlapTokens = MAX_CONTEXT_OVERLAP_TOKENS,
    maxSectionRequests = DEFAULT_MAX_SECTION_REQUESTS,
    transcriptRevision = 1,
  } = options;

  if (!budget.fits) {
    throw new Error(budget.error || "Cannot plan units: insufficient token budget");
  }

  const maxSourceTokens = budget.maxSourceTokens;

  // 1. Expand segments into atomic ranges (splitting oversize segments)
  const atomicRanges: SegmentRangeRef[] = [];
  for (const seg of segments) {
    if (!seg.text || seg.text.trim().length === 0) continue;
    const splitRanges = splitOversizeSegment(seg, maxSourceTokens);
    atomicRanges.push(...splitRanges);
  }

  if (atomicRanges.length === 0) {
    return {
      units: [],
      totalPlannedUnits: 0,
      deferredUnitsCount: 0,
      hasDeferredUnits: false,
      totalSegments: segments.length,
      totalTokens: 0,
    };
  }

  // 2. Pack atomic ranges into units
  const plannedUnits: PlannedTranscriptUnit[] = [];
  let currentRanges: SegmentRangeRef[] = [];
  let currentTokens = 0;
  let totalAllTokens = 0;
  let unitIndex = 0;

  function finalizeUnit() {
    if (currentRanges.length === 0) return;

    const unitKey = `unit-${unitIndex}`;
    const ownedText = currentRanges.map((r) => r.text).join("");
    const ownedSegmentKeys = Array.from(new Set(currentRanges.map((r) => r.segmentKey)));
    const timing = deriveUnitTiming(currentRanges);

    let contextOverlap: ContextOverlap | undefined = undefined;
    if (plannedUnits.length > 0) {
      contextOverlap = extractContextOverlap(
        plannedUnits[plannedUnits.length - 1],
        contextOverlapTokens
      );
    }

    const inputHash = hashUnitInput({
      unitKey,
      transcriptRevision,
      ownedRanges: currentRanges,
      ownedText,
      contextText: contextOverlap?.text,
    });

    plannedUnits.push({
      unitIndex,
      unitKey,
      ownedRanges: [...currentRanges],
      ownedSegmentKeys,
      ownedText,
      contextOverlap,
      estimatedSourceTokens: currentTokens,
      timing,
      inputHash,
    });

    unitIndex++;
    currentRanges = [];
    currentTokens = 0;
  }

  for (const range of atomicRanges) {
    const rangeTokens = estimateTokens(range.text);
    totalAllTokens += rangeTokens;

    // Check if adding this range exceeds maxSourceTokens
    if (currentRanges.length > 0 && currentTokens + rangeTokens > maxSourceTokens) {
      finalizeUnit();
    }

    currentRanges.push(range);
    currentTokens += rangeTokens;
  }

  // Finalize last unit
  if (currentRanges.length > 0) {
    finalizeUnit();
  }

  const totalPlannedUnits = plannedUnits.length;
  const deferredUnitsCount = Math.max(0, totalPlannedUnits - maxSectionRequests);
  const activeUnits = plannedUnits.slice(0, maxSectionRequests);

  return {
    units: activeUnits,
    totalPlannedUnits,
    deferredUnitsCount,
    hasDeferredUnits: deferredUnitsCount > 0,
    totalSegments: segments.length,
    totalTokens: totalAllTokens,
  };
}

// ── Summary Tree Hierarchy ───────────────────────────────────────────────────

export interface SummaryTreeNode {
  nodeKey: string;
  level: number;
  inputUnitKeys: string[];
  isFinal: boolean;
  estimatedTokens: number;
}

export interface SummaryTreePlan {
  levels: SummaryTreeNode[][];
  totalCalls: number;
  fitsBudget: boolean;
  error?: string;
}

/**
 * Plan hierarchical overview summary tree according to D8:
 *   - Groups <= 8 section summaries (<= 300 tokens each) per overview node.
 *   - Recursively groups intermediate summaries until a single final overview fits.
 *   - Default cap: maximum 16 overview requests.
 */
export function planSummaryTree(
  sectionUnitKeys: string[],
  options: {
    maxGroupSize?: number;
    maxOverviewRequests?: number;
    tokensPerSummary?: number;
  } = {}
): SummaryTreePlan {
  const {
    maxGroupSize = MAX_SUMMARY_GROUP_SIZE,
    maxOverviewRequests = DEFAULT_MAX_OVERVIEW_REQUESTS,
    tokensPerSummary = MAX_SUMMARY_TOKEN_BUDGET,
  } = options;

  if (sectionUnitKeys.length === 0) {
    return {
      levels: [],
      totalCalls: 0,
      fitsBudget: true,
    };
  }

  const levels: SummaryTreeNode[][] = [];
  let currentKeys = [...sectionUnitKeys];
  let level = 0;
  let totalCalls = 0;

  // If there's only 1 section, 1 overview call merges / finalizes it
  if (currentKeys.length === 1) {
    const singleNode: SummaryTreeNode = {
      nodeKey: `overview-L0-0`,
      level: 0,
      inputUnitKeys: currentKeys,
      isFinal: true,
      estimatedTokens: tokensPerSummary,
    };
    return {
      levels: [[singleNode]],
      totalCalls: 1,
      fitsBudget: true,
    };
  }

  while (currentKeys.length > 1) {
    const currentLevelNodes: SummaryTreeNode[] = [];
    const isNextLevelFinal = currentKeys.length <= maxGroupSize;

    for (let i = 0; i < currentKeys.length; i += maxGroupSize) {
      const group = currentKeys.slice(i, i + maxGroupSize);
      const nodeIndex = currentLevelNodes.length;
      const nodeKey = `overview-L${level}-${nodeIndex}`;

      currentLevelNodes.push({
        nodeKey,
        level,
        inputUnitKeys: group,
        isFinal: isNextLevelFinal && currentLevelNodes.length === 0 && currentKeys.length <= maxGroupSize,
        estimatedTokens: group.length * tokensPerSummary,
      });
      totalCalls++;
    }

    levels.push(currentLevelNodes);

    if (currentLevelNodes.length === 1) {
      currentLevelNodes[0].isFinal = true;
      break;
    }

    currentKeys = currentLevelNodes.map((n) => n.nodeKey);
    level++;
  }

  const fitsBudget = totalCalls <= maxOverviewRequests;

  return {
    levels,
    totalCalls,
    fitsBudget,
    error: fitsBudget
      ? undefined
      : `Summary tree requires ${totalCalls} overview calls, exceeding maximum budget (${maxOverviewRequests})`,
  };
}
