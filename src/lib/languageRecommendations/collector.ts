import {
  upsertLanguageRecommendationCandidate,
  type LanguageCoverageResultRecord,
  type LanguageGeneratedDocumentRecord,
  type LanguageRecommendationCandidateRecord,
} from "../../api/languageEcosystem";
import type { PodcastEpisode } from "../../api/podcast";
import type { FeedItem } from "../../api/rss";
import type { SmartFeedArticleItem } from "../../api/rss-smart-feeds";
import type { YouTubeVideo } from "../../api/youtube";
import type { Document } from "../../types/document";
import type { CoverageProjection, CoverageSummary } from "../languageCoverage";
import type {
  RecommendationCandidate,
  RecommendationCoverageStatus,
  RecommendationLifecycle,
} from "./types";

const DEFAULT_SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MS_EPOCH_THRESHOLD = 1_000_000_000_000;

export type CoverageLookupEntry =
  | LanguageCoverageResultRecord
  | CoverageProjection
  | CoverageSummary;

export type CoveragesByDocId =
  | ReadonlyMap<string, CoverageLookupEntry | undefined>
  | Readonly<Record<string, CoverageLookupEntry | undefined>>;

export interface RssCandidateInput extends FeedItem {
  language?: string;
}

export interface YouTubeCandidateInput extends YouTubeVideo {
  language?: string;
  transcriptText?: string;
  url?: string;
}

export interface PodcastCandidateInput extends PodcastEpisode {
  language?: string;
  topics?: readonly string[];
}

export interface CollectRecommendationCandidatesInput {
  profileId: string;
  targetLanguage: string;
  documents: readonly Document[];
  coveragesByDocId: CoveragesByDocId;
  interests: readonly string[];
  rssItems?: readonly RssCandidateInput[];
  smartFeedItems?: readonly SmartFeedArticleItem[];
  youtubeVideos?: readonly YouTubeCandidateInput[];
  podcastEpisodes?: readonly PodcastCandidateInput[];
  generatedDocuments?: readonly LanguageGeneratedDocumentRecord[];
  existingCandidates?: readonly RecommendationCandidate[];
  includeRead?: boolean;
  now?: number;
}

function normalizeLanguageBase(tag?: string | null): string | undefined {
  if (!tag) return undefined;
  const trimmed = tag.trim().toLocaleLowerCase();
  if (!trimmed) return undefined;
  return trimmed.split(/[-_]/)[0];
}

function matchesTargetLanguage(itemLanguage: string | undefined | null, targetLanguage: string): boolean {
  const itemBase = normalizeLanguageBase(itemLanguage);
  if (!itemBase) return true;
  const targetBase = normalizeLanguageBase(targetLanguage);
  if (!targetBase) return true;
  return itemBase === targetBase;
}

function computeFreshnessScore(timestampMs: number | undefined, now: number): number {
  if (!timestampMs || !Number.isFinite(timestampMs)) return 0.5;
  const ageDays = Math.max(0, (now - timestampMs) / (24 * 60 * 60 * 1000));
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.85;
  if (ageDays <= 30) return 0.65;
  if (ageDays <= 90) return 0.45;
  return 0.25;
}

