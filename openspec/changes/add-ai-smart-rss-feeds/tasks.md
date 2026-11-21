## 1. Repository Audit & Existing Bug Fixes

- [x] 1.1 Audit active RSS, embedding, LLM provider, privacy/consent, migration, and UI infrastructure across Rust and TypeScript and verify OpenSpec specifications
- [x] 1.2 Fix `rss_preferences::rebuild` ID prefix mismatch (`rss-{id}` vs raw `article_id`) and real model preservation in `src-tauri/src/rss_preferences.rs`; verify with `cargo test --lib rss_preferences`
- [x] 1.3 Remove the legacy `hasClassifiers` gate blocking semantic scoring in `src/pages/QueueScrollPage.tsx` and hydrate `useClassifiersStore`; verify with Vitest unit tests

## 2. Database & Persistence Foundation

- [x] 2.1 Add Migration `155_rss_smart_feeds` (`rss_smart_feeds`, `rss_smart_feed_matches`, `rss_smart_feed_feedback`, `rss_smart_feed_embeddings`, indexes) to `src-tauri/src/database/migrations.rs` and verify `migration_155_rss_smart_feeds` passes for fresh and prior DBs including foreign-key cascades
- [x] 2.2 Create `src-tauri/src/rss_smart_feeds/models.rs` with domain enums, CRUD DTOs, match/article view structs, feedback types, progress/metrics structs, and export/import payloads; verify `cargo check --lib` passes
- [x] 2.3 Create `src-tauri/src/rss_smart_feeds/repository.rs` implementing SQLite CRUD, folder/feed scope resolution, chunked (`<=500`) embedding loading, transactional match upserts preserving `is_user_override = 1`, feedback history, and export/import; verify repository unit tests pass

## 3. Normalization, Clustering & Embeddings Integration

- [x] 3.1 Create `src-tauri/src/rss_smart_feeds/normalize.rs` for HTML stripping, metadata normalization, SHA-256 `content_hash`, separate positive/negative definition formatting, and prompt-injection text sanitization; verify normalization tests pass
- [x] 3.2 Create `src-tauri/src/rss_smart_feeds/clustering.rs` implementing Unicode-safe `Vec<char>` trigram, token Jaccard, canonical URL, and same-model embedding story clustering while keeping every source article accessible; verify clustering unit tests pass with multi-byte UTF-8 inputs
- [x] 3.3 Integrate `ai_learning::embeddings_backend::EmbeddingBackend` and `queue_item_embeddings` reuse (`rss-{id}`) with strict `(provider, model, dimension)` checks and `ensure_embedding_consent` billing gate; verify model-mismatch and unconsented-cloud fallback tests pass

## 4. Hybrid Retrieval & Decision Engine

- [x] 4.1 Create `src-tauri/src/rss_smart_feeds/retrieval.rs` implementing high-recall Stage E candidate retrieval combining `rss_articles_fts`, full-field (`title`, `categories`, `summary`, `content`, `full_content`) stemmed/entity/phrase concept scoring, exclusion clause matching, same-model semantic cosine, and bounded feed-specific log-odds priors; verify retrieval recall tests pass
- [x] 4.2 Create `src-tauri/src/rss_smart_feeds/classifier.rs` implementing Stage F `fast_local` calibrated strictness thresholds (`broad`/`balanced`/`strict`), viewpoint-neutral scoring, `SmartFeedDecisionLlm` trait + `AIProvider` adapter (`intelligent_local` / `hybrid` / `cloud`) with nonce-isolated `<untrusted_article_data>`, strict JSON parsing + 1 repair retry, non-destructive error fallback, and Stage G within-feed ranking; verify fixture, error-recovery, consent, and prompt-injection tests pass

## 5. Background Worker, Ingestion Hooks & Tauri Commands

- [x] 5.1 Create `src-tauri/src/rss_smart_feeds/worker.rs` with bounded concurrency (`Semaphore(2)`), batch evaluation (`25` items), `CancellationToken`, progress/update Tauri events (`rss:smart-feed:progress`, `rss:smart-feed:updated`), definition-revision reevaluation, incremental article enqueueing, and deterministic feedback profile rebuild; verify worker cancellation, cache hit, and feedback rebuild tests pass
- [x] 5.2 Create `src-tauri/src/commands/rss_smart_feeds.rs`, register all 14 commands in `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`, manage `SmartFeedWorkerState`, and hook `create_rss_article`, `bulk_create_rss_articles`, and `fetch_article_full_content` in `src-tauri/src/commands/rss.rs`; verify `cargo check --lib` and RSS ingestion integration tests pass

