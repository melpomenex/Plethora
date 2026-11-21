/**
 * Pure TypeScript Smart Feeds Curation Engine
 *
 * Provides deterministic, zero-network local evaluation, Unicode-safe story
 * clustering, bounded feedback adaptation, strictness calibration, and
 * prompt-injection sanitization for:
 *   1. Web/PWA browser-backend fallback (`src/lib/browser-backend.ts`)
 *   2. Fast deterministic unit tests and Vitest performance benchmarks
 */

import type {
  SmartFeed,
  SmartFeedArticleItem,
  SmartFeedClusterMember,
  SmartFeedDecisionSource,
  SmartFeedFeedbackType,
  SmartFeedMatchDecision,
  SmartFeedStrictness,
} from "../api/rss-smart-feeds";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "over", "about", "involving",
  "related", "including", "without", "generic", "unrelated", "everyday", "meaningful",
  "connection", "specified", "important", "developments", "articles", "content", "news",
  "other", "more", "most", "some", "such", "than", "then", "them", "they", "their", "there",
  "these", "those", "have", "has", "had", "will", "would", "could", "should", "being", "been",
  "are", "was", "were", "can", "not", "but", "all", "any", "only", "also", "very", "well",
  "new", "how", "why", "what", "when", "where", "which", "who", "its", "our", "your", "you",
]);

const BOILERPLATE_EXCLUSION_WORDS = new Set([
  "unrelated", "without", "generic", "everyday", "meaningful", "connection",
  "specified", "news", "content", "articles", "information", "substantive",
]);

export interface EngineArticleInput {
  id: string;
  feedId: string;
  feedTitle: string;
  url: string;
  guid?: string | null;
  title: string;
  author?: string | null;
  publishedDate?: string | null;
  content?: string | null;
  summary?: string | null;
  imageUrl?: string | null;
  categories?: string[];
  isQueued?: boolean;
  isRead?: boolean;
  dateAdded: string;
  fullContent?: string | null;
  fullContentFetchedAt?: string | null;
  embedding?: number[] | null;
}

export interface EngineEvaluationResult {
  articleId: string;
  decision: SmartFeedMatchDecision;
  relevanceScore: number;
  rankingScore: number;
  decisionReason: string;
  matchedEvidence: string[];
  decisionSource: SmartFeedDecisionSource;
  contentHash: string;
}

export interface SmartFeedQueryProfile {
  positiveStems: Map<string, number>;
  positivePhrases: Set<string>;
  negativeStems: Set<string>;
  negativePhrases: Set<string>;
  feedbackTermWeights: Map<string, number>;
  positiveVector?: number[] | null;
  negativeVector?: number[] | null;
}

export function stripHtmlToText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function stemToken(raw: string): string {
  const w = raw.toLowerCase();
  if (w.length <= 3) return w;
  let stripped = w;
  if (w.length > 6 && w.endsWith("ization")) stripped = w.slice(0, -7);
  else if (w.length > 6 && w.endsWith("ations")) stripped = w.slice(0, -6);
  else if (w.length > 5 && w.endsWith("ation")) stripped = w.slice(0, -5);
  else if (w.length > 6 && w.endsWith("ities")) stripped = w.slice(0, -5);
  else if (w.length > 5 && w.endsWith("ments")) stripped = w.slice(0, -5);
  else if (w.length > 4 && w.endsWith("ment")) stripped = w.slice(0, -4);
  else if (w.length > 5 && w.endsWith("ness")) stripped = w.slice(0, -4);
  else if (w.length > 5 && w.endsWith("ings")) stripped = w.slice(0, -4);
  else if (w.length > 4 && w.endsWith("ing")) stripped = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ies")) stripped = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ers")) stripped = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) stripped = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) stripped = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("ly")) stripped = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("al")) stripped = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) stripped = w.slice(0, -1);

  if (stripped.length > 4 && stripped.endsWith("e")) stripped = stripped.slice(0, -1);
  return stripped.length >= 3 ? stripped : w;
}

export function tokenizeStems(text: string): string[] {
  const out: string[] = [];
  const parts = text.split(/[^\p{L}\p{N}_-]+/u);
  for (const raw of parts) {
    const cleaned = raw.replace(/^[_-]+|[_-]+$/g, "");
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    const isShortAcronym = cleaned.length === 2 && /^[A-Z]{2}$/.test(cleaned);
    if (lower.length < 3 && !isShortAcronym) continue;
    if (STOPWORDS.has(lower)) continue;
    if (lower.includes("-") || lower.includes("_")) {
      out.push(lower);
      for (const sub of lower.split(/[-_]/)) {
        if (sub.length >= 3 && !STOPWORDS.has(sub)) {
          out.push(stemToken(sub));
        }
      }
    } else {
      out.push(stemToken(lower));
    }
  }
  return out;
}

