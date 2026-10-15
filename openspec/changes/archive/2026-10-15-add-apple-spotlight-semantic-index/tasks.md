## 1. Identity and fakes

- [x] 1.1 Add `spotlight_uri` / parse helpers in Rust (`src-tauri/src/ai_learning/spotlight.rs`) with unit tests for all four kinds.
- [x] 1.2 Add `FakeSpotlight` projector recording donate/delete/domain-wipe.

## 2. Plugin

- [x] 2.1 Implement Swift `AppleSpotlight.swift` for reserved `apple_spotlight_*` commands with `@available` guards; non-Apple stubs remain `platform_unsupported`.
- [x] 2.2 Default display eligibility false; `isEligibleForPublicIndexing` false.

## 3. Indexer hooks

- [x] 3.1 Call projector after per-document commit in `indexer.rs` (insert/update/delete URIs).
- [x] 3.2 Hook document delete, `removeSourceChunks`, `ai_learning_reset_index`, logout/wipe.
- [x] 3.3 Corruption detection (`spotlight_generation` / stats vs SQLite) + rebuild.

## 4. Settings and search merge

- [x] 4.1 Add `settings.search.systemSpotlightEnabled` default false + settings UI near index/privacy.
- [x] 4.2 Merge Spotlight candidates into `ftsSearch` / `CommandCenter` / `GlobalSearch` / `SearchPage` with dedup; FTS fallback.
- [x] 4.3 Consume A’s `apple_spotlight_search` platform id; do not register a second id (`apple_spotlight_index`). Implement reserved `apple_spotlight_rebuild` (domain wipe + indexer enqueue).

## 5. Tests

- [x] 5.1 Rust lifecycle tests; TS merge/fallback/default-off tests.
- [x] 5.2 Manual: default items absent from system Spotlight; toggle on; airplane in-app search.
