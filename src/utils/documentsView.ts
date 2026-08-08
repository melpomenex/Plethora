import type { Document } from "../types/document";

export type DocumentViewMode = "grid" | "list";
export type DocumentSortKey = "priority" | "lastTouched" | "added" | "title" | "type" | "extracts" | "cards";
export type DocumentSortDirection = "asc" | "desc";

export interface DocumentSearchTokens {
  text: string;
  tags: string[];
  sources: string[];
  queue?: "in" | "out";
  extracts?: { op: "<" | ">" | "="; value: number };
}

const DEFAULT_TOKENS: DocumentSearchTokens = {
  text: "",
  tags: [],
  sources: [],
};

export function parseDocumentSearch(query: string): DocumentSearchTokens {
  const tokens: DocumentSearchTokens = {
    text: "",
    tags: [],
    sources: [],
  };
  if (!query.trim()) {
    return { ...DEFAULT_TOKENS };
  }

  const parts = query.trim().split(/\s+/);
  const textParts: string[] = [];

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower.startsWith("tag:")) {
      const value = part.slice(4).trim();
      if (value) tokens.tags.push(value);
      continue;
    }
    if (lower.startsWith("source:")) {
      const value = part.slice(7).trim();
      if (value) tokens.sources.push(value);
      continue;
    }
    if (lower.startsWith("queue:")) {
      const value = part.slice(6).trim().toLowerCase();
      if (value === "in" || value === "out") tokens.queue = value;
      else textParts.push(part);
      continue;
    }
    if (lower.startsWith("extracts")) {
      const match = lower.match(/^extracts([<>=])(\d+)$/);
      if (match) {
        tokens.extracts = { op: match[1] as "<" | ">" | "=", value: Number(match[2]) };
        continue;
      }
      const alt = lower.match(/^extracts:([<>=]?)(\d+)$/);
      if (alt) {
        const op = (alt[1] || "=") as "<" | ">" | "=";
        tokens.extracts = { op, value: Number(alt[2]) };
        continue;
      }
    }

    textParts.push(part);
  }

  tokens.text = textParts.join(" ").trim();
  return tokens;
}

/**
 * Whether every `tag:` token is satisfied by `tags` (AND across tokens).
 *
 * A token matches any tag that *contains* it, so `tag:occlusion` finds
 * `image-occlusion` — searching for a tag you half-remember is the common case,
 * and an exact-match-only filter silently returns nothing instead of a hint.
 * Both `tags` and `tokens` are expected lowercased by the caller.
 */
function matchesTagTokens(tags: string[], tokens: string[]): boolean {
  return tokens.every((token) => tags.some((tag) => tag.includes(token)));
}

export function matchesDocumentSearch(doc: Document, tokens: DocumentSearchTokens): boolean {  if (!tokens.text && tokens.tags.length === 0 && tokens.sources.length === 0 && !tokens.queue && !tokens.extracts) {
    return true;
  }

  const title = doc.title.toLowerCase();
  const tags = doc.tags.map((tag) => tag.toLowerCase());
  const category = doc.category?.toLowerCase() ?? "";
  const textHaystack = [title, category, ...tags].join(" ");

  if (tokens.text) {
    const text = tokens.text.toLowerCase();
    if (!textHaystack.includes(text)) {
      return false;
    }
  }

  if (tokens.tags.length > 0) {
    const required = tokens.tags.map((tag) => tag.toLowerCase());
    if (!matchesTagTokens(tags, required)) {
      return false;
    }
  }

  if (tokens.sources.length > 0) {
    const sources = tokens.sources.map((source) => source.toLowerCase());
    if (!sources.includes(doc.fileType.toLowerCase())) {
      return false;
    }
  }

  if (tokens.queue) {
    const inQueue = doc.priorityScore > 0 && !doc.isArchived;
    if (tokens.queue === "in" && !inQueue) return false;
    if (tokens.queue === "out" && inQueue) return false;
  }

  if (tokens.extracts) {
    const count = doc.extractCount ?? 0;
    if (tokens.extracts.op === "<" && !(count < tokens.extracts.value)) return false;
    if (tokens.extracts.op === ">" && !(count > tokens.extracts.value)) return false;
    if (tokens.extracts.op === "=" && !(count === tokens.extracts.value)) return false;
  }

  return true;
}

/** Fields of a learning item relevant to the Documents view card search. */
export interface CardSearchItem {
  question: string;
  answer?: string | null;
  cloze_text?: string | null;
  tags?: string[] | null;
}

/**
 * Whether a learning item matches the parsed document search tokens, for the
 * "Cards" result group in the Documents view.
 *
 * - `tokens.text` matches case-insensitively against the question, answer,
 *   cloze text, or any tag.
 * - Every `tokens.tags` entry must match a tag (AND; substring per token, so
 *   `tag:occlusion` matches `image-occlusion`).
 * - Document-only tokens (`source:`, `queue:`, `extracts`) suppress card
 *   results entirely, so a document-only query does not surface an unrelated
 *   card list.
 */
