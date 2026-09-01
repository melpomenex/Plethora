# FSRS-7 Production Migration — Tasks

## 1. Upstream vendoring
- [x] 1.1 Vendor fsrs-rs 6.0.0 at `vendor/fsrs-rs-fsrs7/` (commit `47fb3af`)
- [x] 1.2 Create `UPSTREAM.md` with provenance and BSD-3-Clause notice

## 2. Rust FSRS-7 core
- [x] 2.1 Path dependency in `Cargo.toml`
- [x] 2.2 `algorithms/fsrs7` wrapper with explicit 34-param construction
- [x] 2.3 `stability_fast` on `MemoryState`
- [x] 2.4 Fractional elapsed time in review/document/engaging schedulers
- [x] 2.5 Production dispatch normalization in `apply_review`

## 3. Data migration
- [x] 3.1 Migration 115 schema (stability_fast, legacy columns, tracking table)
- [x] 3.2 `replay_fsrs7_from_history` module
- [x] 3.3 Background startup migrator
- [x] 3.4 Repository read/write for `stability_fast`

## 4. Browser/PWA parity
- [x] 4.1 TypeScript FSRS-7 port in `src/algorithms/fsrs7/`
- [x] 4.2 Update `browser-backend.ts`
- [x] 4.3 Update `fsrsParameters.ts` for 34-param model
- [x] 4.4 Server video-extracts route

## 5. UI / product
- [x] 5.1 `SELECTABLE_SCHEDULERS` = FSRS-7 only
- [x] 5.2 Settings UI simplification
- [x] 5.3 Four-button review enforcement
- [x] 5.4 Scheduler lifecycle abstraction

## 6. Testing
- [x] 6.1 Rust FSRS-7 unit tests (golden vectors)
- [x] 6.2 TS parity tests (1200+ random histories)
- [x] 6.3 Migration fixture tests
- [x] 6.4 Scheduler catalog static guards
- [x] 6.5 Expand differential corpus to 10k+
- [ ] 6.6 Cross-platform convergence tests

## 7. Documentation & licensing
- [ ] 7.1 Update `docs/USER_HANDBOOK.md` and product docs
- [ ] 7.2 Update website FSRS docs
- [ ] 7.3 Open-source licenses surface
- [ ] 7.4 Changelog entry
- [ ] 7.5 Developer note on legacy scheduler status

## 8. Verification
- [ ] 8.1 `cargo test` in src-tauri
- [ ] 8.2 Frontend unit tests
- [ ] 8.3 TypeScript typecheck
- [ ] 8.4 Adversarial review phase
- [ ] 8.5 `npm run bench:check` if schedulers touched benchmarks
