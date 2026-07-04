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

export function matchesDeckTags(tags: string[], deck: StudyDeck | null): boolean {
  if (!deck) return true;
  if (!tags || tags.length === 0) return false;
  if (!deck.tagFilters || deck.tagFilters.length === 0) return false;

  const tagSet = new Set(tags.map((tag) => normalize(tag)));
  for (const filter of deck.tagFilters) {
    if (tagSet.has(normalize(filter))) {
      return true;
    }
  }
  return false;
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
