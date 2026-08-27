## Context

The canonical article pipeline (`universal-article-import-pipeline`, `overhaul-web-article-import`, `canonicalize-arxiv-html-reader` — all implemented at HEAD) already centralizes extraction, sanitization, durable asset ingestion (`plethora-asset://`), and reader classification. The remaining defect is **resource-base selection**, which is still computed ad hoc in five places that disagree:

| Site | Current base | File |
|---|---|---|
| Canonical pipeline (arXiv) | slash-appended requested `htmlUrl` (`arxivHtmlAssetBase`) | `importPipeline.ts:226`, `arxivResolver.ts:85` |
| Canonical pipeline (generic) | **metadata canonical URL** (`resolveCanonicalUrl`: canonicalLink → JSON-LD → og → finalUrl) | `importPipeline.ts:225-226` |
| Raw-page fallback | slash-appended arXiv htmlUrl, else canonical URL | `rawFallback.ts:54-55` |
| Reader display repair | `webArticle.canonicalUrl` → `htmlUrl` → `source` → `filePath`, arXiv round-tripped through the slash transform | `documentImport.ts:144-165` |
| WebArticleImportDialog preview | `new URL(baseUrl).origin + '/'` — discards the entire path | `WebArticleImportDialog.tsx:281` |

Empirical facts established against live arXiv (2026-08-27, `curl` on `arxiv.org/html/2410.07524[v1]`):

1. **No redirects**: versionless `/html/2410.07524` serves HTTP 200 directly (latest version); `finalUrl == requestedUrl`.
2. **No `<base>`, no in-DOM canonical link** in the HTML (canonical exists only as an HTTP `link` header, which we do not parse — and should not use as a resource base).
3. **Figure markup is version-prefixed**: `<img src="2410.07524v1/upcycle.png">` on the v1 page, `<img src="2410.07524v2/upcycle.png">` on the versionless (latest) page, plus root-absolute chrome (`/static/base/...`).
4. Asset probes: `…/2410.07524v1/upcycle.png` → **200**; `…/2410.07524/2410.07524v2/upcycle.png` (slash-base + version-prefixed src, exactly what `arxivHtmlAssetBase` produces) → **404**; `…/2410.07524/upcycle.png` → 200 (arXiv aliases the versionless directory to latest).

So the trailing-slash workaround — written for an older arXiv markup that emitted bare `upcycle.png` — now inverts into a doubling bug: **every figure in every arXiv HTML import absolutizes to a 404 URL**, on both versioned and versionless imports. Downstream, `ingestArticleAssets` fails those fetches and **removes `src`** (`articleAssetIngestor.ts:271-275`), and the reader's `prepareHtmlDocument` then resolves the empty `src` via `new URL('', base)` — which yields the base itself — so the `<img>` points at the article's own HTML page and the WebView paints the broken-image `?`. With `preserveImages=false` the same 404 URLs persist directly and break the same way. Full chain, verified stage by stage:

```
resolveImportSource → arxivHtmlAssetBase (slash appended)
  → normalizeImages: 2410.07524v1/upcycle.png + …/2410.07524v1/ ⇒ …/2410.07524v1/2410.07524v1/upcycle.png (404)
  → ingestArticleAssets: fetch 404 → src removed
  → persisted: <img> without src
  → prepareHtmlDocument: safeImageUrl('', base) resolves '' to the document URL
  → <img src="https://arxiv.org/html/2410.07524v1/"> → HTML-as-image → "?" placeholder
```

The existing regression fixture masks this: `fixtures/arxiv-html-regression/page.html` models **old** markup (`<img src="./moe-routing.svg">`) and the helper uses a trailing-slash fixture URL (`ARXIV_FIXTURE_URL`), so the slash hack passes tests while real arXiv breaks.

Constraints inherited from prior changes: sanitization boundary must not weaken (`article-sanitization`); persisted canonical articles keep the `.inc-article > .inc-body` contract; stored documents are never silently rewritten (highlight/anchor/TTS stability, per `canonicalize-arxiv-html-reader`); CSP `img-src … https:` already permits remote images, so degradation to remote URLs needs no CSP change.

## Goals / Non-Goals

**Goals:**

- One shared, standards-correct effective-resource-base rule used by every import surface and by reader repair.
- ArXiv figures render on fresh imports (versioned, versionless, bare-ID, `/abs/` entry points) without host-specific path hacks.
- The `?`-on-an-HTML-page artifact becomes structurally impossible (empty `src` never resolves to a document URL).
- Asset-ingestion failure degrades gracefully to the retained remote URL with diagnostics.
- A user-visible repair path for already-broken imports, building on the existing (currently UI-less) `reimportCanonicalArticle` store action.

**Non-Goals:**

