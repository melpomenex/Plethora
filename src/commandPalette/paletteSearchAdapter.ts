/**
 * Pure two-stage adapters for Command Palette search:
 * - Stage A (`prepareDocumentTitle`, `matchDocumentTitlesSync`): pre-normalized
 *   WeakMap index over in-memory documents for <16ms synchronous title/tag/category
 *   matching without touching body HTML, transcripts, or synchronous DOMParser.
 * - Stage B (`mapPaletteSearchItemToSearchResult`, `searchDocumentsFallback`):
 *   maps SQLite FTS5 `palette_search` items into `SearchResult` rows while
 *   preserving command-tier precedence (`<= 0.95` vs registry `0.85..1.30`) and
 *   providing an async bounded web/test fallback when not running under Tauri.
 */

import type { PaletteSearchItem } from "../api/ftsSearch";
import {
  SearchResultType,
  type SearchQuery,
  type SearchResult,
} from "../components/search/GlobalSearch";
import type { PaletteScope } from "../commandPalette/types";
import type { SearchHit } from "../types/searchHit";
import type { Document, Extract } from "../types/document";
import {
  calculateRelevanceScore,
  extractSearchTerms,
  fuzzyMatch,
  highlightSearchTerms,
} from "../components/search/SearchUtils";

interface PreparedDocumentMeta {
  titleLower: string;
  categoryLower: string;
  tagsLower: string[];
}

const preparedDocCache = new WeakMap<Document, PreparedDocumentMeta>();

export function prepareDocumentMeta(doc: Document): PreparedDocumentMeta {
  const cached = preparedDocCache.get(doc);
  if (cached) return cached;

  const prepared: PreparedDocumentMeta = {
    titleLower: (doc.title ?? "").toLowerCase(),
    categoryLower: (doc.category ?? "").toLowerCase(),
    tagsLower: (doc.tags ?? []).map((t) => t.toLowerCase()),
  };
  preparedDocCache.set(doc, prepared);
  return prepared;
}

export function isDocumentSearchEligible(
  doc: Document,
  activeCollectionId?: string | null,
  includeArchived = false
): boolean {
  if (!includeArchived && (doc.isArchived || doc.isDismissed)) return false;
  if (activeCollectionId && doc.collectionId && doc.collectionId !== activeCollectionId) {
    return false;
  }
  return true;
}

/**
 * Strip HTML tags & script/style blocks without allocating a `DOMParser`.
 */
export function stripHtmlLight(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesAllTerms(textLower: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  for (let i = 0; i < terms.length; i++) {
    if (!textLower.includes(terms[i])) return false;
  }
  return true;
}

/**
 * Synchronous Stage A matching over document titles/categories/tags.
 * Designed to complete in <16ms even across 10,000+ in-memory documents.
 */
export function matchDocumentTitlesSync(
  documents: Document[],
  query: SearchQuery,
  options: {
    activeCollectionId?: string | null;
    limit?: number;
  } = {}
): SearchResult[] {
  const raw = query.query.trim();
  if (!raw) return [];
  if (query.types && !query.types.includes(SearchResultType.Document)) {
    return [];
  }

  const term = raw.toLowerCase();
  const terms = extractSearchTerms(raw);
  const searchTerms = terms.length > 0 ? terms : [term];
  const limit = options.limit ?? 30;

  const scored: SearchResult[] = [];
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (!isDocumentSearchEligible(doc, options.activeCollectionId)) continue;
    if (query.categories && query.categories.length > 0) {
      if (!doc.category || !query.categories.includes(doc.category)) continue;
    }
    if (query.tags && query.tags.length > 0) {
      if (!doc.tags || !query.tags.some((t) => doc.tags!.includes(t))) continue;
    }

    const meta = prepareDocumentMeta(doc);
    let score = 0;
    if (meta.titleLower === term) {
      score = 0.92;
    } else if (meta.titleLower.startsWith(term)) {
      score = 0.88;
    } else if (meta.titleLower.includes(term) || matchesAllTerms(meta.titleLower, searchTerms)) {
      score = 0.78;
    } else if (
      term.length >= 3 &&
      Math.abs(meta.titleLower.length - term.length) <= 2 &&
      fuzzyMatch(meta.titleLower, term, 2).match
    ) {
      score = 0.62;
    } else if (
      meta.categoryLower.includes(term) ||
      (meta.tagsLower.length > 0 && meta.tagsLower.some((t) => t.includes(term)))
    ) {
      score = 0.56;
    }

    if (score <= 0) continue;

    scored.push({
      id: doc.id,
      type: SearchResultType.Document,
      title: doc.title,
      score,
      metadata: {
        documentId: doc.id,
        fileType: doc.fileType,
        category: doc.category,
        tags: doc.tags ?? [],
        highlightQuery: query.query,
        scopes: ["documents"],
      },
    });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, limit);
}