function parseTimestampMs(raw?: string | number | null): number | undefined {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    return raw < MS_EPOCH_THRESHOLD ? raw * 1000 : raw;
  }
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUrlKey(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    const params = new URLSearchParams(parsed.search);
    for (const key of Array.from(params.keys())) {
      if (key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "fbclid") {
        params.delete(key);
      }
    }
    const query = params.toString();
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function lookupCoverage(
  coveragesByDocId: CoveragesByDocId,
  keys: readonly string[],
): CoverageLookupEntry | undefined {
  for (const key of keys) {
    if (!key) continue;
    const hit =
      coveragesByDocId instanceof Map
        ? coveragesByDocId.get(key)
        : (coveragesByDocId as Record<string, CoverageLookupEntry | undefined>)[key];
    if (hit) return hit;
  }
  return undefined;
}

function isCoverageSummary(entry: CoverageLookupEntry): entry is CoverageSummary {
  return (
    "coveragePercent" in entry &&
    "difficultyScore" in entry &&
    "totalCountedUnits" in entry
  );
}

function extractNumericField(
  obj: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!obj) return undefined;
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveCoverageMetrics(
  entry: CoverageLookupEntry | undefined,
  options: { expectedFingerprint?: string; hasAnalyzableText: boolean },
): {
  coverageStatus: RecommendationCoverageStatus;
  coveragePercent?: number;
  difficultyScore?: number;
  reinforcingLearningCount?: number;
} {
  if (!entry) {
    return {
      coverageStatus: options.hasAnalyzableText ? "pending" : "unavailable",
    };
  }

  if (isCoverageSummary(entry)) {
    const isStaleByFingerprint =
      options.expectedFingerprint &&
      entry.version?.contentFingerprint &&
      options.expectedFingerprint !== entry.version.contentFingerprint;
    if (isStaleByFingerprint) {
      return { coverageStatus: "stale" };
    }
    return {
      coverageStatus: "fresh",
      coveragePercent: entry.coveragePercent,
      difficultyScore: entry.difficultyScore,
      reinforcingLearningCount: entry.stateCounts?.learning,
    };
  }

  const rawFreshness = entry.freshness;
  const entryFingerprint =
    "contentFingerprint" in entry
      ? entry.contentFingerprint
      : entry.version?.contentFingerprint;
  const isStaleByFingerprint =
    options.expectedFingerprint &&
    entryFingerprint &&
    options.expectedFingerprint !== entryFingerprint;

  if (isStaleByFingerprint || rawFreshness === "stale") {
    return { coverageStatus: "stale" };
  }

  if (rawFreshness === "pending") {
    return { coverageStatus: "pending" };
  }

  if (rawFreshness === "unavailable" || rawFreshness === "failed") {
    return { coverageStatus: "unavailable" };
  }

  const summary = entry.summary as Record<string, unknown> | undefined;
  const coveragePercent = extractNumericField(summary, "coveragePercent");
  if (coveragePercent === undefined) {
    return { coverageStatus: "pending" };
  }

  const difficultyScore = extractNumericField(summary, "difficultyScore");
  const stateCounts = summary?.stateCounts as Record<string, unknown> | undefined;
  const reinforcingLearningCount = extractNumericField(stateCounts, "learning");

  return {
    coverageStatus: "fresh",
    coveragePercent,
    difficultyScore,
    reinforcingLearningCount,
  };
}

function collectTopics(
  rawTopics: readonly (string | undefined | null)[],
  interests: readonly string[],
  titleAndSummary?: string,
): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const topic of rawTopics) {
    const clean = topic?.trim();
    if (!clean) continue;
    const lower = clean.toLocaleLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      topics.push(clean);
    }
  }
  if (titleAndSummary) {
    const lowerText = titleAndSummary.toLocaleLowerCase();
    for (const interest of interests) {
      const clean = interest.trim();
      if (!clean) continue;
      const lower = clean.toLocaleLowerCase();
      if (!seen.has(lower) && lowerText.includes(lower)) {
        seen.add(lower);
        topics.push(clean);
      }
    }
  }
  return topics;
}

function resolveDocumentSourceType(doc: Document): string {
  if (doc.fileType === "youtube") return "youtube";
  if (doc.fileType === "video") return "video";
  if (doc.fileType === "audio") {
    return doc.metadata?.source === "podcast" ? "podcast" : "audio";
  }
  if (doc.metadata?.source === "language-generated") return "generated";
  return "library";
}

function hasDocumentText(doc: Document): boolean {
  if (doc.content && doc.content.trim().length > 0) return true;
  return (
    doc.fileType === "epub" ||
    doc.fileType === "pdf" ||
    doc.fileType === "html" ||
    doc.fileType === "markdown"
  );
}

function buildExistingLifecycleMap(
  existingCandidates: readonly RecommendationCandidate[] | undefined,
): Map<string, RecommendationCandidate> {
  const map = new Map<string, RecommendationCandidate>();
  for (const candidate of existingCandidates ?? []) {
    map.set(`${candidate.sourceType}:${candidate.sourceId}`, candidate);
  }
  return map;
}

