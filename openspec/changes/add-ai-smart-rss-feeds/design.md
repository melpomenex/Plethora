## Context

Plethora's active RSS implementation lives in `src-tauri/src/commands/rss.rs`, `src-tauri/src/commands/rss_features.rs`, `src-tauri/src/rss_preferences.rs`, `src/api/rss*.ts`, `src/components/media/RSSReader.tsx`, and `src/components/media/RSSDashboard.tsx` (note: `src-tauri/src/rss/` is uncompiled dead code). Existing personalization covers per-element classifiers (`rss_classifiers`), manual feed-ID `rss_reading_lists`, a static discovery catalog (`commands/curated_feeds.rs` + `rss_discovered_sites`), and global thumbs-up/down embedding clusters (`rss_preferences.rs`). See `proposal.md` for product motivation.

Repository constraints shaping this design:
- SQLite migrations reside inline in `src-tauri/src/database/migrations.rs` (latest: `154_guided_study_trails`), using `split_sql_statements`.
- Article embeddings for RSS/Queue reuse `queue_item_embeddings` (`item_id = "rss-{article_id}"`), while `ai_learning::embeddings_backend::EmbeddingBackend` unifies Android/iOS on-device bridges, local Ollama, Cloud providers, and deterministic test mocks.
- `rss_articles_fts` indexes `(title, content, author)` only, omitting `summary`, `full_content`, and `categories`.
- Existing `QueueScrollPage.tsx` gated `scoreRssRelevance` behind `classifiers.length > 0`, and `rss_preferences.rs::rebuild()` looked up unprefixed `article_id` against `rss-`-prefixed `queue_item_embeddings`.
- Desktop/mobile run via Tauri IPC; Web/PWA sessions run through `src/lib/browser-backend.ts`.

## Goals / Non-Goals

**Goals:**
- Deliver an end-to-end, local-first, multi-stage Smart Feeds curation pipeline in Rust (`src-tauri/src/rss_smart_feeds/`) with Tauri commands (`src-tauri/src/commands/rss_smart_feeds.rs`) and full TypeScript/React UX + pure-TS Web/PWA parity.
- Keep all Smart Feed membership non-destructive over `rss_articles` (zero duplicated articles; shared read/favorite/tag/annotation state).
- Enforce strict embedding provenance matching `(provider, model, dimension)` and strict cloud/billing consent (`paidEmbeddingsEnabled`, `strictLocalOnly`, `ensureCloudAiDisclosure`, per-feed `cloud_consent_granted`).
- Provide grounded explanations, reversible per-feed feedback with override precedence, excluded/uncertain/pending recovery, Unicode-safe story clustering, and measurable performance/accuracy benchmarks.

**Non-Goals:**
- Building an unrequested web crawler or auto-subscribing users to external feeds.
- Heavyweight neural fine-tuning on user feedback (use bounded exemplar centroids + smoothed log-odds lexical adaptation).
- Rewriting Study Plans source snapshots (keep existing `ensure_rss_article_document` bridge for individual articles; defer ongoing feed-level Study Plan binding to a separate follow-up).
- Wiring all legacy RSS tables into Sync v2 (design Smart Feeds tables compatibly with `BackupManager` SQLite `VACUUM INTO` and explicit JSON export/import; see sync governance notes below).

## Decisions

### 1. Multi-Stage Pipeline Architecture

