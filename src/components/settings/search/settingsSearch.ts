/**
 * Settings search matcher (change: improve-settings-search).
 *
 * Pure and synchronous: normalize the query, require every token to match one
 * resolved catalog entry, rank by the weakest token tier, then prefer direct
 * label coverage over breadcrumb-only coverage. Catalog order and stable id
 * break remaining ties so repeated searches are reproducible.
 *
 * Reuses the leaf `fuzzyMatch`/`levenshteinDistance` helpers from
 * `src/utils/fuzzy.ts`; it deliberately does not import the command-palette
 * registry (which would pull command destinations/actions into Settings).
 */

import { fuzzyMatch, levenshteinDistance } from "../../../utils/fuzzy";
import { getEnglishText } from "../../../lib/i18n";
import {
  isSettingsSearchEntryAvailable,
  type SettingsSearchAvailabilitySnapshot,
  type SettingsSearchCopy,
  type SettingsSearchEntry,
} from "./settingsSearchCatalog";

/* ------------------------------------------------------------------------- */
/* Public types                                                              */
/* ------------------------------------------------------------------------- */

export type SettingsSearchTier =
  | "exact-label"
  | "exact-alias"
  | "prefix-label"
  | "prefix-alias"
  | "direct"
  | "fuzzy"
  | "description";

/** Higher is better. Kept small/integer so ties are easy to reason about. */
export const SETTINGS_SEARCH_TIER_SCORE: Record<SettingsSearchTier, number> = {
  "exact-label": 700,
  "exact-alias": 600,
  "prefix-label": 500,
  "prefix-alias": 450,
  direct: 400,
  fuzzy: 300,
  description: 200,
};

export interface ResolvedSettingsSearchEntry {
  readonly entry: SettingsSearchEntry;
  /** Localized display copy. */
  readonly label: string;
  readonly description?: string;
  readonly groupPath: readonly string[];
  /** "Section › Group › Subgroup" for result rows / breadcrumb context. */
  readonly breadcrumb: string;
  /** Searchable variants: localized copy first, English fallback second. */
  readonly labelTerms: readonly string[];
  readonly aliasTerms: readonly string[];
  readonly descriptionTerms: readonly string[];
  readonly breadcrumbTerms: readonly string[];
}

export interface SettingsSearchResult {
  readonly entry: ResolvedSettingsSearchEntry;
  readonly tier: SettingsSearchTier;
  readonly score: number;
  /** Tokens matched by the entry's own label/alias, not just the breadcrumb. */
  readonly directCoverage: number;
}

export interface ResolveSettingsSearchOptions {
  translate: (key: string) => string;
  availability: SettingsSearchAvailabilitySnapshot;
}

/* ------------------------------------------------------------------------- */
/* Normalization                                                             */
/* ------------------------------------------------------------------------- */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