function applyExistingState(
  candidate: RecommendationCandidate,
  existingMap: Map<string, RecommendationCandidate>,
): RecommendationCandidate {
  const existing = existingMap.get(`${candidate.sourceType}:${candidate.sourceId}`);
  if (!existing) return candidate;
  return {
    ...candidate,
    id: existing.id || candidate.id,
    lifecycle: existing.lifecycle,
    snoozedUntil: existing.snoozedUntil,
    importedDocumentId: existing.importedDocumentId ?? candidate.importedDocumentId,
  };
}

/**
 * Build honest recommendation candidates from the user's real corpus:
 * library documents, RSS articles, smart-feed matches, YouTube videos,
 * podcast episodes, and language-generated documents.
 *
 * Coverage is strictly grounded in real measured coverage results; when
 * unanalyzed, stale, or unavailable, `coverageStatus` reflects that state
 * and `coveragePercent` is never fabricated.
 */
export function collectLibraryRecommendationCandidates(
  input: CollectRecommendationCandidatesInput,
): RecommendationCandidate[] {
  const {
    profileId,
    targetLanguage,
    documents,
    coveragesByDocId,
    interests,
    rssItems = [],
    smartFeedItems = [],
    youtubeVideos = [],
    podcastEpisodes = [],
    generatedDocuments = [],
    existingCandidates,
    includeRead = false,
    now = Date.now(),
  } = input;

  const existingMap = buildExistingLifecycleMap(existingCandidates);
  const rawCandidates: RecommendationCandidate[] = [];

  for (const doc of documents) {
    if (doc.isArchived || doc.isDismissed) continue;
    if (!matchesTargetLanguage(doc.metadata?.language, targetLanguage)) continue;

    const sourceType = resolveDocumentSourceType(doc);
    const coverage = resolveCoverageMetrics(
      lookupCoverage(coveragesByDocId, [doc.id, `${sourceType}:${doc.id}`]),
      {
        expectedFingerprint: doc.contentHash,
        hasAnalyzableText: hasDocumentText(doc),
      },
    );

    const publishedAt =
      parseTimestampMs(doc.contentUpdatedAt ?? doc.dateModified ?? doc.dateAdded) ?? now;
    const topics = collectTopics(
      [doc.category, ...(doc.tags ?? []), ...(doc.metadata?.keywords ?? [])],
      interests,
      `${doc.title} ${doc.metadata?.subject ?? ""}`,
    );

    const lifecycle: RecommendationLifecycle =
      coverage.coverageStatus === "fresh" ? "analyzed" : "candidate";

    rawCandidates.push(
      applyExistingState(
        {
          id: `${sourceType}:${doc.id}`,
          profileId,
          sourceType,
          sourceId: doc.id,
          sourceFingerprint: doc.contentHash || `${sourceType}:${doc.id}:${doc.dateModified}`,
          title: doc.title,
          url: doc.metadata?.url ?? doc.metadata?.originalUrl,
          languageTag: doc.metadata?.language ?? targetLanguage,
          topics,
          coverageStatus: coverage.coverageStatus,
          coveragePercent: coverage.coveragePercent,
          difficultyScore: coverage.difficultyScore,
          reinforcingLearningCount: coverage.reinforcingLearningCount,
          qualityScore: doc.isFavorite ? 0.95 : 0.85,
          freshnessScore: computeFreshnessScore(publishedAt, now),
          lifecycle,
          author: doc.metadata?.author,
          wordCount: doc.metadata?.wordCount,
          publishedAt,
        },
        existingMap,
      ),
    );
  }

  for (const gen of generatedDocuments) {
    if (gen.profileId !== profileId) continue;
    const docKey = gen.documentId || gen.id;
    const coverage = resolveCoverageMetrics(
      lookupCoverage(coveragesByDocId, [docKey, `generated:${gen.id}`]),
      { hasAnalyzableText: true },
    );
    const publishedAt = parseTimestampMs(gen.createdAt) ?? now;
    const topics = collectTopics([gen.actionKind], interests, gen.promptSummary);
    const lifecycle: RecommendationLifecycle =
      coverage.coverageStatus === "fresh" ? "analyzed" : "candidate";

    rawCandidates.push(
      applyExistingState(
        {
          id: `generated:${gen.id}`,
          profileId,
          sourceType: "generated",
          sourceId: gen.id,
          sourceFingerprint: `generated:${gen.id}:${gen.createdAt}`,
          title: gen.promptSummary?.trim() || `Generated ${gen.actionKind}`,
          languageTag: targetLanguage,
          topics,
          coverageStatus: coverage.coverageStatus,
          coveragePercent: coverage.coveragePercent,
          difficultyScore: coverage.difficultyScore,
          reinforcingLearningCount: coverage.reinforcingLearningCount,
          qualityScore: 0.8,
          freshnessScore: computeFreshnessScore(publishedAt, now),
          lifecycle,
          summary: gen.promptSummary,
          publishedAt,
        },
        existingMap,
      ),
    );
  }

  for (const item of smartFeedItems) {
    if (item.decision !== "INCLUDE") continue;
    if (!includeRead && item.is_read) continue;

    const text = item.full_content?.trim() || item.content?.trim() || item.summary?.trim();
    const coverage = resolveCoverageMetrics(
      lookupCoverage(coveragesByDocId, [item.article_id, `smart_feed:${item.article_id}`]),
      { hasAnalyzableText: Boolean(text) },
    );
    const publishedAt = parseTimestampMs(item.published_date ?? item.date_added) ?? now;
    const topics = collectTopics(
      [...item.categories, item.feed_title],
      interests,
      `${item.title} ${item.summary ?? ""}`,
    );

    rawCandidates.push(
      applyExistingState(
        {
          id: `smart_feed:${item.article_id}`,
          profileId,
          sourceType: "smart_feed",
          sourceId: item.article_id,
          sourceFingerprint: `smart_feed:${item.article_id}:${item.evaluated_at}`,
          title: item.title,
          url: item.url,
          languageTag: targetLanguage,
          topics,
          coverageStatus: coverage.coverageStatus,
          coveragePercent: coverage.coveragePercent,
          difficultyScore: coverage.difficultyScore,
          reinforcingLearningCount: coverage.reinforcingLearningCount,
          qualityScore: Math.max(0.5, Math.min(1, item.relevance_score || 0.75)),
          freshnessScore: computeFreshnessScore(publishedAt, now),
          lifecycle: coverage.coverageStatus === "fresh" ? "analyzed" : "candidate",
          author: item.author ?? undefined,
          summary: item.summary ?? undefined,
          publishedAt,
        },
        existingMap,
      ),
    );
  }

  for (const item of rssItems) {
    if (!includeRead && item.read) continue;
    if (!matchesTargetLanguage(item.language, targetLanguage)) continue;

    const text = item.fullContent?.trim() || item.content?.trim() || item.description?.trim();
    const coverage = resolveCoverageMetrics(
      lookupCoverage(coveragesByDocId, [item.id, `rss:${item.id}`]),
      { hasAnalyzableText: Boolean(text) },
    );
    const publishedAt = parseTimestampMs(item.pubDate) ?? now;
    const topics = collectTopics(
      item.categories,
      interests,
      `${item.title} ${item.description}`,
    );

    rawCandidates.push(
      applyExistingState(
        {
          id: `rss:${item.id}`,
          profileId,
          sourceType: "rss",
          sourceId: item.id,
          sourceFingerprint: `rss:${item.id}:${item.pubDate}`,
          title: item.title,
          url: item.link,
          languageTag: item.language ?? targetLanguage,
          topics,
          coverageStatus: coverage.coverageStatus,
          coveragePercent: coverage.coveragePercent,
          difficultyScore: coverage.difficultyScore,
          reinforcingLearningCount: coverage.reinforcingLearningCount,
          qualityScore: item.intelligenceScore !== undefined
            ? Math.max(0.4, Math.min(1, item.intelligenceScore))
            : 0.75,
          freshnessScore: computeFreshnessScore(publishedAt, now),
          lifecycle: coverage.coverageStatus === "fresh" ? "analyzed" : "candidate",
          author: item.author,
          summary: item.description,
          publishedAt,
        },
        existingMap,
      ),
    );
  }

  for (const episode of podcastEpisodes) {
    if (!includeRead && episode.played) continue;
    if (!matchesTargetLanguage(episode.language, targetLanguage)) continue;

    const hasTranscript =
      Boolean(episode.transcriptText?.trim()) || episode.transcriptStatus === "completed";
    const coverage = resolveCoverageMetrics(
      lookupCoverage(coveragesByDocId, [episode.id, `podcast:${episode.id}`]),
      { hasAnalyzableText: hasTranscript },
    );
    const publishedAt = parseTimestampMs(episode.publishedDate ?? episode.dateAdded) ?? now;
    const topics = collectTopics(
      episode.topics ?? [],
      interests,
      `${episode.title} ${episode.description ?? ""}`,
    );

    rawCandidates.push(
      applyExistingState(
        {
          id: `podcast:${episode.id}`,
          profileId,
          sourceType: "podcast",
          sourceId: episode.id,
          sourceFingerprint: `podcast:${episode.id}:${episode.publishedDate ?? episode.dateAdded}`,
          title: episode.title,
          url: episode.link ?? episode.audioUrl,
          languageTag: episode.language ?? targetLanguage,
          topics,
          coverageStatus: coverage.coverageStatus,
          coveragePercent: coverage.coveragePercent,
          difficultyScore: coverage.difficultyScore,
          reinforcingLearningCount: coverage.reinforcingLearningCount,
          qualityScore: 0.78,
          freshnessScore: computeFreshnessScore(publishedAt, now),
          lifecycle: coverage.coverageStatus === "fresh" ? "analyzed" : "candidate",
          summary: episode.description ?? undefined,
          durationSeconds: episode.duration ?? undefined,
          publishedAt,
        },
        existingMap,
      ),
    );
  }

  for (const video of youtubeVideos) {
    if (!matchesTargetLanguage(video.language, targetLanguage)) continue;

    const coverage = resolveCoverageMetrics(
      lookupCoverage(coveragesByDocId, [video.id, `youtube:${video.id}`]),
      { hasAnalyzableText: Boolean(video.transcriptText?.trim()) },
    );
    const publishedAt = parseTimestampMs(video.publishDate || video.uploadDate) ?? now;
    const topics = collectTopics(
      [video.category, ...(video.tags ?? [])],
      interests,
      `${video.title} ${video.description}`,
    );

    rawCandidates.push(
      applyExistingState(
        {
          id: `youtube:${video.id}`,
          profileId,
          sourceType: "youtube",
          sourceId: video.id,
          sourceFingerprint: `youtube:${video.id}:${video.publishDate || video.uploadDate}`,
          title: video.title,
          url: video.url ?? `https://www.youtube.com/watch?v=${video.id}`,
          languageTag: video.language ?? targetLanguage,
          topics,
          coverageStatus: coverage.coverageStatus,
          coveragePercent: coverage.coveragePercent,
          difficultyScore: coverage.difficultyScore,
          reinforcingLearningCount: coverage.reinforcingLearningCount,
          qualityScore: 0.76,
          freshnessScore: computeFreshnessScore(publishedAt, now),
          lifecycle: coverage.coverageStatus === "fresh" ? "analyzed" : "candidate",
          author: video.channel,
          summary: video.description,
          durationSeconds: video.duration,
          publishedAt,
        },
        existingMap,
      ),
    );
  }

  // Deduplicate across corpus sources by normalized URL or shared document/source ID,
  // preserving the first (highest-priority) canonical candidate and marking duplicates.
  const canonicalByKey = new Map<string, string>();
  return rawCandidates.map((candidate) => {
    const dedupKeys: string[] = [];
    const urlKey = normalizeUrlKey(candidate.url);
    if (urlKey) dedupKeys.push(`url:${urlKey}`);
    if (candidate.sourceType === "library" || candidate.sourceType === "generated") {
      dedupKeys.push(`doc:${candidate.sourceId}`);
    } else if (candidate.sourceType === "rss" || candidate.sourceType === "smart_feed") {
      dedupKeys.push(`article:${candidate.sourceId}`);
    }

    let duplicateOf = candidate.duplicateOf;
    if (!duplicateOf) {
      for (const key of dedupKeys) {
        const existingCanonical = canonicalByKey.get(key);
        if (existingCanonical && existingCanonical !== candidate.id) {
          duplicateOf = existingCanonical;
          break;
        }
      }
    }

    if (!duplicateOf) {
      for (const key of dedupKeys) {
        if (!canonicalByKey.has(key)) {
          canonicalByKey.set(key, candidate.id);
        }
      }
    }

    return duplicateOf ? { ...candidate, duplicateOf } : candidate;
  });
}

