/**
 * Deterministic extraction-candidate scorer (design D3).
 *
 * `scoreCandidate` is a pure function of the candidate and the page context:
 * no randomness, no clock, no network. Identical inputs always produce an
 * identical score — the fixture suite pins this. All weights and thresholds
 * live in extractor-config.ts and are versioned by EXTRACTOR_VERSION.
 */

import {
  CHROME_CLUSTER_EXTRA,
  CHROME_FULL_PER_1000,
  CHROME_LEXICON,
  COMPLETENESS_MIN_RATIO,
  COMPLETENESS_SOURCE_MIN_WORDS,
  CONTIGUOUS_PARA_MIN_WORDS,
  CONTIGUOUS_PROSE_FULL_RATIO,
  FOOTER_LINK_CLUSTER,
  GOOD_PARAGRAPH_MEAN_WORDS,
  HIGH_THRESHOLD,
  LINK_DENSITY_FULL,
  MEDIUM_THRESHOLD,
  MIN_WORDS,
  PROSE_COMMA_PER_1000,
  PROSE_VOLUME_FULL_WORDS,
  REPEATED_LINK_MIN_REPEATS,
  SCORER_WEIGHTS,
  TINY_LINK_FULL_COUNT,
  TINY_LINK_MAX_WORDS,
  TITLE_AGREEMENT_FULL,
} from './extractor-config';
import { countWords, normalizeWhitespace, parseFragment } from './domUtils';
import { titleSimilarity } from './metadataExtractor';
import type {
  ExtractionCandidate,
  ExtractionConfidence,
  PageMetadata,
  ScoredCandidate,
} from './types';

/** Signals about the page the candidate was extracted from. */
export interface ScorerPageContext {
  meta: PageMetadata;
  /** Whitespace-normalized word count of the whole source document. */
  sourceWords: number;
  /** JSON-LD articleBody length when present (completeness signal). */
  jsonLdArticleBodyChars?: number;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'at', 'by', 'for', 'with',
  'about', 'into', 'to', 'from', 'in', 'on', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'must', 'that', 'this', 'these',
  'those', 'it', 'its', 'he', 'she', 'they', 'we', 'you', 'i', 'not', 'as',
  'than', 'then', 'so', 'such', 'there', 'their', 'his', 'her', 'him', 'them',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'any', 'more',
  'most', 'other', 'some', 'only', 'own', 'same', 'too', 'very', 'just',
]);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function proseVolumeScore(words: number, paragraphs: number): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const w = SCORER_WEIGHTS.proseVolume;
  const wordRatio = clamp01(Math.log(words + 1) / Math.log(PROSE_VOLUME_FULL_WORDS + 1));
  const paragraphRatio = clamp01(paragraphs / 25);
  const meanLen = paragraphs > 0 ? words / paragraphs : 0;
  const meanRatio = clamp01(meanLen / GOOD_PARAGRAPH_MEAN_WORDS);
  const points = w * (wordRatio * 0.7 + paragraphRatio * 0.2 + meanRatio * 0.1);
  if (words >= 400) reasons.push('prose_volume');
  else if (words < 120) reasons.push('prose_thin');
  return { points, reasons };
}

function proseQualityScore(
  container: HTMLElement,
  textContent: string,
  words: number
): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const w = SCORER_WEIGHTS.proseQuality;

  // Contiguous prose: share of text inside paragraphs with ≥ 25 words.
  const paragraphs = Array.from(container.querySelectorAll('p'));
  let longParaChars = 0;
  for (const p of paragraphs) {
    const t = normalizeWhitespace(p.textContent ?? '');
    if (countWords(t) >= CONTIGUOUS_PARA_MIN_WORDS) longParaChars += t.length;
  }
  const totalChars = Math.max(1, textContent.length);
  const contiguous = clamp01(longParaChars / totalChars / CONTIGUOUS_PROSE_FULL_RATIO);

  // Comma density: natural prose has commas; nav soup does not.
  const commas = (textContent.match(/,/g) ?? []).length;
  const per1000 = words > 0 ? (commas * 1000) / words : 0;
  const commaRatio = clamp01(per1000 / PROSE_COMMA_PER_1000);

  // Stop-word density (prose-likeness).
  const tokens = textContent.toLowerCase().split(/\s+/).filter(Boolean);
  const stopHits = tokens.filter((t) => STOP_WORDS.has(t)).length;
  const stopRatio = clamp01(words > 0 ? stopHits / words / 0.4 : 0);

  const points = w * (contiguous * 0.5 + commaRatio * 0.25 + stopRatio * 0.25);
  if (contiguous >= CONTIGUOUS_PROSE_FULL_RATIO) reasons.push('contiguous_prose');
  return { points, reasons };
}