function toSearchResultType(resultType: string): SearchResultType {
  switch (resultType) {
    case "extract":
      return SearchResultType.Extract;
    case "flashcard":
      return SearchResultType.Flashcard;
    case "media":
      return SearchResultType.Media;
    case "command":
      return SearchResultType.Command;
    case "category":
      return SearchResultType.Category;
    case "tag":
      return SearchResultType.Tag;
    case "figure":
      return SearchResultType.Figure;
    default:
      return SearchResultType.Document;
  }
}

export function mapPaletteSearchItemToSearchResult(
  item: PaletteSearchItem,
  highlightQuery: string
): SearchResult {
  // Normalize backend FTS score into [0.42, 0.95] so registry destination/command
  // matches (0.85..1.30) preserve their exact-match priority above content.
  const normalizedScore = Math.min(0.95, Math.max(0.42, 0.45 + item.score / 250));
  const primaryHit = item.primaryHit as SearchHit | undefined;
  const secondaryHits =
    Array.isArray(item.secondaryHits) && item.secondaryHits.length > 0
      ? (item.secondaryHits as SearchHit[])
      : undefined;

  const scopes = (item.scopes ?? []).filter(
    (s): s is PaletteScope =>
      s === "all" ||
      s === "documents" ||
      s === "cards" ||
      s === "actions" ||
      s === "settings" ||
      s === "library"
  );

  return {
    id: item.id,
    type: toSearchResultType(item.resultType),
    title: item.title,
    excerpt: item.excerpt
      ? item.transcriptMatch && item.resultType === "document"
        ? `Transcript — ${item.excerpt}`
        : item.excerpt
      : undefined,
    highlights: [],
    score: normalizedScore,
    metadata: {
      documentId: item.documentId ?? undefined,
      resultKind: item.resultKind,
      articleId: item.articleId ?? undefined,
      feedId: item.feedId ?? undefined,
      episodeId: item.episodeId ?? undefined,
      cardId: item.cardId ?? undefined,
      category: item.category ?? undefined,
      tags: item.tags ?? [],
      fileType: item.fileType ?? undefined,
      transcriptMatch: item.transcriptMatch,
      pageNumber: item.pageNumber ?? undefined,
      timestampMs: item.timestampMs ?? undefined,
      highlightQuery,
      primaryHit,
      secondaryHits,
      scopes: scopes.length > 0 ? scopes : undefined,
    },
  };
}

/**
 * Merge Stage A local results with Stage B backend FTS results cleanly by `id`,
 * preferring Stage B enrichment (excerpts, transcript matches, primary/secondary hits)
 * while retaining commands, help docs, and any Stage A doc hit not exceeded by Stage B.
 */
export function mergeStageResults(
  stageAResults: SearchResult[],
  stageBResults: SearchResult[]
): SearchResult[] {
  const byId = new Map<string, SearchResult>();
  for (const item of stageAResults) {
    byId.set(item.id, item);
  }
  for (const item of stageBResults) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      byId.set(item.id, {
        ...existing,
        ...item,
        score: Math.max(existing.score, item.score),
        metadata: {
          ...existing.metadata,
          ...item.metadata,
        },
      });
    }
  }
  return Array.from(byId.values());
}

/**
 * Non-Tauri web / Vitest fallback search across already-loaded in-memory documents
 * and extracts without synchronous DOMParser or arbitrary 500-item truncation caps.
 */
