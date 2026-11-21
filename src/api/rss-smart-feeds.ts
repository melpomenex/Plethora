/**
 * Smart Feeds API
 *
 * Wraps the Tauri backend `*_rss_smart_feed*` commands (with Web/PWA fallback
 * routed automatically through `invokeCommand` -> `browserInvoke`).
 */

import { invokeCommand } from "../lib/tauri";
import { useLLMProvidersStore } from "../stores/llmProvidersStore";
import { useSettingsStore } from "../stores/settingsStore";
import { buildEmbeddingConfig, paidEmbeddingsConsentFlag, type EmbeddingConfig } from "./ai-learning";

export type SmartFeedSourceScope =
  | "all"
  | "selected_feeds"
  | "selected_folders"
  | "external_discovery";

export type SmartFeedClassificationMode =
  | "fast_local"
  | "intelligent_local"
  | "cloud"
  | "hybrid";

export type SmartFeedStrictness = "broad" | "balanced" | "strict";

export type SmartFeedSortOrder = "relevance" | "newest" | "oldest" | "unread_first";

export type SmartFeedMatchDecision = "INCLUDE" | "EXCLUDE" | "UNCERTAIN" | "PENDING";

export type SmartFeedDecisionSource =
  | "fast_local"
  | "intelligent_local"
  | "cloud"
  | "hybrid"
  | "user_override"
  | "candidate_filter";

export type SmartFeedEvaluationStatus =
  | "pending"
  | "completed"
  | "completed_lexical"
  | "deferred"
  | "error";

export type SmartFeedFeedbackType = "SHOULD_INCLUDE" | "SHOULD_EXCLUDE" | "UNDO";

export interface SmartFeedSourceScopeConfig {
  feed_ids: string[];
  folder_ids: string[];
}

export interface SmartFeed {
  id: string;
  name: string;
  description: string;
  inclusion_criteria: string;
  exclusion_criteria: string;
  source_scope: SmartFeedSourceScope;
  source_scope_config: SmartFeedSourceScopeConfig;
  classification_mode: SmartFeedClassificationMode;
  curation_strictness: SmartFeedStrictness;
  minimum_relevance?: number | null;
  freshness_window_days?: number | null;
  sort_order: SmartFeedSortOrder;
  group_similar_stories: boolean;
  is_enabled: boolean;
  cloud_consent_granted: boolean;
  preferred_provider?: string | null;
  preferred_model?: string | null;
  definition_revision: number;
  created_at: string;
  updated_at: string;
  last_evaluated_at?: string | null;
}

export interface SmartFeedWithStats extends SmartFeed {
  matched_count: number;
  unread_count: number;
  uncertain_count: number;
  excluded_count: number;
  pending_count: number;
  source_feed_count: number;
  lexical_only_count: number;
}

export interface CreateSmartFeedInput {
  name: string;
  description: string;
  inclusion_criteria?: string;
  exclusion_criteria?: string;
  source_scope?: SmartFeedSourceScope;
  source_scope_config?: SmartFeedSourceScopeConfig;
  classification_mode?: SmartFeedClassificationMode;
  curation_strictness?: SmartFeedStrictness;
  minimum_relevance?: number | null;
  freshness_window_days?: number | null;
  sort_order?: SmartFeedSortOrder;
  group_similar_stories?: boolean;
  is_enabled?: boolean;
  cloud_consent_granted?: boolean;
  preferred_provider?: string | null;
  preferred_model?: string | null;
}

export interface UpdateSmartFeedInput {
  name?: string;
  description?: string;
  inclusion_criteria?: string;
  exclusion_criteria?: string;
  source_scope?: SmartFeedSourceScope;
  source_scope_config?: SmartFeedSourceScopeConfig;
  classification_mode?: SmartFeedClassificationMode;
  curation_strictness?: SmartFeedStrictness;
  minimum_relevance?: number | null;
  freshness_window_days?: number | null;
  sort_order?: SmartFeedSortOrder;
  group_similar_stories?: boolean;
  is_enabled?: boolean;
  cloud_consent_granted?: boolean;
  preferred_provider?: string | null;
  preferred_model?: string | null;
}

export interface SmartFeedBadge {
  smart_feed_id: string;
  smart_feed_name: string;
  relevance_score: number;
}

export interface SmartFeedClusterMember {
  article_id: string;
  feed_id: string;
  feed_title: string;
  title: string;
  url: string;
  published_date?: string | null;
  similarity_kind: "duplicate" | "same_story" | string;
}

