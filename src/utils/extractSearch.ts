import type { Extract } from "../api/extracts";
import type { VideoExtract } from "../api/video-extracts";

/**
 * Splits a search string into lowercase non-empty terms.
 */
export function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Strips HTML tags from extract content so markup tokens (e.g. "span", "div")
 * do not cause false-positive matches.
 */
export function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

/**
 * Returns true when every query token appears in at least one of the provided
 * searchable text fields (case-insensitive).
 */
export function matchesSearchTokens(
  tokens: string[],
  fields: Array<string | undefined | null>,
): boolean {
  if (tokens.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => typeof field === "string" && field.length > 0)
    .join(" ")
    .toLowerCase();
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Matches a text extract against a user search query across its content, notes,
 * tags, metadata, and resolved source document title.
 */
export function matchesExtractSearch(
  extract: Pick<
    Extract,
    "content" | "notes" | "tags" | "category" | "page_title" | "source_url"
  >,
  query: string,
  documentTitle?: string,
): boolean {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return true;

  return matchesSearchTokens(tokens, [
    stripHtmlTags(extract.content),
    extract.notes,
    ...(extract.tags ?? []),
    extract.category,
    extract.page_title,
    extract.source_url,
    documentTitle,
  ]);
}

/**
 * Matches a video extract against a user search query across its title,
 * transcript, notes, tags, and source document title.
 */
export function matchesVideoExtractSearch(
  extract: Pick<
    VideoExtract,
    "title" | "transcript_text" | "notes" | "tags" | "document_title"
  >,
  query: string,
  documentTitle?: string,
): boolean {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return true;

  return matchesSearchTokens(tokens, [
    extract.title,
    extract.transcript_text,
    extract.notes,
    ...(extract.tags ?? []),
    extract.document_title,
    documentTitle,
  ]);
}
