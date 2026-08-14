/**
 * Parse line-oriented flashcard output from a small on-device model.
 *
 * Nano-class models emit malformed JSON often enough that a tolerant line
 * parser beats `JSON.parse` plus repair, so the on-device prompt asks for:
 *
 *   Q: What pumps blood?
 *   A: The heart.
 *   CLOZE: The {{c1::heart}} pumps blood.
 *
 * Anything that cannot be classified is discarded rather than emitted as a
 * malformed card. A `Q:` with no following `A:` is dropped — a question with no
 * answer is not a card.
 */

import type { GeneratedFlashcard } from "../../api/ai";

/**
 * Matches `Q:` / `Question:`, tolerating a leading list marker and the bold
 * markers models like to wrap the label in (`**Question:** …`).
 */
const Q_LINE = /^[-*\d.)\s]*\**\s*(?:q|question)\s*\**\s*[:.]\s*\**\s*(.+)$/i;
/** Matches `A:`, `Answer:`, same leniency. */
const A_LINE = /^[-*\d.)\s]*\**\s*(?:a|answer)\s*\**\s*[:.]\s*\**\s*(.+)$/i;
/** Matches `CLOZE:`. */
const CLOZE_LINE = /^[-*\d.)\s]*\**\s*cloze\s*\**\s*[:.]\s*\**\s*(.+)$/i;

/** First `{{c1::deleted text}}` (or `[[c1::…]]`) payload, hint stripped. */
const CLOZE_DELETION = /\{\{c\d+::(.+?)(?:::.*?)?\}\}|\[\[c\d+::(.+?)(?:::.*?)?\]\]/;

/**
 * Parse a model completion into cards.
 *
 * @param completion raw model output
 * @param tags tags applied to every card produced (usually the extract's)
 * @returns cards in the order they appeared; `[]` when nothing was parsable
 */
export function parseGeneratedFlashcards(
  completion: string,
  tags: string[] = []
): GeneratedFlashcard[] {
  const cards: GeneratedFlashcard[] = [];
  let pendingQuestion: string | null = null;

  for (const rawLine of completion.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cloze = CLOZE_LINE.exec(line);
    if (cloze) {
      // A cloze line ends any dangling question: the model moved on.
      pendingQuestion = null;
      const text = cloze[1].trim();
      if (text) {
        cards.push({
          question: text,
          answer: clozeDeletion(text),
          card_type: "cloze",
          tags: [...tags],
        });
      }
      continue;
    }

    const question = Q_LINE.exec(line);
    if (question) {
      // A second `Q:` before any `A:` means the first one had no answer.
      pendingQuestion = question[1].trim() || null;
      continue;
    }

    const answer = A_LINE.exec(line);
    if (answer && pendingQuestion) {
      const text = answer[1].trim();
      if (text) {
        cards.push({
          question: pendingQuestion,
          answer: text,
          card_type: "qa",
          tags: [...tags],
        });
      }
      pendingQuestion = null;
      continue;
    }

    // Unclassifiable: prose, a preamble, a stray heading. Dropped.
  }

  return cards;
}

/**
 * Text inside the first cloze deletion, so the card has a reviewable answer
 * even where cloze rendering is not wired up. Empty when the model emitted a
 * `CLOZE:` line with no deletion markers.
 */
function clozeDeletion(text: string): string {
  const match = CLOZE_DELETION.exec(text);
  return (match?.[1] ?? match?.[2] ?? "").trim();
}
