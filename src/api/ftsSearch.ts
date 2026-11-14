/**
 * Full-text search API with FTS5
 */

import { invoke } from '@tauri-apps/api/core';
import { invokeCommand } from '../lib/tauri';
import { mergeSpotlightIntoFts } from '../lib/ai/apple/spotlight';
import type { SearchHit } from '../types/searchHit';
import type { PaletteScope } from '../commandPalette/types';

export interface FtsSearchQuery {
  query: string;
  limit?: number;
  offset?: number;
  resultTypes?: string[];
}

export interface FtsSearchResult {
  id: string;
  resultType: string;
  title?: string;
  excerpt?: string;
  score: number;
  documentId?: string;
  fileType?: string;
}

export interface FtsSearchStats {
  totalDocuments: number;
  totalExtracts: number;
}

export async function ftsSearch(query: FtsSearchQuery): Promise<FtsSearchResult[]> {
  const results = await invoke<FtsSearchResult[]>('fts_search', { query });
  try {
    return await mergeSpotlightIntoFts(query.query, results);
  } catch {
    return results;
  }
}

export async function ftsSearchSuggestions(query: string): Promise<string[]> {
  return await invoke<string[]>('fts_search_suggestions', { query });
}

export async function ftsGetStats(): Promise<FtsSearchStats> {
  return await invoke<FtsSearchStats>('fts_get_stats');
}

export interface PaletteSearchQuery {
  query: string;
  scope?: PaletteScope | string;
  limit?: number;
  offset?: number;
  collectionId?: string;
  categories?: string[];
  tags?: string[];
  fileTypes?: string[];
  resultTypes?: string[];
  minRating?: number;
  includeArchived?: boolean;
  hasExtracts?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface PaletteSearchItem {
  id: string;
  resultType: string;
  resultKind?:
    | "section"
    | "command"
    | "rss-article"
    | "podcast-episode"
    | "contextual-action"
    | "help-article"
    | "ask-plethora"
    | "learning-item"
    | "extract";
  title: string;
  excerpt?: string;
  score: number;
  documentId?: string;
  articleId?: string;
  feedId?: string;
  episodeId?: string;
  cardId?: string;
  category?: string;
  tags: string[];
  fileType?: string;
  dateAdded?: string;
  dateModified?: string;
  transcriptMatch: boolean;
  pageNumber?: number;
  timestampMs?: number;
  primaryHit?: SearchHit;
  secondaryHits: SearchHit[];
  scopes: string[];
}

export interface PaletteSearchResponse {
  items: PaletteSearchItem[];
  totalEstimate: number;
  elapsedMs: number;
  hasMore: boolean;
}

export async function paletteSearch(
  query: PaletteSearchQuery
): Promise<PaletteSearchResponse> {
  return invokeCommand<PaletteSearchResponse>('palette_search', { query });
}

export async function ftsReindex(): Promise<void> {
  return await invoke('fts_reindex');
}
