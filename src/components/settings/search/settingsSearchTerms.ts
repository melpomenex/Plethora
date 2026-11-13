import type { ResolvedSettingsSearchEntry } from "./settingsSearch";

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const PUNCTUATION_RE = /[.,;:!?()[\]{}\"'“”‘’<>|@#$%^&*+=~`\\/]/g;

/** Normalize searchable text while keeping contiguous CJK labels intact. */
export function normalizeSettingsSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(PUNCTUATION_RE, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsCjk(value: string): boolean {
  return CJK_RE.test(value);
}

export function tokenizeSettingsSearchQuery(query: string): string[] {
  return tokenizeNormalizedQuery(normalizeSettingsSearchText(query));
}

export function tokenizeNormalizedQuery(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

export interface PreparedSearchTerms {
  normalizedLabelTerms: string[];
  normalizedAliasTerms: string[];
  directWords: string[];
  breadcrumbWords: string[];
  normalizedDescription: string;
}

const preparedSearchTermsCache = new WeakMap<ResolvedSettingsSearchEntry, PreparedSearchTerms>();

function words(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

export function prepareSearchTerms(entry: ResolvedSettingsSearchEntry): PreparedSearchTerms {
  const cached = preparedSearchTermsCache.get(entry);
  if (cached) return cached;

  const labelWords = entry.labelTerms.flatMap(words);
  const aliasWords = entry.aliasTerms.flatMap(words);
  const prepared: PreparedSearchTerms = {
    normalizedLabelTerms: entry.labelTerms.map(normalizeSettingsSearchText),
    normalizedAliasTerms: entry.aliasTerms.map(normalizeSettingsSearchText),
    directWords: [...labelWords, ...aliasWords],
    breadcrumbWords: entry.breadcrumbTerms.flatMap(words),
    normalizedDescription: entry.descriptionTerms
      .map(normalizeSettingsSearchText)
      .join(" "),
  };
  preparedSearchTermsCache.set(entry, prepared);
  return prepared;
}
