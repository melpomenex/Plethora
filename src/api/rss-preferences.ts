/**
 * RSS Semantic Preference API (OpenSpec: rss-semantic-preference-learning)
 *
 * Article-level thumbs feedback + decayed embedding-cluster preference
 * profile, computed locally in Rust. Web/PWA builds have no local embedding
 * store, so these degrade to inert defaults (base ranking still applies).
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import type { EmbeddingConfig } from "./ai-learning";

export interface RssPreferenceClusterMeta {
  id: number;
  sentiment: "like" | "dislike";
  weight: number;
  last_updated: number;
  exemplar_article_id: string;
  exemplar_title: string;
  dim: number;
  model: string;
}

export interface RssPreferenceProfile {
  positive_weight: number;
  negative_weight: number;
  clusters: RssPreferenceClusterMeta[];
  cold_start_threshold: number;
}

export interface RssSemanticScore {
  item_id: string;
  /** 0..1 (0.5 neutral); undefined when no embedding or below cold start. */
  score?: number | null;
  driver_exemplar_title?: string | null;
  driver_sentiment?: "like" | "dislike" | null;
}

export interface RssFeedbackSummary {
  id: string;
  title: string;
  text_content: string;
  tags: string[];
}

const EMPTY_PROFILE: RssPreferenceProfile = {
  positive_weight: 0,
  negative_weight: 0,
  clusters: [],
  cold_start_threshold: 1.5,
};

export function isSemanticPreferenceAvailable(): boolean {
  return isTauri();
}

/**
 * Persist (or remove, when `sentiment` is null) article-level feedback and
 * update the semantic profile. `summary` + `config` let the backend embed the
 * article on demand via the configured provider (local-first).
 */
export async function setRssArticleFeedback(
  articleId: string,
  sentiment: "like" | "dislike" | null,
  summary?: RssFeedbackSummary | null,
  config?: EmbeddingConfig | null,
): Promise<void> {
  if (!isTauri()) return;
  await invokeCommand<void>("set_rss_article_feedback", {
    articleId,
    sentiment,
    summary: summary ?? null,
    config: config ?? null,
  });
}

export async function getRssPreferenceProfile(): Promise<RssPreferenceProfile> {
  if (!isTauri()) return EMPTY_PROFILE;
  try {
    return await invokeCommand<RssPreferenceProfile>("get_rss_preference_profile");
  } catch {
    return EMPTY_PROFILE;
  }
}

export async function scoreRssItemsSemantic(itemIds: string[]): Promise<Map<string, RssSemanticScore>> {
  const map = new Map<string, RssSemanticScore>();
  if (!isTauri() || itemIds.length === 0) return map;
  try {
    const scores = await invokeCommand<RssSemanticScore[]>("score_rss_items_semantic", { itemIds });
    for (const score of scores ?? []) map.set(score.item_id, score);
  } catch {
    // Degrade to base ranking.
  }
  return map;
}

export async function rebuildRssPreferenceProfile(): Promise<void> {
  if (!isTauri()) return;
  await invokeCommand<void>("rebuild_rss_preference_profile");
}
