## Why

Plethora's existing RSS reader supports author/title/tag classifiers, Reading Lists over manually selected feeds, and a global thumbs-up/down semantic preference profile, but it cannot automatically curate incoming articles across subscriptions for an arbitrary natural-language topic (such as "AI News", "Iran War", or "Computer Science Research") with negative exclusions and explainable inclusion/exclusion decisions. Furthermore, `QueueScrollPage` currently gates semantic RSS ranking behind legacy classifiers, and `queue_item_embeddings` are only populated reactively on explicit thumbs or Semantic Graph actions rather than proactively on article arrival. Users need **Smart Feeds**: persistent, topic-specific virtual RSS collections defined in natural language that continuously evaluate incoming and existing articles using a hybrid local-first pipeline, learn per-feed corrections without polluting global preferences, and never hide or duplicate underlying subscriptions.

## What Changes

- **Persistent Smart Feed Data Model (SQLite migration `155_rss_smart_feeds`)**:
  - Add `rss_smart_feeds`, `rss_smart_feed_matches`, `rss_smart_feed_feedback`, and `rss_smart_feed_embeddings` tables with compound keys, foreign-key cascades (deleting a Smart Feed never deletes `rss_articles`), revision tracking, and model provenance.
- **Hybrid Multi-Stage Curation Engine (`src-tauri/src/rss_smart_feeds/`)**:
  - **Stage A (Normalization)**: HTML stripping, metadata normalization, and deterministic SHA-256 `content_hash` snapshots over title, summary, body, full content, author, and categories.
  - **Stage B (Story Clustering)**: Unicode-safe trigram + token Jaccard + embedding similarity grouping of duplicate and same-story coverage within Smart Feeds, keeping all source articles directly reachable.
  - **Stages C & D (Embedding Reuse & Separate Positive/Negative Profiles)**: Reuse `queue_item_embeddings` (`rss-{article_id}`) and `ai_learning::embeddings_backend::EmbeddingBackend` (`OnDeviceLive`, `Ollama`, `Cloud` with billing consent, `Mock`) with strict `(provider, model, dimension)` matching; maintain separate positive, negative, `feedback_pos`, and `feedback_neg` vectors in `rss_smart_feed_embeddings`.
  - **Stage E (High-Recall Hybrid Candidate Retrieval)**: Combine FTS5 (`rss_articles_fts`) with in-scope lexical/phrase/entity/stem concept retrieval and semantic vector similarity so emerging entities and articles matching only in `summary`, `full_content`, or `categories` are retained.
  - **Stages F & G (Structured Decision Model & Within-Feed Ranking)**: Support four classification modes (`fast_local` default, `intelligent_local` via local Ollama, `hybrid` sending only `UNCERTAIN` candidates to explicitly consented cloud LLM, and `cloud` with explicit per-feed consent), three calibrated strictness levels (`broad`, `balanced`, `strict`), viewpoint-neutral prompt-injection-hardened LLM JSON evaluation with single retry and non-destructive failure recovery (never turning errors into `EXCLUDE`), grounded explanations, and within-feed ranking decoupled from global likes/dislikes.
- **Continuous Background Updates & Incremental Reevaluation**:
  - Hook `create_rss_article`, `bulk_create_rss_articles`, and `fetch_article_full_content` in `src-tauri/src/commands/rss.rs` to trigger bounded, cancellable background evaluation across matching Smart Feeds without blocking UI or RSS ingestion.
  - Support initial backfill progress streaming (`rss:smart-feed:progress` / `rss:smart-feed:updated`), cancellation, definition-revision invalidation, and incremental reevaluation that preserves explicit user overrides (`is_user_override = 1`).
- **Existing Semantic Preference Reliability Fix**:
  - Fix `src-tauri/src/rss_preferences.rs::rebuild()` ID lookup (`article_id` vs `rss-{article_id}`) and real model provenance preservation.
  - Remove the legacy-classifier gate in `src/pages/QueueScrollPage.tsx` so `scoreRssRelevance` and semantic preference scores apply even when `classifiers` is empty, and hydrate `useClassifiersStore` on queue assembly.
- **Native RSS UX Integration & Web/PWA Parity**:
  - Add Smart Feeds sidebar section, Dashboard Smart Feed cards with progress/counts/empty state, Create/Edit Smart Feed dialog (accessible native `<dialog>`), Smart Feed header bar with `Matched` / `Uncertain` / `Excluded` / `Pending` buckets, sorting, story grouping toggle, "Why is this here?" / "Why excluded?" explanations, sibling Smart Feed badges, reversible feedback with Undo toast, and JSON export/import.
  - Provide pure-TypeScript parity fallback (`src/utils/smartFeedsEngine.ts` wired into `src/lib/browser-backend.ts`) so non-Tauri web/PWA sessions work honestly in lexical degraded mode.
- **Privacy Disclosure & Cloud Consent**:
  - Register `rss_smart_feeds` in `src/lib/privacy/disclosureRegistry.ts` and `docs/PRIVACY_ARCHITECTURE.md`, and enforce `paidEmbeddingsEnabled`, `strictLocalOnly`, `ensureCloudAiDisclosure`, and per-feed `cloud_consent_granted`.

## Capabilities

### New Capabilities
- `rss-smart-feeds`: User-defined, natural-language Smart Feeds with hybrid semantic/lexical curation, per-feed adaptive feedback, excluded-article recovery, story clustering, background backfill/refresh, privacy/consent controls, and RSS Dashboard/Reader integration.

### Modified Capabilities
- None (existing `rss-hybrid-ranking` behavior in `QueueScrollPage.tsx` and `rss-preference-profile` rebuild behavior in `rss_preferences.rs` are fixed to conform to their existing specifications without altering spec-level requirements).

## Impact

- **Backend Rust (`src-tauri/src/`)**: `database/migrations.rs` (migration `155_rss_smart_feeds`), new `rss_smart_feeds/` module (`models.rs`, `repository.rs`, `normalize.rs`, `clustering.rs`, `retrieval.rs`, `classifier.rs`, `worker.rs`, `tests.rs`), `commands/rss_smart_feeds.rs`, `commands/mod.rs`, `commands/rss.rs`, `rss_preferences.rs`, `lib.rs`.
- **Frontend (`src/`)**: `api/rss-smart-feeds.ts`, `stores/smartFeedsStore.ts`, `utils/smartFeedsEngine.ts`, `lib/browser-backend.ts`, `components/media/smartFeeds/*`, `components/media/RSSReader.tsx`, `components/media/RSSDashboard.tsx`, `components/media/RSSListArticleCard.tsx`, `pages/QueueScrollPage.tsx`, `lib/privacy/disclosureRegistry.ts`, `docs/PRIVACY_ARCHITECTURE.md`, `lib/i18n/locales/{en,de,es,fr,ja,zh}.ts`, `scripts/perf-baselines.json`.
- **Dependencies**: Zero new Cargo or npm dependencies required.
- **Compatibility**: Distinct from `curated_feeds.rs` / `rss_discovered_sites` (static feed discovery directory) and `rss_reading_lists` (static feed-ID groups); existing RSS tables, read/favorite state, and sync behavior remain non-destructively intact.
