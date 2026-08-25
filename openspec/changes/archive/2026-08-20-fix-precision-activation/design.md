## Context

The Plethora Precision module (`src-tauri/src/algorithms/precision.rs`, mirrored by `src/lib/precisionScheduler.ts`) was a faithful line-by-line translation of `precision_reference.py` — a decompilation of `precision-kernel-reference.exe`. The formula translation is correct (verified against the now-recovered `precision-kernel-re` reference repo). The problems are entirely in the **app-level wiring**: the version dispatcher defaults every item to V2 (Classic 19), the Bayesian matrices are never instantiated or persisted, and a full FSRS-family branch is gated behind a flag (`algorithm_branch == 1`) that is only ever set in test code.

The authoritative reference (`precision_reference.py:463-465`) confirms that the final `stability * sinc` multiply is **correct for all three versions** — V4's `interval_v4` output is a stability-increase multiplier (SInc), not an absolute interval. The bug report's "interval explosion" concern (Issue 2) is unfounded against the reference. This materially de-risks the change: activating V4 does not require touching the multiply.

Current storage state (from codebase research):
- Algorithm per-item state lives in `learning_items.algorithm_state` (TEXT JSON) and `learning_items.memory_state_stability/difficulty` (REAL). No separate table.
- Migrations are a single Rust const `MIGRATIONS` in `src-tauri/src/database/migrations.rs` (the `.sql` files in `migrations/` are **not** loaded at runtime). Latest is `056_*`; next is `057_*`.
- There is no per-user concept; the app is single-user. `collection_id` is the dominant partitioning axis, defaulting to `DEFAULT_COLLECTION_ID`.
- Structured binary data precedent: `queue_item_embeddings.embedding` and `document_chunk_embeddings.embedding` are BLOBs holding little-endian packed arrays, round-tripped via `to_le_bytes()`/`from_le_bytes()` in `Repository::upsert_embedding` (`repository.rs:2973`).
- Global-singleton table precedent: `youtube_playlist_settings` uses a fixed `WHERE id = 'global'` row.

## Goals / Non-Goals

