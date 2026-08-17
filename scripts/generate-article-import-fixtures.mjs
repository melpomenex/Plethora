/**
 * Fixture corpus generator for the article-import regression suite
 * (overhaul-web-article-import task 10.1).
 *
 * Generates `src/utils/articleImport/__tests__/fixtures/<case>/{page.html,
 * expected.json}`. Fixtures are CRAFTED STRUCTURAL REPLICAS: real site
 * skeletons generalized, synthetic prose; the Mother Jones replica keeps the
 * real title/author/date with a synthetic body. No verbatim copyrighted
 * page bodies. Run once (or after editing the templates):
 *
 *   node scripts/generate-article-import-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = join(here, "..", "src", "utils", "articleImport", "__tests__", "fixtures");

/** Deterministic prose — varied sentences, no repeats. */
function prose(paragraphs, seed = 0) {
  const openers = [
    "The review board concluded, after months of testimony, that the original estimates understated both cost and timeline.",
    "Researchers at the institute spent two years replicating the measurements, and their published numbers agree with the field data.",
    "Officials familiar with the deliberations described a slow shift, driven less by argument than by accumulating paperwork.",
    "Analysts caution that a single quarter proves little, yet the trend has now persisted long enough to attract serious attention.",
    "Community organizers say the practical effects were visible within weeks, though the formal evaluation arrived much later.",
    "The committee's minority report, released without fanfare, questions the methodology behind the headline finding.",
    "Industry groups responded cautiously, praising the direction while reserving judgment on the details still to come.",
    "Local records show the pattern predates the policy itself, which complicates the simple cause-and-effect story.",
    "Independent auditors praised the transparency of the process, while noting several categories that remain difficult to verify.",
    "Veterans of previous reforms point out that implementation, not legislation, has always been the harder half.",
  ];
  const closers = [
    "The next milestone arrives early next year.",
    "A final decision is expected after the summer recess.",
    "Further results will be published as the study continues.",
    "The findings are open to public comment for sixty days.",
    "Officials declined to speculate on timing.",
  ];
  const lines = [];
  for (let i = 0; i < paragraphs; i += 1) {
    const opener = openers[(i + seed) % openers.length];
    const closer = closers[(i + seed * 3) % closers.length];
    lines.push(
      `  <p>${opener} Documents reviewed for this story fill three binders, and the pattern they describe is consistent across every region examined. ${closer}</p>`
    );
  }
  return lines.join("\n");
}

