## Context

The browser extension has three different capture sources: explicit page/link saves, explicit selection extracts, and passive browser events (`tabs.onUpdated`, `history.onVisited`, and `bookmarks.onCreated`). The background worker currently initializes some passive-capture flags as enabled and later loads persisted settings. That creates a startup race in which a visited page can be posted before the disabled setting is applied. The options page also has fallback expressions that treat missing settings as enabled for history and bookmarks.

On the desktop side, browser page requests are handled by `browser_sync_server.rs`. Supplied extension text is preferred, HTML can be retained in document metadata, and empty payloads currently fall back to a generic HTML-to-text fetch. That fallback can preserve navigation-heavy page shells, producing the dense text shown in the report. The existing Readability enrichment is asynchronous and only starts for short imports, so a large but low-quality raw extraction can remain untouched. Library/startup document projections also omit large body fields, which means reader and assistant code must not treat a summary projection as a hydrated document.

The change crosses the extension worker/options UI, the Rust import pipeline and HTML processor, document persistence, and React document hydration/rendering. It should reuse the existing readability, sanitization, deduplication, and test infrastructure.

## Goals / Non-Goals

**Goals:**

- Make passive page/history/bookmark capture opt-in, disabled by default, and safe during worker startup.
- Keep explicit Save Current Tab, Save Link, selection extract, and Save All Tabs actions functional regardless of passive-capture settings.
- Produce a readable document for a page save: canonical plain text for search/Q&A plus structured rich HTML where available.
- Prefer article-quality content over navigation-heavy raw HTML, while retaining a bounded and clearly identifiable fallback when article extraction fails.
- Hydrate full imported documents before reader, assistant, search, or Q&A consumers use body content, including restored documents after restart.
- Repair affected existing browser imports when trustworthy article HTML is already stored, without promoting arbitrary extracts into document bodies.
- Test the extension event gates and the save → restart/reopen → read path at their process boundaries.

**Non-Goals:**

- Automatically deleting documents already created by an earlier extension version.
- Changing the meaning of an explicit user action or converting page saves into extracts.
- Requiring a new external extraction service or a new database schema.
- Guaranteeing recovery for legacy rows that contain neither readable document text nor stored article HTML.
- Making automatic browsing capture the default; the reported behavior is treated as an opt-in defect.

## Decisions

### 1. Use a fail-closed capture state machine in the extension

The worker will initialize `autoSave`, history capture, and bookmark capture to `false` and track whether settings have been loaded. Passive listeners must return without sending a request until settings are ready, then require the corresponding flag to be exactly `true`. The options page will use the same strict boolean interpretation and persist false defaults for new or missing settings.

Explicit commands (`saveCurrentTab`, `saveLink`, `saveAllTabs`, and explicit extract/AI actions) remain separate from passive gates. This preserves the user-facing Save actions while ensuring a browser navigation cannot be mistaken for consent to save. Rejected alternative: relying only on the eventual `loadSettings()` call, because listeners can run before that promise finishes.

### 2. Make the import pipeline readability-first for empty or low-quality page payloads

The server will classify requests by explicit request type and source. Page/link requests create or enrich one HTML document; only an explicit `extract` request creates an extract. When a page payload contains usable extension text and rich HTML, those representations remain the primary document content. When the payload is empty or scores as navigation-heavy/raw, the server will attempt the existing Readability path and persist its plain text and article HTML together. The generic HTML-to-text fetch remains a bounded fallback and is marked in metadata so it is not mistaken for a high-quality article capture.

Candidate selection will be monotonic: a non-empty, higher-quality result may enrich a sparse import, but an empty, poorer, or stale background result may not replace valid content supplied by the extension or a later save. Duplicate saves continue to use the normalized source URL and return the existing document.

Reusing the existing Rust Readability and `extract_text_from_html_fragment` helpers is preferred over adding a second extraction library. A new dependency or an extension-only extraction implementation would create divergent results between explicit saves and link-only imports.

### 3. Treat document summaries and document bodies as different states

Startup and library list queries remain lightweight. Any reader, assistant, search, or Q&A path that needs body content will call the full document lookup and merge the response into the document store before consuming it. A response is applied only if it still belongs to the active document; a late response for a previously active tab may warm the cache but cannot replace the current document.

For browser-imported HTML, the viewer will prefer stored article HTML for structured rendering, sanitize it at the rendering boundary, and use canonical plain text as the fallback for text-only mode, accessibility, search, and AI context. Plain-text fallbacks must preserve paragraph/line boundaries rather than rendering the entire import as one collapsed block.

### 4. Repair only recoverable legacy imports

When a full lookup finds a browser-extension document with empty body text and non-empty stored article HTML, the backend may derive and persist plain text idempotently before returning the document. It must not copy an arbitrary extract into the parent document because extract provenance may represent a selection rather than the page body. Rows with no trustworthy recovery source remain unchanged and can be explicitly re-saved.

### 5. Validate source code and shipped extension artifacts together

Extension unit tests will exercise default settings, startup-before-settings events, disabled passive listeners, enabled passive listeners, and explicit save actions. Rust tests will cover content selection, raw-versus-readable fallback, duplicate/enrichment guards, and recoverable metadata. Frontend tests will cover summary hydration and stale-response handling. The extension packaging/check step will verify that the generated manifest and shipped worker/options files contain the same disabled defaults as source.

## Risks / Trade-offs

- **[Readability-first imports add latency for link-only saves]** → Keep the existing bounded request timeout, use the supplied extension capture immediately when it is good, and use raw text only as an explicit fallback.
- **[A quality heuristic could reject legitimate short pages]** → Require a stronger article candidate before replacing supplied content, and preserve any non-empty valid payload unless the fallback is demonstrably better.
- **[Sanitizing or normalizing HTML can remove site-specific presentation]** → Preserve semantic article structure and images within existing limits; treat inline styling as optional presentation rather than authoritative document data.
- **[Users with old settings may expect previously enabled passive capture]** → Preserve explicit `true` settings for existing users, but interpret missing/invalid values as false and make the options UI show the effective state.
- **[Existing raw imports remain in the library]** → Repair only rows with stored article HTML on full open and provide explicit re-save as the safe path for unrecoverable rows; do not perform destructive bulk cleanup.
- **[Hydration adds a request when opening a summary]** → Keep list projections content-free, fetch once per document open, and cache the hydrated result.

## Migration Plan

1. Ship the extension fail-closed defaults and passive-event gates while preserving explicit user actions and existing explicit settings.
2. Ship readability-first persistence, guarded enrichment, and full-document hydration for new imports.
3. On full document access, idempotently repair affected rows whose stored browser metadata contains article HTML.
4. Run extension, Rust, frontend, and packaging regression suites; manually verify a disabled extension does not create documents while browsing and an explicit Save action produces a readable document.
5. Rollback is code-only. No destructive migration is required, and repaired document text remains valid if the implementation is reverted.

## Open Questions

None. This proposal interprets “when not enabled” as requiring automatic capture to be opt-in; explicit Save actions remain available by default.