function linkDensityPenalty(linkChars: number, textContent: string): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const total = Math.max(1, textContent.length);
  const ratio = linkChars / total;
  const points = SCORER_WEIGHTS.linkDensityPenalty * clamp01(ratio / LINK_DENSITY_FULL);
  if (ratio > LINK_DENSITY_FULL) reasons.push('link_farm');
  return { points, reasons };
}

function chromePenalty(container: HTMLElement, textContent: string, words: number): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const w = SCORER_WEIGHTS.chromePenalty;

  // Lexicon hits per 1000 words (case-insensitive substring).
  const lower = textContent.toLowerCase();
  let hits = 0;
  for (const phrase of CHROME_LEXICON) {
    // Count at most 3 occurrences per phrase so one repeated "Subscribe"
    // button cannot dominate, but repetition still registers.
    let from = 0;
    let seen = 0;
    while (seen < 3) {
      const idx = lower.indexOf(phrase, from);
      if (idx === -1) break;
      hits += 1;
      from = idx + phrase.length;
      seen += 1;
    }
  }
  const per1000 = words > 0 ? (hits * 1000) / words : hits;
  let lex = clamp01(per1000 / CHROME_FULL_PER_1000);

  // Tiny linked fragments ("Share", "Permalink", "Login", …).
  const anchors = Array.from(container.querySelectorAll('a[href]'));
  let tinyFragments = 0;
  const linkTextCounts = new Map<string, number>();
  for (const a of anchors) {
    const t = normalizeWhitespace(a.textContent ?? '');
    if (!t) continue;
    if (countWords(t) <= TINY_LINK_MAX_WORDS) tinyFragments += 1;
    linkTextCounts.set(t, (linkTextCounts.get(t) ?? 0) + 1);
  }
  const tiny = clamp01(tinyFragments / TINY_LINK_FULL_COUNT);

  // Repeated identical link-text blocks (recommendation carousels).
  let repeatedBlocks = 0;
  for (const count of linkTextCounts.values()) {
    if (count >= REPEATED_LINK_MIN_REPEATS) repeatedBlocks += 1;
  }

  // Footer-like trailing cluster: dense anchors in the last 6 elements.
  const children = Array.from(container.children);
  let trailingAnchors = 0;
  for (const el of children.slice(-6)) {
    trailingAnchors += el.querySelectorAll('a[href]').length;
  }
  const footerCluster = trailingAnchors >= FOOTER_LINK_CLUSTER ? 1 : 0;

  const clusterExtra =
    (repeatedBlocks > 0 ? 1 : 0) * CHROME_CLUSTER_EXTRA + footerCluster * CHROME_CLUSTER_EXTRA;

  const points = Math.min(w, w * (lex * 0.6 + tiny * 0.4) + clusterExtra);
  if (lex >= 1) reasons.push('chrome_lexicon');
  if (tiny >= 1) reasons.push('chrome_link_fragments');
  if (repeatedBlocks > 0) reasons.push('chrome_repeated_blocks');
  if (footerCluster) reasons.push('chrome_footer_cluster');
  return { points, reasons };
}

function structureBonus(container: HTMLElement): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const w = SCORER_WEIGHTS.structureBonus;

  const headings = container.querySelectorAll('h2, h3').length;
  const headingRatio = clamp01(headings / 3);

  const figures = Array.from(container.querySelectorAll('figure'));
  const captionedFigures = figures.filter((f) =>
    normalizeWhitespace(f.querySelector('figcaption')?.textContent ?? '').length > 0
  ).length;
  const figureRatio = clamp01(captionedFigures / 2);

  const lists = container.querySelectorAll('ul, ol').length > 0 ? 1 : 0;
  const quotes = container.querySelectorAll('blockquote').length > 0 ? 1 : 0;
  const tables = container.querySelectorAll('table').length > 0 ? 1 : 0;

  const points =
    w * (headingRatio * 0.35 + figureRatio * 0.25 + (lists + quotes + tables) * 0.1);
  if (captionedFigures > 0) reasons.push('captioned_figures');
  return { points, reasons };
}