export async function searchInMemoryFallback(params: {
  documents: Document[];
  extracts: Extract[];
  query: SearchQuery;
  activeCollectionId?: string | null;
  limit: number;
  allowContentSearch: boolean;
  isWeb?: boolean;
}): Promise<SearchResult[]> {
  const {
    documents,
    extracts,
    query,
    activeCollectionId,
    limit,
    allowContentSearch,
    isWeb = false,
  } = params;
  const raw = query.query.trim();
  if (!raw) return [];

  const term = raw.toLowerCase();
  const terms = extractSearchTerms(raw);
  const searchTerms = terms.length > 0 ? terms : [term];

  const results: SearchResult[] = [];
  const docById = new Map<string, Document>();
  const eligibleDocIds = new Set<string>();

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    docById.set(doc.id, doc);
    if (!isDocumentSearchEligible(doc, activeCollectionId)) continue;
    eligibleDocIds.add(doc.id);

    if (query.types && !query.types.includes(SearchResultType.Document)) continue;
    if (query.categories && query.categories.length > 0) {
      if (!doc.category || !query.categories.includes(doc.category)) continue;
    }
    if (query.tags && query.tags.length > 0) {
      if (!doc.tags || !query.tags.some((t) => doc.tags!.includes(t))) continue;
    }

    const meta = prepareDocumentMeta(doc);
    const titleMatch =
      matchesAllTerms(meta.titleLower, searchTerms) ||
      meta.titleLower.includes(term) ||
      (term.length >= 3 && fuzzyMatch(meta.titleLower, term, 2).match);

    let plainContent = "";
    let contentMatch = false;
    if (!isWeb && allowContentSearch && doc.content) {
      plainContent =
        doc.fileType === "html" ? stripHtmlLight(doc.content) : doc.content;
      contentMatch = matchesAllTerms(plainContent.toLowerCase(), searchTerms);
    }

    if (!titleMatch && !contentMatch) continue;

    const score = Math.min(
      0.95,
      calculateRelevanceScore(
        { title: doc.title, content: plainContent },
        query.query,
        SearchResultType.Document
      ) / 100
    );

    const excerpt = contentMatch
      ? highlightSearchTerms(plainContent, query.query, 200).excerpt
      : undefined;

    results.push({
      id: doc.id,
      type: SearchResultType.Document,
      title: doc.title,
      excerpt,
      highlights: [],
      score,
      metadata: {
        documentId: doc.id,
        fileType: doc.fileType,
        category: doc.category,
        tags: doc.tags ?? [],
        highlightQuery: query.query,
        scopes: ["documents"],
      },
    });
  }

  if (!query.types || query.types.includes(SearchResultType.Extract)) {
    for (let i = 0; i < extracts.length; i++) {
      const ext = extracts[i];
      const parentDoc = docById.get(ext.documentId);
      if (parentDoc && !eligibleDocIds.has(parentDoc.id)) continue;

      if (query.categories && query.categories.length > 0) {
        const matchesCat =
          (ext.category && query.categories.includes(ext.category)) ||
          (parentDoc?.category && query.categories.includes(parentDoc.category));
        if (!matchesCat) continue;
      }
      if (query.tags && query.tags.length > 0) {
        const extTags = ext.tags ?? [];
        const docTags = parentDoc?.tags ?? [];
        const matchesTag = query.tags.some(
          (t) => extTags.includes(t) || docTags.includes(t)
        );
        if (!matchesTag) continue;
      }

      const pageTitle = ext.pageTitle?.trim() ?? "";
      const pageTitleLower = pageTitle.toLowerCase();
      const plainContent = ext.content ? stripHtmlLight(ext.content) : "";
      const plainContentLower = plainContent.toLowerCase();
      const notes = ext.notes ?? "";
      const notesLower = notes.toLowerCase();
      const categoryLower = (ext.category ?? "").toLowerCase();
      const tagsLower = (ext.tags ?? []).map((t) => t.toLowerCase());

      const titleMatch =
        pageTitleLower.length > 0 &&
        (pageTitleLower.includes(term) ||
          matchesAllTerms(pageTitleLower, searchTerms));
      const contentMatch =
        allowContentSearch &&
        plainContentLower.length > 0 &&
        matchesAllTerms(plainContentLower, searchTerms);
      const notesMatch =
        allowContentSearch &&
        notesLower.length > 0 &&
        matchesAllTerms(notesLower, searchTerms);
      const metaMatch =
        categoryLower.includes(term) ||
        (tagsLower.length > 0 && tagsLower.some((t) => t.includes(term)));

      if (!titleMatch && !contentMatch && !notesMatch && !metaMatch) continue;

      const combinedText = [plainContent, notes].filter(Boolean).join(" ");
      const rawScore =
        calculateRelevanceScore(
          {
            title: pageTitle || parentDoc?.title || "",
            content: combinedText,
          },
          query.query,
          SearchResultType.Extract
        ) / 100;
      const score = Math.min(0.95, Math.max(0.42, rawScore));

      let excerpt: string | undefined;
      if (contentMatch) {
        excerpt = highlightSearchTerms(plainContent, query.query, 200).excerpt;
      } else if (notesMatch) {
        excerpt = highlightSearchTerms(notes, query.query, 200).excerpt;
      } else if (plainContent) {
        excerpt = plainContent.slice(0, 200);
      }

      const pageNum = ext.pageNumber && ext.pageNumber > 0 ? ext.pageNumber : 1;
      const primaryHit: SearchHit | undefined =
        ext.pageNumber && ext.pageNumber > 0
          ? {
              id: `extract-hit-${ext.id}`,
              location: {
                kind: "pdf",
                pageNumber: pageNum,
                textQuote: raw || undefined,
              },
              label: `Page ${pageNum}`,
              excerptHtml: excerpt,
            }
          : undefined;

      results.push({
        id: ext.id,
        type: SearchResultType.Extract,
        title:
          pageTitle ||
          parentDoc?.title ||
          plainContent.slice(0, 80) ||
          "Extract",
        excerpt,
        highlights: [],
        score,
        metadata: {
          resultKind: "extract",
          documentId: ext.documentId,
          category: ext.category ?? parentDoc?.category,
          tags: ext.tags ?? [],
          pageNumber: ext.pageNumber,
          highlightQuery: query.query,
          primaryHit,
          scopes: ["documents"],
        },
      });
    }
  }

  return results
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