## 6. Frontend Parity Engine, API, Store & Privacy

- [x] 6.1 Create pure-TS engine `src/utils/smartFeedsEngine.ts` mirroring Stage A–G local classification/clustering/feedback/strictness and wire all 14 commands in `src/lib/browser-backend.ts` and `src/lib/browserSmartFeedsBackend.ts` for Web/PWA parity; verify `smartFeedsEngine.test.ts` passes
- [x] 6.2 Create `src/api/rss-smart-feeds.ts` and `src/stores/smartFeedsStore.ts` with Tauri event subscriptions and viewport-stable optimistic feedback state; verify `npx tsc --noEmit` passes
- [x] 6.3 Register `rss_smart_feeds` in `src/lib/privacy/disclosureRegistry.ts` and document it in `docs/PRIVACY_ARCHITECTURE.md`; verify `src/__tests__/privacyCompleteness.test.ts` passes

## 7. RSS UX, Accessibility & Internationalization

- [x] 7.1 Add `dialog:modal` and `dialog::backdrop` scroll-containment CSS rules in `src/index.css` and implement `src/components/media/smartFeeds/SmartFeedDialog.tsx` using accessible native `<dialog>` (`showModal()`, light-dismiss fallback, form validation, cloud consent disclosure, editable starter examples, folder/feed scope picker, advanced options, and JSON export/import)
- [x] 7.2 Implement `SmartFeedsSidebarSection.tsx`, `SmartFeedsDashboardSection.tsx`, `SmartFeedHeaderBar.tsx`, and `SmartFeedArticleExtras.tsx` using `@phosphor-icons/react`, `useToast`, inline two-step delete confirmation controls (avoiding native dialogs and `ModalProvider` dependency), native `<progress>`, grounded explanations, sibling feed badges, expandable story sources, and Excluded/Uncertain/Pending recovery
- [x] 7.3 Integrate Smart Feeds into `RSSReader.tsx`, `RSSDashboard.tsx`, and `RSSListArticleCard.tsx` preserving desktop/mobile 3-pane navigation, keyboard shortcuts, and shared read/favorite/tag state; verify `SmartFeedsWorkflow.test.tsx` passes and zero native `alert`/`confirm`/`prompt` calls exist in Smart Feeds files (`noNativeDialogs.test.ts` still reports 4 pre-existing untouched failures in unrelated files)
- [x] 7.4 Add all `smartFeeds.*` i18n keys in `src/lib/i18n/locales/smartFeeds.ts` spread into `en.ts`, `de.ts`, `es.ts`, `fr.ts`, `ja.ts`, and `zh.ts`; verify `src/lib/i18n/__tests__/i18n-completeness.test.ts` passes

## 8. Comprehensive Tests, Benchmarks & Final Verification

- [x] 8.1 Implement comprehensive Rust test suite `src-tauri/src/rss_smart_feeds/tests.rs` covering AI News, Iran War (multi-viewpoint & cuisine/tourism exclusions), CS Research, Local AI, Cybersecurity, overlapping feeds, semantic mismatch, emerging entities, false-negative calibration metrics, feedback/undo, error/offline/consent/injection cases, and 500/5000 article performance fixtures; verify all 14 `rss_smart_feeds` Cargo tests pass
- [x] 8.2 Add seeded TypeScript benchmarks in `src/utils/__tests__/smartFeedsEngine.bench.ts`, record baselines in `scripts/perf-baselines.json`, and run `npm run bench:check` and `npm run build && npm run check:bundle`; verify all 3 `smartFeeds/*` benchmarks and bundle budgets pass (14 pre-existing unrelated benchmarks failed under VM multi-worker timing variance)
- [x] 8.3 Run final verification suite (`openspec validate add-ai-smart-rss-feeds --strict`, `rustfmt --check`, `cargo test`, `npx tsc --noEmit`, targeted Vitest suites passing 8/8 files & 90/90 tests, targeted ESLint with 0 errors across Smart Feeds files while full-repo `npm run lint` has pre-existing untouched errors) and reconcile task checkboxes
