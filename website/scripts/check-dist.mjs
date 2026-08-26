#!/usr/bin/env node
/**
 * Dist gates: JS budget, eager demo import, banned phrases, claims, internal
 * links, analytics scripts, and indexed-production launch blockers.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(websiteRoot, 'dist');
const indexing = process.env.PUBLIC_INDEXING === 'index' ? 'index' : 'noindex';
const analyticsEnabled = process.env.PUBLIC_ANALYTICS_ENABLED === 'true';
const JS_BUDGET_BYTES = 180 * 1024;
const showcaseBudgets = JSON.parse(
  readFileSync(join(websiteRoot, 'scripts/showcase-budgets.json'), 'utf8'),
);

function fail(message) {
  console.error(`check:dist: ${message}`);
  process.exitCode = 1;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

if (!existsSync(dist)) {
  fail(`missing ${dist} — run npm run build first`);
  process.exit(1);
}

const htmlFiles = walk(dist).filter((file) => extname(file) === '.html');

function distPathForRoute(pathname) {
  if (pathname === '/') return join(dist, 'index.html');
  const trimmed = pathname.replace(/\/$/, '');
  const nested = join(dist, trimmed.slice(1), 'index.html');
  const sibling = join(dist, `${trimmed.slice(1)}.html`);
  if (existsSync(nested)) return nested;
  if (existsSync(sibling)) return sibling;
  return null;
}

const homeHtmlPath = distPathForRoute('/');
if (!homeHtmlPath) {
  fail('homepage HTML missing from dist');
} else {
  const homeHtml = readFileSync(homeHtmlPath, 'utf8');
  if (
    /<astro-island\b[^>]*\bclient="load"[^>]*component-url="[^"]*DemoIsland/i.test(homeHtml) ||
    /<astro-island\b[^>]*component-url="[^"]*DemoIsland[^"]*"[^>]*\bclient="load"/i.test(homeHtml)
  ) {
    fail('demo island is hydrated with client=load; it must stay client:visible / lazy');
  }
  const scriptSrcs = [
    ...homeHtml.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g),
  ].map((match) => match[1]);
  const unique = [...new Set(scriptSrcs)].filter(
    (src) =>
      src.startsWith('/') ||
      src.startsWith('./') ||
      src.startsWith('_astro') ||
      src.includes('/_astro/'),
  );
  let totalGzip = 0;
  for (const src of unique) {
    const cleaned = src.replace(/^\.\//, '/').split('?')[0];
    const file = join(dist, cleaned.replace(/^\//, ''));
    if (!existsSync(file) || !file.endsWith('.js')) continue;
    totalGzip += gzipSync(readFileSync(file)).length;
  }
  if (totalGzip > JS_BUDGET_BYTES) {
    fail(`homepage initial JS gzip ${totalGzip} exceeds ${JS_BUDGET_BYTES}`);
  } else {
    console.log(`check:dist: homepage initial JS gzip ${totalGzip} / ${JS_BUDGET_BYTES}`);
  }
}

const showcaseChunks = walk(join(dist, '_astro')).filter(
  (file) => /DemoIsland\.[^.]+\.js$/.test(file),
);
if (showcaseChunks.length !== 1) {
  fail(`expected one lazy DemoIsland chunk, found ${showcaseChunks.length}`);
} else {
  const showcaseGzip = gzipSync(readFileSync(showcaseChunks[0])).length;
  if (showcaseGzip > showcaseBudgets.maxIslandGzipBytes) {
    fail(`DemoIsland gzip ${showcaseGzip} exceeds ${showcaseBudgets.maxIslandGzipBytes}`);
  } else {
    console.log(
      `check:dist: DemoIsland gzip ${showcaseGzip} / ${showcaseBudgets.maxIslandGzipBytes}`,
    );
  }
}

const layoutPath = join(websiteRoot, 'src/layouts/BaseLayout.astro');
const layoutSource = readFileSync(layoutPath, 'utf8');
if (
  /from ['"].*demo/i.test(layoutSource) ||
  /HomeDemoSlot|demo-contract|components\/demo/.test(layoutSource)
) {
  fail('BaseLayout.astro must not eagerly import the demo island or demo state machine');
}

const bannedPath = join(websiteRoot, 'src/config/banned-phrases.json');
const banned = JSON.parse(readFileSync(bannedPath, 'utf8'));
const exemption = banned.exemptionAttribute || 'data-historical-quote';

function stripExempt(html) {
  const attr = exemption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`<[^>]*\\b${attr}\\b[\\s\\S]*?<\\/[^>]+>`, 'gi'), '');
}

function phraseIsDenied(html, phrase) {
  const lower = html.toLowerCase();
  const needle = String(phrase).toLowerCase();
  let from = 0;
  let saw = false;
  while (from < lower.length) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) break;
    saw = true;
    const window = lower.slice(Math.max(0, idx - 100), idx + needle.length + 40);
    const denied = /does not claim|do not claim|not claim|never display|must not|not market/.test(
      window,
    );
    if (!denied) return false;
    from = idx + needle.length;
  }
  return saw;
}

for (const file of htmlFiles) {
  const raw = readFileSync(file, 'utf8');
  const html = stripExempt(raw);
  for (const phrase of banned.phrases) {
    if (
      html.toLowerCase().includes(String(phrase).toLowerCase()) &&
      !phraseIsDenied(html, phrase)
    ) {
      fail(`${relative(dist, file)} contains banned phrase "${phrase}"`);
    }
  }
}

const claimsJsonPath = join(websiteRoot, 'src/config/claims.json');
const claimsJson = existsSync(claimsJsonPath)
  ? JSON.parse(readFileSync(claimsJsonPath, 'utf8'))
  : { claims: [] };
const privateIds = (claimsJson.claims || [])
  .filter((claim) => claim && claim.public === false)
  .map((claim) => claim.id);
if (indexing === 'index') {
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    for (const id of privateIds) {
      if (html.includes(`data-claim-id="${id}"`) || html.includes(`data-claim-id='${id}'`)) {
        fail(`${relative(dist, file)} contains public:false claim id "${id}" while PUBLIC_INDEXING=index`);
      }
    }
  }
} else {
  console.log('check:dist: skipping private-claim HTML scan (PUBLIC_INDEXING is not index)');
}

const ANALYTICS_HINTS = ['plausible.io', 'googletagmanager.com', 'google-analytics.com', 'segment.com'];
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  if (!analyticsEnabled) {
    for (const hint of ANALYTICS_HINTS) {
      if (html.includes(hint)) {
        fail(`${relative(dist, file)} loads analytics host ${hint} while PUBLIC_ANALYTICS_ENABLED is off`);
      }
    }
  }
}

function resolveInternal(fromFile, href) {
  href = href.replaceAll('&amp;', '&');
  const [pathWithQuery, hash] = href.split('#');
  const pathPart = pathWithQuery.split('?')[0];
  if (!pathPart || pathPart.startsWith('mailto:') || pathPart.startsWith('tel:')) return { ok: true };
  if (/^https?:\/\//i.test(pathPart)) {
    try {
      const url = new URL(pathPart);
      if (url.hostname === 'useplethora.com' || url.hostname === 'www.useplethora.com') {
        return resolveInternal(fromFile, url.pathname + (url.hash || ''));
      }
    } catch {
      return { ok: true };
    }
    return { ok: true };
  }
  const pathname = pathPart.startsWith('/')
    ? pathPart
    : '/' + relative(dist, resolve(dirname(fromFile), pathPart)).split('\\').join('/');
  const assetPath = join(dist, pathname.replace(/^\//, ''));
  if (/\.[a-z0-9]+$/i.test(pathname) && existsSync(assetPath)) {
    return { ok: true };
  }
  const target = distPathForRoute(pathname.replace(/\/$/, '') || '/');
  if (!target) return { ok: false, pathname };
  if (hash) {
    const targetHtml = readFileSync(target, 'utf8');
    const id = hash.replace(/^#/, '');
    if (id && !new RegExp(`id=["']${id}["']`).test(targetHtml)) {
      return { ok: false, pathname: `${pathname}#${id}` };
    }
  }
  return { ok: true };
}

const hrefRe = /(?:href)=["']([^"']+)["']/gi;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  // Client-side scripts construct links at runtime (e.g. the docs search
  // combobox emits `href="${s.url}"` templates). Their text is not served as
  // markup, so strip script bodies before scanning for internal hrefs.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  let match;
  while ((match = hrefRe.exec(markup))) {
    const href = match[1];
    if (href.startsWith('http') && !href.includes('useplethora.com')) continue;
    if (href.startsWith('data:') || href.startsWith('javascript:')) continue;
    const result = resolveInternal(file, href);
    if (!result.ok) {
      fail(`${relative(dist, file)} broken internal link ${href} (${result.pathname})`);
    }
  }
}

if (indexing === 'index') {
  const legalSource = readFileSync(join(websiteRoot, 'src/config/legal.ts'), 'utf8');
  if (/privacyFinal:\s*false/.test(legalSource) || /legalEntityName:\s*null/.test(legalSource) || /termsFinal:\s*false/.test(legalSource)) {
    fail('PUBLIC_INDEXING=index but legal placeholders are still unset');
  }
  const assetsSource = readFileSync(join(websiteRoot, 'src/config/assets.ts'), 'utf8');
  if (/placeholder:\s*true/.test(assetsSource)) {
    fail('PUBLIC_INDEXING=index but marketing assets still mark placeholder: true');
  }
  const launchSource = readFileSync(join(websiteRoot, 'src/config/launch.ts'), 'utf8');
  if (/severity:\s*'block'/.test(launchSource)) {
    fail('PUBLIC_INDEXING=index but launch blockers with severity block remain');
  }
} else {
  console.log('check:dist: placeholder screenshots and legal blockers are warnings only until PUBLIC_INDEXING=index');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('check:dist: ok');
