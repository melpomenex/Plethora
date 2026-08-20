## 0. Dependency gates

Do not start schema consumers until #1 profile scope and #2 analysis spans/versioning are stable. Coordinate the lookup-history migration with `unify-selection-dictionary-lookup`; downstream #4, #5, #6, #9, #10, #11, and #12 must use these repository APIs.

## 1. Schema and domain model

- [ ] 1.1 Define lexical entry, surface form, analysis, phrase reference, occurrence, source-anchor, evidence, and orphan-state types.
- [ ] 1.2 Add SQLite migrations/tables/indexes for profile-scoped lexicon, occurrences, lookup events, analysis versions, and optional compact context references.
- [ ] 1.3 Add repository CRUD/upsert/batch/page methods with transactional aggregate updates and deletion policy.

## 2. Migration and APIs

- [ ] 2.1 Implement migration from `plethora-vocabulary-history` preserving counts/timestamps/source IDs and supporting an unmapped legacy bucket.
- [ ] 2.2 Add Tauri commands and TypeScript API clients for entry/occurrence queries, encounter batches, lookup recording, examples, and user overrides.
- [ ] 2.3 Add backup/export/import/sync serializers with bounded occurrence paging and privacy controls.

## 3. Ingestion and integration

- [ ] 3.1 Add a background encounter queue with coalescing, retry, cancellation, and Queue-safety guards.
- [ ] 3.2 Wire Dictionary Peek and future processor results into lexical entry/lookup/occurrence upserts.
- [ ] 3.3 Add source-anchor adapters for EPUB, PDF fixed/reflow, HTML/Markdown/article, transcript, audio, and video.

## 4. Tests and performance

- [ ] 4.1 Test lemma identity, surface preservation, low confidence, duplicate encounters, deletion/orphaning, profile isolation, and migration.
- [ ] 4.2 Test bounded paging and one-million-occurrence fixture queries with SQLite indexes.
- [ ] 4.3 Verify no lookup/encounter path creates cards or changes Queue/review/reading position.