**Goals:**
- The `precision` algorithm runs the V4 (Plethora Precision proper) formula on every review. Users who select `precision` get Plethora Precision, not Classic 19.
- The Bayesian smoothing matrices are persisted, loaded per review session, fed into `compute_next_interval`, and updated via `record_review` after each graded review — so Plethora Precision learns from the user's history as designed.
- The dead FSRS-family branch is removed from the Plethora Precision module (the repo's separate `fsrs::FSRS` is the real FSRS offering).
- The V2 (Classic 19) path remains reachable via the existing `classic` algorithm choice for users who want it.
- No breaking changes to the public Tauri command surface or the `PrecisionState` JSON contract (existing rows deserialize).

**Non-Goals:**
- Not re-translating the core formulas from the reference — they are already correct; this change is about wiring, not math.
- Not adding a UI setting for V2/V4/V6 selection. V4 is the Plethora Precision contract; V2 users pick `classic`.
- Not extracting FSRS into its own module or adopting the official FSRS library. The embedded FSRS-family code is simply deleted; the existing `fsrs::FSRS` (FSRS-6) is untouched and remains the default.
- Not migrating existing `precision` items' computed intervals. Their next review will simply compute a V4 interval instead of a V2 interval. This is the intended correction.
- Not introducing per-collection matrix scoping in v1. The matrices are a global singleton keyed by `DEFAULT_COLLECTION_ID` (the only collection today); the schema leaves room for future per-collection scoping without a second migration.

## Decisions

### Decision 1: Hardcode V4 inside the Plethora Precision module; drop the version dispatcher

**Choice:** Remove the `match version { 4 => ..., 6 => ..., _ => interval_v2(...) }` block. `compute_next_interval` always calls `interval_v4`. The `PrecisionState.version` field remains in the struct (for backward-compatible deserialization of existing rows) but is **never read** and is documented as deprecated.

**Rationale:** The user decision was "hardcode V4." V6 (FSRS-style double-exponential) is not referenced in the Plethora Precision marketing/docs as a user-facing choice, and the version byte was never meaningfully user-settable. Keeping a dead dispatcher invites the exact misconfiguration that caused this bug.

**Alternatives considered:**
- *Default `version` to 4 instead of 2.* Rejected: leaves a latent footgun (any code path that resets state re-introduces the bug) and keeps V6/V2 code alive for no benefit.
- *Add a version setting.* Rejected per user decision — adds UI surface for a distinction (Classic 19 vs Plethora Precision) that's already covered by the `classic` vs `precision` algorithm-type choice.

**V2 retention:** The V2 formula (`interval_v2`) and its constants stay in the module because the `classic` algorithm (`src-tauri/src/algorithms/classic.rs::ClassicAlgorithm`) is a *different* implementation and the Plethora Precision module's `interval_v2` is not used by it. Actually — verify during implementation whether `precision::interval_v2` is imported anywhere outside tests; if not, it can be deleted along with V6. V4 is the only path that must remain.

### Decision 2: Persist matrices in a dedicated global table with two BLOB columns

**Choice:** New table via migration `057_add_precision_matrices`:
```sql
CREATE TABLE IF NOT EXISTS precision_matrices (
    id TEXT PRIMARY KEY,           -- 'global' for v1
    collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    interval_matrix BLOB NOT NULL, -- 9261 × f64 little-endian = 74,088 bytes
    count_matrix BLOB NOT NULL,    -- 9261 × u32 little-endian = 37,044 bytes
    date_modified TEXT NOT NULL
);
```
Single row, `id = 'global'`. `interval_matrix` and `count_matrix` are packed little-endian byte arrays, round-tripped with the same pattern as `Repository::upsert_embedding`.

**Rationale:**
- *Why not the `learning_items.algorithm_state` JSON?* The matrices are learner-global (one learner), not per-card. Inlining ~111 KB of base64 into every review's JSON blob would bloat every `learning_items` row and every review IPC payload.
- *Why not the `settings` KV table?* It stores TEXT only; you'd JSON-encode 18,522 numbers as text (~200 KB+ of ASCII), much larger and slower than a binary BLOB. The `settings` table is for small config values.
- *Why BLOB over JSON-in-TEXT?* Matches the embeddings precedent (`queue_item_embeddings`, `document_chunk_embeddings`) and is ~3× smaller and faster to (de)serialize than JSON.
- *Why global over per-collection?* The app is single-user and effectively single-collection today. Plethora Precision's learning is about the learner's memory, not the collection. Including `collection_id` in the schema (defaulted) leaves a no-migration upgrade path to per-collection scoping if multi-collection becomes meaningful.

**Alternatives considered:**
- *Per-collection matrices.* Rejected for v1 (no benefit today, more rows), but the schema accommodates it.
- *File-based storage (e.g. a `.bin` next to the DB).* Rejected: breaks the single-DB backup/restore/sync story that everything else relies on.

### Decision 3: Thread matrices through the review path; update after each grade

**Choice:** `apply_precision_review` (`commands/review.rs:738`) gains matrix load/persist:
1. At the start, load the global matrices via `Repository::get_precision_matrices()`. If absent (first run), return zeroed arrays in memory.
2. Pass `&interval_matrix, &count_matrix` into a new `precision::review_with_matrices(&state, rating, elapsed_days, &im, &cm)` (or extend the existing `precision::review` signature with optional matrix params). Internally this calls `compute_next_interval(..., Some(&im), Some(&cm))` and, after computing the new interval, calls `record_review(state.stability, state.difficulty, repetition, interval_used, &mut im, &mut cm)` to log the observation.
3. After computing the result, persist the updated matrices via `Repository::upsert_precision_matrices(...)`.

The TypeScript mirror (`src/lib/precisionScheduler.ts`) keeps the matrices as function parameters (the browser/PWA backend doesn't have the SQLite layer) — the call site in the browser-backend review path is responsible for its own storage (if any). For the PWA backend, matrices can be held in memory for the session and persisted to IndexedDB; this is a follow-on, not a blocker for the Tauri path.

**Rationale:** Loading per-review (rather than caching in a process-global) is simple and correct given SQLite's page cache. A single review is already a DB transaction; one extra BLOB read + write of ~111 KB is negligible against the IPC and JSON costs already present. Caching introduces invalidation concerns across windows/sessions.

**Alternatives considered:**
- *In-process cache (`OnceCell<[f64;9261]>`).* Rejected: adds a global mutable state with no clear invalidation story, and the per-review DB cost is already small.
- *Batch matrix updates (write every N reviews).* Rejected: a crash between reviews loses observations; the per-review write is cheap.

### Decision 4: Remove the FSRS-family branch entirely

**Choice:** Delete from `precision.rs` and `precisionScheduler.ts`: `fsrs_expert1/2/3`, `fsrs_expert_mixture`, `fsrs_difficulty_update`, `fsrs_lapse_stability`, `fsrs_recall_stability`, `fsrs_review_kernel`, `fsrs_init_item`, `review_fsrs`, the `FSRS_PARAMS` array, the `algorithm_branch` field usage in `review()` dispatch, and their tests. The `algorithm_branch` field stays in `PrecisionState` for deserialization compatibility but is ignored.

**Rationale:**
- It is dead in production (`algorithm_branch` is only set to `1` by `fsrs_init_item`, which is only called in tests).
- The repo already ships FSRS-6 via `fsrs::FSRS` (the actual default algorithm), so this is not removing FSRS capability from the product.
- It diverges from the reference: the repo's `fsrs_expert_mixture(t, s, d)` takes 3 params, but `precision_reference.py:631` `fsrs_expert_mixture(t, S)` takes 2. It's not a faithful translation, so it's not worth preserving even if someone wanted to reactivate it.

**Alternatives considered:**
- *Fix the 3-vs-2-param divergence and keep it behind a feature flag.* Rejected: adds complexity for code nobody uses, and the reference shows FSRS-in-Precision is gated by per-item flags derived from Plethora's own item model that this app doesn't have.

### Decision 5: Migration is additive only; no data migration for existing `precision` items

**Choice:** The migration only `CREATE TABLE IF NOT EXISTS precision_matrices`. Existing `learning_items` rows with `algorithm_type = 'precision'` keep their `algorithm_state` JSON (including `version: 2`, which is now ignored). On their next review, V4 computes a new interval. No row rewrite, no backfill.

**Rationale:** The persisted scalars (stability, difficulty, repetition, lapses) are version-agnostic — they're DSR state, not formula outputs. Re-running V4 against the same DSR state produces a valid Plethora Precision interval. Forcing a rewrite would be riskier than letting the next review naturally transition.

## Risks / Trade-offs

- **[Behavior change for existing `precision` users]** Their intervals will shift from V2 values to V4 values on the next review. V4 intervals will generally differ (larger or smaller depending on difficulty/repetition). → *Mitigation:* Call this out in release notes. It's the intended correction. The `STABILITY_MAX` clamp (44530 days ≈ 122 years) and the per-rating `success_multiplier` bound the magnitude.

- **[Matrix cold-start]** On first use, the matrices are all zeros, so `bayesian_smooth` returns the `interval_initial` prior for every cell until observations accumulate. The `BAYES_PRIOR_WEIGHT = 500` constant means the prior dominates until ~hundreds of reviews per cell. → *Mitigation:* This is by design (the reference's Bayesian weighting); behavior degrades gracefully to the prior, not to garbage. No action needed.

- **[Concurrency]** Two reviews submitted near-simultaneously could both read the matrices, both update, and the second write wins (last-write-wins on the `interval_matrix[idx]` running average). → *Mitigation:* Reviews are already effectively serialized per-item via the `get_learning_item` → compute → `update_learning_item` sequence, and the UI doesn't allow concurrent reviews of the same item. The race window is two *different* items updating different matrix cells; the running averages are independent so the lost update only loses one cell's increment — acceptable for a learning algorithm that converges over many reviews. Document as known limitation; do not add locking in v1.

- **[PWA/browser-backend parity]** The TS mirror will support matrix params but the browser backend has no SQLite; without IndexedDB persistence the PWA path won't learn across sessions. → *Mitigation:* Ship the Tauri path as the complete implementation. For PWA, matrices can be session-scoped in v1 (learning accumulates within a session, resets on reload) and IndexedDB persistence added as a follow-on. The Tauri desktop path is the primary target.

- **[V4 correctness verification]** Although the reference confirms the `stability * sinc` multiply, the *parameter mapping* into `interval_v4` (which argument is `p1` vs `p2` etc.) must match the reference exactly. → *Mitigation:* The repo already has a pinned test `ref_compute_next_interval_v4_v6_fallback` asserting `v4 == 33.54` for known inputs; keep and extend it. Add a few more V4 cases computed directly from `precision_reference.py` to pin the parameter mapping.

## Migration Plan

1. **Migration `057_add_precision_matrices`** — additive `CREATE TABLE`. Zero downtime, zero data movement. Applied automatically on next app launch via `run_migrations`.
2. **Code change** — remove V2/V6 dispatch (hardcode V4), delete FSRS branch, wire matrix load/persist into `apply_precision_review`. Shipped in the same release as the migration.
3. **Rollback** — if V4 intervals are found unacceptable, revert the code change; the `precision_matrices` table is harmless to leave in place (or drop manually). Existing `learning_items` rows are unaffected because no `learning_items` schema changed.

## Open Questions

- **Should `interval_v2` / `interval_v6` and their constants be deleted too?** Decision 1 leans yes (V4 is the only path), but confirm during implementation that nothing outside the Plethora Precision module imports them. The `classic` algorithm uses `classic::ClassicAlgorithm`, not `precision::interval_v2`, so they're likely pure dead code after the change. (Resolve at task time; either way is safe.)
- **Browser-backend matrix persistence.** Decision 3 defers IndexedDB persistence for the PWA path. Confirm with the user whether the PWA learning-across-sessions gap is acceptable for v1 or blocks release. (Likely acceptable given desktop is primary.)