export interface SmartFeedArticleItem {
  article_id: string;
  feed_id: string;
  feed_title: string;
  url: string;
  guid?: string | null;
  title: string;
  author?: string | null;
  published_date?: string | null;
  content?: string | null;
  summary?: string | null;
  image_url?: string | null;
  categories: string[];
  is_queued: boolean;
  is_read: boolean;
  date_added: string;
  full_content?: string | null;
  full_content_fetched_at?: string | null;
  decision: SmartFeedMatchDecision;
  relevance_score: number;
  ranking_score: number;
  decision_reason: string;
  matched_evidence: string[];
  decision_source: SmartFeedDecisionSource;
  evaluation_status: SmartFeedEvaluationStatus;
  error_message?: string | null;
  is_user_override: boolean;
  evaluated_at: string;
  active_feedback?: SmartFeedFeedbackType | null;
  also_in_smart_feeds: SmartFeedBadge[];
  cluster_id?: string | null;
  cluster_size: number;
  cluster_members: SmartFeedClusterMember[];
}

export interface SmartFeedArticlesFilter {
  bucket?: SmartFeedMatchDecision;
  search?: string;
  unread_only?: boolean;
  sort_order?: SmartFeedSortOrder;
  group_similar_stories?: boolean;
  limit?: number;
  offset?: number;
}

export interface SmartFeedArticlesResponse {
  smart_feed: SmartFeedWithStats;
  articles: SmartFeedArticleItem[];
  total_in_bucket: number;
  grouped_count: number;
}

export interface SmartFeedFeedbackResult {
  smart_feed_id: string;
  article_id: string;
  decision: SmartFeedMatchDecision;
  active_feedback?: SmartFeedFeedbackType | null;
  is_user_override: boolean;
  decision_reason: string;
}

export interface SmartFeedProgress {
  smart_feed_id: string;
  phase: "idle" | "running" | "completed" | "cancelled" | "failed" | string;
  total: number;
  evaluated: number;
  matched: number;
  excluded: number;
  uncertain: number;
  remaining: number;
  cache_hits: number;
  lexical_only: boolean;
  message?: string | null;
}

export interface SmartFeedRunMetrics {
  smart_feed_id: string;
  total_scanned: number;
  evaluated_count: number;
  matched_count: number;
  excluded_count: number;
  uncertain_count: number;
  deferred_count: number;
  error_count: number;
  cache_hits: number;
  embeddings_reused: number;
  embeddings_generated: number;
  provider_calls: number;
  estimated_tokens: number;
  duration_ms: number;
  articles_per_sec: number;
  cancelled: boolean;
  lexical_only: boolean;
}

export interface SmartFeedCapabilities {
  fast_local_available: boolean;
  semantic_embeddings_available: boolean;
  embedding_provider?: string | null;
  embedding_model?: string | null;
  intelligent_local_available: boolean;
  local_llm_model?: string | null;
  cloud_llm_available: boolean;
  cloud_llm_provider?: string | null;
  cloud_llm_model?: string | null;
  strict_local_only: boolean;
  paid_embeddings_enabled: boolean;
}

export interface SmartFeedsExportPayload {
  schema_version: number;
  exported_at: string;
  smart_feeds: SmartFeed[];
}

export interface SmartFeedsImportResult {
  imported: number;
  skipped: number;
  ids: string[];
}

function keyForProviderType(
  type: "openai" | "openrouter" | "cohere",
): string | undefined {
  const match = useLLMProvidersStore
    .getState()
    .providers.find((p) => p.provider === type && p.apiKey && p.apiKey.trim().length > 0);
  return match?.apiKey;
}

function resolveRuntimeFlags(): {
  embeddingConfig: EmbeddingConfig | null;
  paidEmbeddingsEnabled: boolean;
  strictLocalOnly: boolean;
} {
  const settings = useSettingsStore.getState().settings;
  const paidEmbeddingsEnabled = paidEmbeddingsConsentFlag();
  const strictLocalOnly = settings.ai?.strictLocalOnly === true;
  const emb = settings.embedding;
  if (!emb) {
    return { embeddingConfig: null, paidEmbeddingsEnabled, strictLocalOnly };
  }
  const keys = {
    openai: keyForProviderType("openai") ?? (settings.ai?.provider === "openai" ? settings.ai.apiKey : undefined),
    openrouter:
      keyForProviderType("openrouter") ??
      (settings.ai?.provider === "openrouter" ? settings.ai.apiKey : undefined),
    cohere: keyForProviderType("cohere"),
  };
  const cfg = buildEmbeddingConfig(emb, keys);
  // Only pass cloud embedding config if consent is explicitly enabled; Ollama passes freely.
  if (cfg.provider !== "Ollama" && (!paidEmbeddingsEnabled || strictLocalOnly)) {
    return { embeddingConfig: null, paidEmbeddingsEnabled, strictLocalOnly };
  }
  return { embeddingConfig: cfg, paidEmbeddingsEnabled, strictLocalOnly };
}

