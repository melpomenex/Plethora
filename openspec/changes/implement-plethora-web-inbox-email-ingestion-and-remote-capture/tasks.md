# Implementation Tasks

## 1. Shared extraction + server capture
- [x] 1.1 Extract isomorphic article-extraction module from `src/utils/articleImport/` (behavior-preserving; golden-test parity client/server)
- [x] 1.2 `/v1/capture/url` + `/v1/capture/content`: SSRF-guarded bounded fetcher, extraction, inbox store
- [x] 1.3 `/v1/inbox` lifecycle endpoints + quota (`web_capture`) + per-domain rate limits + payload caps

## 2. Email ingestion
- [x] 2.1 Inbound-email adapter (provider-agnostic) + per-account rotating capture addresses
- [x] 2.2 Parsing → content-capture path; attachment caps/types; allowlist + daily caps + content-free audit events

## 3. Clients
- [x] 3.1 Remote inbox UI/store (accept/dismiss/bulk, placement, dedup outcome, failure fallbacks) + sync/pull delivery
- [x] 3.2 Extension cloud-relay mode (sign-in, localhost default, offline-app fallback) 
- [x] 3.3 Web "Save to Plethora" page + API-token capture path (20 contract)
- [x] 3.4 Share-sheet regression suites (Android intents + PWA share-target) wired to CI

## 4. Validation
- [x] 4.1 Fetcher fixtures (paywalled/oversized/redirect/SSRF); extraction parity corpus; email fixtures
- [x] 4.2 Abuse/quota tests; inbox E2E (capture→accept→library→dedup)
- [x] 4.3 i18n 6 locales; full gates