const PUNCTUATION_RE = /[.,;:!?()[\]{}"'“”‘’<>|@#$%^&*+=~`\\/]/g;

/**
 * Normalize searchable text: Unicode normalize, fold Latin accents, lowercase,
 * treat dashes/punctuation as word boundaries, collapse whitespace.
 * Non-Latin scripts are preserved so contiguous CJK labels can match.
 */
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

/** Query tokens. A whitespace-free CJK query stays a single token. */
export function tokenizeSettingsSearchQuery(query: string): string[] {
  const normalized = normalizeSettingsSearchText(query);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

/* ------------------------------------------------------------------------- */
/* Copy resolution                                                           */
/* ------------------------------------------------------------------------- */

function resolveCopyVariants(
  copy: SettingsSearchCopy | undefined,
  translate: (key: string) => string,
): string[] {
  if (!copy) return [];
  if ("text" in copy) {
    const text = copy.text.trim();
    return text ? [text] : [];
  }
  const localized = translate(copy.key);
  const english = getEnglishText(copy.key);
  const variants: string[] = [];
  // A missing key would otherwise surface the raw dotted key in the UI; never
  // index or display it as though it were copy.
  if (localized && localized !== copy.key) variants.push(localized);
  if (english && english !== copy.key && !variants.includes(english)) variants.push(english);
  return variants;
}

function displayCopy(
  copy: SettingsSearchCopy | undefined,
  translate: (key: string) => string,
): string | undefined {
  const variants = resolveCopyVariants(copy, translate);
  return variants[0];
}

/* ------------------------------------------------------------------------- */
/* Catalog resolution                                                        */
/* ------------------------------------------------------------------------- */

export function resolveSettingsSearchCatalog(
  entries: readonly SettingsSearchEntry[],
  options: ResolveSettingsSearchOptions,
): ResolvedSettingsSearchEntry[] {
  const { translate, availability } = options;

  const sectionLabels = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind !== "section") continue;
    const variants = resolveCopyVariants(entry.label, translate);
    if (variants.length) sectionLabels.set(entry.section, variants);
  }
  const sectionLabelTerms = (section: string): string[] => sectionLabels.get(section) ?? [];

  const resolved: ResolvedSettingsSearchEntry[] = [];
  for (const entry of entries) {
    if (!isSettingsSearchEntryAvailable(entry, availability)) continue;
    const labelTerms = resolveCopyVariants(entry.label, translate);
    if (labelTerms.length === 0) continue;
    const groupPath = (entry.groupPath ?? [])
      .map((copy) => displayCopy(copy, translate))
      .filter((value): value is string => !!value);
    const sectionLabel = sectionLabels.get(entry.section)?.[0] ?? entry.section;
    // A section result is the category itself; repeating its label as a
    // breadcrumb is noise. Keep the section label searchable through
    // `breadcrumbTerms` below.
    const breadcrumbParts =
      entry.kind === "section" ? [] : [sectionLabel, ...groupPath].filter(Boolean);
    resolved.push({
      entry,
      label: labelTerms[0],
      description: displayCopy(entry.description, translate),
      groupPath,
      breadcrumb: breadcrumbParts.join(" › "),
      labelTerms,
      aliasTerms: [
        ...(entry.aliases ?? []).flatMap((copy) => resolveCopyVariants(copy, translate)),
        ...(entry.keywords ?? []),
      ],
      descriptionTerms: resolveCopyVariants(entry.description, translate),
      breadcrumbTerms: [
        ...sectionLabelTerms(entry.section),
        ...breadcrumbParts,
        ...(entry.groupPath ?? []).flatMap((copy) => resolveCopyVariants(copy, translate)),
      ],
    });
  }
  return resolved;
}

/* ------------------------------------------------------------------------- */
/* Matching                                                                  */
/* ------------------------------------------------------------------------- */

/** Split a normalized label/phrase into words without breaking CJK runs. */
function words(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

function singleAdjacentTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let first = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      first = i;
      break;
    }
  }
  if (first < 0 || first + 1 >= a.length) return false;
  if (a[first] !== b[first + 1] || a[first + 1] !== b[first]) return false;
  return a.slice(first + 2) === b.slice(first + 2);
}

interface TokenMatch {
  tier: SettingsSearchTier;
  direct: boolean;
}

function fuzzyWordMatch(word: string, token: string): boolean {
  const shortest = Math.min(word.length, token.length);
  if (shortest < 4) return false;
  const maxDistance = token.length >= 6 ? 2 : 1;
  const result = fuzzyMatch(word, token, maxDistance);
  if (result.match && result.score >= 0.7) return true;
  // Levenshtein counts a swap as two edits; accept one bounded adjacent swap
  // for short typos (`siez` → `size`) without relaxing other short words.
  if (token.length <= 6) {
    return (
      singleAdjacentTransposition(word, token) &&
      levenshteinDistance(word, token) <= maxDistance + 1
    );
  }
  return false;
}

/** Best tier for one query token within one entry (or null when absent). */
function matchToken(entry: ResolvedSettingsSearchEntry, token: string): TokenMatch | null {
  const cjkToken = containsCjk(token);

  const labelWords = entry.labelTerms.flatMap(words);
  const aliasWords = entry.aliasTerms.flatMap(words);
  const directWords = [...labelWords, ...aliasWords];

  if (cjkToken) {
    // Contiguous CJK text is meaningful without whitespace segmentation.
    if (entry.labelTerms.some((label) => {
      const normalized = normalizeSettingsSearchText(label);
      return normalized.includes(token) || token.includes(normalized);
    })) {
      return { tier: "direct", direct: true };
    }
    if (entry.aliasTerms.some((alias) => normalizeSettingsSearchText(alias).includes(token))) {
      return { tier: "direct", direct: true };
    }
  }

  if (directWords.includes(token)) return { tier: "direct", direct: true };

  if (directWords.some((word) => word.startsWith(token))) {
    return { tier: "direct", direct: true };
  }

  if (directWords.some((word) => fuzzyWordMatch(word, token))) {
    return { tier: "fuzzy", direct: true };
  }

  const contextWords = entry.breadcrumbTerms.flatMap(words);
  if (contextWords.includes(token) || contextWords.some((word) => word.startsWith(token))) {
    return { tier: "direct", direct: false };
  }

  const description = entry.descriptionTerms
    .map((value) => normalizeSettingsSearchText(value))
    .join(" ");
  if (description && description.includes(token)) {
    return { tier: "description", direct: false };
  }

  // A longer CJK query may contain a short indexable label; do not invent
  // English-style word boundaries for it.
  if (cjkToken && entry.labelTerms.some((label) => {
    const normalized = normalizeSettingsSearchText(label);
    return normalized.length >= 2 && token.includes(normalized);
  })) {
    return { tier: "direct", direct: true };
  }

  return null;
}

