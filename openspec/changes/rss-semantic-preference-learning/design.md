# Design — RSS Semantic Preference Learning

## Context

Live ranking is `src/utils/rssRelevance.ts` `scoreRssRelevance()` (classifier keyword match + tag frequency + recency) applied at queue assembly in `QueueScrollPage`. Thumbs write `rss_classifiers` rows (author/tag rules) via `useTrainFeedback`. A complete Rust engine `src-tauri/src/algorithms/relevance.rs` (cosine, centroids, composite scoring, weight redistribution, 25 tests) is not declared in `algorithms/mod.rs` and never runs. Embeddings: `queue_item_embeddings` (item_id `rss-<id>`, content hash, provider/model/dim), providers include local Ollama; `embed_queue_items` exists. No article-level feedback rows; no persisted centroids.

## Goals / Non-Goals

**Goals:** 👍/👎 produce semantic preference that transfers across author/source/tags; hybrid ranking with decay + implicit engagement + exploration; cold start unchanged; undo; explainability; deterministic behavioral tests; local-first.

**Non-Goals:** server-side ranking/sync of preference profiles (local device only in this change); "why?" refinement questionnaire; re-ranking the active viewport.

## Decisions

1. **Source of truth = feedback events, clusters = derived cache.** New tables:
   - `rss_article_feedback(id, article_id UNIQUE, sentiment TEXT CHECK like|dislike, feedback_source TEXT, created_at)` — replaces-on-toggle (one row per article; re-toggle updates sentiment; undo deletes).
   - `rss_preference_clusters(id, sentiment, centroid_sum BLOB, centroid_norm REAL, weight REAL, last_updated, exemplar_article_id, exemplar_title, dim INTEGER, model TEXT)` — derived; rebuildable from feedback + embeddings.
2. **Cluster maintenance in Rust** (`src-tauri/src/rss/preferences.rs`), reusing `relevance.rs` math (register `pub mod relevance;`). Algorithm: for feedback on article A with embedding e (fetched from `queue_item_embeddings`, computed on demand via existing embed path using configured provider):
   - decay existing same-sentiment clusters by `λ^Δdays` (half-life 45d) applied to `weight` and `centroid_sum`;
   - if `cos(e, c) ≥ 0.62` for the strongest cluster c → merge (weighted incremental mean);
   - else create cluster (cap 8 per sentiment; on overflow merge the two weakest by weight);
   - opposite-sentiment toggle removes/rebuilds.
   Rebuild command recomputes all clusters from feedback table (used by undo and integrity repair).
3. **Scoring API**: `get_rss_preference_profile` returns normalized per-sentiment clusters (vectors + weights + exemplars) + total weights. TS `scoreRssRelevance` extension (keeps existing signature, adds optional `semantic` input): fetch profile once per queue assembly; per article with cached embedding compute `pos = Σ wᵢ·max(cos,0)`, `neg` likewise; `semantic = clamp(0.5 + 0.5·(pos − neg), 0, 1)` when total weight ≥ cold-start threshold (else `undefined` → old behavior). Composite: `0.55·base + 0.45·semantic` (weights in `rssQueue` settings, testable). Articles without embeddings score on metadata only (base), so ranking never blocks on embedding.
4. **Exploration**: after scoring, a deterministic fraction of slots (default 12%) reserved for items with low personalized score but high recency/novelty (unseen feed), selected by seeded shuffle — keeps serendipity without random viewport churn. Implement as stable bonus to `novelty` term, not post-hoc reorder.
5. **Implicit engagement**: `saved` (is_queued) adds +0.08; deep-read time from existing stats is surfaced later (MVP: saved only) — keeps scope tight, no new tracking.
6. **Feedback UX wiring**: `handleQuickTrain` keeps classifier write (compat) and additionally invokes `set_rss_article_feedback(articleId, sentiment)`; undo path (`useTrainFeedback`) calls it with remove. Command internally ensures the article embedding exists (bounded: embed single article, skip silently on provider failure — profile updates on next successful embedding via retry queue flag).
7. **Explainability**: profile exposes exemplar titles; `RelevanceIndicator` tooltip shows "Because you liked articles like ‘<title>’" when semantic ≥ 0.6 and base < 0.6 (i.e., semantic drove the boost).
8. **Privacy**: embeddings via configured provider (Ollama default-friendly); no new disclosure needed when provider is local; when a cloud embedding provider is configured the existing AI disclosure/settings govern. Profile rows are device-local; included in app-state export via existing RSS data path if present, otherwise documented as local-only.
9. **Tests**: Rust unit tests for cluster merge/decay/cap/rebuild with fixture vectors (pure math, no providers). TS behavioral tests with fixture embeddings for the scenario matrix (transfer, negative, decay, exploration, cold start). E2E excluded; `embed` mocked.

## Risks / Trade-offs

- [Cold embeddings missing] → semantic term optional per article; ranking degrades gracefully to today's behavior.
- [Cluster drift] → rebuild from feedback table is idempotent; run after undo/bulk deletes.
- [Perf] → profile fetched once per assembly; per-article cosine is O(items × clusters ≤ 16) — negligible; embeddings read from existing table, no re-embedding.
- [Over-personalization] → exploration slot + cap on semantic weight blend (≤ 0.45).

## Migration Plan

Additive migration only; no data backfill needed (profile builds from first feedback). Rollback: ignore new tables.

## Open Questions

None blocking. Decay half-life and thresholds are settings-exposed constants, tunable later.
