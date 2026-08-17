# Implementation Tasks

## 1. Tokens & middleware
- [ ] 1.1 Token store (hashed, scopes, rotation, last-used) + deny-by-default scope middleware + rate limits
- [ ] 1.2 Token manager UI (scopes, rotate, revoke) + i18n

## 2. Public API
- [ ] 2.1 `/v1/api/*` routes (documents, extracts, items, reviews, queue, collections/tags, search, usage/self) on framework conventions
- [ ] 2.2 OpenAPI generation from zod + contract test harness; versioning/deprecation policy doc
- [ ] 2.3 `export` job kind (account-held data bulk export)
- [ ] 2.4 E2E-boundary documentation + route-enumeration test

## 3. Webhooks & local bridge
- [ ] 3.1 Webhook store + HMAC signing + retries/dead-letter + event-id dedupe + SSRF target validation
- [ ] 3.2 Event catalog implementation (cloud) + subscription caps + due-digest jobs
- [ ] 3.3 Local automation event bridge in `browser_sync_server.rs` (catalog parity)
- [ ] 3.4 Webhook manager UI with redacted delivery log

## 4. Integrations surface
- [ ] 4.1 Connector registry reorganization (existing Obsidian/Anki/NotebookLM/extension/RSS panels; no behavior change)
- [ ] 4.2 File-based importers: Pocket/Instapaper/Readwise export files → import pipeline

## 5. Validation
- [ ] 5.1 Scope matrix, contract, signature/tamper, dedupe/dead-letter, content-absence tests
- [ ] 5.2 API load smoke with p95 baseline (24 enforces); local-automation regression suite
- [ ] 5.3 i18n 6 locales; full gates
