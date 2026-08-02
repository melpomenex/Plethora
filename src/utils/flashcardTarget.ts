/**
 * Resolves how many flashcards a generation request should target, based on
 * the user's AI settings (fixed count, or auto/density-based scaling with
 * the size of the selected content) and an optional session-local override.
 */

import type { AIControlsSettings } from "../stores/settingsStore";

/** Approximate words of source content per generated card in "auto" mode. Tunable. */
const WORDS_PER_CARD = 120;

export interface FlashcardTargetOverride {
  mode?: "fixed" | "auto";
  fixedCount?: number;
  autoMin?: number;
  autoMax?: number;
}

export interface ResolvedFlashcardTarget {
  mode: "fixed" | "auto";
  count: number;
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return min;
  return Math.min(Math.max(value, min), max);
}

function countWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Resolve the effective flashcard generation target.
 *
 * `content` is either the raw text to be summarized into cards (word count is
 * derived from it) or a precomputed word count, used only in "auto" mode.
 */
export function resolveFlashcardTarget(
  settings: Pick<AIControlsSettings, "flashcardCountMode" | "flashcardFixedCount" | "flashcardAutoMin" | "flashcardAutoMax">,
  content: string | number = 0,
  override?: FlashcardTargetOverride,
): ResolvedFlashcardTarget {
  const mode = override?.mode ?? settings.flashcardCountMode;

  if (mode === "fixed") {
    const fixedCount = override?.fixedCount ?? settings.flashcardFixedCount;
    return { mode: "fixed", count: Math.max(1, Math.round(fixedCount)) };
  }

  const autoMin = override?.autoMin ?? settings.flashcardAutoMin;
  const autoMax = override?.autoMax ?? settings.flashcardAutoMax;
  const wordCount = typeof content === "number" ? content : countWords(content);
  const estimate = Math.round(wordCount / WORDS_PER_CARD);
  return { mode: "auto", count: clamp(estimate, Math.max(1, autoMin), Math.max(autoMin, autoMax)) };
}