export function matchesCardSearch(item: CardSearchItem, tokens: DocumentSearchTokens): boolean {
  // Document-only tokens have no meaning for a card: exclude all cards rather
  // than silently ignoring them.
  if (tokens.sources.length > 0 || tokens.queue || tokens.extracts) {
    return false;
  }

  // An empty query is handled by the caller (no Cards group); but if invoked,
  // treat it as a non-match so a blank search never lists every card.
  if (!tokens.text && tokens.tags.length === 0) {
    return false;
  }

  const tags = (item.tags ?? []).map((tag) => tag.toLowerCase());

  if (tokens.tags.length > 0) {
    const required = tokens.tags.map((tag) => tag.toLowerCase());
    if (!matchesTagTokens(tags, required)) {
      return false;
    }
  }

  if (tokens.text) {
    const text = tokens.text.toLowerCase();
    const haystack = [
      item.question ?? "",
      item.answer ?? "",
      item.cloze_text ?? "",
      ...tags,
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(text)) {
      return false;
    }
  }

  return true;
}

export function sortDocuments(
  documents: Document[],
  sortKey: DocumentSortKey,
  direction: DocumentSortDirection
): Document[] {
  const multiplier = direction === "asc" ? 1 : -1;
  const indexed = documents.map((doc, index) => ({ doc, index }));
  indexed.sort((a, b) => {
    const left = getSortValue(a.doc, sortKey);
    const right = getSortValue(b.doc, sortKey);
    if (left < right) return -1 * multiplier;
    if (left > right) return 1 * multiplier;
    return a.index - b.index;
  });
  return indexed.map((item) => item.doc);
}

function getSortValue(doc: Document, sortKey: DocumentSortKey): number | string {
  switch (sortKey) {
    case "priority":
      return doc.priorityScore ?? doc.priorityRating ?? 0;
    case "lastTouched":
      return new Date(getLastTouched(doc)).getTime();
    case "added":
      return new Date(doc.dateAdded).getTime();
    case "title":
      return doc.title.toLowerCase();
    case "type":
      return doc.fileType.toLowerCase();
    case "extracts":
      return doc.extractCount ?? 0;
    case "cards":
      return doc.learningItemCount ?? 0;
    default:
      return 0;
  }
}

export function getLastTouched(doc: Document): string {
  return doc.dateLastReviewed ?? doc.dateModified ?? doc.dateAdded;
}

export function getPriorityTier(doc: Document): "high" | "medium" | "low" {
  const rating = doc.priorityRating ?? 0;
  const score = doc.priorityScore ?? 0;
  if (score >= 80 || rating >= 4) return "high";
  if (score >= 50 || rating >= 2) return "medium";
  return "low";
}

export function getPrioritySignal(doc: Document): string {
  const score = doc.priorityScore ?? doc.priorityRating ?? 0;
  return score ? String(Math.round(score)) : "-";
}

export function getPriorityReason(doc: Document): string {
  if (doc.isArchived) return "Archived";
  if (doc.extractCount === 0) return "Needs extracts";
  const added = new Date(doc.dateAdded).getTime();
  const now = Date.now();
  if (now - added < 3 * 24 * 60 * 60 * 1000) return "Recently imported";
  if (doc.learningItemCount > 0) return "Active reading";
  if ((doc.priorityScore ?? 0) >= 80 || (doc.priorityRating ?? 0) >= 4) return "High value";
  return "In queue";
}

export function getNextAction(doc: Document): string {
  if (doc.isArchived) return "Archive";
  if (doc.extractCount === 0) return "Extract";
  if (doc.learningItemCount === 0) return "Read";
  return "Review";
}

export function getProgressSegments(doc: Document): {
  extracts: number;
  cards: number;
  total: number;
  extractRatio: number;
  cardRatio: number;
} {
  const extracts = doc.extractCount ?? 0;
  const cards = doc.learningItemCount ?? 0;
  const total = extracts + cards;
  const extractRatio = total === 0 ? 0 : extracts / total;
  const cardRatio = total === 0 ? 0 : cards / total;
  return { extracts, cards, total, extractRatio, cardRatio };
}

export function formatRelativeTime(dateString?: string): string {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours <= 0) return "Just now";
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export type SmartSectionId =
  | "priority"
  | "recent"
  | "active"
  | "parked"
  | "mostly"
  | "other";

export function getSmartSection(doc: Document): SmartSectionId {
  if (doc.isArchived || getPriorityTier(doc) === "low") return "parked";
  if ((doc.priorityScore ?? 0) >= 80) return "priority";
  const added = new Date(doc.dateAdded).getTime();
  if (Date.now() - added < 7 * 24 * 60 * 60 * 1000) return "recent";
  if ((doc.extractCount ?? 0) >= 10 && (doc.learningItemCount ?? 0) >= 20) return "mostly";
  if ((doc.extractCount ?? 0) > 0 && (doc.learningItemCount ?? 0) > 0) return "active";
  return "other";
}

export const SMART_SECTION_LABELS: Record<SmartSectionId, string> = {
  priority: "In Priority Queue",
  recent: "Recently Imported",
  active: "Active Reading",
  parked: "Parked / Low Priority",
  mostly: "Mostly Extracted",
  other: "Other",
};
