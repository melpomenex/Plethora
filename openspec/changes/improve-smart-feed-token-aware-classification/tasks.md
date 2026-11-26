## 1. Audit & Laya Runtime Verification

- [x] 1.1 Audit `src-tauri/src/rss_smart_feeds/*`, `src-tauri/src/laya_runtime.rs`, `src-tauri/src/models/hf/laya_catalog.rs`, `src/components/media/smartFeeds/*`, and `openspec/changes/add-ai-smart-rss-feeds/`
- [x] 1.2 Verify pinned `laya[serve]==0.5.2` and `convaiinnovations/laya-typed-decisions` (`rl_agent_config.json`, `encoder/config.json`, `tokenizer/tokenizer.json`, `/v1/systemone`, `/v1/systemone/batch`, truncation metadata)

## 2. Token-Aware Laya Budgeting & Runtime Client

- [x] 2.1 Add `tokenizers` crate (`default-features = false, features = ["fancy-regex"]`) via `sfw cargo add` and create `src-tauri/src/rss_smart_feeds/laya_budget.rs` implementing exact Laya sequence layout, per-question head budgeting (`head_max_len = 256`), state room calculation (`max_len = 1024`), context prioritization, and fallback estimator
- [x] 2.2 Update `LayaSystemOneLlm` in `src-tauri/src/rss_smart_feeds/classifier.rs` to pass `"model": "typed-decisions"`, use `laya_budget`, inspect `usage.{state_tokens, state_tokens_dropped, truncated, truncated_questions}`, repack on unexpected truncation, and support `/v1/systemone/batch`

## 3. Content Normalization, Passage Chunking & Dual Retrieval

- [x] 3.1 Upgrade `src-tauri/src/rss_smart_feeds/normalize.rs` with `ContentProvenance`, paragraph/heading preservation, RSS boilerplate stripping, and full-text `content_hash`
- [x] 3.2 Create `src-tauri/src/rss_smart_feeds/passages.rs` implementing deterministic, Unicode-safe, token-aware passage chunking with overlap and `section_heading` / `start_char` / `end_char` provenance
- [x] 3.3 Implement feed-conditioned dual passage retrieval (positive/supporting + negative/contradictory/exclusion + diversity-aware Jaccard dedup + lexical fallback) in `passages.rs` / `retrieval.rs`

## 4. Adaptive Routing, Multi-Passage Evaluation & Document Aggregation

- [x] 4.1 Add `EvaluationDepth` (`fast`, `adaptive`, `thorough`) and diagnostic/provenance structs to `src-tauri/src/rss_smart_feeds/models.rs`
- [x] 4.2 Improve initial routing (`should_escalate_to_laya`) in `classifier.rs` / `worker.rs` to catch borderline, conflicting, and summary-vs-body discrepancies without uncontrolled inference
- [x] 4.3 Implement Stage B -> Stage C -> Stage D multi-passage Laya evaluation (with `centrality` typed question) and document-level aggregation (topical centrality gate, exclusion dominance, strictness calibration) in `classifier.rs` & `worker.rs`
- [x] 4.4 Generate deterministic, article-grounded explanations citing supporting/contradictory passage excerpts, evaluation depth, passages evaluated, and truncation status

## 5. Additive Database Migration & Caching

- [x] 5.1 Add Migration `161_smart_feed_passages_and_diagnostics` in `src-tauri/src/database/migrations.rs` (`rss_article_passages`, `rss_article_passage_embeddings`, `evaluation_depth`, match diagnostic columns)
- [x] 5.2 Update `src-tauri/src/rss_smart_feeds/repository.rs` to persist/query passages, lazy passage embeddings, and match diagnostics while preserving `is_user_override = 1` and bumping `CLASSIFIER_VERSION` to `"smart-feed-v2"`

## 6. Frontend API, Diagnostics UI, Web/PWA Parity & i18n

- [x] 6.1 Update `src/api/rss-smart-feeds.ts`, `src/utils/smartFeedsEngine.ts`, and `src/components/media/smartFeeds/SmartFeedDialog.tsx` with `evaluation_depth` and new diagnostic fields
- [x] 6.2 Update `src/components/media/smartFeeds/SmartFeedArticleExtras.tsx` and `src/lib/i18n/locales/smartFeeds.ts` to display grounded passage evidence, content provenance, passages evaluated, truncation status, and collapsible diagnostics

## 7. Comprehensive Automated Tests & Benchmarks

- [x] 7.1 Add unit & integration tests in `src-tauri/src/rss_smart_feeds/tests.rs` covering token budgeting, chunking, dual retrieval, routing, topical centrality aggregation, caching/invalidation, privacy/security, and live/mocked Laya end-to-end flows
- [x] 7.2 Extend `scripts/bench-decision-models/` with a multi-topic Smart Feed classification benchmark dataset and run baseline vs. improved comparisons (including live Laya evaluation)
- [x] 7.3 Run `cargo test`, `npx tsc --noEmit`, targeted Vitest/ESLint checks, `openspec validate improve-smart-feed-token-aware-classification --strict`, and reconcile all task checkboxes
