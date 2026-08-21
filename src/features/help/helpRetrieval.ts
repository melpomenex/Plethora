/**
 * Local Hybrid Help Retrieval Engine
 * High-speed offline lexical (BM25) matching, exact alias resolution,
 * contextual app state boosting, and token budgeting.
 */

import type {
  HelpDocChunk,
  HelpSearchResult,
  HelpAppContext,
  DirectLookupResult,
  ProductDocArticle,
} from "./helpTypes";
import { BUNDLED_HELP_INDEX, type GeneratedHelpIndex } from "./generated/helpIndexData";

export interface RetrievalOptions {
  limit?: number;
  maxTokens?: number;
  context?: Partial<HelpAppContext>;
  filterDomain?: string;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "he", "her", "his", "how", "i", "in", "into", "is", "it",
  "its", "me", "my", "not", "of", "on", "or", "our", "she", "so", "that",
  "the", "their", "them", "there", "these", "they", "this", "to", "us",
  "was", "we", "were", "what", "where", "why", "will", "with", "you", "your",
  "can", "plethora", "do"
]);

/**
 * Tokenizes and normalizes query text into search terms.
 */
export function tokenizeQuery(raw: string): string[] {
  const normalized = raw
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .trim();

  return normalized
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term));
}

/**
 * Estimates prompt token count from string length (1 token ≈ 4 characters).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Fast in-memory BM25 lexical scorer across documentation chunks.
 */
export class HelpRetrievalEngine {
  private index: GeneratedHelpIndex;
  private avgDocLength: number;
  private idfMap: Map<string, number> = new Map();
  private docMap: Map<string, ProductDocArticle> = new Map();

  constructor(indexData: GeneratedHelpIndex = BUNDLED_HELP_INDEX) {
    this.index = indexData;
    this.docMap = new Map(indexData.docs.map((d) => [d.id, d]));

    let totalLen = 0;
    const docFreq: Map<string, number> = new Map();

    for (const chunk of this.index.chunks) {
      const words = tokenizeQuery(chunk.content + " " + chunk.title);
      totalLen += words.length;
      const uniqueWords = new Set(words);
      for (const w of uniqueWords) {
        docFreq.set(w, (docFreq.get(w) || 0) + 1);
      }
    }

    const n = Math.max(1, this.index.chunks.length);
    this.avgDocLength = totalLen / n;

    for (const [word, freq] of docFreq.entries()) {
      // Standard BM25 IDF formulation with smoothing
      const idf = Math.log(1 + (n - freq + 0.5) / (freq + 0.5));
      this.idfMap.set(word, Math.max(0.1, idf));
    }
  }

  /**
   * Resolves direct canonical lookup for exact or high-confidence alias matches (0ms LLM).
   */
  public resolveDirectLookup(rawQuery: string): DirectLookupResult | null {
    const clean = rawQuery
      .toLowerCase()
      .replace(/^(how\s+(to|do\s+i)\s+|what\s+is\s+|where\s+is\s+|\?|\/help\s+)/i, "")
      .replace(/[?!.,]/g, "")
      .trim();

    if (!clean || clean.length < 2) return null;

    // 1. Check exact alias map
    const mappedDocId = this.index.aliasMap[clean];
    if (mappedDocId) {
      const doc = this.docMap.get(mappedDocId);
      if (doc) {
        return {
          featureId: doc.id,
          title: doc.title,
          summary: doc.summary,
          how_to: doc.how_to,
          why: doc.why,
          confidence: 1.0,
          primaryAction: doc.actions?.[0],
          related: doc.related || [],
        };
      }
    }

    // 2. Check direct title match
    for (const doc of this.index.docs) {
      const titleClean = doc.title.toLowerCase().trim();
      if (titleClean === clean || titleClean.includes(clean)) {
        return {
          featureId: doc.id,
          title: doc.title,
          summary: doc.summary,
          how_to: doc.how_to,
          why: doc.why,
          confidence: 0.95,
          primaryAction: doc.actions?.[0],
          related: doc.related || [],
        };
      }
    }

    return null;
  }

