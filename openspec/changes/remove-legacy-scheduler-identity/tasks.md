# Tasks: Remove Legacy Scheduler Identity

## A — OpenSpec & governance
- [x] A.1 Create proposal, design, specs, tasks
- [x] A.2 Terminology gate script + vitest wrapper

## B — Compatibility boundary
- [x] B.1 `scheduler_identity.rs`
- [x] B.2 `schedulerIdentity.ts`
- [x] B.3 `arena_model_identity.rs` (Arena M1–M5 + legacy deserialize)

## C — Rust cleanup
- [x] C.1 Precision module comments and type renames
- [x] C.2 `review.rs` renames; legacy Tauri aliases in `ipc_compat.rs`
- [x] C.3 `repository.rs` arena method renames
- [x] C.4 Arena identity boundary (no literal legacy ids in precision/mod.rs)

## D — Frontend cleanup
- [x] D.1 schedulerCatalog, api/review, canonical scheduler union
- [x] D.2 `precisionPureKernel`, `arenaReviewMode` settings keys
- [x] D.3 Remove legacy parse/type aliases; update callers
- [x] D.4 Review components, i18n, comments
- [x] D.5 browser-backend canonical keys + handlers

## E — Docs & OpenSpec tree
- [x] E.1 Sanitize `openspec/` archives
- [x] E.2 Fix `docs/USER_HANDBOOK*.md` and related docs
- [x] E.3 Help index (no new paths required)

## F — Verification
- [x] F.1 Scheduler test suites (adaptive, precision, identity, catalog, terminology gate)
- [x] F.2 `cargo test` (1156+ unit) + vitest scheduler suites
- [x] F.3 Terminology scan: 0 hits outside exempt paths
- [x] F.4 Multi-agent implementation and review
