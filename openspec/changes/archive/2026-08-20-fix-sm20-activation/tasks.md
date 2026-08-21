## 1. Storage layer (Rust)

- [x] 1.1 Add migration `057_add_sm20_matrices` to the `MIGRATIONS` const in `src-tauri/src/database/migrations.rs` — `CREATE TABLE IF NOT EXISTS sm20_matrices (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001', interval_matrix BLOB NOT NULL, count_matrix BLOB NOT NULL, date_modified TEXT NOT NULL)`
- [x] 1.2 Add `Repository::get_sm20_matrices(&self) -> Result<Option<([f64;9261], [u32;9261])>>` in `src-tauri/src/database/repository.rs` — reads the `WHERE id = 'global'` row; deserializes the two BLOBs into `[f64; 9261]` (74,088 bytes) and `[u32; 9261]` (37,044 bytes) via little-endian `from_le_bytes` chunks. Match the `bytes_to_embedding` pattern.
- [x] 1.3 Add `Repository::upsert_sm20_matrices(&self, interval: &[f64;9261], count: &[u32;9261]) -> Result<()>` — packs both arrays to little-endian bytes and `INSERT ... ON CONFLICT(id) DO UPDATE` the `global` row with `date_modified = now`. Match the `upsert_embedding` pattern.
- [x] 1.4 Add a unit test for the matrix round-trip (write known values, read back, assert equality of every cell). Two tests added: `sm20_matrices_round_trip_preserves_every_cell` and `sm20_matrices_upsert_replaces_existing`.

## 2. SM-20 module core (Rust)

- [x] 2.1 In `src-tauri/src/algorithms/sm20.rs`, remove the `match version { 4 => ..., 6 => ..., _ => ... }` dispatch in `compute_next_interval` — hardcode the V4 call (`interval_v4(diff_frac, stab_xform, 0.8, 0.0, 0.9, stab_xform, repetition as f64)`). Remove the `version: u8` parameter from `compute_next_interval`.
- [x] 2.2 Keep the `stability * sinc` final step (`clamp(stability * sinc, 1.0, STABILITY_MAX)`) unchanged — it is correct per the reference. Add a code comment citing `sm20_reference.py:463-465`.
- [x] 2.3 Decide and execute on `interval_v2` / `interval_v6`: grep the repo for non-test importers; if none, delete them and their constants. — **Done: no external importers found; V2/V6, UFACTOR, and all V2_* / ROUND_* constants deleted. INIT_* and ROUND_* kept (still used by `interval_initial`/`bayesian_smooth`).**
- [x] 2.4 Delete the FSRS-family branch: `fsrs_expert1/2/3`, `fsrs_expert_mixture`, `fsrs_difficulty_update`, `fsrs_lapse_stability`, `fsrs_recall_stability`, `fsrs_review_kernel`, `fsrs_init_item`, `review_fsrs`, the `FSRS_PARAMS` array, and the `if state.algorithm_branch == 1 { return review_fsrs(...) }` dispatch in `review()`.
- [x] 2.5 Keep `algorithm_branch` and `version` fields in `SM20State` (for deserialization compat) with `/// Deprecated field:` doc comments; ensure `review()` no longer reads either. (Used doc comments rather than `#[deprecated]` to avoid lint churn at construction sites.)
- [x] 2.6 Add matrix threading: `review_with_matrices()` accepts `&mut [f64;9261]` and `&mut [u32;9261]`, passes immutable reborrows into `compute_next_interval` (Phase 1), then calls `record_review` with the mutable borrows (Phase 2). `review()` (no matrices) retained for the preview path.

## 3. Review command wiring (Rust)

- [x] 3.1 `apply_sm20_review` is now `async fn` taking `repo: &Repository`; loads matrices via `repo.get_sm20_matrices()` at the start, defaulting to zeroed arrays if `None`. Called from `apply_review` with `.await`.
- [x] 3.2 Pass the matrices into `sm20::review_with_matrices(...)`; the mutated arrays stay in scope.
- [x] 3.3 Persist the updated matrices via `repo.upsert_sm20_matrices(...)` after computing the result and before returning.
- [x] 3.4 `parse_sm20_state` fallback now uses `..Default::default()` (version=4) instead of a `version: 2` literal; persisted `version` is still deserialized for compat.

## 4. TypeScript mirror

- [x] 4.1 In `src/lib/sm20.ts`, hardcode V4 in `computeNextInterval` (removed the `switch (version)`), deleted the FSRS-family functions and `FSRS_PARAMS`, deleted `reviewFsrs` and the `algorithm_branch === 1` dispatch in `sm20Review`.
- [x] 4.2 Threaded optional matrix params (`intervalMatrix?`, `countMatrix?`) through `sm20Review`; documented that the browser backend does not persist them in v1 (Tauri path is the complete implementation).
- [x] 4.3 Kept `version` and `algorithm_branch` in the `SM20State` interface with `@deprecated` JSDoc comments.

## 5. Tests

- [x] 5.1 Replaced `ref_compute_next_interval_v4_v6_fallback` with `ref_compute_next_interval_always_v4` — asserts `compute_next_interval(5.0, 0.3, 3, None, None) == 33.54`.
- [x] 5.2 Added `ref_v4_sweep` — 9 cases across low/mid/high stability and difficulty extremes, values computed directly from `sm20_reference.py`, pinned to ±0.01.
- [x] 5.3 Deleted all FSRS-family tests in `sm20.rs` (`fsrs_expert1_typical`, `fsrs_kernel_recall_path`, `fsrs_init_item_*`, etc.).
- [x] 5.4 Added `matrix_sharing_two_items_bayesian_incorporates_prior_review` — reviews item A, asserts the shared cell is populated, then asserts item B's Bayesian path differs from raw V4.
- [x] 5.5 Rewrote `src/lib/__tests__/sm20.test.ts` — removed FSRS branch tests, added `matrix recording via sm20Review`, `V4 reference value`, and `FSRS-family branch removed: persisted algorithm_branch=1 is ignored`.
- [ ] 5.6 Run `cargo test -p incrementum` and `pnpm test` — **BLOCKED: rustc 1.93.1 (custom source-tarball build) segfaults on dependency compilation in this environment; requires a reboot to verify. Tests are written but not yet executed.**

## 6. Verification & docs

- [x] 6.1 Added `sm20_state_backward_compat_deserialize` test — an `algorithm_state` JSON with `version: 2` and `algorithm_branch: 1` deserializes and schedules via V4 (interval 36.12 for the test inputs) with no FSRS dispatch.
- [x] 6.2 Updated `docs/USER_HANDBOOK.md` "Understanding SM-20" section and the algorithm-comparison bullets — V4-only language, removed V2/V4/V6 and FSRS-branch language, documents persisted matrices; SM-19 available as `sm2`.
- [x] 6.3 Mirrored the handbook update in `docs/USER_HANDBOOK.ja.md` and `docs/USER_HANDBOOK.fr.md` (both the main section and the comparison bullets).
- [x] 6.4 Added a release-notes bullet to `CHANGELOG.md` under a new `[Unreleased]` section: existing `sm20` users will see intervals shift from SM-19 (V2) to SM-20 (V4) values on their next review — intended correction.
