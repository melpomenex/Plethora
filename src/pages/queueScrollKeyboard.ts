/**
 * Pure decision logic for the Scroll Mode keydown handler (Space to reveal a
 * flashcard's answer, 1-4 to rate the current item), extracted so the
 * shortcut rules are unit-testable without mounting the ~4000-line
 * QueueScrollPage component — same reasoning as queueScrollBudget.ts.
 *
 * The per-item components' own 1-4 handlers only fire when keyboard focus is
 * inside the card (FlashcardScrollItem's container guard) or when their own
 * gates pass, and EPUB/PDF iframes swallow keys entirely — which is why Scroll
 * Mode handles Space and the number keys at the page level instead.
 */

import { getRatingSchema } from "../lib/supermemo-grades";

export type ScrollItemType = "document" | "rss" | "flashcard" | "extract" | "podcast";

/** Window event the scroll page dispatches to reveal the current flashcard's
 *  answer when focus is outside the card (the card listens and reveals). */
export const FLASHCARD_REVEAL_EVENT = "incrementum:flashcard-reveal-request";

/**
 * Whether the number keys should submit native 0-5 grades for the current
 * item. ONLY flashcards follow the flashcard scheduler's rating schema
 * (SM-18/SM-20 → six grades); documents, extracts, RSS, and podcasts are
 * scheduled by four-grade schedulers (e.g. the FSRS-6 engagement scheduler
 * for documents) regardless of the flashcard algorithm, so they keep plain
 * 1-4 rating keys matching their on-screen buttons.
 */
export function usesNativeGradeKeys(
  itemType: ScrollItemType | undefined,
  algorithm: Parameters<typeof getRatingSchema>[0],
): boolean {
  return itemType === "flashcard" && getRatingSchema(algorithm).type === "supermemo";
}

export interface ScrollRatingKeyContext {
  /** Current item type (undefined when nothing is showing). */
  itemType: ScrollItemType | undefined;
  /** Whether the current flashcard's answer is revealed (ignored for non-flashcards). */
  flashcardRevealed: boolean;
  /** True while a rating is in flight (the rating buttons are disabled then too). */
  isRating: boolean;
  /** True when the active scheduler grades natively on the SuperMemo 0-5
   *  scale (SM-18/SM-20) — keys 0-5 then submit grades; otherwise 1-4
   *  submit ratings as before. */
  nativeGrades?: boolean;
}

export type ScrollRatingKeyAction =
  | { kind: "reveal-flashcard" }
  | { kind: "rate"; rating: number; grade?: number };

/**
 * Decide what the Scroll Mode keydown handler should do for Space and the
 * rating keys. Returns null when the key is not a rating/reveal key or
 * should be ignored.
 *
 * - Space reveals the current flashcard's answer (only while unrevealed).
 * - Under a SuperMemo six-grade schema (`nativeGrades`), 0-5 submit the
 *   native grade (with its equivalent 4-button rating) — mirroring the
 *   review session's keyboard mapping.
 * - Otherwise 1-4 rate the current item (1=Again, 2=Hard, 3=Good, 4=Easy) —
 *   the same action as the rating buttons. Flashcards keep their "reveal the
 *   answer first" rule (same as the review session and the card's own
 *   buttons, which only appear after the answer is revealed).
 * - Nothing while a rating is in flight, or when nothing is showing.
 */
export function resolveScrollRatingKey(
  key: string,
  ctx: ScrollRatingKeyContext
): ScrollRatingKeyAction | null {
  if (key === " ") {
    if (ctx.itemType === "flashcard" && !ctx.flashcardRevealed) {
      return { kind: "reveal-flashcard" };
    }
    return null;
  }

  const isRatingKey = ctx.nativeGrades
    ? key >= "0" && key <= "5"
    : key >= "1" && key <= "4";
  if (isRatingKey) {
    if (!ctx.itemType || ctx.isRating) return null;
    const flashcardRevealed = ctx.itemType !== "flashcard" || ctx.flashcardRevealed;
    if (!flashcardRevealed) return null;
    if (ctx.nativeGrades) {
      const grade = parseInt(key, 10);
      // Same grade→rating equivalence as the review session (0/1/2→1, 3→2,
      // 4→3, 5→4).
      const rating = grade < 3 ? 1 : grade - 1;
      return { kind: "rate", rating, grade };
    }
    return { kind: "rate", rating: parseInt(key, 10) };
  }

  return null;
}