function page({ head = "", bodyTop = "", article = "", bodyBottom = "", lang = "en" }) {
  const title = head.includes("<title") ? "" : "<title>Generated Fixture</title>";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
${title}
${head}
</head>
<body>
${bodyTop}
${article}
${bodyBottom}
</body>
</html>
`;
}

function writeFixture(name, html, expected) {
  const dir = join(outRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "page.html"), html);
  writeFileSync(join(dir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
}

const CHROME_NAV = `  <nav class="site-nav">
    <a href="/home">Home</a> <a href="/news">News</a> <a href="/politics">Politics</a>
    <a href="/culture">Culture</a> <a href="/about">About</a> <a href="/contact">Contact</a>
  </nav>`;
const CHROME_SIDEBAR_RELATED = `  <aside class="related">
    <h3>Related</h3>
    <a href="/r1">Related: An earlier piece on the same subject</a>
    <a href="/r2">Related: A follow-up investigation</a>
    <a href="/r3">Related: The original reporting</a>
    <a href="/r4">Related: What changed since</a>
  </aside>
  <aside class="we-recommend">
    <h3>We Recommend</h3>
    <a href="/w1">Recommended: Another reader favorite</a>
    <a href="/w2">Recommended: Most read this week</a>
    <a href="/w3">Recommended: Editor's picks</a>
    <a href="/w4">Recommended: From the archive</a>
  </aside>`;
const CHROME_FOOTER = `  <footer class="site-footer">
    <a href="/subscribe">Subscribe</a> <a href="/donate">Donate</a>
    <a href="/privacy">Privacy</a> <a href="/terms">Terms</a>
    <a href="/sitemap">Sitemap</a> <a href="/jobs">Jobs</a>
    <p>© 2026 Fixture Publishing. All rights reserved.</p>
  </footer>`;
const CHROME_NEWSLETTER = `  <div class="newsletter-cta">
    <p>Sign up for our free newsletter</p>
    <form><input type="email" name="nl"><button type="submit">Subscribe</button></form>
  </div>`;
const CHROME_DONATE = `  <div class="donate-prompt">
    <p>Support our journalism. Donate today and help us keep reporting like this free.</p>
    <a href="/donate/monthly">Donate monthly</a> <a href="/donate/once">Donate once</a>
  </div>`;

// ──────────────────────────────────────────────────────────────────────────
// 1. Traditional news
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "news-traditional",
  page({
    head: `
<meta property="og:title" content="Traditional Desk Covers a Slow-Moving Story">
<meta property="og:site_name" content="The Traditional Desk">
<meta property="og:image" content="https://cdn.traditional.example.com/hero.jpg">
<meta property="article:published_time" content="2026-08-01T08:00:00Z">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Traditional Desk Covers a Slow-Moving Story","author":[{"name":"Amara Tradewell"}],"datePublished":"2026-08-01T08:00:00Z","publisher":{"name":"The Traditional Desk"}}</script>`,
    bodyTop: CHROME_NAV,
    article: `  <article class="story">
    <h1>Traditional Desk Covers a Slow-Moving Story</h1>
    <p class="byline">By Amara Tradewell</p>
    <figure><img src="https://cdn.traditional.example.com/hero.jpg" alt="The hearing room"><figcaption>Witnesses wait for the session to begin. (Photo: Desk Staff)</figcaption></figure>
${prose(16)}
    <h2>The numbers</h2>
${prose(8)}
    <blockquote><p>This is a measured quote from an official who agreed to speak on the record.</p></blockquote>
${prose(6)}
  </article>`,
    bodyBottom: `${CHROME_SIDEBAR_RELATED}\n${CHROME_FOOTER}`,
  }),
  {
    title: "Traditional Desk Covers a Slow-Moving Story",
    authors: ["Amara Tradewell"],
    publishedAtContains: "2026-08-01",
    siteName: "The Traditional Desk",
    minWords: 350,
    mustContain: ["The numbers"],
    mustNotContain: ["Sign up for our free newsletter", "We Recommend", "All rights reserved", "Sitemap"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 2. WordPress news
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "news-wordpress",
  page({
    head: `
<meta name="author" content="WP Reporter">
<link rel="canonical" href="https://wpnews.example.com/2026/07/agency-report/">
<meta property="og:title" content="Agency Report Lands With Few Surprises">
<meta property="og:site_name" content="WPNews">`,
    bodyTop: `  <header class="site-header"><a href="/">WPNews</a><a href="/cat/news">News</a><a href="/cat/opinion">Opinion</a><a href="/subscribe">Subscribe</a></header>`,
    article: `  <div class="entry-content">
    <h1 class="entry-title">Agency Report Lands With Few Surprises</h1>
${prose(14, 2)}
    <h2>Reaction</h2>
${prose(8, 5)}
    <ul><li>Point one from the summary.</li><li>Point two from the summary.</li><li>Point three from the summary.</li></ul>
${prose(5, 9)}
  </div>
  <div class="wp-block-group sharedaddy"><a href="/share">Share this:</a><a href="/tweet">Tweet</a></div>`,
    bodyBottom: `  <div class="comments-area"><h3>Comments</h3><p>Leave a comment</p></div>
${CHROME_FOOTER}`,
  }),
  {
    title: "Agency Report Lands With Few Surprises",
    authors: ["WP Reporter"],
    siteName: "WPNews",
    minWords: 300,
    mustContain: ["Reaction"],
    mustNotContain: ["Leave a comment", "Share this:", "All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 3. Mother Jones regression replica (task 10.2)
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "motherjones-regression",
  page({
    head: `
<link rel="canonical" href="https://www.motherjones.com/politics/2026/08/trump-crypto-project-bank/">
<meta property="og:title" content="The Trumps' Crypto Project Just Got One Step Closer to Becoming a Bank">
<meta property="og:site_name" content="Mother Jones">
<meta property="og:image" content="https://www.motherjones.com/wp-content/uploads/2026/08/crypto-hero.jpg">
<meta property="article:published_time" content="2026-08-15T05:00:00Z">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"The Trumps' Crypto Project Just Got One Step Closer to Becoming a Bank","author":[{"name":"Sophie Hurwitz"}],"datePublished":"2026-08-15T05:00:00Z","publisher":{"name":"Mother Jones"},"image":"https://www.motherjones.com/wp-content/uploads/2026/08/crypto-hero.jpg"}</script>`,
    bodyTop: `  <a class="skip-link" href="#main">Skip to main content</a>
  <nav class="main-nav">
    <a href="/">Home</a> <a href="/politics">Politics</a> <a href="/environment">Environment</a>
    <a href="/donate">Donate</a> <a href="/subscribe">Subscribe</a>
  </nav>
  <div class="adblock-notice"><p>We see you're using an ad blocker. One quick request... we depend on reader support.</p><a href="/support">Support our journalism</a></div>
  <div class="sticky-donate"><a href="/donate">Donate</a></div>`,
    article: `  <article id="main" class="article-body">
    <header class="article-header">
      <p class="kicker">Politics</p>
      <h1>The Trumps' Crypto Project Just Got One Step Closer to Becoming a Bank</h1>
      <p class="byline">By <a href="/authors/sophie-hurwitz">Sophie Hurwitz</a></p>
      <time datetime="2026-08-15">August 15, 2026</time>
    </header>
    <figure class="hero">
      <img src="https://www.motherjones.com/wp-content/uploads/2026/08/crypto-hero.jpg" alt="A photo illustration of a crypto token">
      <figcaption>A crypto token rendered on a trading screen. <span class="credit">Illustration: Mother Jones</span></figcaption>
    </figure>
${prose(18, 3)}
    <h2>What the filing says</h2>
${prose(9, 6)}
    <blockquote><p>The application is unusual, and the timeline is aggressive, said a former regulator who reviewed the documents.</p></blockquote>
${prose(7, 11)}
    <h2>The history here</h2>
${prose(10, 1)}
  </article>
  <div class="share-tools">
    <a href="/share/fb">Share on Facebook</a> <a href="/share/x">Share on X</a> <a href="/email">Email</a>
  </div>
  <div class="newsletter-inline">
    <h3>Sign up for our free newsletter</h3>
    <p>Get our award-winning magazine delivered weekly.</p>
    <form><input type="email"><button>Sign up</button></form>
  </div>`,
    bodyBottom: `  <section class="related-stories">
    <h3>Related</h3><a href="/r1">Related story one</a><a href="/r2">Related story two</a><a href="/r3">Related story three</a>
    <h3>We Recommend</h3><a href="/w1">Recommended one</a><a href="/w2">Recommended two</a>
    <h3>Latest</h3><a href="/l1">Latest one</a><a href="/l2">Latest two</a>
  </section>
  <div class="privacy-manager"><a href="/privacy">Privacy Manager</a> <a href="/terms">Terms</a></div>
${CHROME_FOOTER}`,
  }),
  {
    title: "The Trumps' Crypto Project Just Got One Step Closer to Becoming a Bank",
    authors: ["Sophie Hurwitz"],
    publishedAtContains: "2026-08-15",
    siteName: "Mother Jones",
    minWords: 500,
    mustContain: ["What the filing says", "The history here"],
    mustNotContain: [
      "Skip to main content",
      "Share on Facebook",
      "Donate",
      "Subscribe",
      "Related",
      "We Recommend",
      "Latest",
      "Sign up for our free newsletter",
      "Get our award-winning magazine",
      "Privacy Manager",
      "We see you're using an ad blocker",
      "One quick request",
      "All rights reserved",
    ],
    expectedFigureCaptions: ["Illustration: Mother Jones"],
    minImages: 1,
    noSiteSpecific: true,
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 4. Substack
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "substack",
  page({
    head: `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"Notes on Slow Systems","author":[{"name":"Sub Stackwell"}],"datePublished":"2026-07-20T10:00:00Z","publisher":{"name":"Slow Systems Weekly"}}</script>
<meta property="og:title" content="Notes on Slow Systems">
<meta property="og:site_name" content="Slow Systems Weekly">`,
    bodyTop: `  <div class="substack-header"><a href="/">Slow Systems Weekly</a><button>Subscribe</button></div>`,
    article: `  <article class="body markup">
    <h1 class="post-title">Notes on Slow Systems</h1>
    <div class="post-meta">Sub Stackwell · Jul 20, 2026</div>
${prose(20, 4)}
    <h3>Why slow wins</h3>
${prose(12, 7)}
    <blockquote><p>Slow systems fail slowly, which is another way of saying they can be repaired while running.</p></blockquote>
${prose(6, 2)}
  </article>
  <div class="subscribe-cta"><h4>Subscribe now</h4><p>Join 40,000 readers.</p><button>Subscribe</button></div>`,
    bodyBottom: `  <div class="comments-thread"><h4>Comments</h4><p>Leave a comment</p></div>`,
  }),
  {
    title: "Notes on Slow Systems",
    authors: ["Sub Stackwell"],
    publishedAtContains: "2026-07-20",
    siteName: "Slow Systems Weekly",
    minWords: 450,
    mustContain: ["Why slow wins"],
    mustNotContain: ["Join 40,000 readers", "Leave a comment", "Subscribe now"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 5. Medium-style
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "medium-style",
  page({
    head: `
<meta property="og:title" content="What I Learned Rebuilding Everything">
<meta property="og:site_name" content="Medium">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"What I Learned Rebuilding Everything","author":[{"name":"Med Wellwrite"}],"datePublished":"2026-06-30T00:00:00Z","publisher":{"name":"Medium"}}</script>`,
    bodyTop: `  <header><a href="/">Medium</a><a href="/topics">Topics</a><a href="/membership">Become a member</a><button>Sign in</button></header>`,
    article: `  <article>
    <section>
    <h1>What I Learned Rebuilding Everything</h1>
    <p class="by">Med Wellwrite · Jun 30, 2026 · 8 min read</p>
${prose(18, 8)}
    </section>
    <section>
    <h2>Lesson one</h2>
${prose(10, 3)}
    <figure><img src="https://miro.medium.example.com/v2/lesson.jpg" alt="Diagram"><figcaption>The first diagram from the rebuild.</figcaption></figure>
${prose(8, 13)}
    </section>
    <section>
    <h2>Lesson two</h2>
${prose(10, 6)}
    </section>
  </article>`,
    bodyBottom: `  <div class="claps"><button>Clap</button></div>
  <div class="more-from"><h4>More from Medium</h4><a href="/m1">Recommended read one</a><a href="/m2">Recommended read two</a><a href="/m3">Recommended read three</a></div>
  <footer><a href="/about">About</a><a href="/help">Help</a><a href="/legal">Legal</a></footer>`,
  }),
  {
    title: "What I Learned Rebuilding Everything",
    authors: ["Med Wellwrite"],
    publishedAtContains: "2026-06-30",
    siteName: "Medium",
    minWords: 400,
    mustContain: ["Lesson one", "Lesson two"],
    mustNotContain: ["Become a member", "More from Medium", "8 min read", "Clap"],
    expectedFigureCaptions: ["The first diagram from the rebuild."],
    minImages: 1,
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 6. Wikipedia
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "wikipedia",
  page({
    head: `
<link rel="canonical" href="https://en.wikipedia.org/wiki/Incremental_reading">
<meta property="og:title" content="Incremental reading - Wikipedia">
<meta property="og:site_name" content="Wikipedia">`,
    bodyTop: `  <div class="vector-header"><a href="/wiki/Main_Page">Wikipedia</a><a href="/wiki/Special:Search">Search</a><a href="/wiki/Special:MyTalk">Talk</a></div>`,
    article: `  <div id="mw-content-text">
    <div class="mw-parser-output">
    <h1 id="firstHeading">Incremental reading</h1>
    <p><b>Incremental reading</b> is a technique for reading and retaining large volumes of material by scheduling reviews of extracted portions over time, rather than completing each source in a single pass.</p>
${prose(12, 5)}
    <h2>History</h2>
${prose(8, 10)}
    <h2>Method</h2>
${prose(10, 2)}
    <table>
      <caption>Example scheduling parameters</caption>
      <thead><tr><th>Parameter</th><th>Typical value</th></tr></thead>
      <tbody><tr><td>Session length</td><td>20–40 minutes</td></tr><tr><td>Extract size</td><td>1–3 sentences</td></tr></tbody>
    </table>
${prose(6, 15)}
    <h2>See also</h2>
    <ul><li><a href="/wiki/Spaced_repetition">Spaced repetition</a></li><li><a href="/wiki/Incremental_writing">Incremental writing</a></li></ul>
    <div class="navbox">Navigation box with dozens of related article links</div>
    <div class="reflist"><ol><li>Reference one.</li><li>Reference two.</li></ol></div>
    <div class="catlinks">Categories: Learning techniques | Memory</div>
    </div>
  </div>`,
    bodyBottom: `  <footer class="site-footer"><ul><li><a href="/wiki/About">About Wikipedia</a></li><li><a href="/wiki/Contact">Contact</a></li></ul></footer>`,
  }),
  {
    url: "https://en.wikipedia.org/wiki/Incremental_reading",
    title: "Incremental reading",
    siteName: "Wikipedia",
    minWords: 350,
    mustContain: ["History", "Method", "Example scheduling parameters"],
    // See-also links are article content, not chrome — they stay.
    mustNotContain: ["Navigation box", "Categories:", "About Wikipedia", "Contact", "Reference one"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 7. Personal blog
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "blog",
  page({
    head: `
<meta name="author" content="Bloggy Person">
<title>On Small Tools — bloggy.example.dev</title>`,
    bodyTop: `  <nav class="blog-nav"><a href="/">Home</a><a href="/archive">Archive</a><a href="/feed">RSS</a></nav>`,
    article: `  <article>
    <h1>On Small Tools</h1>
    <p class="meta">Posted 2026-05-12 by Bloggy Person</p>
${prose(16, 12)}
    <h2>A worked example</h2>
${prose(9, 4)}
    <pre><code>$ small-tool --watch src/
watching 3 files for changes
compiled in 41ms
</code></pre>
${prose(5, 8)}
  </article>`,
    bodyBottom: `  <footer><p>© 2026 bloggy.example.dev</p></footer>`,
  }),
  {
    title: "On Small Tools",
    authors: ["Bloggy Person"],
    minWords: 300,
    mustContain: ["A worked example", "small-tool"],
    mustNotContain: ["RSS", "Archive"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 8. Documentation page
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "docs-page",
  page({
    head: `<title>Configuration · ToolDocs</title>
<meta name="description" content="Configuration reference for the example tool.">`,
    bodyTop: `  <aside class="docs-sidebar">
    <a href="/docs/install">Install</a> <a href="/docs/config">Configuration</a>
    <a href="/docs/cli">CLI</a> <a href="/docs/api">API</a> <a href="/docs/faq">FAQ</a>
  </aside>`,
    article: `  <main class="docs-content">
    <h1>Configuration</h1>
    <p>The example tool reads a single TOML file. This page documents every key, its default, and how values interact.</p>
    <h2 id="general">General</h2>
${prose(6, 1)}
    <pre><code>[general]
mode = "fast"
retries = 3
</code></pre>
    <h2 id="advanced">Advanced</h2>
${prose(8, 14)}
    <table>
      <thead><tr><th>Key</th><th>Default</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td><code>mode</code></td><td><code>"fast"</code></td><td>Sets the processing mode.</td></tr>
        <tr><td><code>retries</code></td><td><code>3</code></td><td>Attempts per unit of work.</td></tr>
      </tbody>
    </table>
    <blockquote><p>Changing <code>mode</code> at runtime requires a restart.</p></blockquote>
${prose(4, 7)}
  </main>`,
    bodyBottom: `  <footer class="docs-footer"><a href="/docs/config">Configuration</a><a href="/docs/cli">CLI</a><a href="/docs/api">API</a><p>© 2026 ToolDocs</p></footer>`,
  }),
  {
    title: "Configuration",
    minWords: 220,
    mustContain: ["Advanced", "Sets the processing mode", "[general]"],
    mustNotContain: ["FAQ", "© 2026 ToolDocs"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 9. Heavy navigation
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "heavy-navigation",
  page({
    head: `
<meta property="og:title" content="A Story Buried Under Navigation">
<meta property="og:site_name" content="Nav Heavy Daily">`,
    bodyTop: `  <header class="mega-nav">
    ${Array.from({ length: 8 }, (_, i) => `<a href="/s${i}">Section ${i}</a>`).join(" ")}
    <a href="/login">Log in</a> <a href="/register">Register</a>
  </header>
  <nav class="breadcrumb"><a href="/">Home</a> / <a href="/news">News</a> / <a href="/news/x">Sub</a></nav>
  <div class="topic-menu">${Array.from({ length: 10 }, (_, i) => `<a href="/t${i}">Topic ${i}</a>`).join(" ")}</div>`,
    article: `  <article>
    <h1>A Story Buried Under Navigation</h1>
${prose(20, 9)}
    <h2>Details</h2>
${prose(10, 16)}
  </article>`,
    bodyBottom: `  <div class="mega-footer">
    ${Array.from({ length: 20 }, (_, i) => `<a href="/f${i}">Footer ${i}</a>`).join(" ")}
    <a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/cookies">Cookie preferences</a>
  </div>`,
  }),
  {
    title: "A Story Buried Under Navigation",
    minWords: 380,
    mustContain: ["Details"],
    mustNotContain: ["Topic 1", "Footer 2", "Cookie preferences", "Log in", "Register"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 10. Repeated recommendation blocks
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "recommendations-repeated",
  page({
    head: `<meta property="og:title" content="One Good Article Among Many Cards">
<meta property="og:site_name" content="Card Town">`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>One Good Article Among Many Cards</h1>
${prose(18, 11)}
    <h2>Conclusion</h2>
${prose(8, 6)}
  </article>`,
    bodyBottom: `  <div class="cards">
    ${Array.from({ length: 12 }, (_, i) => `<a class="card" href="/c${i}"><img src="https://cdn.cardtown.example.com/thumb${i}.jpg" width="640" height="360" alt="Card ${i}"><span>Read more: Card story ${i}</span></a>`).join("\n    ")}
  </div>
  <div class="cards-row-2">
    ${Array.from({ length: 12 }, (_, i) => `<a class="card" href="/d${i}"><span>Most popular: Related card ${i}</span></a>`).join("\n    ")}
  </div>
${CHROME_FOOTER}`,
  }),
  {
    title: "One Good Article Among Many Cards",
    minWords: 350,
    mustContain: ["Conclusion"],
    mustNotContain: ["Read more: Card story 1", "Most popular: Related card", "All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 11. Newsletter CTAs
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "newsletter-cta",
  page({
    head: `<meta property="og:title" content="The Newsletter Garden">
<meta property="og:site_name" content="Garden Weekly">`,
    bodyTop: `${CHROME_NEWSLETTER}\n${CHROME_NAV}`,
    article: `  <article>
    <h1>The Newsletter Garden</h1>
${prose(16, 13)}
${CHROME_NEWSLETTER}
    <h2>Practical notes</h2>
${prose(10, 3)}
  </article>`,
    bodyBottom: `${CHROME_NEWSLETTER}\n${CHROME_FOOTER}`,
  }),
  {
    title: "The Newsletter Garden",
    minWords: 330,
    mustContain: ["Practical notes"],
    mustNotContain: ["Sign up for our free newsletter", "All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 12. Donation prompts
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "donation-prompts",
  page({
    head: `<meta property="og:title" content="Reporting That Needs Readers">
<meta property="og:site_name" content="Reader Supported News">`,
    bodyTop: `${CHROME_DONATE}\n${CHROME_NAV}`,
    article: `  <article>
    <h1>Reporting That Needs Readers</h1>
${prose(16, 5)}
    <h2>Why it matters</h2>
${prose(9, 10)}
  </article>`,
    bodyBottom: `${CHROME_DONATE}\n${CHROME_DONATE.replace("today", "now")}\n${CHROME_FOOTER}`,
  }),
  {
    title: "Reporting That Needs Readers",
    minWords: 320,
    mustContain: ["Why it matters"],
    mustNotContain: ["Donate today", "Donate now", "All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 13. Embedded modal markup
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "embedded-modal",
  page({
    head: `<meta property="og:title" content="An Article Behind a Consent Modal">
<meta property="og:site_name" content="Consent Daily">`,
    bodyTop: `  <div class="modal-overlay" role="dialog" aria-label="consent">
    <div class="modal">
      <h3>Your privacy choices</h3>
      <p>We use cookies and similar technologies. Manage your Privacy Manager settings.</p>
      <button>Accept all</button> <button>Reject all</button>
    </div>
  </div>`,
    article: `  <article>
    <h1>An Article Behind a Consent Modal</h1>
${prose(18, 7)}
    <h2>Further reading notes</h2>
${prose(9, 12)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "An Article Behind a Consent Modal",
    minWords: 330,
    mustContain: ["Further reading notes"],
    mustNotContain: ["Your privacy choices", "Accept all", "Privacy Manager", "cookies"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 14. Multi-image article with captions
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "multi-images-captions",
  page({
    head: `<meta property="og:title" content="A Photo Essay in Three Frames">
<meta property="og:site_name" content="Frame Quarterly">
<meta property="og:image" content="https://cdn.frame.example.com/photos/1.jpg">`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>A Photo Essay in Three Frames</h1>
${prose(6, 2)}
    <figure>
      <img src="https://cdn.frame.example.com/photos/1.jpg" alt="First frame" width="1600" height="1000">
      <figcaption>Frame one: the harbor at first light. (Photo: A. Photographer)</figcaption>
    </figure>
${prose(5, 9)}
    <figure>
      <img src="https://cdn.frame.example.com/photos/2.jpg" alt="Second frame" width="1600" height="1000">
      <figcaption>Frame two: the market at noon. (Photo: A. Photographer)</figcaption>
    </figure>
${prose(5, 4)}
    <figure>
      <img src="https://cdn.frame.example.com/photos/3.jpg" alt="Third frame" width="1600" height="1000">
      <figcaption>Frame three: the last ferry. (Photo: A. Photographer)</figcaption>
    </figure>
${prose(8, 6)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "A Photo Essay in Three Frames",
    minWords: 150,
    mustContain: ["Frame one", "Frame two", "Frame three"],
    mustNotContain: ["All rights reserved"],
    minImages: 3,
    expectedFigureCaptions: ["the harbor at first light", "the market at noon", "the last ferry"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 15. Table-heavy
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "tables",
  page({
    head: `<meta property="og:title" content="The Numbers, In Rows">
<meta property="og:site_name" content="Rows Weekly">`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>The Numbers, In Rows</h1>
${prose(8, 3)}
    <table>
      <caption>Spending by category, 2026</caption>
      <thead><tr><th>Category</th><th>2025</th><th>2026</th><th>Change</th></tr></thead>
      <tbody>
        <tr><td>Operations</td><td>1,200</td><td>1,350</td><td>+12.5%</td></tr>
        <tr><td>Outreach</td><td>480</td><td>502</td><td>+4.6%</td></tr>
        <tr><td>Research</td><td>910</td><td>905</td><td>-0.5%</td></tr>
        <tr><td>Reserve</td><td>250</td><td>250</td><td>0%</td></tr>
      </tbody>
    </table>
${prose(6, 8)}
    <h2>Reading the table</h2>
${prose(6, 1)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "The Numbers, In Rows",
    minWords: 130,
    mustContain: ["Spending by category, 2026", "Operations", "Reading the table", "1,350"],
    mustNotContain: ["All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 16. Blockquote-heavy essay
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "blockquotes",
  page({
    head: `<meta property="og:title" content="What They Said, At Length">
<meta property="og:site_name" content="Quote Basket">`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>What They Said, At Length</h1>
${prose(6, 5)}
    <blockquote><p>The first long quotation runs several sentences, exactly as it was delivered, because the wording itself is the news.</p></blockquote>
${prose(4, 11)}
    <blockquote><p>The second long quotation answers the first, and the two together frame the dispute that follows.</p></blockquote>
${prose(4, 7)}
    <blockquote><p>The third quotation closes the sequence with the official's summary of the whole affair.</p></blockquote>
    <h2>Context</h2>
${prose(8, 13)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "What They Said, At Length",
    minWords: 150,
    mustContain: ["The first long quotation", "The second long quotation", "The third quotation", "Context"],
    mustNotContain: ["All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 17. Code-heavy tutorial
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "code-blocks",
  page({
    head: `<meta property="og:title" content="A Tiny Parser, Start to Finish">
<meta property="og:site_name" content="Parse Codely">`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>A Tiny Parser, Start to Finish</h1>
${prose(6, 4)}
    <pre><code>fn parse(input: &amp;str) -&gt; Node {
    let tokens = lex(input);
    let mut parser = Parser::new(tokens);
    parser.parse_root()
}</code></pre>
    <h2>Step by step</h2>
${prose(6, 9)}
    <pre><code>interface Node {
  kind: string;
  text: string;
  children: Node[];
}</code></pre>
${prose(6, 14)}
    <p>Inline code like <code>parse_root()</code> appears in the prose too.</p>
${prose(4, 2)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "A Tiny Parser, Start to Finish",
    minWords: 120,
    mustContain: ["fn parse", "parse_root", "Step by step", "interface Node"],
    mustNotContain: ["All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 18. Lazy-loaded images
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "lazy-images",
  page({
    head: `<meta property="og:title" content="Pictures That Arrive Late">
<meta property="og:site_name" content="Lazy Ledger">
<meta property="og:image" content="https://cdn.lazy.example.com/media/cover.jpg">`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>Pictures That Arrive Late</h1>
${prose(8, 6)}
    <figure>
      <img class="lazyload" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-src="https://cdn.lazy.example.com/media/cover.jpg" alt="The late cover" width="1200" height="800">
      <figcaption>The cover image, loaded lazily on the origin site.</figcaption>
    </figure>
    <figure>
      <img class="lazyload" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" data-lazy-src="https://cdn.lazy.example.com/media/inline.jpg" alt="Inline photo" width="1200" height="800">
      <figcaption>An inline photo behind a data-lazy-src attribute.</figcaption>
    </figure>
    <figure>
      <img src="https://cdn.lazy.example.com/media/placeholder.gif" data-original="https://cdn.lazy.example.com/media/gallery.jpg" alt="Gallery photo" width="1200" height="800">
      <figcaption>A gallery photo behind data-original.</figcaption>
    </figure>
${prose(10, 1)}
    <h2>Why sites do this</h2>
${prose(6, 8)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "Pictures That Arrive Late",
    minWords: 200,
    mustContain: ["Why sites do this"],
    mustNotContain: ["All rights reserved"],
    mustContainImageUrls: [
      "https://cdn.lazy.example.com/media/cover.jpg",
      "https://cdn.lazy.example.com/media/inline.jpg",
      "https://cdn.lazy.example.com/media/gallery.jpg",
    ],
    mustNotContainImageUrls: ["placeholder.gif", "data:image/gif"],
    expectedFigureCaptions: ["loaded lazily", "data-lazy-src attribute", "behind data-original"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 19. Relative image URLs
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "relative-image-urls",
  page({
    head: `<link rel="canonical" href="https://rel.example.com/posts/2026/best-hikes/">
<meta property="og:title" content="The Best Hikes, With Maps">
<meta property="og:site_name" content="Trail Notes">
<meta property="og:image" content="/assets/maps/cover.jpg">`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>The Best Hikes, With Maps</h1>
${prose(8, 10)}
    <figure>
      <img src="../images/ridge.jpg" alt="The ridge trail">
      <figcaption>The ridge trail above the valley.</figcaption>
    </figure>
${prose(6, 3)}
    <figure>
      <img src="/assets/maps/lake-map.png" alt="Lake map">
      <figcaption>The lake loop, drawn to scale.</figcaption>
    </figure>
${prose(8, 5)}
    <h2>Packing notes</h2>
${prose(6, 12)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "The Best Hikes, With Maps",
    minWords: 180,
    mustContain: ["Packing notes"],
    mustContainImageUrls: [
      "https://rel.example.com/posts/2026/images/ridge.jpg",
      "https://rel.example.com/assets/maps/lake-map.png",
      "https://rel.example.com/assets/maps/cover.jpg",
    ],
    mustNotContain: ["../images/ridge.jpg", "All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 20. Malformed HTML
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "malformed-html",
  `<!doctype html>
<html>
<head>
<title>Broken Markup, Real Story</title>
<meta property="og:title" content="Broken Markup, Real Story">
<meta property="og:site_name" content="Tag Soup Times">
</head>
<body>
<div class="nav"><a href="/">Home</a><a href="/x">Menu item</a><a href="/y">Another</a><a href="/z">Third</a>
<article>
<h1>Broken Markup, Real Story</h1>
<p>Unclosed paragraph tags everywhere, but the prose is intact and readable, which is what matters for extraction.
${prose(16, 7)}
<h2>Still readable</h2>
${prose(10, 2)}
<div class="share"><a href="/share">Share on Facebook</a><a href="/tw">Share on X</a></div>
<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
</body>
</html>`,
  {
    title: "Broken Markup, Real Story",
    minWords: 300,
    mustContain: ["Still readable"],
    mustNotContain: ["Share on Facebook", "Privacy", "Terms", "Menu item"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 21/25. JS-rendered shell (rendered fallback required). The static page is
// an empty app root; `rendered.html` is what the (fake) renderer returns.
// ──────────────────────────────────────────────────────────────────────────
const SHELL_HEAD = `<title>Reactive Daily</title>
<meta property="og:site_name" content="Reactive Daily">`;
const shellBody = `  <div id="app-root"><div class="skeleton-splash">Loading Reactive Daily…</div></div>
<script src="/assets/client.js"></script>`;
const renderedArticle = `<!doctype html>
<html lang="en"><head>
<title>Hydrated Story Emerges at Runtime | Reactive Daily</title>
<meta property="og:title" content="Hydrated Story Emerges at Runtime">
<meta property="og:site_name" content="Reactive Daily">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Hydrated Story Emerges at Runtime","author":[{"name":"Hydra Tion"}],"datePublished":"2026-08-10T00:00:00Z","publisher":{"name":"Reactive Daily"}}</script>
</head><body>
<div id="app-root">
  <article data-reactroot>
    <h1>Hydrated Story Emerges at Runtime</h1>
    <p>By Hydra Tion</p>
${prose(20, 6)}
    <h2>How it renders</h2>
${prose(10, 13)}
    <figure><img src="https://cdn.reactive.example.com/runtime.jpg" alt="Runtime"><figcaption>The story only exists after scripts run.</figcaption></figure>
${prose(6, 3)}
  </article>
</div>
</body></html>`;

mkdirSync(join(outRoot, "js-rendered-shell"), { recursive: true });
writeFileSync(
  join(outRoot, "js-rendered-shell", "page.html"),
  page({ head: SHELL_HEAD, bodyTop: shellBody })
);
writeFileSync(join(outRoot, "js-rendered-shell", "rendered.html"), renderedArticle);
writeFileSync(
  join(outRoot, "js-rendered-shell", "expected.json"),
  JSON.stringify(
    {
      title: "Hydrated Story Emerges at Runtime",
      authors: ["Hydra Tion"],
      publishedAtContains: "2026-08-10",
      siteName: "Reactive Daily",
      minWords: 400,
      mustContain: ["How it renders"],
      mustNotContain: ["Loading Reactive Daily"],
      expectedExtractorPrefix: "rendered-",
      renderedFallbackRequired: true,
      confidenceAtLeast: "medium",
    },
    null,
    2
  ) + "\n"
);

// both-static-fail: same shell, no capture → typed low_confidence.
mkdirSync(join(outRoot, "both-static-fail"), { recursive: true });
writeFileSync(
  join(outRoot, "both-static-fail", "page.html"),
  page({ head: SHELL_HEAD, bodyTop: shellBody })
);
writeFileSync(
  join(outRoot, "both-static-fail", "expected.json"),
  JSON.stringify(
    {
      expectsFailure: "low_confidence",
      mustNotContain: ["Loading Reactive Daily"],
    },
    null,
    2
  ) + "\n"
);

// ──────────────────────────────────────────────────────────────────────────
// 22. JSON-LD rich metadata
// ──────────────────────────────────────────────────────────────────────────
writeFixture(
  "jsonld-rich",
  page({
    head: `
<script type="application/ld+json">{"@context":"https://schema.org","@type":"TechArticle","headline":"A Metadata-First Article","author":[{"name":"Jay Sonne-Eldee"},{"name":"Co Authorson"}],"datePublished":"2026-04-01T12:00:00Z","dateModified":"2026-04-02T12:00:00Z","publisher":{"name":"Schema First Media"},"inLanguage":"en","image":"https://cdn.schema.example.com/first.jpg","mainEntityOfPage":{"@id":"https://schemafirst.example.com/articles/metadata-first"},"articleBody":"The article body as recorded in structured data, present so the completeness signal has something to measure against during scoring."}</script>`,
    bodyTop: CHROME_NAV,
    article: `  <article>
    <h1>A Metadata-First Article</h1>
    <p>By Jay Sonne-Eldee and Co Authorson</p>
${prose(16, 15)}
    <h2>Why structured data helps</h2>
${prose(10, 8)}
  </article>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "A Metadata-First Article",
    authors: ["Jay Sonne-Eldee", "Co Authorson"],
    publishedAtContains: "2026-04-01",
    siteName: "Schema First Media",
    minWords: 300,
    mustContain: ["Why structured data helps"],
    mustNotContain: ["All rights reserved"],
    confidenceAtLeast: "medium",
  }
);

// ──────────────────────────────────────────────────────────────────────────
// 23/24. Engine-specific winners. These skeletons are crafted so one engine
// reliably outperforms the other (expectedExtractor is pinned after a
// calibration run — see fixtures README).
// ──────────────────────────────────────────────────────────────────────────

// defuddle-wins: paywalled-meter wrapper with a summary region that
// Readability grades too thin, but Defuddle's exact-selector cleanup keeps.
writeFixture(
  "defuddle-wins",
  page({
    head: `
<meta property="og:title" content="Metered Story With a Clean Teaser">
<meta property="og:site_name" content="The Metered Ledger">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Metered Story With a Clean Teaser","author":[{"name":"Dee Fuddle"}],"publisher":{"name":"The Metered Ledger"}}</script>`,
    bodyTop: CHROME_NAV,
    article: `  <article class="metered-story">
    <h1>Metered Story With a Clean Teaser</h1>
    <p>By Dee Fuddle</p>
${prose(20, 1)}
    <h2>The teaser section</h2>
${prose(8, 4)}
    <div class="most-read">
      <h3>Most read</h3>
      ${Array.from({ length: 4 }, (_, i) => `<p><a href="/mr${i}">Most read story ${i}: a long, prose-like teaser sentence with commas, context, and a second clause that reads like ordinary reporting.</a></p>`).join("\n      ")}
    </div>
  </article>
  <div class="paywall-gate">
    <p>Subscribe to continue reading. You have 2 free articles left.</p>
    <a href="/subscribe">Subscribe</a> <a href="/login">Log in</a>
  </div>`,
    bodyBottom: CHROME_FOOTER,
  }),
  {
    title: "Metered Story With a Clean Teaser",
    authors: ["Dee Fuddle"],
    minWords: 350,
    mustNotContain: ["free articles left", "All rights reserved"],
    confidenceAtLeast: "medium",
    // Pinned by calibration: Readability keeps the chunky "most read" teasers
    // (they read like prose) and pays the chrome penalty; Defuddle strips
    // them by class and wins on score.
    expectedExtractor: "defuddle",
  }
);

// readability-wins: long nested article inside landmark-heavy layout where
// Readability's ancestor scoring grabs the full body.
writeFixture(
  "readability-wins",
  page({
    head: `
<meta property="og:title" content="The Long Read Nested Deep">
<meta property="og:site_name" content="Landmark Gazette">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"The Long Read Nested Deep","author":[{"name":"Reed Ability"}],"publisher":{"name":"Landmark Gazette"}}</script>`,
    bodyTop: "",
    article: `  <div class="post">
  <header class="masthead"><a href="/">Landmark Gazette</a><a href="/sections">Sections</a><a href="/subscribe">Subscribe</a></header>
  <nav aria-label="sections"><a href="/a">Alpha</a><a href="/b">Beta</a><a href="/c">Gamma</a><a href="/d">Delta</a><a href="/e">Epsilon</a></nav>
  <main>
    <article role="main">
      <div class="story-wrap">
        <h1>The Long Read Nested Deep</h1>
        <p>By Reed Ability</p>
${prose(22, 9)}
        <h2>Part one</h2>
${prose(12, 2)}
        <blockquote><p>A source close to the matter put it plainly: the structure is the story.</p></blockquote>
${prose(10, 5)}
        <div class="article-bottom">
        <h2>Part two</h2>
${prose(12, 16)}
        </div>
      </div>
    </article>
  </main>
  </div>`,
    bodyBottom: `  <section class="recirc"><h3>Most read</h3><a href="/m1">Most read one</a><a href="/m2">Most read two</a><a href="/m3">Most read three</a></section>
${CHROME_FOOTER}`,
  }),
  {
    title: "The Long Read Nested Deep",
    authors: ["Reed Ability"],
    minWords: 500,
    mustContain: ["Part one", "Part two"],
    mustNotContain: ["Most read", "All rights reserved"],
    confidenceAtLeast: "medium",
    // Pinned by calibration: the final section lives in the common
    // .article-bottom wrapper; Defuddle treats it as trailing chrome and
    // loses the content, Readability keeps it and wins on completeness.
    expectedExtractor: "readability",
  }
);

console.log("fixtures generated under", outRoot);