  /**
   * Performs hybrid search returning ranked search results with contextual boosting.
   */
  public search(rawQuery: string, options: RetrievalOptions = {}): HelpSearchResult[] {
    const queryClean = rawQuery.trim().toLowerCase();
    if (!queryClean) return [];

    const terms = tokenizeQuery(queryClean);
    const limit = options.limit || 5;
    const maxTokens = options.maxTokens || 1500;
    const ctx = options.context || {};

    const k1 = 1.2;
    const b = 0.75;
    const candidates: Array<{ chunk: HelpDocChunk; baseScore: number; boost: number; reasons: string[] }> = [];

    for (const chunk of this.index.chunks) {
      if (options.filterDomain && chunk.domain !== options.filterDomain) continue;

      const titleLower = chunk.title.toLowerCase();
      const contentLower = chunk.content.toLowerCase();
      const chunkWords = tokenizeQuery(chunk.content + " " + chunk.title);
      const chunkLen = chunkWords.length;

      let baseScore = 0.0;
      const reasons: string[] = [];

      // Exact phrase match bonus
      if (titleLower.includes(queryClean)) {
        baseScore += 8.0;
        reasons.push("Title match");
      }
      if (contentLower.includes(queryClean)) {
        baseScore += 4.0;
        reasons.push("Phrase match in body");
      }

      // BM25 term scoring
      for (const term of terms) {
        let tf = 0;
        for (const w of chunkWords) {
          if (w === term || w.includes(term)) tf++;
        }
        if (tf > 0) {
          const idf = this.idfMap.get(term) || 0.5;
          const numerator = tf * (k1 + 1);
          const denominator = tf + k1 * (1 - b + b * (chunkLen / (this.avgDocLength || 1)));
          baseScore += idf * (numerator / Math.max(0.001, denominator));
          reasons.push(`Term '${term}' (tf=${tf})`);
        }
      }

      // Alias matches
      for (const alias of chunk.aliases) {
        if (alias.toLowerCase().includes(queryClean) || queryClean.includes(alias.toLowerCase())) {
          baseScore += 6.0;
          reasons.push(`Alias match '${alias}'`);
        }
      }

      if (baseScore <= 0.0) continue;

      // Multiplicative Contextual Boosting
      let boost = 1.0;

      // 1. Active View Boost (x1.4)
      if (ctx.activeView) {
        const viewDomainMap: Record<string, string[]> = {
          "document-viewer": ["reading", "tts"],
          "queue": ["queue", "scheduling"],
          "queue-scroll": ["queue", "scheduling", "review"],
          "review": ["review", "scheduling"],
          "rss": ["media"],
          "podcast": ["media", "tts"],
          "audiobook": ["tts", "reading"],
          "settings": ["settings"],
        };

        const matchingDomains = viewDomainMap[ctx.activeView] || [];
        if (matchingDomains.includes(chunk.domain)) {
          boost *= 1.4;
          reasons.push(`View boost: ${ctx.activeView} (x1.4)`);
        }
      }

      // 2. Document Format Boost (x1.3)
      if (ctx.documentFormat && (contentLower.includes(ctx.documentFormat) || chunk.tags.includes(ctx.documentFormat))) {
        boost *= 1.3;
        reasons.push(`Format boost: ${ctx.documentFormat} (x1.3)`);
      }

      // 3. TTS Active Boost (x1.5)
      if (ctx.ttsActive && (chunk.domain === "tts" || chunk.id.includes("auto_scroll") || chunk.id.includes("word_highlighting"))) {
        boost *= 1.5;
        reasons.push("TTS active boost (x1.5)");
      }

      // 4. Algorithm Boost (x1.4)
      if (ctx.activeAlgorithm && (chunk.id.includes(ctx.activeAlgorithm) || contentLower.includes(ctx.activeAlgorithm))) {
        boost *= 1.4;
        reasons.push(`Algorithm boost: ${ctx.activeAlgorithm} (x1.4)`);
      }

      // 5. Platform Boost (x1.3)
      if (ctx.platform && chunk.platforms.includes(ctx.platform)) {
        boost *= 1.3;
        reasons.push(`Platform boost: ${ctx.platform} (x1.3)`);
      }
      if (ctx.einkActive && (chunk.id.includes("eink") || chunk.platforms.includes("eink"))) {
        boost *= 1.5;
        reasons.push("E-ink mode boost (x1.5)");
      }

      candidates.push({
        chunk,
        baseScore,
        boost,
        reasons,
      });
    }

    // Sort by final score = baseScore * boost
    candidates.sort((a, b) => (b.baseScore * b.boost) - (a.baseScore * a.boost));

    // Token Budgeting & Chunk Deduplication (k <= limit, totalTokens <= maxTokens)
    const results: HelpSearchResult[] = [];
    let currentTokens = 0;
    const seenDocIds = new Set<string>();

    for (const c of candidates) {
      if (results.length >= limit) break;

      const chunkTokens = estimateTokenCount(c.chunk.content);
      if (currentTokens + chunkTokens > maxTokens && results.length > 0) {
        continue;
      }

      currentTokens += chunkTokens;
      seenDocIds.add(c.chunk.docId);

      results.push({
        chunk: c.chunk,
        score: c.baseScore * c.boost,
        baseScore: c.baseScore,
        boostMultiplier: c.boost,
        matchReasons: c.reasons,
      });
    }

    return results;
  }

  /**
   * Retrieves full doc article by ID.
   */
  public getDocument(docId: string): ProductDocArticle | undefined {
    return this.docMap.get(docId);
  }

  /**
   * Returns corpus hash for cache invalidation.
   */
  public getCorpusHash(): string {
    return this.index.corpusHash;
  }
}

export const defaultHelpRetrieval = new HelpRetrievalEngine();