function toPersistedLifecycle(
  lifecycle: RecommendationLifecycle,
): LanguageRecommendationCandidateRecord["lifecycle"] {
  switch (lifecycle) {
    case "accepted":
    case "imported":
      return "accepted";
    case "dismissed":
      return "dismissed";
    case "snoozed":
      return "snoozed";
    case "expired":
      return "expired";
    default:
      return "candidate";
  }
}

export function toRecommendationCandidateRecord(
  candidate: RecommendationCandidate,
  now = Date.now(),
): LanguageRecommendationCandidateRecord {
  const nowSec = Math.floor(now / 1000);
  return {
    id: candidate.id,
    profileId: candidate.profileId,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceFingerprint: candidate.sourceFingerprint,
    title: candidate.title,
    url: candidate.url,
    explanation: {
      detailedLifecycle: candidate.lifecycle,
      topics: [...candidate.topics],
      languageTag: candidate.languageTag,
      importedDocumentId: candidate.importedDocumentId,
    },
    ranking: {
      coveragePercent: candidate.coveragePercent,
      difficultyScore: candidate.difficultyScore,
      reinforcingLearningCount: candidate.reinforcingLearningCount,
      recentEncounterCount: candidate.recentEncounterCount,
      qualityScore: candidate.qualityScore,
      freshnessScore: candidate.freshnessScore,
      duplicateOf: candidate.duplicateOf,
    },
    coverageStatus: candidate.coverageStatus,
    lifecycle: toPersistedLifecycle(candidate.lifecycle),
    snoozedUntil: candidate.snoozedUntil,
    createdAt: nowSec,
    updatedAt: nowSec,
  };
}

