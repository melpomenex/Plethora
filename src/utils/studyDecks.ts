import type { StudyDeck } from "../types/study-decks";

const normalize = (value: string) => value.trim().toLowerCase();

export function normalizeTagList(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = normalize(trimmed);
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }
  return Array.from(seen.values());
}

function tagMatchesFilter(tag: string, filter: string): boolean {
  const normTag = normalize(tag);
  const normFilter = normalize(filter);
  
  const cleanTag = normTag.startsWith("deck:") ? normTag.slice(5) : normTag;
  const cleanFilter = normFilter.startsWith("deck:") ? normFilter.slice(5) : normFilter;
  
  return cleanTag === cleanFilter || 
         cleanTag.startsWith(cleanFilter + "::") ||
         cleanTag.startsWith(cleanFilter + "/");
}

export function matchesDeckTags(tags: string[], deck: StudyDeck | null): boolean {
  if (!deck) return true;
  if (!tags || tags.length === 0) return false;
  if (!deck.tagFilters || deck.tagFilters.length === 0) return false;

  for (const filter of deck.tagFilters) {
    if (tags.some((tag) => tagMatchesFilter(tag, filter))) {
      return true;
    }
  }
  return false;
}

/**
 * Tags that describe how a card was created rather than which deck it lives in.
 * These survive any deck move, even when they happen to also be a deck's tag
 * filter — e.g. a card moved out of the `Browser Extension` deck keeps
 * `browser-extension` so `tag:browser-extension` remains a durable query.
 */
const PROVENANCE_TAGS = new Set(
  ["browser-extension", "image-occlusion", "ai-generated", "manual"].map(normalize),
);

/**
 * Returns the tag set a card should carry after being moved into `targetDeck`.
 *
 * Drops only tags that act as filters for decks the card *currently* matches,
 * adds the target deck's tag filters, and preserves everything else —
 * provenance tags, unrelated user tags, and tags belonging to decks the card
 * does not match. Provenance tags are protected even if they coincide with a
 * matched deck's filter (see PROVENANCE_TAGS).
 *
 * Tag comparison reuses the existing `normalize` / `tagMatchesFilter`
 * semantics so a move and a deck-membership check can never disagree.
 */
export function swapDeckTags(
  cardTags: string[],
  decks: StudyDeck[],
  targetDeck: StudyDeck,
): string[] {
  const currentDecks = decks.filter((deck) => deck.id !== targetDeck.id);

  const isDroppable = (tag: string): boolean => {
    if (PROVENANCE_TAGS.has(normalize(tag))) return false;
    return currentDecks.some((deck) => {
      if (!matchesDeckTags(cardTags, deck)) return false;
      return (deck.tagFilters ?? []).some((filter) => tagMatchesFilter(tag, filter));
    });
  };

  const kept = cardTags.filter((tag) => !isDroppable(tag));

  return normalizeTagList([...kept, ...(targetDeck.tagFilters ?? [])]);
}

export function matchesDeck<
  T extends {
    tags: string[];
    document_id?: string;
    documentId?: string;
    difficulty?: number;
    state?: string;
  }
>(item: T, deck: StudyDeck | null): boolean {
  if (!deck) return true;

  const itemDocId = item.document_id || item.documentId;

  // 1. If deck is document-bound, filter by document
  if (deck.documentId) {
    if (!itemDocId || deck.documentId !== itemDocId) {
      return false;
    }
  }

  // 2. Filter by smart deck type
  const filterType = deck.filterType || (deck.tagFilters && deck.tagFilters.length > 0 ? "tags" : "all");

  if (filterType === "cram") {
    const itemDueDate = (item as any).due_date || (item as any).dueDate;
    const isDue = itemDueDate ? new Date(itemDueDate).getTime() <= Date.now() : true;
    const itemState = item.state ? item.state.toLowerCase() : "";
    const isNewOrLearning = itemState === "new" || itemState === "learning" || itemState === "relearning";
    const lapses = (item as any).lapses || 0;
    
    if (!isDue && !isNewOrLearning && lapses === 0) {
      return false;
    }
  } else if (filterType === "difficulty") {
    if (deck.difficultyFilters && deck.difficultyFilters.length > 0) {
      if (item.difficulty === undefined || !deck.difficultyFilters.includes(item.difficulty)) {
        return false;
      }
    }
  } else if (filterType === "tags") {
    return matchesDeckTags(item.tags, deck);
  }

  // If filterType is "all", it belongs to the document (checked above) and has no tag restriction
  return true;
}

