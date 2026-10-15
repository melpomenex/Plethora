# Change: Implement Plethora Pro Integrations, API, and Automation

> Wave 3 — Cloud Capabilities. Hard-depends on proposals 3 + 5 + 2. Capabilities: `api_access` (public cloud API), `automation` (event webhooks + automation rules), `integrations` (third-party connector surface). **Extends two existing local surfaces rather than inventing a third: the automation endpoints on `browser_sync_server.rs` and the local MCP server.**

## Why

Power users want Plethora in their workflows: an API for scripts/Shortcuts/Obsidian plugins, webhooks on domain events, and integrations with note systems/read-it-later services. The app already exposes a capable local API (HTTP automation endpoints + MCP tools); Pro adds the authenticated cloud tier, event webhooks, and token/scope management.

## What exists today
- **Local automation API**: `browser_sync_server.rs` (Axum, 127.0.0.1:8766) — `/api/automation/cards`, `/api/automation/reviews/submit`, etc., auth via `X-API-Key`/`Bearer` matching a generated/rotatable automation key (`get/rotate_automation_api_key`); CORS for extension origins; 10 MB payload cap.
- **MCP**: local stdio server exposing ~20 tools (documents, extracts, cards, reviews, queue, video snippets) + external-server client manager (`mcp/` modules, `mcpServersStore`, settings UI).
- **Integrations**: Obsidian export (vault sync w/ `*-id` frontmatter), Anki sync, NotebookLM (28 commands), browser extension.
- **Server**: nothing public; JWT only.

## What Changes

### 1. Public cloud API (`api_access`)
- Versioned REST under `/v1/api/*` on proposal-5's framework, scoped to read/create (not destructive admin): documents (list/get/create-url/content), extracts, learning-items, reviews (submit), queue (read), collections/tags, search (FTS), capture (`/v1/capture/*` from 19), usage/self. **No endpoints that bypass E2E sync encryption for reading synced content**: the cloud API reads only what the server legitimately holds (inbox/capture items, metadata the user has explicitly pushed); local-first content access happens through the local API/MCP. This boundary is a privacy feature, documented.
- **API tokens**: per-account tokens with scopes (`read`, `write`, `capture:write`, `webhooks`, `cards:write`, `reviews:write`), creation/revocation UI, last-used tracking, rotation; hashed at rest. Rate limits per token class.
- Versioning policy: additive-only within v1; deprecation headers + changelog; OpenAPI document generated from zod schemas (contract tests).

### 2. Event webhooks (`automation`)
- Cloud: per-account webhook endpoints (HTTPS, signature `X-Plethora-Signature` HMAC with token secret, retries with backoff, dead-letter after N attempts, event-id dedupe). Event catalog v1: `document.imported`, `document.completed`, `extract.created`, `card.created`, `review.completed`, `gap.identified` (10), `item.due` (daily digest, not per-item spam), `card.due` (digest), `connection.discovered` (8). Events carry ids/metadata only — **never document content** (E2E boundary + privacy).
- Local: extend the automation endpoints with an event-emission bridge (local webhooks/scripts on the same catalog where data is local) — power without cloud.

### 3. Integrations surface (`integrations`)
- Connector registry standardizing existing connectors (Obsidian, Anki, NotebookLM, extension, RSS) + new cloud-mediated ones where valuable (read-it-later import: Pocket/Instapaper/Readwise export-file importers v1 — file-based, no third-party OAuth complexity; OAuth connectors deferred).
- Export/import workflows: the existing export formats (Anki decks, Plethora, app-state backups, collection archives, mnemosyne txt) documented as the portability contract; API-based bulk export endpoint (`export` job kind) for account-held data.

### 4. Client UX
- Settings → Integrations & API: token manager (scopes, rotate, revoke, last-used), webhook manager (endpoint, events, active/disabled, delivery log with redacted payloads), connector cards, API docs link + copyable examples (curl/Shortcuts).

### 5. Abuse/safety
- Scope enforcement at middleware (deny-by-default), token rate limits, payload caps, webhook target SSRF validation, no content in webhook payloads/logs, per-event subscriptions capped.

## Impact

### Affected Specs
- `public-api-automation` — New (API surface, tokens/scopes, webhook contract, event catalog, E2E boundary, local bridge).

### Affected Code Areas
- Server: `/v1/api/*` routes, token/webhook stores + middleware, OpenAPI gen; app: local automation bridge extension (browser_sync_server), settings UI, connector registry refactor (existing integrations UI evolve); i18n.

### Non-goals
- No third-party OAuth connectors v1, no plugin sandbox in-app (MCP covers local extensibility), no write access to scheduling internals beyond review submission, no content-bearing webhooks.

## Dependencies

### Hard dependencies
- 3 (accounts), 5 (framework), 2 (capabilities). Soft: 8/10 (events), 19 (capture endpoints), 6 (synced-content boundary documented).

### May run concurrently
- 16–19 (19 consumes token scopes late).

### Must not start yet
- —.

## Shared interfaces
- API token model + scope names (consumed by 19); webhook event catalog + signature scheme; `/v1/api/*` OpenAPI contract; local automation event-bridge API.

## Ownership boundaries
- **May modify**: server api/webhook routes, token infra, local automation bridge additions, integrations settings UI, connector registry organization.
- **Must treat as external**: MCP server tools (extend tool list additively only if needed), sync engine, capture domain logic (19), billing/auth middleware semantics.

## Collision risks
- `server/src/index.ts` route mounting (with 3/4/5/19 — route-file-per-proposal); `browser_sync_server.rs` (owned additions in clearly separated modules); integrations settings UI (existing panels evolve in place).

## Integration contract
- Events reference domain ids (never content); API responses follow the framework error envelope; webhook deliveries idempotent by event id; tokens scoped per catalog above.

## Testing & acceptance

### Tests
- Contract tests from OpenAPI (route/method/schema/response); scope matrix (each scope × endpoint allow/deny); token lifecycle (create/rotate/revoke/last-used); rate limits.
- Webhooks: signature verification (reject tampered), retry/backoff/dead-letter, dedupe, SSRF target validation, payload-content absence (scan).
- Local bridge: event parity with cloud catalog on local paths; rotation invalidates old key (existing behavior preserved).
- Export job: account-data completeness vs documented contract.
- Load: API smoke at target RPS with p95 baseline (24 enforces).

### Acceptance criteria
- A user creates a scoped token, scripts a capture + card query via the public API, receives signed webhooks on the catalog events with local fallback working, and manages everything from the new settings surface; scopes deny-by-default; no content ever leaves via webhooks; local MCP/automation unchanged for existing users.

### Must remain unchanged
- Existing local automation endpoints' auth model (rotatable key), MCP tool behavior, existing importers/exporters (registry reorganization only).

## Open questions
1. Event catalog v1 final list + digest granularity for due-events (daily digest assumed).
2. Whether local webhooks support non-HTTP targets (shell command — security-reviewed, default off).
3. Readwise OAuth connector priority (file-import v1 assumed).
