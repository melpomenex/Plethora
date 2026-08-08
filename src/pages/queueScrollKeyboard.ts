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

export type ScrollItemType = "document" | "rss" | "flashcard" | "extract" | "podcast";

/** Window event the scroll page dispatches to reveal the current flashcard's
 *  answer when focus is outside the card (the card listens and reveals). */
export const FLASHCARD_REVEAL_EVENT = "incrementum:flashcard-reveal-request";

export interface ScrollRatingKeyContext {
  /** Current item type (undefined when nothing is showing). */
  itemType: ScrollItemType | undefined;
  /** Whether the current flashcard's answer is revealed (ignored for non-flashcards). */
  flashcardRevealed: boolean;
  /** True while a rating is in flight (the rating buttons are disabled then too). */
  isRating: boolean;
}

export type ScrollRatingKeyAction =
  | { kind: "reveal-flashcard" }
  | { kind: "rate"; rating: number };

/**
 * Decide what the Scroll Mode keydown handler should do for Space and the
 * 1-4 rating keys. Returns null when the key is not a rating/reveal key or
 * should be ignored.
 *
 * - Space reveals the current flashcard's answer (only while unrevealed).
 * - 1-4 rate the current item (1=Again, 2=Hard, 3=Good, 4=Easy) — the same
 *   action as the rating buttons. Flashcards keep their "reveal the answer
 *   first" rule (same as the review session and the card's own buttons,
 *   which only appear after the answer is revealed).
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

  if (key >= "1" && key <= "4") {
    if (!ctx.itemType || ctx.isRating) return null;
    const flashcardRevealed = ctx.itemType !== "flashcard" || ctx.flashcardRevealed;
    if (!flashcardRevealed) return null;
    return { kind: "rate", rating: parseInt(key, 10) };
  }

  return null;
}
