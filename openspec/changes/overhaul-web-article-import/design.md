# Design: Canonical Web Article Import Pipeline

## Context

Incrementum's URL import path (Android Share Sheet, PWA share target, toolbar "Import URL" dialog) currently produces flattened webpage dumps, not articles.

**Current state (verified in repo):**

- **Entry points.** Android: `FolderImportPlugin.kt` receives `ACTION_SEND`, regex-extracts the first URL, and dispatches an `android-shared-url` `CustomEvent` into the WebView (cold-start shares drain via `register_share_listener`). Frontend: `src/lib/shareTarget.ts` → `src/hooks/useShareTarget.ts` → `documentStore.importFromUrl`. PWA: `manifest.json` share target → `/share-target` redirect → hash params → same hook. Desktop: `WebArticleImportDialog` → same store action. iOS share reception is not implemented (`register_share_listener` returns empty).
- **Fetch.** `documentStore.importFromUrl` → `src/utils/documentImport.ts:importFromUrl` → Rust `fetch_url_content` (`src-tauri/src/commands/document.rs:1563`, reqwest, 60s timeout, SSRF guard, temp-file download) → `read_document_file` bytes → `TextDecoder`. Browser/PWA mode uses `fetch()` with CORS-proxy fallbacks. The Rust command reports only `{file_path, file_name, content_type}` — no final redirect URL, no HTTP status, and content type is guessed from the file extension.
- **"Extraction".** None. `processHtmlContent` (`src/utils/documentImport.ts:74`) is a whole-page sanitizer: removes `script/iframe/object/embed/form`, `on*` attributes, isolates MediaWiki `.mw-parser-output`, normalizes lazy `data-src` attributes, strips `srcset`, injects `<base>` + guardrail CSS. The entire page becomes the document — hence nav, subscribe prompts, "Related"/"We Recommend"/"Latest" modules, footers, and modals all land in imports.
- **Persistence.** `create_document` + `update_document_content` (display HTML in the `content` column) + `update_document` (JSON `metadata`: source, fetchedAt, author, description, og:image, wordCount, readingTime). `fileType: 'html'`, category "Web Import". The `documents` table (`src-tauri/src/database/migrations.rs`) has `content`, `html_content`, `metadata`, and `source_url` columns; list queries exclude large text columns.
- **Rendering.** `DocumentViewer.tsx:4743` uses `metadata.articleHtml || content || htmlContent` → `htmlForDisplay` DOM pass → sandboxed iframe (`sandbox="allow-same-origin allow-scripts"`, `srcDoc`) with `injectHtmlViewerStyles` typography/theme injection and scroll restore. Highlights anchor by cumulative character offsets (`src/utils/textHighlights.ts`); extracts, TTS, AI, and search consume the persisted DOM/text. This machinery already gives imported articles the full reader experience — the missing piece is clean content.
- **Images.** Kept as remote absolute URLs with `referrerpolicy=no-referrer`; optional per-image offline download via `ingest_remote_image_asset` (sha256-deduped `image_assets` table). `coverImageUrl` exists for covers.
- **Existing libraries.** `dompurify` is already a production dependency (unused in the import path); `jsdom` is a dev dependency (tests). Rust has `readable-readability` + `html2text`, used **only** by browser-extension enrichment (`browser_sync_server.rs:fetch_readable_content`) — not by the share path. `@mozilla/readability` and `defuddle` are absent.
- **Constraints.** Tauri 2.11; Vite `inlineDynamicImports` for the Tauri target (new deps land in the entry chunk; bundle budget `scripts/bundle-budgets.json` entryChunkBytes 3.0 MB vs ~2.67 MB actual — thin headroom); perf bench gate (`npm run bench:check`) with baseline protocol; vitest jsdom environment; Android is a single-activity WebView app where the plugin layer is the proven place for native WebView work; no record-level sync exists (cloud backup zips DB + documents folder), so schema growth only affects local DB and backups.