export function extractPhrases(text: string): string[] {
  const words = text
    .split(/[^\p{L}\p{N}-]+/u)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map((w) => stemToken(w));
  const phrases: string[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    if (words[i] !== words[i + 1]) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
    }
  }
  return phrases;
}

export function fastFnvHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function sanitizeUntrustedPromptText(text: string, maxChars = 1400): string {
  const cleaned = Array.from(text)
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 || c === "\n";
    })
    .join("")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```/g, "'''")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= maxChars ? cleaned : cleaned.slice(0, maxChars);
}

export function buildQueryProfile(
  feed: Pick<SmartFeed, "name" | "description" | "inclusion_criteria" | "exclusion_criteria">,
  feedbackArticles: Array<{ feedbackType: SmartFeedFeedbackType; text: string }> = [],
  vectors?: { positiveVector?: number[] | null; negativeVector?: number[] | null },
): SmartFeedQueryProfile {
  const posText = `${feed.name}\n${feed.description}\n${feed.inclusion_criteria ?? ""}`;
  const stemCounts = new Map<string, number>();
  for (const stem of tokenizeStems(posText)) {
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  const positiveStems = new Map<string, number>();
  for (const [stem, count] of stemCounts.entries()) {
    const w = stem.length <= 2 ? 0.55 : count > 1 ? 1.15 : 1.0;
    positiveStems.set(stem, w);
  }
  const positivePhrases = new Set(extractPhrases(posText));

  const negativeStems = new Set<string>();
  for (const stem of tokenizeStems(feed.exclusion_criteria ?? "")) {
    if (!positiveStems.has(stem) && !BOILERPLATE_EXCLUSION_WORDS.has(stem)) {
      negativeStems.add(stem);
    }
  }
  const negativePhrases = new Set(
    extractPhrases(feed.exclusion_criteria ?? "").filter((ph) => !positivePhrases.has(ph)),
  );

  const feedbackTermWeights = computeFeedbackLexicalWeights(feedbackArticles, positiveStems);

  return {
    positiveStems,
    positivePhrases,
    negativeStems,
    negativePhrases,
    feedbackTermWeights,
    positiveVector: vectors?.positiveVector ?? null,
    negativeVector: vectors?.negativeVector ?? null,
  };
}

function computeFeedbackLexicalWeights(
  feedbackArticles: Array<{ feedbackType: SmartFeedFeedbackType; text: string }>,
  positiveStems: Map<string, number>,
): Map<string, number> {
  if (feedbackArticles.length === 0) return new Map();
  const posDf = new Map<string, number>();
  const negDf = new Map<string, number>();
  let posDocs = 0;
  let negDocs = 0;

  for (const fb of feedbackArticles) {
    if (fb.feedbackType === "UNDO") continue;
    const stems = new Set(tokenizeStems(fb.text));
    if (fb.feedbackType === "SHOULD_INCLUDE") {
      posDocs++;
      for (const s of stems) posDf.set(s, (posDf.get(s) ?? 0) + 1);
    } else {
      negDocs++;
      for (const s of stems) negDf.set(s, (negDf.get(s) ?? 0) + 1);
    }
  }

  const total = posDocs + negDocs;
  if (total === 0) return new Map();
  const damping = Math.min(total, 5) / 5;
  const allTerms = new Set([...posDf.keys(), ...negDf.keys()]);
  const out = new Map<string, number>();

  for (const term of allTerms) {
    if (positiveStems.has(term)) continue;
    const p = posDf.get(term) ?? 0;
    const n = negDf.get(term) ?? 0;
    const pProb = (p + 1) / (posDocs + 2);
    const nProb = (n + 1) / (negDocs + 2);
    const bounded = Math.max(-0.12, Math.min(0.12, Math.log(pProb / nProb) * 0.06 * damping));
    if (Math.abs(bounded) >= 0.015) out.set(term, bounded);
  }
  return out;
}

function exactCosine(a?: number[] | null, b?: number[] | null): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0 || !Number.isFinite(denom)) return null;
  return Math.max(-1, Math.min(1, dot / denom));
}

export function thresholdsForStrictness(
  strictness: SmartFeedStrictness,
  semanticAvailable: boolean,
  minimumRelevance?: number | null,
): { includeFloor: number; uncertainFloor: number } {
  let includeFloor: number;
  let uncertainFloor: number;
  if (semanticAvailable) {
    includeFloor = strictness === "broad" ? 0.36 : strictness === "strict" ? 0.58 : 0.46;
    uncertainFloor = strictness === "broad" ? 0.24 : strictness === "strict" ? 0.42 : 0.32;
  } else {
    includeFloor = strictness === "broad" ? 0.24 : strictness === "strict" ? 0.46 : 0.34;
    uncertainFloor = strictness === "broad" ? 0.14 : strictness === "strict" ? 0.31 : 0.21;
  }
  if (minimumRelevance != null && Number.isFinite(minimumRelevance)) {
    const clamped = Math.max(0.05, Math.min(0.95, minimumRelevance));
    includeFloor = Math.max(includeFloor, clamped);
    uncertainFloor = Math.min(includeFloor - 0.02, Math.max(0.05, includeFloor - 0.12));
  }
  return { includeFloor, uncertainFloor };
}

export function computeWithinFeedRanking(
  relevanceScore: number,
  publishedDate?: string | null,
  feedbackLift = 0.5,
  nowMs = Date.now(),
): number {
  let freshness = 0.45;
  if (publishedDate) {
    const parsed = Date.parse(publishedDate);
    if (Number.isFinite(parsed)) {
      const ageDays = Math.max(0, (nowMs - parsed) / 86_400_000);
      freshness = Math.max(0.05, Math.min(1, Math.pow(0.5, ageDays / 14)));
    }
  }
  return Math.max(
    0,
    Math.min(1, 0.62 * relevanceScore + 0.28 * freshness + 0.1 * feedbackLift),
  );
}

export function evaluateArticleAgainstProfile(
  feed: Pick<
    SmartFeed,
    "name" | "curation_strictness" | "minimum_relevance"
  >,
  profile: SmartFeedQueryProfile,
  article: EngineArticleInput,
  nowMs = Date.now(),
): EngineEvaluationResult {
  const summaryText = stripHtmlToText(article.summary ?? "");
  const bodyRaw = (article.fullContent && article.fullContent.trim()) ? article.fullContent : (article.content ?? "");
  const bodyText = stripHtmlToText(bodyRaw);
  const bestText = bodyText.length >= summaryText.length ? bodyText : summaryText;
  const catText = (article.categories ?? []).join(" ");

  const titleStems = new Set(tokenizeStems(article.title));
  const catStems = new Set(tokenizeStems(catText));
  const summaryStems = new Set(tokenizeStems(summaryText));
  const bodyStems = new Set(tokenizeStems(bestText));
  const articlePhrases = new Set(extractPhrases(`${article.title} ${catText} ${summaryText} ${bestText}`));

  let weightedPosSum = 0;
  let distinctPositiveHits = 0;
  let strongNonAcronymHits = 0;
  const matchedPos: string[] = [];

  for (const [stem, specW] of profile.positiveStems.entries()) {
    const inTitle = titleStems.has(stem);
    const inCat = catStems.has(stem);
    const inSummary = summaryStems.has(stem);
    const inBody = bodyStems.has(stem);
    if (inTitle || inCat || inSummary || inBody) {
      distinctPositiveHits++;
      if (specW >= 0.9) strongNonAcronymHits++;
      const fieldW =
        (inTitle ? 1.45 : 0) +
        (inCat ? 0.9 : 0) +
        (inSummary ? 0.7 : 0) +
        (inBody ? 0.55 : 0);
      weightedPosSum += Math.min(2.1, fieldW) * specW;
      matchedPos.push(stem);
    }
  }

  let phraseBonus = 0;
  for (const phrase of profile.positivePhrases) {
    if (articlePhrases.has(phrase)) {
      phraseBonus += 0.55;
      if (matchedPos.length < 8) matchedPos.push(phrase);
    }
  }

  const rawPos = weightedPosSum + phraseBonus;
  let positiveLexicalScore = Math.max(0, Math.min(1, 1 - Math.exp(-rawPos / 3.4)));
  if (distinctPositiveHits <= 1 && phraseBonus === 0) {
    const cap = strongNonAcronymHits === 0 ? 0.16 : 0.22;
    positiveLexicalScore = Math.min(positiveLexicalScore, cap);
  }

  let negSum = 0;
  const matchedNeg: string[] = [];
  for (const stem of profile.negativeStems) {
    const inTitle = titleStems.has(stem);
    const inCat = catStems.has(stem);
    const inSummary = summaryStems.has(stem);
    const inBody = bodyStems.has(stem);
    if (inTitle || inCat || inSummary || inBody) {
      const w = (inTitle ? 1.35 : 0) + (inCat ? 0.85 : 0) + (inSummary ? 0.65 : 0) + (inBody ? 0.45 : 0);
      negSum += Math.min(1.8, w);
      matchedNeg.push(stem);
    }
  }
  for (const phrase of profile.negativePhrases) {
    if (articlePhrases.has(phrase)) {
      negSum += 0.9;
      matchedNeg.push(phrase);
    }
  }
  const negativeLexicalScore = Math.max(0, Math.min(1, 1 - Math.exp(-negSum / 2.0)));

  let feedbackLexicalDelta = 0;
  for (const [term, w] of profile.feedbackTermWeights.entries()) {
    if (titleStems.has(term) || summaryStems.has(term) || bodyStems.has(term)) {
      feedbackLexicalDelta += w;
    }
  }
  feedbackLexicalDelta = Math.max(-0.12, Math.min(0.12, feedbackLexicalDelta));

  const posSemSim = exactCosine(article.embedding, profile.positiveVector);
  const negSemSim = exactCosine(article.embedding, profile.negativeVector);
  const semanticAvailable = posSemSim !== null;

  const isCandidate =
    (posSemSim !== null && posSemSim >= 0.26) ||
    positiveLexicalScore >= 0.1 ||
    feedbackLexicalDelta >= 0.05;

  const contentHash = fastFnvHash(
    `${article.title}\0${catText}\0${summaryText}\0${bestText.slice(0, 2000)}`,
  );

  if (!isCandidate) {
    const reason =
      matchedNeg.length > 0
        ? `Excluded from ${feed.name} because it matched exclusion criteria (${matchedNeg.slice(0, 4).join(", ")}) without topical overlap.`
        : `Excluded from ${feed.name} because no topical or semantic alignment matched the feed definition.`;
    return {
      articleId: article.id,
      decision: "EXCLUDE",
      relevanceScore: 0.05,
      rankingScore: computeWithinFeedRanking(0.05, article.publishedDate, 0.5, nowMs),
      decisionReason: reason,
      matchedEvidence: matchedNeg.slice(0, 5),
      decisionSource: "candidate_filter",
      contentHash,
    };
  }

  let relevanceScore: number;
  if (semanticAvailable && posSemSim !== null) {
    const semPos = Math.max(0, Math.min(1, (posSemSim - 0.18) / 0.55));
    const negSemPen = negSemSim !== null ? Math.max(0, Math.min(1, (negSemSim - 0.25) / 0.5)) : 0;
    const combinedPos = 0.5 * semPos + 0.32 * positiveLexicalScore + 0.18 * Math.max(semPos, positiveLexicalScore);
    const negPenalty = 0.38 * negativeLexicalScore + 0.28 * negSemPen;
    relevanceScore = Math.max(0, Math.min(1, combinedPos - negPenalty + feedbackLexicalDelta));
  } else {
    relevanceScore = Math.max(
      0,
      Math.min(1, positiveLexicalScore - 0.55 * negativeLexicalScore + feedbackLexicalDelta),
    );
  }

  const { includeFloor, uncertainFloor } = thresholdsForStrictness(
    feed.curation_strictness,
    semanticAvailable,
    feed.minimum_relevance,
  );

  const decision: SmartFeedMatchDecision =
    relevanceScore >= includeFloor
      ? "INCLUDE"
      : relevanceScore >= uncertainFloor
        ? "UNCERTAIN"
        : "EXCLUDE";

  const evidence: string[] = [];
  for (const t of matchedPos.slice(0, 4)) evidence.push(`topic: ${t}`);
  if (posSemSim !== null && posSemSim >= 0.32) {
    evidence.push(`semantic similarity: ${posSemSim.toFixed(2)}`);
  }
  for (const t of matchedNeg.slice(0, 3)) evidence.push(`exclusion: ${t}`);

  const decisionReason =
    decision === "INCLUDE"
      ? `Included in ${feed.name} (score ${relevanceScore.toFixed(2)}) matching ${matchedPos.slice(0, 4).join(", ") || "semantic definition"}.`
      : decision === "UNCERTAIN"
        ? `Borderline match for ${feed.name} (score ${relevanceScore.toFixed(2)}).`
        : matchedNeg.length > 0
          ? `Excluded from ${feed.name} (score ${relevanceScore.toFixed(2)}): matched exclusion criteria (${matchedNeg.slice(0, 3).join(", ")}).`
          : `Excluded from ${feed.name} (score ${relevanceScore.toFixed(2)}): insufficient topical overlap.`;

  return {
    articleId: article.id,
    decision,
    relevanceScore,
    rankingScore: computeWithinFeedRanking(relevanceScore, article.publishedDate, 0.5, nowMs),
    decisionReason,
    matchedEvidence: evidence.slice(0, 6),
    decisionSource: "fast_local",
    contentHash,
  };
}

export function unicodeTrigramSimilarity(a: string, b: string): number {
  const normA = a.toLowerCase().replace(/\s+/g, " ").trim();
  const normB = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const charsA = Array.from(normA);
  const charsB = Array.from(normB);
  if (charsA.length < 3 || charsB.length < 3) return 0;

  const setA = new Set<string>();
  for (let i = 0; i + 2 < charsA.length; i++) setA.add(charsA[i] + charsA[i + 1] + charsA[i + 2]);
  const setB = new Set<string>();
  for (let i = 0; i + 2 < charsB.length; i++) setB.add(charsB[i] + charsB[i + 1] + charsB[i + 2]);

  let inter = 0;
  for (const g of setA) {
    if (setB.has(g)) inter++;
  }
  return (2 * inter) / (setA.size + setB.size);
}

export function canonicalUrlKey(url: string): string {
  const trimmed = url.trim().toLowerCase();
  const noScheme = trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const [base, q] = noScheme.split("?");
  const cleanBase = base.replace(/\/+$/, "");
  if (!q) return cleanBase;
  const kept = q
    .split("&")
    .filter((pair) => {
      const k = pair.split("=")[0];
      return (
        pair.length > 0 &&
        !k.startsWith("utm_") &&
        !["fbclid", "gclid", "ref", "source", "mc_cid", "mc_eid"].includes(k)
      );
    })
    .sort();
  return kept.length > 0 ? `${cleanBase}?${kept.join("&")}` : cleanBase;
}

export function groupSimilarSmartFeedArticles(
  articles: SmartFeedArticleItem[],
): SmartFeedArticleItem[] {
  if (articles.length <= 1) return articles;
  const n = articles.length;
  const urls = articles.map((a) => canonicalUrlKey(a.url));
  const tokens = articles.map(
    (a) =>
      new Set(
        a.title
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
      ),
  );
  const priorityOrder = Array.from({ length: n }, (_, i) => i).sort((ia, ib) => {
    const rankDiff = articles[ib].ranking_score - articles[ia].ranking_score;
    if (rankDiff !== 0) return rankDiff;
    return ia - ib;
  });

  const assigned = new Array<boolean>(n).fill(false);
  const grouped: SmartFeedArticleItem[] = [];
  const indexById = new Map<string, number>();
  articles.forEach((a, i) => indexById.set(a.article_id, i));

  for (const primaryIdx of priorityOrder) {
    if (assigned[primaryIdx]) continue;
    assigned[primaryIdx] = true;
    const primary = { ...articles[primaryIdx] };
    const members: SmartFeedClusterMember[] = [];

    for (let candIdx = 0; candIdx < n; candIdx++) {
      if (assigned[candIdx] || candIdx === primaryIdx) continue;
      const cand = articles[candIdx];
      let similarityKind: string | null = null;
      if (urls[primaryIdx] && urls[primaryIdx] === urls[candIdx]) {
        similarityKind = "duplicate";
      } else if (unicodeTrigramSimilarity(primary.title, cand.title) >= 0.8) {
        similarityKind = "duplicate";
      } else if (primary.feed_id !== cand.feed_id) {
        let inter = 0;
        for (const t of tokens[primaryIdx]) {
          if (tokens[candIdx].has(t)) inter++;
        }
        const union = tokens[primaryIdx].size + tokens[candIdx].size - inter;
        const jac = union > 0 ? inter / union : 0;
        const sharedEnough = inter >= 3 || (inter >= 2 && tokens[primaryIdx].size <= 5);
        if (jac >= 0.45 && sharedEnough) similarityKind = "same_story";
      }

      if (similarityKind) {
        assigned[candIdx] = true;
        members.push({
          article_id: cand.article_id,
          feed_id: cand.feed_id,
          feed_title: cand.feed_title,
          title: cand.title,
          url: cand.url,
          published_date: cand.published_date ?? null,
          similarity_kind: similarityKind,
        });
      }
    }

    if (members.length > 0) {
      primary.cluster_id = primary.article_id;
      primary.cluster_size = members.length + 1;
      primary.cluster_members = members;
    } else {
      primary.cluster_id = null;
      primary.cluster_size = 1;
      primary.cluster_members = [];
    }
    grouped.push(primary);
  }

  grouped.sort(
    (a, b) =>
      (indexById.get(a.article_id) ?? Number.MAX_SAFE_INTEGER) -
      (indexById.get(b.article_id) ?? Number.MAX_SAFE_INTEGER),
  );
  return grouped;
}
