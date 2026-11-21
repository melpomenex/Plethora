/**
 * Browser/PWA Smart Feeds Backend Handler Set
 *
 * Persists Smart Feed definitions, matches, and feedback events in
 * `localStorage` and evaluates subscribed articles from `localStorage["rss_feeds"]`
 * using `smartFeedsEngine.ts` in honest lexical degraded mode.
 */

import type {
  CreateSmartFeedInput,
  SmartFeed,
  SmartFeedArticleItem,
  SmartFeedArticlesFilter,
  SmartFeedArticlesResponse,
  SmartFeedBadge,
  SmartFeedCapabilities,
  SmartFeedFeedbackResult,
  SmartFeedFeedbackType,
  SmartFeedMatchDecision,
  SmartFeedRunMetrics,
  SmartFeedsExportPayload,
  SmartFeedsImportResult,
  SmartFeedWithStats,
  UpdateSmartFeedInput,
} from "../api/rss-smart-feeds";
import {
  buildQueryProfile,
  computeWithinFeedRanking,
  evaluateArticleAgainstProfile,
  groupSimilarSmartFeedArticles,
  type EngineArticleInput,
} from "../utils/smartFeedsEngine";

const FEEDS_KEY = "rss_smart_feeds_v1";
const MATCHES_KEY = "rss_smart_feed_matches_v1";
const FEEDBACK_KEY = "rss_smart_feed_feedback_v1";

interface StoredMatch {
  smart_feed_id: string;
  article_id: string;
  decision: SmartFeedMatchDecision;
  relevance_score: number;
  ranking_score: number;
  decision_reason: string;
  matched_evidence: string[];
  decision_source: "fast_local" | "user_override" | "candidate_filter";
  content_hash: string;
  definition_revision: number;
  evaluation_status: "completed_lexical" | "completed";
  is_user_override: boolean;
  evaluated_at: string;
}

interface StoredFeedbackEvent {
  id: string;
  smart_feed_id: string;
  article_id: string;
  feedback_type: SmartFeedFeedbackType;
  created_at: string;
}

interface LocalRssFeed {
  id: string;
  title: string;
  items?: Array<{
    id: string;
    title: string;
    description?: string;
    content?: string;
    fullContent?: string;
    fullContentFetchedAt?: string;
    link: string;
    pubDate?: string;
    author?: string;
    categories?: string[];
    guid?: string;
    read?: boolean;
    favorite?: boolean;
    thumbnail?: string;
  }>;
}