**Problem:** the importer never answers "what is the article?". It must fetch the source, run competing semantic extractions, score and select, fall back to a rendered DOM when static extraction is inadequate, normalize and sanitize, persist as an Incrementum-native article, and render through the existing reader. The Mother Jones import (title "The Trumps' Crypto Project Just Got One Step Closer to Becoming a Bank", author Sophie Hurwitz, Aug 15 2026) is the regression case.

## Goals / Non-Goals

**Goals:**

- Share → Incrementum → readable article, with zero user-facing engine choices or element picking.
- Competing Defuddle + Mozilla Readability candidates on independent DOM clones, deterministic scoring/selection, confidence-gated rendered-page fallback, canonical metadata, first-class figures/images, strict sanitization, persisted extraction provenance + raw-source snapshots, typed failure UX, deterministic fixture regression suite (incl. Mother Jones), benchmark + bundle-budget compliance.
- Platform-shared pipeline (TypeScript, WebView native DOM) across Android/desktop/PWA; platform-specific only the rendered-DOM capture.

**Non-Goals:**

- Full browser, WARC/archiving, publisher-CSS reproduction, running publisher JS after import, paywall/auth circumvention, universal video download, replacing the reader, redesigning Share Sheet UX, cloud scraping infrastructure, iOS share reception (pipeline is ready for it when the entry point exists), reprocessing of pre-existing imports (no snapshots exist for them; see Migration).

## Decisions

### D1. Pipeline lives in TypeScript, using the WebView's native DOM

New module tree `src/utils/articleImport/` executed in the app WebView (or browser for PWA). Defuddle and `@mozilla/readability` are DOM-based JS libraries; the app already runs in a full DOM environment, so `DOMParser` + native DOM APIs serve both engines with **no production DOM shim** (`jsdom`/`linkedom` stay dev/test-only). This keeps one pipeline across Android/desktop/PWA and avoids duplicating engines in Rust.

*Alternatives rejected:* Rust-side extraction (the existing `readable-readability` path) — single engine (no Defuddle), poor DOM ergonomics in Rust, and it would strand PWA mode which has no Rust backend; a Node service — violates the no-cloud non-goal and adds infra.

### D2. Competing candidates, never a try/catch chain

Both engines always run against the **same statically fetched HTML** (rendered fallback re-runs both). Each engine receives its own deep clone of the parsed `Document` because both libraries mutate the DOM they parse. Each returns a normalized `ExtractionCandidate { engine, contentHtml, title, byline, publishedTime?, textContent, stats }`. Selection is deterministic: highest score wins; ties break by engine precedence (`defuddle` → `readability`), then word count. Successful engine execution is never sufficient by itself — only the score decides (a parser can "succeed" on the wrong subtree).

### D3. Scoring algorithm (deterministic, testable)

A pure function `scoreCandidate(candidate, pageContext) → { score, confidence, reasons[] }`. `pageContext` carries structured metadata (D7), source document stats, and the chrome lexicon. Score in [0, 100], computed from weighted components (weights are constants in `extractor-config.ts`; exact tuning happens against the fixture corpus, shape fixed now):

| Component | Points | Signals |
|---|---|---|
| Prose volume | 0…25 | word count (log-scaled, capped), paragraph count, mean paragraph length |
| Prose quality | 0…15 | contiguous-prose ratio, comma/stop-word density (prose-likeness) |
| Link-density penalty | −0…15 | linked-character ratio inside the candidate |
| Chrome penalty | −0…25 | weighted hits of a generic chrome lexicon ("Subscribe", "Sign up", "Donate", "Related", "Recommended", "We Recommend", "Latest", "Privacy", "Terms", "Log in", "Share", "Comments", "Cookie preferences", "Skip to main content", …) per 1000 words; count of tiny linked fragments; repeated identical link-text blocks; footer-like trailing clusters |
| Structure bonus | 0…10 | heading hierarchy sanity, figures-with-captions, lists, blockquotes, tables present in content |
| Metadata agreement | 0…10 | normalized title similarity vs og:title/JSON-LD headline; byline present; published date present; site name present |
| Completeness signal | −10…0 | candidate word count vs source-document word count; vs JSON-LD `articleBody` length when present; "very short content from a large source" is penalized |

