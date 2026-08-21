/**
 * Deterministic Command Palette Intent Classifier
 * Categorizes user inputs with 0ms latency into Navigation, Direct Lookup, Product Help, or Document Content.
 */

import type { UserHelpIntent, HelpAppContext, DirectLookupResult } from "./helpTypes";
import { defaultHelpRetrieval } from "./helpRetrieval";
import { findMatchingSections } from "../../components/search/sectionRegistry";

const HELP_QUESTION_PATTERNS = [
  /^(how\s+(do\s+i|to|can\s+i|should\s+i)|what\s+(is|are|does)|where\s+(is|are|can\s+i\s+find)|why\s+(is|did|does|am\s+i|do)|when\s+(does|should)|can\s+plethora|does\s+plethora|explain\b|tell\s+me\s+about\b)/i,
  /\?$/,
  /^(troubleshoot|fix|error|issue|problem\s+with)\b/i,
];

/**
 * Checks whether query matches natural language product help inquiry patterns.
 */
export function isHelpQuestionPattern(query: string): boolean {
  const q = query.trim();
  if (q.length < 3) return false;
  return HELP_QUESTION_PATTERNS.some((pattern) => pattern.test(q));
}

/**
 * Deterministically classifies Command Palette input with zero remote AI latency.
 */
export function classifyPaletteInput(
  rawInput: string,
  context: Partial<HelpAppContext> = {}
): UserHelpIntent {
  const query = rawInput.trim();
  if (!query) {
    return { kind: "document_content", query: "" };
  }

  // 1. Explicit Prefix forcing Product Help (? or /help or help:)
  if (
    query.startsWith("?") ||
    query.toLowerCase().startsWith("/help ") ||
    query.toLowerCase().startsWith("help:") ||
    query.toLowerCase().startsWith("help ")
  ) {
    const cleanQuery = query
      .replace(/^(\?|\/help\s+|help:\s*|help\s+)/i, "")
      .trim();

    return {
      kind: "product_help",
      query: cleanQuery || query,
      forcedPrefix: true,
    };
  }

  // 2. High-confidence App Section Navigation ("Dashboard", "Queue", "Settings", etc.)
  const sectionMatches = findMatchingSections(query);
  if (sectionMatches.length > 0 && sectionMatches[0].score >= 0.95) {
    const top = sectionMatches[0];
    return {
      kind: "navigation",
      actionId: `section-${top.section.id}`,
      targetPath: top.section.path,
      label: top.section.label,
    };
  }

  // 3. Exact or High-Confidence Canonical Feature Alias / Title Lookup ("e-ink mode", "tts speed", "sm-18")
  const directMatch = defaultHelpRetrieval.resolveDirectLookup(query);
  if (directMatch && directMatch.confidence >= 0.92) {
    return {
      kind: "direct_lookup",
      directResult: directMatch,
    };
  }

  // 4. Natural Language Help Question Heuristics ("how do i enable pdf reflow?", "why did queue item return?")
  if (isHelpQuestionPattern(query)) {
    return {
      kind: "product_help",
      query,
      forcedPrefix: false,
    };
  }

  // 5. Default: Standard Command / Document Content Search
  return {
    kind: "document_content",
    query,
  };
}
