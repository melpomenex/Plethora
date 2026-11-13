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
import {
  containsCjk,
  normalizeSettingsSearchText,
  prepareSearchTerms,
  tokenizeNormalizedQuery,
  type PreparedSearchTerms,
} from "./settingsSearchTerms";
export {
  containsCjk,
  normalizeSettingsSearchText,
  tokenizeSettingsSearchQuery,
} from "./settingsSearchTerms";

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
function matchToken(terms: PreparedSearchTerms, token: string): TokenMatch | null {
  const cjkToken = containsCjk(token);

  if (cjkToken) {
    // Contiguous CJK text is meaningful without whitespace segmentation.
    if (terms.normalizedLabelTerms.some((label) => {
      return label.includes(token) || token.includes(label);
    })) {
      return { tier: "direct", direct: true };
    }
    if (terms.normalizedAliasTerms.some((alias) => alias.includes(token))) {
      return { tier: "direct", direct: true };
    }
  }

  if (terms.directWords.includes(token)) return { tier: "direct", direct: true };

  if (terms.directWords.some((word) => word.startsWith(token))) {
    return { tier: "direct", direct: true };
  }

  if (terms.directWords.some((word) => fuzzyWordMatch(word, token))) {
    return { tier: "fuzzy", direct: true };
  }

  if (
    terms.breadcrumbWords.includes(token) ||
    terms.breadcrumbWords.some((word) => word.startsWith(token))
  ) {
    return { tier: "direct", direct: false };
  }

  if (terms.normalizedDescription && terms.normalizedDescription.includes(token)) {
    return { tier: "description", direct: false };
  }

  // A longer CJK query may contain a short indexable label; do not invent
  // English-style word boundaries for it.
  if (
    cjkToken &&
    terms.normalizedLabelTerms.some((label) => label.length >= 2 && token.includes(label))
  ) {
    return { tier: "direct", direct: true };
  }

  return null;
}

function wholeExact(
  terms: PreparedSearchTerms,
  normalizedQuery: string,
): SettingsSearchTier | null {
  const label = terms.normalizedLabelTerms.some((value) => value === normalizedQuery);
  if (label) return "exact-label";
  const alias = terms.normalizedAliasTerms.some((value) => value === normalizedQuery);
  if (alias) return "exact-alias";
  return null;
}

function wholePrefix(
  terms: PreparedSearchTerms,
  normalizedQuery: string,
): SettingsSearchTier | null {
  if (terms.normalizedLabelTerms.some((value) => value.startsWith(normalizedQuery))) {
    return "prefix-label";
  }
  if (terms.normalizedAliasTerms.some((value) => value.startsWith(normalizedQuery))) {
    return "prefix-alias";
  }
  return null;
}

function scoreNormalizedEntry(
  entry: ResolvedSettingsSearchEntry,
  normalizedQuery: string,
  tokens: readonly string[],
): Omit<SettingsSearchResult, "entry"> & { entry: ResolvedSettingsSearchEntry } | null {
  if (!normalizedQuery) return null;

  const terms = prepareSearchTerms(entry);
  const exact = wholeExact(terms, normalizedQuery);
  if (exact) {
    return {
      entry,
      tier: exact,
      score: SETTINGS_SEARCH_TIER_SCORE[exact],
      directCoverage: tokens.length,
    };
  }

  const prefix = wholePrefix(terms, normalizedQuery);
  if (prefix) {
    return {
      entry,
      tier: prefix,
      score: SETTINGS_SEARCH_TIER_SCORE[prefix],
      directCoverage: tokens.length,
    };
  }

  if (tokens.length === 0) return null;

  let weakest: SettingsSearchTier | null = null;
  let directCoverage = 0;
  for (const token of tokens) {
    const match = matchToken(terms, token);
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

/** Score one resolved entry against one query. */
export function scoreSettingsSearchEntry(
  entry: ResolvedSettingsSearchEntry,
  query: string,
): Omit<SettingsSearchResult, "entry"> & { entry: ResolvedSettingsSearchEntry } | null {
  const normalizedQuery = normalizeSettingsSearchText(query);
  return scoreNormalizedEntry(
    entry,
    normalizedQuery,
    tokenizeNormalizedQuery(normalizedQuery),
  );
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
  const normalizedQuery = normalizeSettingsSearchText(query);
  if (!normalizedQuery) return [];
  const tokens = tokenizeNormalizedQuery(normalizedQuery);
  const scored: Array<SettingsSearchResult & { order: number }> = [];
  entries.forEach((entry, order) => {
    const match = scoreNormalizedEntry(entry, normalizedQuery, tokens);
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
