/**
 * Anki bulk-import hot path — `convertAnkiDeckToDocuments` +
 * `convertAnkiCardsToLearningItems` process a whole deck into documents and
 * learning items (see src/utils/ankiImport.ts). User-visible on large decks.
 *
 * Determinism: the synthetic ~2000-note deck is built once from `seededRandom`;
 * every iteration converts the identical deck.
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import {
  convertAnkiCardsToLearningItems,
  convertAnkiDeckToDocuments,
  type AnkiDeck,
  type AnkiField,
} from "./ankiImport";

const rng = seededRandom(0x9a1c);

const WORDS = ["card", "question", "answer", "note", "deck", "import", "review", "tag"];

function field(name: string): AnkiField {
  const n = 8 + Math.floor(rng() * 20);
  const words: string[] = [];
  for (let i = 0; i < n; i += 1) words.push(WORDS[Math.floor(rng() * WORDS.length)]);
  return { name, value: words.join(" ") };
}

const NOTE_COUNT = 2000;
const deck: AnkiDeck = {
  id: 1,
  name: "Synthetic Deck",
  notes: Array.from({ length: NOTE_COUNT }, (_, i) => ({
    id: i,
    guid: `guid-${i}-${Math.floor(rng() * 1_000_000)}`,
    mid: 100,
    modelName: "Basic",
    tags: [WORDS[Math.floor(rng() * WORDS.length)], "anki-import"],
    fields: [field("Front"), field("Back"), field("Extra")],
    timestamp: Math.floor(rng() * 2_000_000_000),
  })),
  cards: Array.from({ length: NOTE_COUNT }, (_, i) => ({
    id: i,
    noteId: i,
    ord: 0,
    interval: Math.floor(rng() * 200),
    ease: 2.5,
    due: Math.floor(rng() * 2000),
  })),
};

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the conversion).
let sink = 0;

bench("ankiImport/convert-2000-notes", async () => {
  const docs = await convertAnkiDeckToDocuments(deck);
  const items = await convertAnkiCardsToLearningItems(deck, "doc-1");
  sink ^= docs.length + items.length;
});