Confidence buckets from the score: `high ≥ HIGH_THRESHOLD(70)`, `medium ≥ MEDIUM_THRESHOLD(45)`, else `low` (constants; tuned with fixtures, stored in config, versioned by `EXTRACTOR_VERSION = 1`). Acceptance policy:

- best confidence `high`/`medium` → proceed with best candidate;
- `low` (or best word count < `MIN_WORDS(120)`, or zero candidates) → rendered-page fallback (D5), then re-run both engines on the rendered DOM; **rendered candidates compete with static candidates purely by score** — rendering is not an auto-win;
- final best below `ACCEPT_FLOOR(35)` or < `MIN_WORDS` → typed failure (D9), never a silent garbage import.

Post-sanitization degeneracy check: if sanitized text < 60% of candidate text → warning diagnostic; < 25% → `sanitization_degenerate` failure. No randomness, no clock inputs — same input ⇒ same score (fixture-asserted).

### D4. URL normalization and canonical URL

`urlNormalizer.ts`: validate scheme (http/https only), lowercase host, strip default ports, strip fragment, and remove a conservative tracking-param blocklist (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref_src`, `ref_url`, `igshid`, `si`, …). `originalUrl` is preserved verbatim for provenance. Canonical URL precedence (deterministic, diagnostics recorded when they disagree): `<link rel="canonical">` → JSON-LD `url`/`mainEntityOfPage` → `og:url` → final redirect-resolved URL → normalized original. Canonical URL (not original) is the dedupe key and the base for relative-URL resolution.

### D5. Rendered-page fallback (platform matrix)

Triggered only when static confidence is insufficient (D3) — the WebView cost is never imposed on imports that static extraction already handles.

| Platform | Mechanism | Notes |
|---|---|---|
| Android | Offscreen native `WebView` created by the folder-import Kotlin plugin (`captureRenderedDom(url, timeoutMs)` command) | Top-level navigation ⇒ **not** subject to X-Frame-Options. Bare WebView — it is not the Tauri webview and has **no IPC/bridge**, so remote JS cannot touch the app. Attached 1×1/invisible to the activity so rendering proceeds. Single-flight; destroyed in a `finally`. |
| Desktop (macOS/Win/Linux) | New Rust command `capture_rendered_dom(url, timeoutMs)` building a hidden `WebviewWindow` (label `article-capture-*`, `visible(false)`) with an injected stability script that posts the DOM back over IPC/events; window destroyed on completion/timeout | Capabilities are window-scoped (`capabilities/default.json` lists only `main`/`screenshot-overlay`), so a capture window label matches **no** capability and the loaded remote page gets **zero** Tauri permissions. A guard test asserts no capability ever matches `article-capture-*`. |
| PWA/browser | Best-effort hidden `<iframe>` | Subject to X-Frame-Options/CSP `frame-ancestors`; load failure or inaccessible document reports `rendered_unavailable`. Documented limitation. |
| iOS | Not applicable | Share reception not implemented; when it lands, the Android-style native capture is the template. |

DOM-stability detection (shared logic, injected as a script on Android/desktop; duplicated inline for iframe): wait for `readyState === 'complete'` (or `domInteractive` + budget), then sample `(nodeCount, textLength, imageCount)` every 250 ms via a `MutationObserver`-fed counter; stable when unchanged for 750 ms; hard caps: 6 s post-load stabilization and a 20 s total budget. No arbitrary sleeps. Timeouts, navigation errors, redirect loops (> 10 hops via the fetch layer) and cancellation (`AbortSignal` threaded through the pipeline) all tear down and destroy the WebView/window. Resource limits: block known ad/malware-ish domains is a non-goal; the capture disables media autoplay and declines downloads where the platform allows.

### D6. Security boundary (sanitization)

The persisted article is produced only through DOMPurify (already a production dep) configured with an explicit semantic allowlist:

- **Tags:** `p, h1–h6, strong, em, b, i, s, a, ul, ol, li, blockquote, figure, img, figcaption, table, thead, tbody, tfoot, tr, th, td, pre, code, br, hr, sup, sub, dl, dt, dd, small, time, abbr` + MathML (`math` and descendants). **Dropped:** `script, style, iframe, object, embed, form, input, button, select, textarea, link, meta, base, noscript, svg, template, frame(frameset)`.
- **Attributes:** global none except `lang, dir`; `a[href, title, rel]`; `img[src, srcset, sizes, alt, width, height, loading, decoding, referrerpolicy]`; `blockquote[cite]`; table cell `colspan/rowspan`; `ol[start, type]`; `time[datetime]`; MathML attributes. No `class`, no `style`, no `data-*`, no inline handlers (DOMPurify strips by default).
- **URL policy (after-sanitize hook):** `a[href]` allows `http/https/mailto` + in-document fragments; `img/source` URLs must be `http/https` after resolution; `javascript:`, `data:`, `vbscript:`, and unknown schemes are removed (element kept, attribute dropped, diagnostic recorded).
- **Privilege isolation:** scripts never reach persistence; the reader's existing sandboxed iframe gains nothing new; the rendered-capture WebViews are IPC-less by construction (D5). Imported content can never invoke Tauri APIs.

Sanitizer runs as the last step before persistence on the fully normalized article (defense-in-depth: normalization itself also drops disallowed nodes; the sanitizer is the boundary the tests prove).

### D7. Structured metadata extraction and precedence

`metadataExtractor.ts` parses, before the original DOM is discarded: OpenGraph (`og:title/description/image/site_name/url`, `article:published_time`, `article:author`, `article:section`, `og:locale`), JSON-LD graph walk (`Article`, `NewsArticle`, `BlogPosting`, `TechArticle` — `headline`, `author[].name`, `datePublished`, `publisher.name`, `image`, `articleBody`, `inLanguage`, `mainEntityOfPage`), Twitter card fallbacks, `<meta name="author">`, `<html lang>`, canonical link.

Deterministic precedence (tested): **title** = engine-extracted title if similarity ≥ threshold vs metadata, else JSON-LD `headline` → `og:title` → cleaned `<title>` → first `h1` → hostname (cleaning strips ` | Site` / ` — Site` suffixes). **Authors** = JSON-LD `author[].name]` → `article:author`/`meta author` → engine byline. **Published** = JSON-LD `datePublished` → `article:published_time` → first `<time datetime>` in content. **Site** = `og:site_name` → JSON-LD `publisher.name` → hostname. **Language** = `inLanguage` → `<html lang>` → `og:locale`. **Hero image** = `og:image` → JSON-LD `image`, absolutized, also fed to the existing `coverImageUrl` field. Metadata supplements but never overrides a clearly better-scoring extraction (it feeds D3's agreement component instead).

### D8. Normalization and canonical article shape

`articleNormalizer.ts` converts the winning candidate into a single canonical document (conceptual; `inc-*` classes are hooks, not publisher styling):

```html
<article class="inc-article">
  <header>
    <p class="inc-publication">Mother Jones</p>
    <h1 class="inc-title">…</h1>
    <p class="inc-dek">…</p>            <!-- subtitle when present -->
    <p class="inc-byline">Sophie Hurwitz · August 15, 2026</p>
  </header>
  <figure class="inc-hero">…img + figcaption…</figure>
  <div class="inc-body">…semantic content as extracted…</div>