export async function createSmartFeed(
  input: CreateSmartFeedInput,
  evaluateNow = true,
): Promise<SmartFeedWithStats> {
  const { embeddingConfig, paidEmbeddingsEnabled, strictLocalOnly } = resolveRuntimeFlags();
  return invokeCommand<SmartFeedWithStats>("create_rss_smart_feed", {
    input,
    evaluateNow,
    embeddingConfig,
    paidEmbeddingsEnabled,
    strictLocalOnly,
  });
}

export async function getSmartFeeds(): Promise<SmartFeedWithStats[]> {
  return invokeCommand<SmartFeedWithStats[]>("get_rss_smart_feeds", {});
}

export async function getSmartFeed(id: string): Promise<SmartFeedWithStats> {
  return invokeCommand<SmartFeedWithStats>("get_rss_smart_feed", { id });
}

export async function updateSmartFeed(
  id: string,
  input: UpdateSmartFeedInput,
  reevaluateNow?: boolean,
): Promise<SmartFeedWithStats> {
  const { embeddingConfig, paidEmbeddingsEnabled, strictLocalOnly } = resolveRuntimeFlags();
  return invokeCommand<SmartFeedWithStats>("update_rss_smart_feed", {
    id,
    input,
    reevaluateNow: reevaluateNow ?? null,
    embeddingConfig,
    paidEmbeddingsEnabled,
    strictLocalOnly,
  });
}

export async function deleteSmartFeed(id: string): Promise<void> {
  return invokeCommand<void>("delete_rss_smart_feed", { id });
}

export async function getSmartFeedArticles(
  smartFeedId: string,
  filter?: SmartFeedArticlesFilter,
): Promise<SmartFeedArticlesResponse> {
  return invokeCommand<SmartFeedArticlesResponse>("get_rss_smart_feed_articles", {
    smartFeedId,
    filter: filter ?? null,
  });
}

export async function evaluateSmartFeed(
  smartFeedId: string,
  options: { forceReevaluate?: boolean; waitForCompletion?: boolean } = {},
): Promise<SmartFeedRunMetrics> {
  const { embeddingConfig, paidEmbeddingsEnabled, strictLocalOnly } = resolveRuntimeFlags();
  return invokeCommand<SmartFeedRunMetrics>("evaluate_rss_smart_feed", {
    smartFeedId,
    forceReevaluate: options.forceReevaluate ?? false,
    waitForCompletion: options.waitForCompletion ?? false,
    embeddingConfig,
    paidEmbeddingsEnabled,
    strictLocalOnly,
  });
}

export async function cancelSmartFeedEvaluation(smartFeedId: string): Promise<boolean> {
  return invokeCommand<boolean>("cancel_rss_smart_feed_evaluation", { smartFeedId });
}

export async function getSmartFeedProgress(smartFeedId: string): Promise<SmartFeedProgress | null> {
  return invokeCommand<SmartFeedProgress | null>("get_rss_smart_feed_progress", { smartFeedId });
}

export async function submitSmartFeedFeedback(
  smartFeedId: string,
  articleId: string,
  feedbackType: SmartFeedFeedbackType,
  note?: string,
): Promise<SmartFeedFeedbackResult> {
  const { embeddingConfig, paidEmbeddingsEnabled, strictLocalOnly } = resolveRuntimeFlags();
  return invokeCommand<SmartFeedFeedbackResult>("submit_rss_smart_feed_feedback", {
    smartFeedId,
    articleId,
    feedbackType,
    note: note ?? null,
    embeddingConfig,
    paidEmbeddingsEnabled,
    strictLocalOnly,
  });
}

export async function getSmartFeedCapabilities(): Promise<SmartFeedCapabilities> {
  const { embeddingConfig, paidEmbeddingsEnabled, strictLocalOnly } = resolveRuntimeFlags();
  return invokeCommand<SmartFeedCapabilities>("get_rss_smart_feed_capabilities", {
    embeddingConfig,
    paidEmbeddingsEnabled,
    strictLocalOnly,
  });
}

export async function getArticleSmartFeedMemberships(
  articleIds: string[],
): Promise<Record<string, SmartFeedBadge[]>> {
  if (articleIds.length === 0) return {};
  return invokeCommand<Record<string, SmartFeedBadge[]>>("get_article_smart_feed_memberships", {
    articleIds,
  });
}

export async function exportSmartFeeds(): Promise<SmartFeedsExportPayload> {
  return invokeCommand<SmartFeedsExportPayload>("export_rss_smart_feeds", {});
}

export async function importSmartFeeds(
  payload: SmartFeedsExportPayload,
): Promise<SmartFeedsImportResult> {
  return invokeCommand<SmartFeedsImportResult>("import_rss_smart_feeds", { payload });
}