interface LocalFolder {
  id: string;
  feeds?: string[];
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadSubscribedArticles(): EngineArticleInput[] {
  const feeds = readJson<LocalRssFeed[]>("rss_feeds", []);
  const out: EngineArticleInput[] = [];
  for (const feed of feeds) {
    for (const item of feed.items ?? []) {
      out.push({
        id: item.id,
        feedId: feed.id,
        feedTitle: feed.title,
        url: item.link,
        guid: item.guid ?? null,
        title: item.title,
        author: item.author ?? null,
        publishedDate: item.pubDate ?? null,
        content: item.content ?? null,
        summary: item.description ?? null,
        imageUrl: item.thumbnail ?? null,
        categories: item.categories ?? [],
        isQueued: Boolean(item.favorite),
        isRead: Boolean(item.read),
        dateAdded: item.pubDate ?? new Date().toISOString(),
        fullContent: item.fullContent ?? null,
        fullContentFetchedAt: item.fullContentFetchedAt ?? null,
      });
    }
  }
  return out;
}

function resolveAllowedFeedIds(feed: SmartFeed): Set<string> | null {
  if (feed.source_scope === "all" || feed.source_scope === "external_discovery") return null;
  if (feed.source_scope === "selected_feeds") {
    return new Set(feed.source_scope_config?.feed_ids ?? []);
  }
  const folders = readJson<LocalFolder[]>("rss_folders", []);
  const folderIds = new Set(feed.source_scope_config?.folder_ids ?? []);
  const allowed = new Set<string>(feed.source_scope_config?.feed_ids ?? []);
  for (const fld of folders) {
    if (folderIds.has(fld.id)) {
      for (const fid of fld.feeds ?? []) allowed.add(fid);
    }
  }
  return allowed;
}

function activeFeedbackMapForFeed(smartFeedId: string): Map<string, SmartFeedFeedbackType> {
  const events = readJson<StoredFeedbackEvent[]>(FEEDBACK_KEY, []);
  const map = new Map<string, SmartFeedFeedbackType>();
  for (const ev of events) {
    if (ev.smart_feed_id !== smartFeedId) continue;
    if (ev.feedback_type === "UNDO") map.delete(ev.article_id);
    else map.set(ev.article_id, ev.feedback_type);
  }
  return map;
}

function computeFeedStats(
  feed: SmartFeed,
  matches: StoredMatch[],
  articlesById: Map<string, EngineArticleInput>,
): SmartFeedWithStats {
  let matched_count = 0;
  let unread_count = 0;
  let uncertain_count = 0;
  let excluded_count = 0;
  let pending_count = 0;
  let lexical_only_count = 0;
  const sourceFeeds = new Set<string>();

  for (const m of matches) {
    if (m.smart_feed_id !== feed.id) continue;
    const art = articlesById.get(m.article_id);
    if (!art) continue;
    if (m.evaluation_status === "completed_lexical") lexical_only_count++;
    if (m.decision === "INCLUDE") {
      matched_count++;
      if (!art.isRead) unread_count++;
      sourceFeeds.add(art.feedId);
    } else if (m.decision === "UNCERTAIN") {
      uncertain_count++;
    } else if (m.decision === "EXCLUDE") {
      excluded_count++;
    } else {
      pending_count++;
    }
  }

  return {
    ...feed,
    matched_count,
    unread_count,
    uncertain_count,
    excluded_count,
    pending_count,
    source_feed_count: sourceFeeds.size,
    lexical_only_count,
  };
}

function evaluateFeedSync(feedId: string, force = false): SmartFeedRunMetrics {
  const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
  const feedIdx = feeds.findIndex((f) => f.id === feedId);
  if (feedIdx < 0) throw new Error(`Smart Feed '${feedId}' not found`);
  const feed = feeds[feedIdx];
  const articles = loadSubscribedArticles();
  const allowed = resolveAllowedFeedIds(feed);
  const cutoffMs =
    feed.freshness_window_days && feed.freshness_window_days > 0
      ? Date.now() - feed.freshness_window_days * 86_400_000
      : null;

  const scoped = articles.filter((a) => {
    if (allowed && !allowed.has(a.feedId)) return false;
    if (cutoffMs !== null) {
      const ts = Date.parse(a.publishedDate ?? a.dateAdded);
      if (Number.isFinite(ts) && ts < cutoffMs) return false;
    }
    return true;
  });

  const activeFb = activeFeedbackMapForFeed(feed.id);
  const articlesById = new Map(articles.map((a) => [a.id, a]));
  const fbInputs: Array<{ feedbackType: SmartFeedFeedbackType; text: string }> = [];
  for (const [aid, fbType] of activeFb.entries()) {
    const art = articlesById.get(aid);
    if (art) fbInputs.push({ feedbackType: fbType, text: `${art.title} ${art.summary ?? ""}` });
  }

  const profile = buildQueryProfile(feed, fbInputs);
  const allMatches = readJson<StoredMatch[]>(MATCHES_KEY, []);
  const existingByKey = new Map<string, StoredMatch>();
  for (const m of allMatches) existingByKey.set(`${m.smart_feed_id}:${m.article_id}`, m);

  let evaluated_count = 0;
  let matched_count = 0;
  let excluded_count = 0;
  let uncertain_count = 0;
  let cache_hits = 0;
  const nowIso = new Date().toISOString();

  for (const art of scoped) {
    const key = `${feed.id}:${art.id}`;
    const existing = existingByKey.get(key);
    if (existing?.is_user_override) {
      cache_hits++;
      if (existing.decision === "INCLUDE") matched_count++;
      else if (existing.decision === "EXCLUDE") excluded_count++;
      else if (existing.decision === "UNCERTAIN") uncertain_count++;
      continue;
    }
    const evalRes = evaluateArticleAgainstProfile(feed, profile, art);
    if (
      !force &&
      existing &&
      existing.definition_revision === feed.definition_revision &&
      existing.content_hash === evalRes.contentHash
    ) {
      cache_hits++;
      if (existing.decision === "INCLUDE") matched_count++;
      else if (existing.decision === "EXCLUDE") excluded_count++;
      else if (existing.decision === "UNCERTAIN") uncertain_count++;
      continue;
    }

    evaluated_count++;
    if (evalRes.decision === "INCLUDE") matched_count++;
    else if (evalRes.decision === "EXCLUDE") excluded_count++;
    else if (evalRes.decision === "UNCERTAIN") uncertain_count++;

    existingByKey.set(key, {
      smart_feed_id: feed.id,
      article_id: art.id,
      decision: evalRes.decision,
      relevance_score: evalRes.relevanceScore,
      ranking_score: evalRes.rankingScore,
      decision_reason: evalRes.decisionReason,
      matched_evidence: evalRes.matchedEvidence,
      decision_source: evalRes.decisionSource as StoredMatch["decision_source"],
      content_hash: evalRes.contentHash,
      definition_revision: feed.definition_revision,
      evaluation_status: "completed_lexical",
      is_user_override: false,
      evaluated_at: nowIso,
    });
  }

  writeJson(MATCHES_KEY, Array.from(existingByKey.values()));
  feeds[feedIdx] = { ...feed, last_evaluated_at: nowIso };
  writeJson(FEEDS_KEY, feeds);

  return {
    smart_feed_id: feed.id,
    total_scanned: scoped.length,
    evaluated_count,
    matched_count,
    excluded_count,
    uncertain_count,
    deferred_count: 0,
    error_count: 0,
    cache_hits,
    embeddings_reused: 0,
    embeddings_generated: 0,
    provider_calls: 0,
    estimated_tokens: 0,
    duration_ms: 1,
    articles_per_sec: scoped.length * 1000,
    cancelled: false,
    lexical_only: true,
  };
}

export function registerBrowserSmartFeedHandlers(
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>,
): void {
  handlers.create_rss_smart_feed = async (args) => {
    const input = args.input as CreateSmartFeedInput;
    if (!input?.name?.trim()) throw new Error("Smart Feed name is required");
    if (!input?.description?.trim() && !input?.inclusion_criteria?.trim()) {
      throw new Error("Smart Feed description or inclusion criteria is required");
    }
    if (input.source_scope === "external_discovery") {
      throw new Error("External web discovery is not enabled");
    }
    const now = new Date().toISOString();
    const feed: SmartFeed = {
      id: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: input.name.trim(),
      description: (input.description ?? "").trim(),
      inclusion_criteria: (input.inclusion_criteria ?? "").trim(),
      exclusion_criteria: (input.exclusion_criteria ?? "").trim(),
      source_scope: input.source_scope ?? "all",
      source_scope_config: input.source_scope_config ?? { feed_ids: [], folder_ids: [] },
      classification_mode: input.classification_mode ?? "fast_local",
      curation_strictness: input.curation_strictness ?? "balanced",
      minimum_relevance: input.minimum_relevance ?? null,
      freshness_window_days: input.freshness_window_days ?? null,
      sort_order: input.sort_order ?? "relevance",
      group_similar_stories: input.group_similar_stories ?? true,
      is_enabled: input.is_enabled ?? true,
      cloud_consent_granted: input.cloud_consent_granted ?? false,
      preferred_provider: input.preferred_provider ?? null,
      preferred_model: input.preferred_model ?? null,
      definition_revision: 1,
      created_at: now,
      updated_at: now,
      last_evaluated_at: null,
    };
    const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    feeds.unshift(feed);
    writeJson(FEEDS_KEY, feeds);
    if (args.evaluateNow !== false && feed.is_enabled) {
      evaluateFeedSync(feed.id);
    }
    const updatedFeeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const storedFeed = updatedFeeds.find((f) => f.id === feed.id) ?? feed;
    const matches = readJson<StoredMatch[]>(MATCHES_KEY, []);
    const articles = new Map(loadSubscribedArticles().map((a) => [a.id, a]));
    return computeFeedStats(storedFeed, matches, articles);
  };

  handlers.get_rss_smart_feeds = async () => {
    const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const matches = readJson<StoredMatch[]>(MATCHES_KEY, []);
    const articles = new Map(loadSubscribedArticles().map((a) => [a.id, a]));
    return feeds.map((f) => computeFeedStats(f, matches, articles));
  };

  handlers.get_rss_smart_feed = async (args) => {
    const id = args.id as string;
    const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const feed = feeds.find((f) => f.id === id);
    if (!feed) throw new Error(`Smart Feed '${id}' not found`);
    const matches = readJson<StoredMatch[]>(MATCHES_KEY, []);
    const articles = new Map(loadSubscribedArticles().map((a) => [a.id, a]));
    return computeFeedStats(feed, matches, articles);
  };

  handlers.update_rss_smart_feed = async (args) => {
    const id = args.id as string;
    const input = (args.input ?? {}) as UpdateSmartFeedInput;
    if (input.source_scope === "external_discovery") {
      throw new Error("External web discovery is not enabled");
    }
    const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const idx = feeds.findIndex((f) => f.id === id);
    if (idx < 0) throw new Error(`Smart Feed '${id}' not found`);
    const prev = feeds[idx];
    const next: SmartFeed = {
      ...prev,
      name: input.name !== undefined ? input.name.trim() : prev.name,
      description: input.description !== undefined ? input.description.trim() : prev.description,
      inclusion_criteria:
        input.inclusion_criteria !== undefined
          ? input.inclusion_criteria.trim()
          : prev.inclusion_criteria,
      exclusion_criteria:
        input.exclusion_criteria !== undefined
          ? input.exclusion_criteria.trim()
          : prev.exclusion_criteria,
      source_scope: input.source_scope ?? prev.source_scope,
      source_scope_config: input.source_scope_config ?? prev.source_scope_config,
      classification_mode: input.classification_mode ?? prev.classification_mode,
      curation_strictness: input.curation_strictness ?? prev.curation_strictness,
      minimum_relevance:
        input.minimum_relevance !== undefined ? input.minimum_relevance : prev.minimum_relevance,
      freshness_window_days:
        input.freshness_window_days !== undefined
          ? input.freshness_window_days
          : prev.freshness_window_days,
      sort_order: input.sort_order ?? prev.sort_order,
      group_similar_stories: input.group_similar_stories ?? prev.group_similar_stories,
      is_enabled: input.is_enabled ?? prev.is_enabled,
      cloud_consent_granted: input.cloud_consent_granted ?? prev.cloud_consent_granted,
      definition_revision: prev.definition_revision + 1,
      updated_at: new Date().toISOString(),
    };
    feeds[idx] = next;
    writeJson(FEEDS_KEY, feeds);
    if (args.reevaluateNow !== false && next.is_enabled) {
      evaluateFeedSync(next.id, true);
    }
    const matches = readJson<StoredMatch[]>(MATCHES_KEY, []);
    const articles = new Map(loadSubscribedArticles().map((a) => [a.id, a]));
    return computeFeedStats(
      readJson<SmartFeed[]>(FEEDS_KEY, []).find((f) => f.id === id) ?? next,
      matches,
      articles,
    );
  };

  handlers.delete_rss_smart_feed = async (args) => {
    const id = args.id as string;
    writeJson(
      FEEDS_KEY,
      readJson<SmartFeed[]>(FEEDS_KEY, []).filter((f) => f.id !== id),
    );
    writeJson(
      MATCHES_KEY,
      readJson<StoredMatch[]>(MATCHES_KEY, []).filter((m) => m.smart_feed_id !== id),
    );
    writeJson(
      FEEDBACK_KEY,
      readJson<StoredFeedbackEvent[]>(FEEDBACK_KEY, []).filter((f) => f.smart_feed_id !== id),
    );
  };

  handlers.get_rss_smart_feed_articles = async (args) => {
    const smartFeedId = args.smartFeedId as string;
    const filter = (args.filter ?? {}) as SmartFeedArticlesFilter;
    const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const feed = feeds.find((f) => f.id === smartFeedId);
    if (!feed) throw new Error(`Smart Feed '${smartFeedId}' not found`);
    const matches = readJson<StoredMatch[]>(MATCHES_KEY, []);
    const articlesList = loadSubscribedArticles();
    const articlesById = new Map(articlesList.map((a) => [a.id, a]));
    const activeFb = activeFeedbackMapForFeed(smartFeedId);
    const bucket = filter.bucket ?? "INCLUDE";
    const searchLower = filter.search?.trim().toLowerCase() ?? "";

    // Build sibling memberships map
    const feedNameById = new Map(feeds.map((f) => [f.id, f.name]));
    const memberships = new Map<string, SmartFeedBadge[]>();
    for (const m of matches) {
      if (m.decision !== "INCLUDE" || m.smart_feed_id === smartFeedId) continue;
      const arr = memberships.get(m.article_id) ?? [];
      arr.push({
        smart_feed_id: m.smart_feed_id,
        smart_feed_name: feedNameById.get(m.smart_feed_id) ?? "Smart Feed",
        relevance_score: m.relevance_score,
      });
      memberships.set(m.article_id, arr);
    }

    let items: SmartFeedArticleItem[] = [];
    for (const m of matches) {
      if (m.smart_feed_id !== smartFeedId) continue;
      if (m.decision !== bucket) continue;
      const art = articlesById.get(m.article_id);
      if (!art) continue;
      if (filter.unread_only && art.isRead) continue;
      if (searchLower) {
        const hay = `${art.title} ${art.feedTitle} ${art.summary ?? ""} ${m.decision_reason}`.toLowerCase();
        if (!hay.includes(searchLower)) continue;
      }
      items.push({
        article_id: art.id,
        feed_id: art.feedId,
        feed_title: art.feedTitle,
        url: art.url,
        guid: art.guid ?? null,
        title: art.title,
        author: art.author ?? null,
        published_date: art.publishedDate ?? null,
        content: art.content ?? null,
        summary: art.summary ?? null,
        image_url: art.imageUrl ?? null,
        categories: art.categories ?? [],
        is_queued: Boolean(art.isQueued),
        is_read: Boolean(art.isRead),
        date_added: art.dateAdded,
        full_content: art.fullContent ?? null,
        full_content_fetched_at: art.fullContentFetchedAt ?? null,
        decision: m.decision,
        relevance_score: m.relevance_score,
        ranking_score: m.ranking_score,
        decision_reason: m.decision_reason,
        matched_evidence: m.matched_evidence,
        decision_source: m.decision_source,
        evaluation_status: m.evaluation_status,
        error_message: null,
        is_user_override: m.is_user_override,
        evaluated_at: m.evaluated_at,
        active_feedback: activeFb.get(art.id) ?? null,
        also_in_smart_feeds: memberships.get(art.id) ?? [],
        cluster_id: null,
        cluster_size: 1,
        cluster_members: [],
      });
    }

    const sortOrder = filter.sort_order ?? feed.sort_order;
    items.sort((a, b) => {
      if (sortOrder === "newest") {
        return Date.parse(b.published_date ?? b.date_added) - Date.parse(a.published_date ?? a.date_added);
      }
      if (sortOrder === "oldest") {
        return Date.parse(a.published_date ?? a.date_added) - Date.parse(b.published_date ?? b.date_added);
      }
      if (sortOrder === "unread_first" && a.is_read !== b.is_read) {
        return a.is_read ? 1 : -1;
      }
      return b.ranking_score - a.ranking_score;
    });

    const total_in_bucket = items.length;
    const shouldGroup = filter.group_similar_stories ?? feed.group_similar_stories;
    if (shouldGroup && bucket === "INCLUDE" && items.length > 1) {
      items = groupSimilarSmartFeedArticles(items);
    }

    const resp: SmartFeedArticlesResponse = {
      smart_feed: computeFeedStats(feed, matches, articlesById),
      articles: items,
      total_in_bucket,
      grouped_count: items.length,
    };
    return resp;
  };

  handlers.evaluate_rss_smart_feed = async (args) =>
    evaluateFeedSync(args.smartFeedId as string, Boolean(args.forceReevaluate));

  handlers.cancel_rss_smart_feed_evaluation = async () => false;

  handlers.get_rss_smart_feed_progress = async () => null;

  handlers.submit_rss_smart_feed_feedback = async (args) => {
    const smartFeedId = args.smartFeedId as string;
    const articleId = args.articleId as string;
    const feedbackType = args.feedbackType as SmartFeedFeedbackType;
    const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const feed = feeds.find((f) => f.id === smartFeedId);
    if (!feed) throw new Error(`Smart Feed '${smartFeedId}' not found`);

    const events = readJson<StoredFeedbackEvent[]>(FEEDBACK_KEY, []);
    events.push({
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      smart_feed_id: smartFeedId,
      article_id: articleId,
      feedback_type: feedbackType,
      created_at: new Date().toISOString(),
    });
    writeJson(FEEDBACK_KEY, events);

    const matches = readJson<StoredMatch[]>(MATCHES_KEY, []);
    const articlesById = new Map(loadSubscribedArticles().map((a) => [a.id, a]));
    const art = articlesById.get(articleId);

    if (feedbackType === "UNDO") {
      const filtered = matches.filter(
        (m) => !(m.smart_feed_id === smartFeedId && m.article_id === articleId),
      );
      writeJson(MATCHES_KEY, filtered);
      evaluateFeedSync(smartFeedId, true);
      const after = readJson<StoredMatch[]>(MATCHES_KEY, []).find(
        (m) => m.smart_feed_id === smartFeedId && m.article_id === articleId,
      );
      const decision: SmartFeedMatchDecision = after?.decision ?? "UNCERTAIN";
      return {
        smart_feed_id: smartFeedId,
        article_id: articleId,
        decision,
        active_feedback: null,
        is_user_override: false,
        decision_reason: `Feedback undone; automated classification restored (${decision}).`,
      } satisfies SmartFeedFeedbackResult;
    }

    const decision: SmartFeedMatchDecision =
      feedbackType === "SHOULD_INCLUDE" ? "INCLUDE" : "EXCLUDE";
    const relevance = decision === "INCLUDE" ? 0.96 : 0.02;
    const reason =
      decision === "INCLUDE"
        ? `Manually included in ${feed.name} by user feedback.`
        : `Manually excluded from ${feed.name} by user feedback.`;
    const nextMatch: StoredMatch = {
      smart_feed_id: smartFeedId,
      article_id: articleId,
      decision,
      relevance_score: relevance,
      ranking_score: computeWithinFeedRanking(
        relevance,
        art?.publishedDate,
        decision === "INCLUDE" ? 1 : 0,
      ),
      decision_reason: reason,
      matched_evidence: ["user feedback override"],
      decision_source: "user_override",
      content_hash: "",
      definition_revision: feed.definition_revision,
      evaluation_status: "completed",
      is_user_override: true,
      evaluated_at: new Date().toISOString(),
    };
    const nextMatches = matches.filter(
      (m) => !(m.smart_feed_id === smartFeedId && m.article_id === articleId),
    );
    nextMatches.push(nextMatch);
    writeJson(MATCHES_KEY, nextMatches);
    return {
      smart_feed_id: smartFeedId,
      article_id: articleId,
      decision,
      active_feedback: feedbackType,
      is_user_override: true,
      decision_reason: reason,
    } satisfies SmartFeedFeedbackResult;
  };

  handlers.get_rss_smart_feed_capabilities = async (): Promise<SmartFeedCapabilities> => ({
    fast_local_available: true,
    semantic_embeddings_available: false,
    embedding_provider: null,
    embedding_model: null,
    intelligent_local_available: false,
    local_llm_model: null,
    cloud_llm_available: false,
    cloud_llm_provider: null,
    cloud_llm_model: null,
    strict_local_only: false,
    paid_embeddings_enabled: false,
  });

  handlers.get_article_smart_feed_memberships = async (args) => {
    const ids = new Set((args.articleIds as string[]) ?? []);
    const feeds = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const feedNameById = new Map(feeds.map((f) => [f.id, f.name]));
    const matches = readJson<StoredMatch[]>(MATCHES_KEY, []);
    const out: Record<string, SmartFeedBadge[]> = {};
    for (const m of matches) {
      if (m.decision !== "INCLUDE" || !ids.has(m.article_id)) continue;
      if (!out[m.article_id]) out[m.article_id] = [];
      out[m.article_id].push({
        smart_feed_id: m.smart_feed_id,
        smart_feed_name: feedNameById.get(m.smart_feed_id) ?? "Smart Feed",
        relevance_score: m.relevance_score,
      });
    }
    return out;
  };

  handlers.export_rss_smart_feeds = async (): Promise<SmartFeedsExportPayload> => ({
    schema_version: 1,
    exported_at: new Date().toISOString(),
    smart_feeds: readJson<SmartFeed[]>(FEEDS_KEY, []).map((f) => ({
      ...f,
      cloud_consent_granted: false,
    })),
  });

  handlers.import_rss_smart_feeds = async (args): Promise<SmartFeedsImportResult> => {
    const payload = args.payload as SmartFeedsExportPayload;
    const existing = readJson<SmartFeed[]>(FEEDS_KEY, []);
    const existingIds = new Set(existing.map((f) => f.id));
    let imported = 0;
    let skipped = 0;
    const ids: string[] = [];
    for (const f of payload?.smart_feeds ?? []) {
      if (!f.name?.trim() || existingIds.has(f.id)) {
        skipped++;
        continue;
      }
      const created = (await handlers.create_rss_smart_feed({
        input: { ...f, cloud_consent_granted: false },
        evaluateNow: false,
      })) as SmartFeedWithStats;
      ids.push(created.id);
      imported++;
    }
    return { imported, skipped, ids };
  };
}