</article>
```

Rules: strip the in-body duplicate of the title/first `h1`; ensure exactly one `h1`; demote nothing else; keep reading order exactly as extracted (stable text order is what highlight offsets, TTS, and extracts depend on); drop empty paragraphs/trailing whitespace nodes; unwrap unknown-but-harmless inline wrappers (`span`, `font`, `div` used purely for layout — unwrap to their children, preserving order). No HTML → Markdown → HTML round-trip: semantic HTML is the canonical rich representation; a plain-text derivative (`textContent`, normalized whitespace) is stored for word count/AI/search as today.

**Images/figures (`imageNormalizer.ts`):** resolve `data-src/data-lazy-src/data-original/data-ll-src` and `srcset`/`<picture><source>` (choose the largest candidate ≤ 2400px width, else the largest); absolutize against the canonical URL; keep `alt`; keep `figure`+`figcaption` pairs attached and in reading position; set `referrerpolicy=no-referrer`, `loading=eager`, `decoding=async` (matches current conventions). Reject: `img` with effective `width`/`height` ≤ 2 (tracking pixels), images whose `src` repeats ≥ 3 times in one document (logo/chrome heuristic), and images outside the winning candidate's subtree (already excluded by extraction). Remote images stay remote (existing offline hover-download and hotlink policy continue to apply).

### D9. Failure taxonomy and UX

Typed `ArticleImportErrorCode`: `invalid_url | network_failed | http_error | auth_required | empty_content | no_candidates | low_confidence | rendered_unavailable | rendered_failed | sanitization_degenerate | canceled`. `auth_required`: HTTP 401/403, or a meta-robots/paywall heuristic — kept conservative and reported as low-confidence with the reason. Consequences:

- **Share-sheet path** (`useShareTarget`): error toast with the reason and a **Retry** action; on `low_confidence`-family failures an "Open original" action; **no document is created**.
- **Dialog path** (`WebArticleImportDialog`): inline error state, Retry, and an explicit "Import full page anyway" escape hatch that creates a document from the sanitized full page labeled with `metadata.webArticle.extractor = "raw-fallback"` and a visible in-document banner class (`inc-raw-notice`) so it is never mistaken for a clean article.
- Cancellation (user leaves, app backgrounds, new share arrives) aborts via `AbortSignal` and creates nothing; orphan cleanup is structural (capture WebView destroyed in `finally`).

### D10. Persistence, provenance, snapshots, dedupe

- **Document record:** unchanged shape — `fileType: 'html'`, `content` = sanitized canonical article HTML, `source_url` column set to the canonical URL (today it is not populated by this path), category/tags as now, `coverImageUrl` from the hero image.
- **`DocumentMetadata` extension** (additive, optional `webArticle` object in both the TS type and the Rust serde struct with `serde(default)`): `originalUrl, canonicalUrl?, resolvedUrl, extractor ('defuddle' | 'readability' | 'rendered-defuddle' | 'rendered-readability' | 'raw-fallback' | string), extractionScore, extractionConfidence, extractionVersion, importedAt, renderedFallbackUsed, renderFallbackReason?, failureReason?, sourceSnapshot? { path, sha256, rawBytes, gzipBytes }, candidates[] (bounded to 4: engine, score, confidence, words, paragraphs, images)`. Provenance is first-class: engine, version, score, confidence, and per-candidate diagnostics are always recorded.
- **Raw-source snapshot:** new Rust command `store_source_snapshot(documentId, bytes)` gzips the original fetched HTML to `{app_data}/source-snapshots/{id}.html.gz`; skipped (with diagnostic) if raw > 5 MB; referenced from metadata. Retention: setting `webImportKeepRawSource` (default on) — turning it off deletes existing snapshots; a cleanup pass removes snapshots older than 180 days. Snapshots live **outside** the cloud-backup `documents/` folder by default (backup size protection) — trade-off: re-extraction works on-device; restores lose snapshots but keep articles. This is the documented storage/sync trade-off; re-running `EXTRACTOR_VERSION = 4` extraction over a `v1` import later requires only the snapshot, not the URL.
- **Dedupe:** before `create_document`, look up `source_url` (canonical, falling back to normalized original) plus an in-flight URL set; a duplicate share surfaces the existing document (toast → Open) instead of creating a second one. Lifecycle safety: `useShareTarget`'s existing single-flight guard is kept; the pipeline is additionally keyed so rapid re-shares coalesce.
- **DB migration:** none required — new data rides the existing `metadata` JSON blob and `source_url` column; Rust model changes are additive optional fields. If implementation finds `source_url` indexing insufficient for dedupe, an additive indexed column is the sanctioned fallback.

### D11. Diagnostics

Every import records a bounded `diagnostics` object inside `metadata.webArticle`: URLs (original/canonical/resolved), fetch status + content type + redirect hop count, per-candidate engine/score/confidence/text length/paragraph count/image count, selected candidate + confidence, rendered-fallback used/reason/latency, normalization warnings, sanitization warnings (dropped-attribute counts), final text length/image count, per-stage timings (fetch/parse/defuddle/readability/score/normalize/sanitize), and failure reason. No page bodies in logs; URL strings only; everything length-capped. Emitted through the existing `tauri-plugin-log` at debug level and viewable from document metadata (the debug affordance is the metadata panel — a dedicated diagnostics screen is out of scope).

### D12. Dependencies and bundle impact

Add `defuddle` and `@mozilla/readability` (both MIT, browser-compatible, TypeScript-typed, no transitive DOM requirement — they operate on caller-provided documents). Reuse `dompurify` (already prod) and dev `jsdom` (tests). All three pipeline libs are loaded via `dynamic import()` on first import and cached — startup executes nothing new; worker-style off-main-thread parsing is a non-goal for v1 (diagnostics will tell us if jank shows up on huge pages). Tauri builds inline dynamic imports into the entry chunk (~roughly +150–300 KB minified expected), so `scripts/bundle-budgets.json` must be re-measured and updated **in the same change** with a justification comment, per repo protocol; PWA builds get an `article-vendor` manual chunk.

### D13. Test strategy

- **Fixtures:** `src/utils/articleImport/__tests__/fixtures/<case>/` with `page.html` + `expected.json` (`title, authors, publishedAt, siteName, minWords, mustContain[], mustNotContain[], expectedExtractor?, confidenceRange?, expectedImageCount?, expectedFigureCaptions[]`). Corpus (from the brief): traditional news, WordPress news, Mother Jones-style, Substack, Medium-style, Wikipedia, blog, documentation page, heavy-navigation, repeated recommendation blocks, newsletter CTAs, donation prompts, embedded modal markup, multi-image + captions, tables, blockquotes, code, lazy-loaded images, relative image URLs, malformed HTML, JS-rendered shell (static HTML is an empty app root → asserts fallback triggers), JSON-LD-rich metadata, defuddle-wins, readability-wins, both-static-fail. Fixtures are **crafted structural replicas** (real site skeletons generalized, synthetic prose; the Mother Jones replica keeps the real title/author/date and synthetic body) — no verbatim copyrighted page bodies; a fixtures README documents capture/sanitization rules.
- **Rendered fallback tests:** the capture clients are interfaces; unit tests inject a fake renderer returning a fixture DOM (JS-rendered case), asserting re-extraction, re-scoring, candidate competition, timeout/cancellation paths, and cleanup guarantees. Real capture is validated by the manual matrix (D14/tasks).
- **Unit tests:** scorer determinism + component behavior (chrome penalty actually punishes nav soup; agreement rewards matching titles), engine clone isolation (second engine unaffected by first), URL normalizer, metadata precedence matrix, image normalizer (lazy attrs, srcset selection, relative resolution, tracking-pixel rejection), sanitizer XSS battery (`<script>`, `img onerror`, `javascript:`/`data:` URLs, SVG-with-script, form/iframe/style/noscript-mXSS cases, attribute smuggling), persistence mapping, dedupe, failure taxonomy, share-hook routing (jsdom `CustomEvent`), capabilities guard (`article-capture-*` never granted).
- **CI hermeticity:** no network in tests — fetch clients are mocked with fixture HTML; vitest jsdom environment already configured.
- **Bench:** `src/utils/articleImport/importPipeline.bench.ts` per the repo gate — seeded-PRNG synthetic pages (chrome blocks + prose), consuming results into a module sink; static-path stages measured end-to-end; `scripts/perf-baselines.json` recorded/updated per protocol (warn-only until recorded).

### D14. Performance requirements (measurable)

Static path (fetch excluded): parse + both engines + score + normalize + sanitize ≤ 1.5 s for a 1 MB page on desktop-class hardware, ≤ 3 s on mid-range Android (measured via diagnostics timings; bench guards the frontend stages). Rendered fallback: overall hard budget 20 s, typical target ≤ 8 s, frequency expected < 15% of imports (diagnostics counter). Startup: zero new synchronous imports at module load (bundle size accounted in D12). Resulting document size: sanitized article expected ≤ 25% of raw source on chrome-heavy pages (diagnostics ratio, informational). Memory: no page retains parsed DOMs after the pipeline resolves (all references dropped; WebView destroyed).

### D15. Site-specific override escape hatch (structure now, rules later)

The generic pipeline must remain uncontaminated by publisher hacks. The pipeline therefore has an ordered extractor chain: `siteSpecific(domain)? → defuddle → readability`, where `siteSpecific` is a registry (`src/utils/articleImport/engines/site-specific/`, one module per domain, e.g. `wikipedia.ts`, `medium.ts`) returning a candidate like any other engine and **still subject to the same scorer** — an override can win only by scoring, never by fiat. A registry entry is added only when the generic pipeline reproducibly fails on an important site and a generic fix would risk other sites; the Mother Jones regression must be fixed generically, not via a `motherjones.com` rule. v1 ships the registry empty or with Wikipedia only (its `.mw-parser-output` semantics are already proven in `processHtmlContent`).

## Risks / Trade-offs

- [Scorer mis-ranks on unusual sites] → fixtures cover the documented categories; scores/confidences/reasons are persisted so failures are diagnosable; site-specific override hooks (D15) exist for later without touching the generic scorer.
- [New deps grow the entry chunk past budget] → measured in-task, budget bumped with justification or trimmed (defuddle/readability are small; worst case engines load lazily and budget is renegotiated in the same PR — never silently).
- [Hidden desktop window flaky on WebKitGTK] → capture command returns a typed `unavailable` and the pipeline degrades to the failure UX; platform matrix documents Linux as best-effort.
- [PWA iframe fallback blocked by X-Frame-Options] → typed `rendered_unavailable` + raw-fallback offer; documented limitation (PWA users can retry in the desktop app).
- [Snapshot disk growth] → gzip + 5 MB cap + 180-day retention + off-by-default-for-backup placement + setting to disable entirely.
- [jsdom/native-DOM behavioral drift in tests] → engines verified against both; fixture suite runs in jsdom, same code path as production WebView modulo `DOMParser` fidelity, which is high for parsing/extraction concerns.
- [Extraction engines mutate shared DOM] → enforced by clone-per-engine and a regression test asserting candidate independence.
- [Mother Jones overfit] → assertions live in the fixture, not in scorer special-cases; the scorer uses only generic structural signals.

## Migration Plan

Additive only. Existing documents: untouched, still render through the legacy viewer path (render-time `processHtmlContent` repair stays for them). New imports: new pipeline from first merge. Older clients restoring a DB containing `webArticle` metadata ignore the unknown JSON (serde `default`/optional TS). No bulk rewrite of existing articles ever runs automatically; a future change may offer per-document "re-extract" using the snapshot (new imports) or `originalUrl` re-fetch (old imports) — hooks (`extractionVersion`, snapshots) are designed for exactly that.

## Open Questions

- Exact scorer weights/thresholds — resolved during implementation by tuning against the fixture corpus (constants centralized; fixtures pin the behavior).
- Whether `source_url` lookups need an index for dedupe at scale — decide when implementing D10 (sanctioned fallback: additive indexed column).
- Desktop capture on Linux/WebKitGTK reliability — verify during implementation; degrade path already specified.