- No new arbitrary URL-fetching facility; ingestion stays image-only through the existing SSRF-guarded registry.
- No silent or bulk migration of stored documents.
- No rerouting of arXiv PDFs, browser-extension captures, X threads, or RSS full-content (they keep their own pipelines; only their shared base-resolution helper changes where applicable).
- No CSP changes, no sanitizer-allowlist expansion, no `<base>` allowed in persisted HTML.
- Not fixing the legacy local-`.html`-file import path (Rust `html2text` plain-text persistence) — a separate problem (images are destroyed, not misbased).

## Decisions

### D1. Effective resource base = safe document `<base href>` → final URL → requested URL (standards precedence)

New pure utility (in `arxivResolver.ts`'s neighborhood, or a new `resourceBase.ts` — naming per existing style: `resolveEffectiveResourceBase`):

```ts
resolveEffectiveResourceBase({
  requestedUrl: string,          // what the user shared / the adapter rewrote
  finalUrl?: string,             // redirect-resolved URL from the transport
  docBaseHref?: string | null,   // <base href> of the fetched document, if any
}): { base: string; source: 'doc-base' | 'final' | 'requested' }
```

Rules: take `finalUrl ?? requestedUrl` as the anchor; if `docBaseHref` absolutizes (via `new URL(docBaseHref, anchor)`) to an absolute `http(s)` URL, use that; otherwise use the anchor **verbatim**. No host sniffing, no slash mutation, no canonical metadata. This reproduces exactly what the source browser did: if the page worked in a browser, its relative URLs resolve under this rule. It also correctly covers historical arXiv variants (pages that declared `<base>` or redirected to a slash URL) — which the trailing-slash hack only approximated.

- *Alternatives considered*: keep `arxivHtmlAssetBase` for arXiv only (rejected: provably wrong for current markup, and the versionless directory aliasing is a behavior of arXiv's CDN we should not depend on); probe-then-fallback (fetch HEAD per image — rejected: N network probes per import, breaks hermetic tests).
- The arXiv adapter still performs **identity** rewriting (`/abs/`, bare ID → `/html/` fetch URL, canonical = abs page); only the resource-base construction changes.

### D2. Pipeline re-anchors after fetch; canonical URL stays identity-only

In `importArticle()`: after `fetchArticleSource`, compute `assetBaseUrl = resolveEffectiveResourceBase({ requestedUrl: source.fetchUrl, finalUrl: fetched.finalUrl, docBaseHref: extractPageMetadata-adjacent read of doc's <base> })`. Use it for `cloneForEngine` (engine clones + rendered-fallback re-run), `normalizeArticle({ baseUrl })`, and hero-image absolutization. `canonicalUrl` (`resolveCanonicalUrl`) remains unchanged for identity/dedupe/provenance. `<base>` elements are stripped from engine clones before extraction (engines infer their own bases; we normalize images before engines run, as today). Record `diagnostics.resourceBase = { base, source }`.

- Browser/PWA path caveat: CORS proxies hide redirects (`finalUrl = url` there, by existing design) — acceptable; anchor is the requested URL, same as a browser would use when the proxy isn't involved.
- `rawFallback.ts` switches to the same helper (it currently mirrors the two wrong bases).

### D3. Ingestion failure keeps the remote URL

`articleAssetIngestor.ts`: on failure, leave `img src` as the absolutized remote URL (drop only `srcset`/`sizes` as today). Count in `diagnostics.assets.failed` (already) and add `degradedToRemote` count so diagnostics distinguish "offline-durable" from "remote-degraded". Aggregate/per-asset limits, MIME checks, concurrency, cancellation semantics unchanged. Rationale: CSP already allows `https:` images; a figure that fails download today may still load from the live site, and this is strictly better than either `?`-on-HTML (current) or silent removal. *Alternative considered*: remove the img on failure (rejected: loses caption-adjacent figure context and any chance of rendering; the durable-assets spec's "degrade gracefully" reads better as remote-degrade).

### D4. Reader never fabricates an image source

- `prepareHtmlDocument.ts`: `safeImageUrl` returns `null` for empty/whitespace `src` → img removed (canonical kind already removes imgs with missing asset render URLs; non-asset branch gets the same rule).
- `processHtmlContent` (legacy/compat kinds): an img with no usable candidate after lazy-attribute resolution is removed rather than left/pointed at the base.
- `resolveDocumentHtmlBaseUrl`: reorder candidates to `webArticle.resolvedUrl → htmlUrl → source → filePath`, with `webArticle.canonicalUrl` demoted to a last-resort fallback; stop round-tripping generic candidates through the arXiv slash transform. **Exception:** documents classified `legacy-arxiv` keep the existing `arxivHtmlAssetBase(htmlUrl)` repair — that corpus was imported with old bare-relative markup where the slash base is what made (and still makes) their stored relative URLs resolve. `prepareHtmlDocument`/`DocumentViewer` already know the reader kind; pass it down so only `legacy-arxiv` takes the historical branch.

### D5. Preview parity in `WebArticleImportDialog`

Replace `baseTag.href = origin + '/'` with `resolveEffectiveResourceBase` over the dialog's fetched preview document (it already has both the URL and the HTML). The preview intentionally remains a style-preserving full-page preview (documented in the dialog); this change only fixes resource resolution so relative figures preview correctly. The dialog's browser-fetch-with-proxies preview transport is unchanged (arXiv sends `access-control-allow-origin: *`).

### D6. Repair = surface the existing re-import action

`documentStore.reimportCanonicalArticle` (exists, tested, no UI caller) becomes the backing action for a "Re-import from source" control on the HTML reader/document menu, offered when classification is `canonical-article`/`canonical-raw-fallback` (webArticle provenance) or `legacy-arxiv` (htmlUrl/arxivUrl present). It re-runs `importArticle` (network required) and replaces body+assets+provenance; identity/category/tags preserved by the existing action. One correction inside the action: its repair-URL precedence should match D4 (`resolvedUrl` before `canonicalUrl`), so a versioned document re-imports from the version it came from rather than silently jumping to latest — arXiv bare `/abs/` stays valid for versionless documents. No automatic migration, honoring the `canonicalize-arxiv-html-reader` decision.

### D7. Sanitizer boundary unchanged; persistence invariant enforced by construction + tests

`sanitizeArticleHtml` keeps its allowlist (media schemes: `http`, `https`, `plethora-asset`; relative pass-through stays as a latent-tolerance layer, not a contract). The invariant "no relative media in persisted HTML" is guaranteed upstream by `normalizeImages` (which already rejects any img whose absolutized URL isn't `http(s)`) plus D1's correct base, and enforced by a new persisted-HTML scan assertion in tests (count of non-absolute media `src` === 0). No new sanitizer behavior → no new bypass surface.

### D8. Fixture truthfulness: model current arXiv markup

- New fixture `fixtures/arxiv-html-regression-v2/` (or update in place — preferred: **update in place** and rename expectations, since the old shape no longer exists in the wild): synthetic LaTeXML structure with version-prefixed figure srcs, `ltx_*` classes, MathML stub, root-absolute chrome image, an `onerror` handler, a `data:text/html` img, and no `<base>`. Fixture URL **without** trailing slash (`https://arxiv.org/html/2410.07524v1`) — matching reality; plus a second variant page for the versionless entry point whose figures point at `…v2/` paths.
- `mustContainImageUrls` becomes `https://arxiv.org/html/2410.07524v1/upcycle.png` etc.
- Generic fixtures: canonical-mismatch case (`fixtures/relative-image-urls` gains a canonical link differing in path) and a `<base href>` case (safe cross-origin base honored; `javascript:` base ignored).
- Hermetic: all base-resolution tests are pure `new URL`/DOM tests; the ingestor degradation test stubs the registry API. No live arXiv in CI.

### D9. Version bump and diagnostics

`EXTRACTOR_VERSION` 4 → 5 (`extractor-config.ts`), so re-normalized articles are distinguishable. `ArticleImportDiagnostics` gains `resourceBase: { base: string; source: 'doc-base' | 'final' | 'requested' }` and `media: { discovered, absolutized, dropped }` (imageReport already exists; surface the counts), persisted inside the existing `webArticle.diagnostics` blob — additive, no schema migration.

## Risks / Trade-offs

- [Some site's canonical URL was accidentally the *correct* base today and becomes finalUrl-based] → For pages without redirects the two coincide; divergence only occurs when canonical path ≠ document path, where the browser provably used the document URL — so the new behavior is strictly more faithful. Fixture coverage pins this.
- [Removing the slash hack breaks an un-rebased older arXiv markup corpus] → Only the **import** path changes; stored `legacy-arxiv` documents keep the historical reader repair (D4 exception). If arXiv ever serves bare-relative markup again *without* `<base>`, a browser couldn't render it either; matching browser semantics is the contract.
- [Remote-degraded figures leak referrers / track users] → `referrerpolicy="no-referrer"` is already stamped by normalization and re-stamped at display; degradation applies only to figures whose durable ingestion failed.
- [Re-import jumps paper version when only a versionless URL is stored] → D6 corrects precedence to `resolvedUrl` first; versionless documents intentionally re-import latest (matches arXiv's own "latest" semantics).
- [Doubling of work: preview still fetches separately from the import] → Existing intentional behavior (preview ≠ persisted extraction); not expanded here.
- [Fixture rename churn in `arxiv-html-regression`] → `expected.json` consumers are local to the fixture suite; update in the same task.

## Migration Plan

1. Land base-resolution utility + pipeline/rawFallback switch + fixture updates (behavior change begins at `EXTRACTOR_VERSION` 5).
2. Land reader-side changes (empty-src, base precedence, kind-aware legacy exception) — safe independently of step 1.
3. Land ingestor degradation + diagnostics fields.
4. Surface re-import UI. Rollback: each step is independently revertible; no persisted-format change beyond additive diagnostics fields, so a rollback leaves newer diagnostics blobs readable by older builds (extra JSON keys are ignored by the existing provenance reader).

## Open Questions

- None blocking. (Whether the legacy local-`.html` file import should gain image preservation is deferred to a future change — different pipeline, different failure mode.)
