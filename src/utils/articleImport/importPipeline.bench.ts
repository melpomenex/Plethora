// @vitest-environment jsdom
/**
 * Benchmark: the article-import static path (design D14).
 *
 * Measures parse → metadata → Defuddle + Readability on independent clones →
 * score → normalize → sanitize for synthetic pages built from the seeded PRNG
 * (chrome blocks + prose; never the clock, never Math.random). Fetch and the
 * rendered fallback are excluded by design: only frontend stages are guarded
 * here. Results fold into a module-level sink so the engine cannot elide the
 * work. Only pure pipeline modules are imported — the bench must not pull the
 * Tauri bridge or the api layer.
 */

import { bench } from "vitest";

import { seededRandom } from "../../test/bench-support";
import { deepCloneDocument, parseHtml } from "./domUtils";
import { extractPageMetadata, resolveArticleMetadata } from "./metadataExtractor";
import { runDefuddle } from "./engines/defuddleExtractor";
import { runReadability } from "./engines/readabilityExtractor";
import { scoreCandidate, selectBestCandidate } from "./scorer";
import { normalizeArticle } from "./articleNormalizer";
import { sanitizeArticleHtml } from "./sanitizer";

const SENTENCES = [
  "The committee reviewed the proposal carefully, and its members agreed that further study, funded properly, would clarify the remaining questions.",
  "Researchers at the institute spent two years replicating the measurements, and their published numbers agree with the field data.",
  "Officials familiar with the deliberations described a slow shift, driven less by argument than by accumulating paperwork.",
  "Analysts caution that a single quarter proves little, yet the trend has now persisted long enough to attract serious attention.",
  "Independent auditors praised the transparency of the process, while noting several categories that remain difficult to verify.",
  "Community organizers say the practical effects were visible within weeks, though the formal evaluation arrived much later.",
];

const CHROME_BLOCKS = [
  (rng: () => number): string =>
    `<nav>${Array.from({ length: 4 + Math.floor(rng() * 6) }, (_, i) => `<a href="/n${i}">Nav link ${i}</a>`).join(" ")}</nav>`,
  (): string =>
    `<div class="newsletter-cta"><p>Subscribe to our newsletter. Sign up for our free newsletter today.</p><a href="/subscribe">Subscribe</a></div>`,
  (rng: () => number): string =>
    `<aside class="related">${Array.from({ length: 3 + Math.floor(rng() * 4) }, (_, i) => `<a href="/r${i}">Related: recommended story ${i}</a>`).join("")}</aside>`,
  (): string =>
    `<div class="donate-prompt"><p>Donate to support our journalism. Get our award-winning magazine.</p><a href="/donate">Donate</a></div>`,
  (rng: () => number): string =>
    `<footer>${Array.from({ length: 6 + Math.floor(rng() * 6) }, (_, i) => `<a href="/f${i}">Footer ${i}</a>`).join(" ")}</footer>`,
];

/** Deterministic synthetic page: prose article + seeded chrome soup. */
function buildSyntheticPage(seed: number, paragraphCount: number, chromeCount: number): string {
  const rng = seededRandom(seed);
  const article = Array.from({ length: paragraphCount }, () => {
    const first = SENTENCES[Math.floor(rng() * SENTENCES.length)];
    const second = SENTENCES[Math.floor(rng() * SENTENCES.length)];
    return `<p>${first} ${second}</p>`;
  }).join("\n");
  const chrome = Array.from({ length: chromeCount }, () => {
    const block = CHROME_BLOCKS[Math.floor(rng() * CHROME_BLOCKS.length)];
    return block(rng);
  }).join("\n");
  return `<!doctype html>
<html lang="en"><head>
<title>Synthetic Story ${seed} | Bench Daily</title>
<meta property="og:title" content="Synthetic Story ${seed}">
<meta property="og:site_name" content="Bench Daily">
<meta property="article:published_time" content="2026-08-15T00:00:00Z">
<script type="application/ld+json">{"@type":"NewsArticle","headline":"Synthetic Story ${seed}","author":[{"name":"Bench Author"}],"datePublished":"2026-08-15T00:00:00Z","publisher":{"name":"Bench Daily"}}</script>
</head><body>
${chrome}
<article><h1>Synthetic Story ${seed}</h1>
${article}
<figure><img src="https://cdn.bench.example.com/hero-${seed}.jpg" alt="Hero"><figcaption>The hero caption for story ${seed}.</figcaption></figure>
</article>
${chrome}
</body></html>`;
}

interface PreparedPage {
  html: string;
  url: string;
}

function prepare(seed: number, paragraphs: number, chromeBlocks: number): PreparedPage {
  return {
    html: buildSyntheticPage(seed, paragraphs, chromeBlocks),
    url: `https://bench.example.com/story/${seed}`,
  };
}

/** The full static pipeline for a prepared page (fetch excluded). */
async function runStaticPipeline(page: PreparedPage): Promise<{ words: number; images: number }> {
  const doc = parseHtml(page.html);
  const meta = extractPageMetadata(doc);
  const sourceWords = (doc.body?.textContent ?? "").split(/\s+/).filter(Boolean).length;
  const ctx = { meta, sourceWords };

  const candidates = [];
  const defuddle = await runDefuddle(deepCloneDocument(doc), page.url);
  if (defuddle) candidates.push(defuddle);
  const readability = await runReadability(deepCloneDocument(doc));
  if (readability) candidates.push(readability);

  const scored = candidates.map((c) => scoreCandidate(c, ctx));
  const best = selectBestCandidate(scored);
  if (!best) return { words: 0, images: 0 };

  const hostname = "bench.example.com";
  const resolved = resolveArticleMetadata(meta, best.candidate, hostname);
  const normalized = normalizeArticle({
    contentHtml: best.candidate.contentHtml,
    title: resolved.title ?? "Untitled",
    authors: resolved.authors,
    publishedTime: resolved.publishedTime,
    siteName: resolved.siteName,
    language: resolved.language,
    heroImage: resolved.heroImage,
    baseUrl: page.url,
  });
  const sanitized = await sanitizeArticleHtml(normalized.article.contentHtml);
  const parsed = parseHtml(sanitized.html);
  const words = (parsed.body?.textContent ?? "").split(/\s+/).filter(Boolean).length;
  return { words, images: parsed.querySelectorAll("img").length };
}

// Consumed-result sinks keep the pipeline from being elided.
let sink = 0;

const smallPage = prepare(101, 40, 8);
bench("article-import-static-small-40p", async () => {
  const result = await runStaticPipeline(smallPage);
  sink ^= result.words + result.images;
});

const largePage = prepare(202, 260, 20);
bench("article-import-static-large-260p", async () => {
  const result = await runStaticPipeline(largePage);
  sink ^= result.words * 31 + result.images;
});

// Keep `sink` observably alive (engines cannot prove it unused).
if (sink === -1) {
  console.log("unreachable", sink);
}
