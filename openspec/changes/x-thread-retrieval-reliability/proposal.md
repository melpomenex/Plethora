# Change: X Thread Retrieval Reliability

Covers numbered requirement **#13 (fix X Thread retrieval using the proven `xcom.py` approach)**.

## Why

The user-facing error "X Thread could not be retrieved" appears when opening X threads. Investigation found the current implementation is actually a Rust pipeline that is *more* robust than the reference `xcom.py` in several ways, but there is a concrete frontend bug degrading all typed errors, plus real-world failure surfaces that need hardening.

### Current state discovered

- **`xcom.py`** (repo root, 1,326 lines) is the reference: ThreadReaderApp JSON API (`GET https://threadreaderapp.com/api/v0/thread/{id}.json`) as the primary unroll path, X GraphQL `TweetResultByRestId` (guest-token auth) as single-tweet fallback/enrichment, ThreadReaderApp HTML only for enrichment/id discovery, plus syndication for single posts. **Verified live (2026-08-19):** `xcom.py`'s primary JSON route is actually **dead** (returns 404 HTML), so `xcom.py` itself is broken today without an HTML fallback.
- **Rust implementation** (`src-tauri/src/threadreader.rs` + `twitter.rs`): probes the dead JSON route, **falls back to the live HTML unroll page** (`/thread/{root}.html`, verified 200), resolves root id via `ping`, uses X GraphQL (guest token, same query id `oZDZmKdLaZObfAE9qC17Lg`) for single-post fallback, and syndication as last fallback. It preserves paragraph breaks, handles media allow-lists, bounded concurrency for enrichment, and typed `ThreadError` serialization.
- **Frontend bug:** `src/components/viewer/XThreadErrorState.tsx:17–33` maps error types with **camelCase keys** (`threadReaderUnavailable`, `rateLimited`, `networkError`, `invalidUrl`) but the Rust backend serializes **snake_case** (`thread_reader_unavailable`, …). Every typed error therefore falls through to the generic "Unable to load this X thread" + raw Rust message — which is the "X Thread could not be retrieved"-style UX. Tests only assert the generic fallback, masking the mismatch.
- **Failure surfaces:** threads not on ThreadReaderApp (→ single-post fallback; private/deleted → `thread_unavailable`), ThreadReaderApp 429/blocking, X query-id rotation (mitigated by syndication; current id valid), and network errors.
- **Frontend flows:** `documentStore.openTwitterThread` (src/stores/documentStore.ts:1179–1388), `XThreadViewer.tsx` rendering, retry re-calls `openTwitterThread`.

### What must change

1. Treat `xcom.py` as the **behavioral reference** and document the alignment (the Rust pipeline already covers its providers with an HTML fallback `xcom.py` lacks — keep that superiority). Add the missing reference capabilities that matter in-app.
2. Fix the frontend error-type mapping so each typed error surfaces its intended, user-friendly title/detail.
3. Harden the retrieval path: URL normalization, root-post identification, thread ordering, text retrieval, and distinct, useful error states without exposing raw internal exceptions.
4. Add real tests: single post, multi-post thread, x.com URL variants, inaccessible post, provider/API failure, fallback path.

## What Changes

### 1. Error-type parity (the concrete bug)
Fix `XThreadErrorState` (and any other consumer of `metadata.xThreadError`) so Rust snake_case types map to the intended camelCase title/detail keys. Add a normalization layer (frontend) and/or test that asserts type parity between Rust serialization and the UI map.

### 2. Behavioral parity with `xcom.py` (see spec)
Document and implement the provider/fallback order: ThreadReaderApp (JSON probe → HTML unroll) → X GraphQL single-post → syndication. Keep enrichment optional. Add the reference's remaining capabilities that are valuable in-app (hashtags/mentions/expanded-URL fields on `TwitterPost` if cheap; otherwise document as out of scope). Preserve the HTML-fallback superiority.

### 3. URL normalization and root identification
Normalize common x.com/twitter.com URL formats (www/mobile subdomains, optional scheme, query params, trailing slashes, `/i/status/`, `status/`), identify the root post for a thread (in-thread id → root via ThreadReaderApp ping), and produce the canonical output URL.

### 4. Distinct, useful error states
Expose typed, user-friendly errors: invalid URL, deleted/private/restricted post, auth/API credentials missing, provider rate limit, upstream provider unavailable, thread genuinely inaccessible. Never surface raw internal exceptions as the primary UX. If a fallback provider is used, handle transparently.

## Impact

### Affected Specs
- `x-thread-retrieval` (new, #13)

### Affected Code Areas
- `src/components/viewer/XThreadErrorState.tsx` (camelCase/snake_case fix), `XThreadViewer.tsx`
- `src/stores/documentStore.ts` (`openTwitterThread` error handling, `parseThreadError`)
- `src-tauri/src/threadreader.rs`, `src-tauri/src/twitter.rs` (hardening only where gaps exist; no rewrite of the working pipeline)
- `docs/X_THREAD_RETRIEVAL.md` (update with the error-parity fix and alignment notes)
- Tests: `XThreadViewer.test.tsx`, new `documentStore`/error-mapping tests, Rust `threadreader.rs` tests

### Non-goals
- No removal of the existing working ThreadReaderApp-first pipeline.
- No authenticated X search (`SearchTimeline` with user cookies) — out of scope for in-app reading.
- No embedding of media as base64 in `html_content` (remote allow-listed URLs are fine for the native viewer).