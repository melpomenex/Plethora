/**
 * Unified Search API — re-exports indexed palette search & FTS5 endpoints.
 */

export {
  ftsGetStats,
  ftsReindex,
  ftsSearch,
  ftsSearchSuggestions,
  paletteSearch,
  type FtsSearchQuery,
  type FtsSearchResult,
  type FtsSearchStats,
  type PaletteSearchItem,
  type PaletteSearchQuery,
  type PaletteSearchResponse,
} from './ftsSearch';