```text
RSS Subscriptions (bulk_create_rss_articles / create_rss_article / fetch_article_full_content)
       │
       ▼
Stage A: Normalization & Content Hash (HTML strip, title + summary + body/full + categories + author -> SHA-256)
       │
       ▼
Stage B: Unicode-Safe Story Clustering (URL match, Unicode Vec<char> trigram >= 0.80, Jaccard >= 0.45, emb >= 0.90)
       │
       ▼
Stage C & D: Embeddings & Separate Profiles
  ├─ Article vectors cached in queue_item_embeddings ("rss-{id}") via EmbeddingBackend
  └─ Feed vectors in rss_smart_feed_embeddings (roles: positive | negative | feedback_pos | feedback_neg)
       │
       ▼
Stage E: High-Recall Hybrid Candidate Retrieval
  ├─ FTS5 (rss_articles_fts) + in-scope scan over title/categories/summary/body/full_content
  ├─ Topic-predicate vs entity specificity + exclusion-clause matching
  └─ Same-model cosine similarity (positive, negative, feedback centroids)
       │
       ▼
Stage F: Structured Decision Evaluation (INCLUDE | EXCLUDE | UNCERTAIN)
  ├─ Fast Local (default): calibrated hybrid score + strictness thresholds + bounded feedback
  ├─ Intelligent Local: Fast Local + local Ollama JSON adjudication for UNCERTAIN items
  ├─ Hybrid: Fast Local + consented Cloud LLM JSON adjudication for UNCERTAIN items
  └─ Cloud: Hybrid retrieval + consented Cloud LLM evaluation for retrieved candidates
       │
       ▼
Stage G: Within-Feed Ranking & Persisted Membership (rss_smart_feed_matches)
  └─ 0.62*relevance + 0.28*freshness + 0.10*feedback_lift -> RSS Dashboard / Sidebar / Reader
```

### 2. Database Schema & Migration (`155_rss_smart_feeds`)
- **`rss_smart_feeds`**: `id TEXT PK`, `name`, `description`, `inclusion_criteria`, `exclusion_criteria`, `source_scope` (`all` | `selected_feeds` | `selected_folders` | `external_discovery`), `source_scope_config` (JSON), `classification_mode` (`fast_local` | `intelligent_local` | `cloud` | `hybrid`), `curation_strictness` (`broad` | `balanced` | `strict`), `minimum_relevance REAL`, `freshness_window_days INTEGER`, `sort_order`, `group_similar_stories INTEGER`, `is_enabled INTEGER`, `cloud_consent_granted INTEGER`, `preferred_provider`, `preferred_model`, `definition_revision INTEGER DEFAULT 1`, `created_at`, `updated_at`, `last_evaluated_at`.
- **`rss_smart_feed_matches`**: `PRIMARY KEY (smart_feed_id, article_id)` with `ON DELETE CASCADE` to `rss_smart_feeds(id)` and `rss_articles(id)`; `decision` (`INCLUDE` | `EXCLUDE` | `UNCERTAIN` | `PENDING`); `relevance_score`; `ranking_score`; `decision_reason`; `matched_evidence` (JSON); `decision_source`; `content_hash`; `definition_revision`; `classifier_version`; `embedding_provider`; `embedding_model`; `evaluation_status` (`pending` | `completed` | `completed_lexical` | `deferred` | `error`); `error_message`; `is_user_override INTEGER DEFAULT 0`; `evaluated_at`.
- **`rss_smart_feed_feedback`**: `id TEXT PK`, `smart_feed_id`, `article_id`, `feedback_type` (`SHOULD_INCLUDE` | `SHOULD_EXCLUDE` | `UNDO`), `previous_decision`, `note`, `created_at`.
- **`rss_smart_feed_embeddings`**: `PRIMARY KEY (smart_feed_id, role)` (`positive` | `negative` | `feedback_pos` | `feedback_neg`), `definition_revision`, `provider`, `model`, `dimension`, `embedding BLOB`, `weight`, `content_hash`, `updated_at`.

*Alternative considered*: Storing matches as JSON on `rss_smart_feeds`. Rejected because SQLite relational joins and compound indexes (`idx_smart_feed_matches_feed_decision_rank`) scale to thousands of articles, enforce referential cascades, and allow single-article multi-feed lookup (`idx_smart_feed_matches_article`).

