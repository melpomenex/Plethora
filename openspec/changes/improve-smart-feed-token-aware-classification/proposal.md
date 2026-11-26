## Why

Plethora's Smart AI Feeds currently use Laya Typed Decisions (`laya[serve]==0.5.2`, `convaiinnovations/laya-typed-decisions`) in `intelligent_local` and `hybrid` modes, but the integration suffers from structural limitations that severely degrade accuracy on long-form, ambiguous, or narrowly defined RSS articles:

1. **Character-based truncation instead of model-token budgeting**: `LayaSystemOneLlm::build_request_body()` truncates article text to 1,400 characters and feed instructions to 1,600–1,800 characters without accounting for Laya's actual ModernBERT tokenizer, `max_len = 1024`, `head_max_len = 256`, special tokens (`[CLS]`, `[SEP]`, `[MASK]`), or per-question head budgets.
2. **RSS summary prioritization over full content**: `build_request_body()` prefers `summary_text` over `best_text`, preventing available full article content from reaching Laya when an RSS feed provides a short or misleading summary.
3. **Single-pass prefix-only evaluation**: Long articles are never chunked or evaluated across passages; relevant evidence or exclusion triggers later in an article are dropped.
4. **Silent runtime truncation & missing model routing**: `build_request_body()` omits `"model": "typed-decisions"` (causing offline 500 errors if `laya-serve` defaults to another checkpoint) and `parse_response()` ignores `usage.truncated`, `usage.state_tokens_dropped`, and `usage.truncated_questions`.
5. **Narrow uncertainty-only routing**: `worker.rs` only invokes Laya when `evaluate_fast_local()` returns `UNCERTAIN`, allowing weak or contradictory `INCLUDE`/`EXCLUDE` fast-local decisions to bypass Laya.
6. **Lack of topical centrality & grounded evidence**: Incidental mentions can trigger inclusion without document-level aggregation, and explanations cite generic scores rather than actual article passages, evaluated passage counts, or truncation status.

## What Changes

- **Verified Laya Runtime & Tokenizer Integration (`src-tauri/src/rss_smart_feeds/laya_budget.rs`)**:
  - Use the exact HuggingFace `tokenizer.json` from the verified `convaiinnovations/laya-typed-decisions` checkpoint (with deterministic fallback when no local checkpoint is installed) to compute exact head, metadata, and state token budgets against `max_len = 1024` and `head_max_len = 256`.
  - Pass `"model": "typed-decisions"` explicitly, prioritize instructions/criteria/title/evidence/summary/metadata without silently dropping exclusion criteria, and inspect `usage.truncated`, `usage.state_tokens_dropped`, and `usage.truncated_questions` with bounded repacking on unexpected truncation.
- **Content Provenance & Structure-Preserving Normalization (`normalize.rs`)**:
  - Preserve paragraph boundaries and section headings during HTML-to-text extraction, suppress common RSS boilerplate (cookie notices, newsletter prompts, related-article blocks), track `ContentProvenance` (`headline_only`, `summary_only`, `rss_embedded`, `full_extracted`, `partial`), and hash full normalized text.
- **Token-Aware Passage Chunking & Feed-Conditioned Retrieval (`passages.rs`)**:
  - Split articles deterministically at paragraph/sentence/heading boundaries into token-bounded overlapping passages (targeting ~350–500 state tokens per passage derived dynamically from Laya's remaining state room).
  - Retrieve both **positive/supporting** and **negative/contradictory/exclusion** passages using local embeddings (reusing `ai_learning::embeddings_backend::EmbeddingBackend` with lazy per-passage caching) and a deterministic lexical + structural fallback when embeddings are unavailable, with diversity-aware deduplication.
- **Adaptive Multi-Stage Classification & Document-Level Aggregation (`worker.rs`, `classifier.rs`)**:
  - Improve initial routing so weak, borderline, conflicting, or metadata-poor fast-local decisions escalate to Laya without uncontrolled inference volume.
  - Implement progressive depth (`Fast`, `Adaptive` default, `Thorough`): Stage A fast signals -> Stage B compact token-safe Laya decision -> Stage C multi-passage Laya evaluation (using `/v1/systemone/batch` where available) -> Stage D document-level aggregation modeling **topical centrality** (incidental mention vs. primary subject), exclusion applicability, and strictness (`broad` / `balanced` / `strict`).
- **Additive Persistence & Caching (Migration `161_smart_feed_passages_and_diagnostics`)**:
  - Add `rss_article_passages`, `rss_article_passage_embeddings`, and diagnostic columns on `rss_smart_feed_matches` (evaluation depth, content provenance, passages evaluated/total, inference calls, token usage, unexpected truncation flag, structured evidence JSON) without modifying or deleting existing RSS articles, Smart Feeds, or user overrides.
- **Evidence-Grounded Explanations & Diagnostics UI (`SmartFeedArticleExtras.tsx`, `SmartFeedDialog.tsx`, `src/api/rss-smart-feeds.ts`)**:
  - Surface grounded supporting/contradictory passage excerpts, evaluation depth selector, content provenance, passages evaluated, and collapsible technical diagnostics while preserving Web/PWA parity (`smartFeedsEngine.ts`) and local-only privacy guarantees.
- **Reproducible Quality & Performance Benchmarks (`scripts/bench-decision-models/`, `src-tauri/src/rss_smart_feeds/tests.rs`)**:
  - Add a multi-topic Smart Feed benchmark dataset (AI News, Iran War, Cybersecurity, Linux & Open Source, Semiconductor Industry, Philosophy, Scientific Research, Financial Markets) with difficult regression cases (incidental mentions, late-article evidence, misleading headlines, prompt injections) comparing Fast Local, single-pass Laya, and Adaptive multi-passage Laya.

## Capabilities

### New Capabilities
- None (extends `rss-smart-feeds`).

### Modified Capabilities
- `rss-smart-feeds`: Adds token-aware Laya context budgeting, structure-preserving normalization, token-aware passage chunking, positive/contradictory passage retrieval, adaptive classification depth, topical-centrality document aggregation, grounded passage evidence, additive passage caching, and classification diagnostics.

## Impact

- **Backend Rust (`src-tauri/src/`)**: `Cargo.toml` (`tokenizers` crate with `default-features = false, features = ["fancy-regex"]` via `sfw cargo add`), `database/migrations.rs` (migration `161_smart_feed_passages_and_diagnostics`), `rss_smart_feeds/` (`laya_budget.rs`, `passages.rs`, `models.rs`, `normalize.rs`, `retrieval.rs`, `classifier.rs`, `repository.rs`, `worker.rs`, `tests.rs`), `commands/rss_smart_feeds.rs`.
- **Frontend (`src/`)**: `api/rss-smart-feeds.ts`, `utils/smartFeedsEngine.ts`, `components/media/smartFeeds/SmartFeedArticleExtras.tsx`, `components/media/smartFeeds/SmartFeedDialog.tsx`, `lib/i18n/locales/smartFeeds.ts`.
- **Benchmarks**: `scripts/bench-decision-models/` extended with Smart Feed classification benchmark dataset and runner.
- **Compatibility**: Additive migration `161` preserves all existing Smart Feeds, matches, feedback, user overrides, and RSS articles; `evaluation_depth` defaults to `adaptive`; Web/PWA `smartFeedsEngine.ts` remains pure TypeScript without native assumptions.
