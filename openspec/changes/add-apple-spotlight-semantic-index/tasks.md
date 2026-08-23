## 1. Identity and fakes

- [ ] 1.1 Add `spotlight_uri` / parse helpers in Rust (`src-tauri/src/ai_learning/spotlight.rs`) with unit tests for all four kinds.
- [ ] 1.2 Add `FakeSpotlight` projector recording donate/delete/domain-wipe.

## 2. Plugin

- [ ] 2.1 Implement Swift `AppleSpotlight.swift` for reserved `apple_spotlight_*` commands with `@available` guards; non-Apple stubs remain `platform_unsupported`.
- [ ] 2.2 Default display eligibility false; `isEligibleForPublicIndexing` false.

## 3. Indexer hooks

- [ ] 3.1 Call projector after per-document commit in `indexer.rs` (insert/update/delete URIs).
- [ ] 3.2 Hook document delete, `removeSourceChunks`, `ai_learning_reset_index`, logout/wipe.
- [ ] 3.3 Corruption detection (`spotlight_generation` / stats vs SQLite) + rebuild.

## 4. Settings and search merge

- [ ] 4.1 Add `settings.search.systemSpotlightEnabled` default false + settings UI near index/privacy.
- [ ] 4.2 Merge Spotlight candidates into `ftsSearch` / `CommandCenter` / `GlobalSearch` / `SearchPage` with dedup; FTS fallback.
- [ ] 4.3 Register `apple_spotlight_search` if A did not.

## 5. Tests

- [ ] 5.1 Rust lifecycle tests; TS merge/fallback/default-off tests.
- [ ] 5.2 Manual: default items absent from system Spotlight; toggle on; airplane in-app search.