### 3. Resolutions to Core Architectural Questions (1–18)
1. **Rust vs. TS split**: Authoritative curation engine, persistence, embeddings, and LLM calls live in Rust (`src-tauri/src/rss_smart_feeds/`). A lean pure-TS engine (`src/utils/smartFeedsEngine.ts`) provides Web/PWA parity in `browser-backend.ts` and deterministic frontend unit/bench fixtures.
2. **Embedding reuse & index safety**: Reuse `queue_item_embeddings` (`rss-{article_id}`) and `ai_learning::EmbeddingBackend`. Similarity is computed strictly when `(provider, model, dimension)` match; mismatches skip vector comparison and queue re-embedding rather than mixing vector spaces.
3. **Local classifier choice**: Hybrid scoring combining same-model cosine similarity (positive centroid minus weighted negative centroid), multi-field lexical/stem/phrase BM25-like concept coverage, exclusion penalty, and bounded feedback adaptation (`±0.18` semantic centroid + `±0.12` smoothed log-odds lexical terms, damped by `min(feedback_count, 5)/5`). More interpretable, deterministic, and debuggable than opaque online SGD while avoiding overfitting on sparse feedback.
4. **Uncertainty handling**: Items falling between strictness `uncertain_floor` and `include_floor` become `UNCERTAIN` (surfaced in the dedicated Uncertain tab in Fast Local; routed to local Ollama in `intelligent_local` or consented cloud LLM in `hybrid`).
5. **High recall on emerging topics**: Stage E uses `rss_articles_fts` + full-field in-scope scanning (`title`, `categories`, `summary`, `content`, `full_content`) + stemmed tokens + capitalized entity tokens + phrase bigrams + embedding similarity, with a deliberately permissive candidate gate (`pos_semantic >= 0.26 || pos_lexical >= 0.10 || feedback_pos_sim >= 0.42`).
6. **Definition change behavior**: Editing definition/criteria/scope/strictness/mode/freshness increments `definition_revision` and clears `positive`/`negative` feed embeddings while preserving existing displayed matches until incremental reevaluation updates rows—and NEVER overwriting `is_user_override = 1` decisions.
7. **Override precedence vs. generalization**: Explicit user overrides set `is_user_override = 1` in `rss_smart_feed_matches` and append an immutable event to `rss_smart_feed_feedback`. Background evaluations skip overwriting `is_user_override = 1`, while `rebuild_feedback_profile` updates `feedback_pos`/`feedback_neg` centroids and damped lexical priors for future articles.
8. **Hundreds of simultaneous articles**: `bulk_create_rss_articles` commits articles and triggers a non-blocking worker pass that embeds each distinct new article once across all matching Smart Feeds, checks `(content_hash, definition_revision)` cache hits, runs O(N) local candidate filtering, and batches any required LLM adjudication.
9. **Minimizing LLM calls across overlapping feeds**: Local Stage E discards irrelevant pairs first; `fast_local` makes 0 LLM calls; `hybrid` sends only `UNCERTAIN` candidates; multi-feed LLM evaluation can group up to 5 overlapping feeds per article when sharing provider/model.
10. **Settings & provider coexistence**: Reuse `AIState`/`AIKeyStore` (`LLMProviderType`) and `EmbeddingConfigInput` (`useSettingsStore`). Do not duplicate provider forms or store secrets in Smart Feed rows.
11. **Model switch / disabling cloud**: Changing embedding model or provider triggers content/model staleness checks without crashing or cross-comparing vectors; disabling cloud consent blocks `cloud`/`hybrid` LLM calls cleanly (`deferred` / lexical fallback) rather than marking items `EXCLUDE`.
12. **Partial progress UI**: Native `<progress>` bar in Dashboard cards and Smart Feed header bar driven by `"rss:smart-feed:progress"` Tauri events, with Cancel button; already-evaluated matches appear as batches commit.
13. **False-negative recovery**: First-class `Matched | Uncertain | Excluded | Pending` tabs + inline search + grounded "Why excluded?" + one-click "Belongs in this feed" + Undo toast.
14. **Interaction with Folders, Reading Lists, Queue**: `selected_folders` resolves against `rss_folders`/`rss_feed_folders` (plus localStorage fallback if unmigrated); Reading Lists remain static feed-ID sets; Smart Feeds remain distinct virtual topic views; Queue assembly bug in `QueueScrollPage.tsx` (gating semantic scoring behind `hasClassifiers`) is fixed alongside `rss_preferences.rs::rebuild()`.
15. **Story clustering without hiding alternative views**: `clustering.rs` groups duplicates/same-story articles within a feed view into an expandable `"N sources covering this story"` disclosure retaining every source title, feed, timestamp, and reader action.
16. **Reused vs. new code**: Reused `rss_articles`, `rss_articles_fts`, `queue_item_embeddings`, `ai_learning::EmbeddingBackend`, `AIProvider`/`AIState`, `security::validate_url_not_private`, `RSSReader` reader pane, `RSSListArticleCard`, `useToast`, `useModal`, `cloudAiDisclosure`. New: `rss_smart_feeds` Rust engine, migration `155`, commands, TS parity engine, store, and Smart Feed UI components.
17. **Desktop / Mobile / Web parity**: Desktop & mobile (Android/iOS) run full Rust engine (with on-device EmbeddingGemma/Apple NL when available); Web/PWA routes through `browser-backend.ts` backed by `smartFeedsEngine.ts` + `localStorage` in honest lexical degraded mode. Mobile uses `useMobileShell()` 3-pane navigation cleanly.
18. **Objective metrics**: Deterministic Rust & Vitest fixture suites compute Precision, Recall, FP rate, FN rate across `broad`/`balanced`/`strict`, plus `vitest bench` cost ratios recorded in `scripts/perf-baselines.json`.

