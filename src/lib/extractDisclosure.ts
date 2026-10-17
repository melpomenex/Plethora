/**
 * Progressive disclosure display resolution for extract cards.
 *
 * Kept pure (no React, no i18n, no store) so the stage rules can be tested
 * directly. The Queue extract card is the only consumer: it turns the result
 * into badges and editors.
 *
 * Rules (see openspec/changes/extract-progressive-summary-opt-in/design.md):
 *  - Disclosure inactive (global setting off, or max level <= 0) -> full text.
 *  - The AI summary phase covers the first `ceil(max/2)` stages.
 *  - The final stage is always the full extract, so `max/max` is never a
 *    partially revealed text.
 *  - Remaining intermediate stages reveal a fraction of the text.
 */

export interface ExtractSummaryEntry {
  level: number;
  summary: string;
  word_count: number;
}

export type ExtractDisplayKind = "full" | "summary" | "partial" | "loading" | "error";

export interface ExtractDisplayInput {
  content: string;
  /** Extract's configured `max_disclosure_level`. */
  maxLevel: number;
  /** Extract's stored `progressive_disclosure_level`. */
  currentLevel: number;
  /** Cached progressive summaries, if any. */
  summaries: ExtractSummaryEntry[];
  /** Global opt-in: "Generate AI summaries for extracts during review". */
  summariesEnabled: boolean;
  isGenerating: boolean;
  hasError: boolean;
  /**
   * True once the generation attempt completed (successfully or not). Distinguishes
   * "still waiting for the first summaries" from "the provider returned none",
   * which must fall back to full text instead of spinning forever.
   */
  generationFinished?: boolean;
}

export interface ExtractDisplay {
  kind: ExtractDisplayKind;
  text: string;
  /**
   * One-based stage for the level badges, or null when disclosure is inactive
   * (setting off / maxLevel <= 0). Both the header indicator and the content
   * badge must use this value so the same state is never shown as two levels.
   */
  stage: number | null;
  /** Fraction of the text revealed when `kind === "partial"`, else null. */
  fraction: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Truncate at a word boundary near `fraction` of the content. */
function revealText(content: string, fraction: number): string {
  if (fraction >= 1) return content;
  const charCount = Math.max(0, Math.floor(content.length * fraction));
  let cutoff = charCount;
  if (cutoff < content.length) {
    const nextSpace = content.indexOf(" ", cutoff);
    if (nextSpace !== -1 && nextSpace < cutoff + 50) {
      cutoff = nextSpace;
    }
  }
  return content.slice(0, cutoff) + "...";
}

export function resolveExtractDisplay(input: ExtractDisplayInput): ExtractDisplay {
  const { content, maxLevel, currentLevel, summaries, summariesEnabled } = input;

  // Disclosure inactive: no summarization, no levels, full editable text.
  if (!summariesEnabled || maxLevel <= 0) {
    return { kind: "full", text: content, stage: null, fraction: null };
  }

  // Past the last stage: fully revealed.
  if (currentLevel >= maxLevel) {
    return { kind: "full", text: content, stage: maxLevel, fraction: null };
  }

  const stageIndex = clamp(currentLevel, 0, maxLevel - 1);
  const summaryStageCount = Math.ceil(maxLevel / 2);

  if (stageIndex < summaryStageCount) {
    const stage = stageIndex + 1;
    if (summaries.length > 0) {
      const entry = summaries[Math.min(stageIndex, summaries.length - 1)]!;
      return { kind: "summary", text: entry.summary, stage, fraction: null };
    }
    if (input.hasError) {
      return { kind: "error", text: content, stage, fraction: null };
    }
    if (input.generationFinished) {
      // Nothing was returned: show the extract rather than an endless spinner.
      return { kind: "full", text: content, stage: null, fraction: null };
    }
    // First paint before the generation effect runs, or summaries were cleared.
    return { kind: "loading", text: "", stage, fraction: null };
  }

  // Final stage is the full extract — `max/max` must never read as partial.
  if (stageIndex === maxLevel - 1) {
    return { kind: "full", text: content, stage: maxLevel, fraction: null };
  }

  const partialSpan = maxLevel - summaryStageCount;
  const fraction = (stageIndex - summaryStageCount + 1) / partialSpan;
  return {
    kind: "partial",
    text: revealText(content, fraction),
    stage: stageIndex + 1,
    fraction,
  };
}