export async function dismissCandidate(
  candidate: RecommendationCandidate,
  now = Date.now(),
): Promise<RecommendationCandidate> {
  const updated: RecommendationCandidate = {
    ...candidate,
    lifecycle: "dismissed",
    snoozedUntil: undefined,
  };
  await upsertLanguageRecommendationCandidate(toRecommendationCandidateRecord(updated, now));
  return updated;
}

export async function snoozeCandidate(
  candidate: RecommendationCandidate,
  durationMsOrUntil: number | { until?: number; durationMs?: number; now?: number } = DEFAULT_SNOOZE_DURATION_MS,
  nowArg = Date.now(),
): Promise<RecommendationCandidate> {
  const now =
    typeof durationMsOrUntil === "object" ? (durationMsOrUntil.now ?? nowArg) : nowArg;
  let snoozedUntil: number;
  if (typeof durationMsOrUntil === "object") {
    snoozedUntil =
      durationMsOrUntil.until ??
      now + (durationMsOrUntil.durationMs ?? DEFAULT_SNOOZE_DURATION_MS);
  } else if (durationMsOrUntil >= MS_EPOCH_THRESHOLD) {
    snoozedUntil = durationMsOrUntil;
  } else {
    snoozedUntil = now + durationMsOrUntil;
  }

  const updated: RecommendationCandidate = {
    ...candidate,
    lifecycle: "snoozed",
    snoozedUntil,
  };
  await upsertLanguageRecommendationCandidate(toRecommendationCandidateRecord(updated, now));
  return updated;
}

export async function markCandidateImported(
  candidate: RecommendationCandidate,
  importedDocumentId?: string,
  now = Date.now(),
): Promise<RecommendationCandidate> {
  const updated: RecommendationCandidate = {
    ...candidate,
    lifecycle: "imported",
    importedDocumentId: importedDocumentId ?? candidate.importedDocumentId,
    snoozedUntil: undefined,
  };
  await upsertLanguageRecommendationCandidate(toRecommendationCandidateRecord(updated, now));
  return updated;
}

export async function acceptCandidate(
  candidate: RecommendationCandidate,
  now = Date.now(),
): Promise<RecommendationCandidate> {
  const updated: RecommendationCandidate = {
    ...candidate,
    lifecycle: "accepted",
    snoozedUntil: undefined,
  };
  await upsertLanguageRecommendationCandidate(toRecommendationCandidateRecord(updated, now));
  return updated;
}
