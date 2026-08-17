## 1. Data layer (Rust)

- [x] 1.1 Migration: `rss_article_feedback` + `rss_preference_clusters` tables
- [x] 1.2 Declare `pub mod relevance;` in `algorithms/mod.rs`; fix any compile/test fallout (25 orphaned tests now run)
- [x] 1.3 `src-tauri/src/rss/preferences.rs`: incremental cluster update (merge/spawn/cap/decay) + full rebuild, reusing `relevance.rs` math; unit tests with fixture vectors
- [x] 1.4 Commands: `set_rss_article_feedback` (upsert/delete + ensure embedding via existing embed path + profile update), `get_rss_preference_profile`, `rebuild_rss_preference_profile`; web-mode HTTP fallbacks where the existing API pattern requires
- [x] 1.5 TS API wrappers (`src/api/rss-classifiers.ts` or new `rss-preferences.ts`) incl. browser/PWA fallback behavior consistent with existing web-mode degradation

## 2. Hybrid ranking (TS)

- [x] 2.1 Extend `scoreRssRelevance` with optional semantic term (profile clusters × cached embeddings), saved-bonus, novelty/exploration term; keep old behavior under cold start; unit tests
- [x] 2.2 QueueScrollPage wiring: fetch profile once per assembly; per-article embedding lookup via existing embeddings API; no active-viewport reshuffle
- [x] 2.3 `RelevanceIndicator` reason line from exemplars

## 3. Feedback UX

- [x] 3.1 `handleQuickTrain` dual-write (classifier + article feedback); undo path removes both and triggers profile update
- [x] 3.2 Verify persisted button state on revisit; immediate confirmation unchanged

## 4. Behavioral tests

- [x] 4.1 Fixture-embedding scenario matrix: liked-topic rise, disliked-topic fall, cross-author transfer, same-author-different-topic, decay, exploration surfacing, cold start

## 5. Validation

- [ ] 5.1 `cargo test` (rss + algorithms), `npm run test:run` new/updated suites, `npm run bench:check` for ranking-path perf
