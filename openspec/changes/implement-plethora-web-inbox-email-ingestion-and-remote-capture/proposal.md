# Change: Implement Plethora Web Inbox, Email Ingestion, and Remote Capture

> Wave 3 — Cloud Capabilities. Hard-depends on proposals 3 (accounts) + 5 (service) + 2 (capability `web_capture`). Extends the existing browser extension and article-import pipeline; **must not regress native share-sheet capture** (Android SEND intents, PWA share-target — both exist today).

## Why

Capture should work from anywhere: a web "save to Plethora" page, email-to-Plethora address, browser extension (local today → cloud-relayed), public capture API for scripts/Shortcuts, and a remote inbox that feeds the same high-quality article/document pipeline as on-device capture.

## What exists today
- **Browser extension** (`browser_extension/`): MV3, saves pages/selections/videos to the app's local `browser_sync_server` (127.0.0.1:8766) when running; postMessage bridge to the PWA; extract storage per-host; AMO-signed xpi distribution.
- **Article import pipeline**: `src/utils/articleImport/` (engines: Readability/Defuddle, DOMPurify sanitization, metadata extraction, scoring, raw/rendered fallbacks) — high quality, battle-tested; URL import modal; `web_proxy.rs` in-app browser fetch with SSRF guard.
- **Share capture**: Android SEND/SEND_MULTIPLE intents (text/pdf/epub/media), PWA share-target (`/share-target` → `?shared_url=`), screenshot capture overlay.
- **Cloud fetching precedent**: Vercel youtube API with proxy fallbacks; RSS full-content fetching.
- **Dedup**: `content_hash` on documents.

## What Changes

### 1. Remote inbox (server, `capture` domain on proposal-5 framework)
- `POST /v1/capture/url { url, tags?, collection? }` — server-side fetch (SSRF-guarded, robots/ToS-respecting fetcher with size/time caps, standard UA), article extraction (server port of the same engine selection/scoring logic — shared TS module extracted from `articleImport/` so client and server don't fork), sanitize, store as pending inbox item.
- `POST /v1/capture/content { html|text, url, title? }` — for extension/API callers that already have content (server never needs to fetch).
- `GET /v1/inbox` / `PATCH /v1/inbox/:id` (accept/dismiss/retag) / auto-sync: inbox items flow to devices via the sync channel (6) or direct pull; accepted items enter the local import pipeline as if captured on-device (identical sanitization/metadata/dedup path).
- Quota: items/month under `web_capture`; abuse controls: per-domain rate limits, payload caps, SSRF re-validation server-side (mirroring `security.rs`), no authless capture.

### 2. Email-to-Plethora
- Per-account capture address (`token@inbox.plethora.app` style; rotating token). Inbound email (via a provider-agnostic inbound webhook — SES/Postmark/Mailgun adapter behind the framework) → extract HTML/text → content-capture path → inbox. Attachments (pdf/epub) become inbox documents (size-capped).
- Anti-abuse: sender allowlist (account owner + optional allowlisted senders), attachment type/size caps, spam heuristics, per-day caps.

### 3. Web save + public capture API
- Web app "Save to Plethora" (paste URL on readsync-successor PWA → routes to `/v1/capture/url`) and the extension gains **cloud relay mode**: when the desktop app isn't running, sends via the authenticated API instead of localhost (extension gains sign-in; local mode remains default/available).
- Public capture API endpoint = the same `/v1/capture/*` with API tokens (proposal 20 owns token scopes; this change's endpoints are the first consumers) — enables Shortcuts/scripts.

### 4. Inbox UX
- Remote inbox section in the app: pending items with source/title/excerpt/tags; accept (choose collection/queue placement) / dismiss; bulk actions; item states sync; failure states (paywalled source, fetch failed) surfaced honestly with raw-URL fallback (import-on-device attempt).
- Dedup on accept (content_hash) with clear "already in library" outcome.

### 5. Native share-sheet invariants
- Android intents + PWA share-target behavior explicitly regression-tested; remote capture is additive only.

## Impact

### Affected Specs
- `remote-capture-inbox` — New (endpoints, fetcher rules, email pipeline, inbox lifecycle, quotas/abuse, share-sheet invariants).

### Affected Code Areas
- Server: capture routes, fetcher, extraction module (shared code extraction from `src/utils/articleImport/` into an isomorphic package), inbound-email adapter; extension: cloud-relay mode + auth; app: inbox UI/store, import-pipeline entry; i18n.

### Non-goals
- No newsletter-subscription management (existing RSS/substack flows cover), no full-page archiving service (readability extraction only), no social/team inboxes, no email sending (beyond transactional needs in 3/22).

## Dependencies

### Hard dependencies
- 3 (auth for extension/API capture), 5 (framework, storage), 2 (capability), rebrand (extension naming per its decision). Soft: 6 (inbox item delivery via sync; direct pull fallback until then), 20 (API tokens).

### May run concurrently
- 16, 17, 18, 20 (20 owns token infra consumed late here).

### Must not start yet
- — (but email provider selection is a deployment prerequisite for the email path).

## Shared interfaces
- `/v1/capture/*` + `/v1/inbox/*` contracts; shared article-extraction module (client/server single source — extraction lives in an isomorphic lib re-imported by both); inbox item schema; extension relay protocol.

## Ownership boundaries
- **May modify**: server capture routes/fetcher, `articleImport/` refactor into shared module (behavior-preserving — existing tests must pass unchanged), extension background relay, inbox UI.
- **Must treat as external**: sync engine (delivery only), API-token infra (20), article pipeline semantics (only relocated, not redesigned).

## Collision risks
- `src/utils/articleImport/` refactor (behavior-preserving move; many importers depend — land atomically with test parity); extension `background.js` (also touched by rebrand compat window — sequence after rebrand); migration numbering none (server-side schema).

## Integration contract
- Inbox items serialize to the standard document-import payload (same fields as on-device import); extension relay uses `/v1/capture/content` with the account session; API tokens per 20's scope model (`capture:write`).

## Testing & acceptance

### Tests
- Fetcher: fixture sites (article, paywalled, oversized, redirect-chain, private-IP attempt) → correct outcomes incl. SSRF rejection; extraction parity: shared module output identical client vs server on the existing article-import fixture corpus (golden tests reused).
- Email: inbound fixtures (html, text, pdf attachment, oversized, wrong sender) → routing/caps/allowlist behavior.
- Inbox lifecycle: accept→import→dedup ("already in library"), dismiss, bulk, sync/pull delivery, failure fallbacks.
- Extension: relay mode (app offline), local mode unchanged, auth expiry handling.
- Share-sheet regression: Android intent + PWA share-target suites stay green (explicit).
- Abuse: rate limits, payload caps, unauthenticated rejection.

### Acceptance criteria
- A URL saved from the web/extension/API/email appears in the device inbox and imports through the standard pipeline with dedup; quotas and abuse controls verified; native capture paths regression-free; Free users without `web_capture` see the feature with reason (local capture always works).

### Must remain unchanged
- On-device import quality/behavior (extraction parity proven), extension local mode, share sheets, existing article-import benches (or baselines updated per protocol).

## Open questions
1. Inbound-email provider (SES/Postmark/Mailgun) — deployment decision behind adapter.
2. Fetcher policy details (UA, robots honoring depth, cache TTL).
3. Whether inbox items auto-import on accept-to-default-collection (default: yes, with per-user setting).