### 4. Security & Privacy Hardening
- Article content passed to any LLM is stripped of control chars/delimiter breakouts and wrapped inside `<untrusted_article_data nonce="<16-hex>">...</untrusted_article_data>` with an explicit system directive forbidding tool execution or schema overrides.
- `IntelligentLocal` restricts execution to loopback/local Ollama endpoints; `Hybrid`/`Cloud` require both `feed.cloud_consent_granted == true` and `!strict_local_only` (plus `ensureCloudAiDisclosure` in UI), transmitting only the active Smart Feed's topic definition and the candidate article's title/summary/bounded excerpt.
- Cloud embedding providers require `paidEmbeddingsEnabled == true` via `ensure_embedding_consent`; otherwise Smart Feeds automatically fall back to local on-device or lexical evaluation.

### 5. Sync, Backup & Portability
- Full database backups (`BackupManager` `VACUUM INTO` + restore) automatically cover all four `rss_smart_feeds*` tables.
- Explicit JSON export/import commands (`export_rss_smart_feeds`, `import_rss_smart_feeds`) serialize feed definitions, criteria, and non-secret settings (never API keys).
- Derived match rows (`rss_smart_feed_matches`) and embeddings (`rss_smart_feed_embeddings`) remain device-local per `openspec/specs/sync-coverage-governance/spec.md` (no bulky derived tables replicated over CRDT).

## Risks / Trade-offs

- **Risk**: Legacy `rss_articles_fts` lacks `summary`/`full_content`, so pure FTS queries miss summary-only terms → **Mitigation**: Stage E supplements FTS5 with in-scope scanning over normalized `title`, `categories`, `summary`, `content`, and `full_content`.
- **Risk**: Desktop without Ollama/cloud embeddings runs in lexical degraded mode → **Mitigation**: Disclose `"Lexical"` status clearly in UI, calibrate lexical-only thresholds separately for solid recall, and seamlessly upgrade to hybrid semantic+lexical whenever Ollama, on-device, or consented cloud embeddings become available.
- **Risk**: Single-connection `QueueScrollPage` / `RSSReader` bundle growth near `32 MB` total dist limit → **Mitigation**: Zero external packages added and keep Smart Feeds UI concise and lazy-dialog friendly; verify `npm run check:bundle`.

## Migration Plan

1. Append Migration `155_rss_smart_feeds` to `src-tauri/src/database/migrations.rs` (idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, guarded by `_schema_migrations`).
2. Existing RSS tables (`rss_feeds`, `rss_articles`, `rss_classifiers`, `rss_reading_lists`, `rss_article_feedback`, `rss_preference_clusters`) receive zero destructive DDL changes; rollback only requires dropping the 4 additive `rss_smart_feed*` tables if needed.