function wholeExact(
  entry: ResolvedSettingsSearchEntry,
  normalizedQuery: string,
): SettingsSearchTier | null {
  const label = entry.labelTerms.some(
    (value) => normalizeSettingsSearchText(value) === normalizedQuery,
  );
  if (label) return "exact-label";
  const alias = entry.aliasTerms.some(
    (value) => normalizeSettingsSearchText(value) === normalizedQuery,
  );
  if (alias) return "exact-alias";
  return null;
}

function wholePrefix(
  entry: ResolvedSettingsSearchEntry,
  normalizedQuery: string,
): SettingsSearchTier | null {
  if (entry.labelTerms.some((value) => normalizeSettingsSearchText(value).startsWith(normalizedQuery))) {
    return "prefix-label";
  }
  if (entry.aliasTerms.some((value) => normalizeSettingsSearchText(value).startsWith(normalizedQuery))) {
    return "prefix-alias";
  }
  return null;
}

/** Score one resolved entry against one query. */
export function scoreSettingsSearchEntry(
  entry: ResolvedSettingsSearchEntry,
  query: string,
): Omit<SettingsSearchResult, "entry"> & { entry: ResolvedSettingsSearchEntry } | null {
  const normalizedQuery = normalizeSettingsSearchText(query);
  if (!normalizedQuery) return null;

  const exact = wholeExact(entry, normalizedQuery);
  if (exact) {
    return {
      entry,
      tier: exact,
      score: SETTINGS_SEARCH_TIER_SCORE[exact],
      directCoverage: tokenizeSettingsSearchQuery(normalizedQuery).length,
    };
  }

  const prefix = wholePrefix(entry, normalizedQuery);
  if (prefix) {
    return {
      entry,
      tier: prefix,
      score: SETTINGS_SEARCH_TIER_SCORE[prefix],
      directCoverage: tokenizeSettingsSearchQuery(normalizedQuery).length,
    };
  }

  const tokens = tokenizeSettingsSearchQuery(normalizedQuery);
  if (tokens.length === 0) return null;

  let weakest: SettingsSearchTier | null = null;
  let directCoverage = 0;
  for (const token of tokens) {
    const match = matchToken(entry, token);
    if (!match) return null;
    if (match.direct) directCoverage += 1;
    if (weakest === null || SETTINGS_SEARCH_TIER_SCORE[match.tier] < SETTINGS_SEARCH_TIER_SCORE[weakest]) {
      weakest = match.tier;
    }
  }
  if (!weakest) return null;
  return {
    entry,
    tier: weakest,
    score: SETTINGS_SEARCH_TIER_SCORE[weakest],
    directCoverage,
  };
}

function kindOrder(entry: ResolvedSettingsSearchEntry): number {
  // At an equal tier, prefer a concrete setting/group over a whole category.
  switch (entry.entry.kind) {
    case "setting":
      return 0;
    case "group":
      return 1;
    default:
      return 2;
  }
}

/**
 * Match and rank catalog entries. Deterministic:
 * tier → direct coverage → kind → catalog order → stable id.
 * Duplicate destinations are collapsed, keeping the best match.
 */
export function searchSettings(
  entries: readonly ResolvedSettingsSearchEntry[],
  query: string,
): SettingsSearchResult[] {
  if (!normalizeSettingsSearchText(query)) return [];
  const scored: Array<SettingsSearchResult & { order: number }> = [];
  entries.forEach((entry, order) => {
    const match = scoreSettingsSearchEntry(entry, query);
    if (match) scored.push({ ...match, order });
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.directCoverage - a.directCoverage ||
      kindOrder(a.entry) - kindOrder(b.entry) ||
      a.order - b.order ||
      a.entry.entry.id.localeCompare(b.entry.entry.id),
  );

  const seen = new Set<string>();
  const deduped: SettingsSearchResult[] = [];
  for (const { order: _order, ...match } of scored) {
    const destination = match.entry.entry.targetId;
    if (seen.has(destination)) continue;
    seen.add(destination);
    deduped.push(match);
  }
  return deduped;
}