function metadataAgreement(
  candidate: ExtractionCandidate,
  meta: PageMetadata
): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const w = SCORER_WEIGHTS.metadataAgreement;

  let agreement = 0;
  const expected = meta.jsonLdHeadline ?? meta.ogTitle;
  if (candidate.title && expected) {
    const similarity = titleSimilarity(candidate.title, expected);
    agreement += 0.4 * clamp01(similarity / TITLE_AGREEMENT_FULL);
  } else if (!candidate.title) {
    // A candidate with no title at all loses the agreement share.
    agreement += 0;
  } else {
    agreement += 0.2;
  }
  if (candidate.byline || meta.jsonLdAuthors?.length) agreement += 0.2;
  if (candidate.publishedTime || meta.jsonLdDatePublished || meta.articlePublishedTime) agreement += 0.2;
  if (meta.ogSiteName || meta.jsonLdPublisher) agreement += 0.2;

  const points = w * clamp01(agreement);
  if (agreement >= 0.8) reasons.push('metadata_agreement');
  return { points, reasons };
}

function completenessPenalty(
  words: number,
  ctx: ScorerPageContext
): { points: number; reasons: string[] } {
  const reasons: string[] = [];
  const w = SCORER_WEIGHTS.completenessPenalty;
  let ratio = 1;

  if (ctx.sourceWords >= COMPLETENESS_SOURCE_MIN_WORDS) {
    ratio = Math.min(ratio, words / ctx.sourceWords);
  }
  if (ctx.jsonLdArticleBodyChars && ctx.jsonLdArticleBodyChars > 0) {
    // articleBody chars ≈ words * 6; generous conversion.
    const expectedWords = ctx.jsonLdArticleBodyChars / 6;
    if (expectedWords >= 150) {
      ratio = Math.min(ratio, words / expectedWords);
    }
  }
  if (ratio >= COMPLETENESS_MIN_RATIO) return { points: 0, reasons };

  reasons.push('incomplete_extraction');
  const points = w * clamp01((COMPLETENESS_MIN_RATIO - ratio) / COMPLETENESS_MIN_RATIO);
  return { points, reasons };
}

/** Confidence bucket from the final score (constants in extractor-config). */
export function confidenceFor(score: number): ExtractionConfidence {
  if (score >= HIGH_THRESHOLD) return 'high';
  if (score >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

/** Deterministically score one candidate against its page context. */
export function scoreCandidate(
  candidate: ExtractionCandidate,
  ctx: ScorerPageContext
): ScoredCandidate {
  const container = parseFragment(candidate.contentHtml);
  const words = candidate.stats.words;

  const volume = proseVolumeScore(words, candidate.stats.paragraphs);
  const quality = proseQualityScore(container, candidate.textContent, words);
  const link = linkDensityPenalty(candidate.stats.linkChars, candidate.textContent);
  const chrome = chromePenalty(container, candidate.textContent, words);
  const structure = structureBonus(container);
  const agreement = metadataAgreement(candidate, ctx.meta);
  const completeness = completenessPenalty(words, ctx);

  let score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (volume.points +
          quality.points +
          structure.points +
          agreement.points -
          link.points -
          chrome.points -
          completeness.points) *
          10
      ) / 10
    )
  );

  const reasons = [
    ...volume.reasons,
    ...quality.reasons,
    ...link.reasons,
    ...chrome.reasons,
    ...structure.reasons,
    ...agreement.reasons,
    ...completeness.reasons,
  ];

  if (candidate.engine.startsWith('site:') && candidate.stats.words >= MIN_WORDS) {
    score = Math.min(100, score + 8);
    reasons.push('structured_adapter_bonus');
  }

  return {
    candidate,
    score,
    confidence: confidenceFor(score),
    reasons,
  };
}

/** Deterministic selection: highest score, ties break by engine precedence
 * (site-specific → defuddle → readability), then by word count. */
const ENGINE_PRECEDENCE = ['site:', 'rendered-', 'defuddle', 'readability', 'semantic'];

export function selectBestCandidate(scored: ScoredCandidate[]): ScoredCandidate | null {
  if (scored.length === 0) return null;
  const precedence = (engine: string): number => {
    const idx = ENGINE_PRECEDENCE.findIndex((p) => engine.startsWith(p));
    return idx === -1 ? ENGINE_PRECEDENCE.length : idx;
  };
  return [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = precedence(a.candidate.engine);
    const pb = precedence(b.candidate.engine);
    if (pa !== pb) return pa - pb;
    return b.candidate.stats.words - a.candidate.stats.words;
  })[0];
}