export function filterByDeck<
  T extends {
    tags: string[];
    document_id?: string;
    documentId?: string;
    difficulty?: number;
    state?: string;
  }
>(items: T[], deck: StudyDeck | null): T[] {
  if (!deck) return items;
  return items.filter((item) => matchesDeck(item, deck));
}

export function filterByDecks<
  T extends {
    tags: string[];
    document_id?: string;
    documentId?: string;
    difficulty?: number;
    state?: string;
  }
>(items: T[], decks: StudyDeck[]): T[] {
  if (decks.length === 0) return items;
  return items.filter((item) => decks.some((deck) => matchesDeck(item, deck)));
}

export function getDeckTagCandidates(tags: string[]): string[] {
  return tags
    .filter((tag) => tag && tag.trim().length > 0)
    .filter((tag) => normalize(tag) !== "anki-import")
    .map((tag) => tag.trim());
}

/** Tag attached to every card imported via the browser extension. */
export const BROWSER_EXTENSION_TAG = "browser-extension";

/**
 * Whether the auto-maintained "Browser Extension" deck should be created for
 * the given cards and decks: true when at least one card carries the
 * `browser-extension` tag and no existing deck already filters on that tag.
 *
 * Detection is by tag filter, not by deck name, so a renamed deck is not
 * duplicated.
 */
export function shouldEnsureBrowserExtensionDeck<
  T extends { tags?: string[] | null },
  D extends { tagFilters?: string[] | null },
>(cards: T[], decks: D[]): boolean {
  const hasExtensionCard = cards.some((c) =>
    (c.tags ?? []).some((tag) => normalize(tag) === BROWSER_EXTENSION_TAG),
  );
  if (!hasExtensionCard) return false;
  return !decks.some((d) =>
    (d.tagFilters ?? []).some((filter) => normalize(filter) === BROWSER_EXTENSION_TAG),
  );
}

export interface DeckStatEntry {
  deck: StudyDeck;
  /** Total cards matching the deck's filters, regardless of due status. */
  total: number;
  /** Cards matching the deck whose due date is today or earlier (or unset). */
  due: number;
  newCount: number;
  learningCount: number;
  reviewCount: number;
}

/**
 * Computes total/due/state-breakdown counts per deck from a single item set.
 * Shared by ReviewHome and ReviewDecksModal so the two surfaces can never
 * disagree on a deck's numbers.
 */
export function computeDeckStats<
  T extends {
    tags: string[];
    document_id?: string;
    documentId?: string;
    difficulty?: number;
    state?: string;
    due_date?: string;
    dueDate?: string;
  }
>(decks: StudyDeck[], items: T[]): DeckStatEntry[] {
  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return decks.map((deck) => {
    const matched = items.filter((item) => matchesDeck(item, deck));
    let due = 0;
    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;

    for (const item of matched) {
      const state = item.state ? item.state.toLowerCase() : "";
      if (state === "new") newCount += 1;
      else if (state === "learning" || state === "relearning") learningCount += 1;
      else if (state === "review") reviewCount += 1;

      const dueRaw = item.due_date || item.dueDate;
      if (!dueRaw) {
        due += 1;
        continue;
      }
      const parsed = new Date(dueRaw);
      if (Number.isNaN(parsed.getTime())) {
        due += 1;
        continue;
      }
      const dueOnly = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      if (dueOnly <= todayOnly) due += 1;
    }

    return { deck, total: matched.length, due, newCount, learningCount, reviewCount };
  });
}
