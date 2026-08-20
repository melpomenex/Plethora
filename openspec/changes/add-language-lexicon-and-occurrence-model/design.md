## Context

The durable data plane is SQLite through the Rust repository; current frontend stores are appropriate for UI caches but not hundreds of thousands of occurrences. Existing documents, extracts, learning items, transcript segments, source anchors, and lookup history must remain compatible.

## Dependencies

- Hard: #1 language profiles and #2 processing adapters.
- Soft/coordination: active `unify-selection-dictionary-lookup`, `add-collections`, and future #13 audio alignment.
- #4 and all state/coverage/analytics/SRS consumers must wait for the lexical identity, occurrence, paging, and migration contracts.

## Goals / Non-Goals

**Goals:**

- Distinguish surface form, normalized form, lemma, lexical entry, analysis, phrase, and occurrence.
- Keep encounter writes cheap and idempotent enough for scrolling/playing.
- Support profile isolation, exact source recovery, paging, and incremental reprocessing.

**Non-Goals:**

- Automatically making every encounter an SRS card.
- Storing complete duplicate passages for every token.
- Replacing dictionary providers or implementing morphology in the database.

## Decisions

1. **Normalized relational core.** Use `language_lexical_entries`, `language_surface_forms`, `language_lexical_analyses`, and `language_occurrences`; use a separate phrase object extension. Keep lemma/display strings deduplicated and indexed by profile/language/normalized identity.
2. **Occurrence stores compact context references.** Store sentence/context IDs or bounded context hashes plus source anchors and optional short context text only when source recovery is impossible. Never duplicate a whole document per occurrence.
3. **Profile-scoped identity.** The same lemma in two profiles has independent state/evidence while language-level dictionary metadata may be shared through immutable provider records.
4. **Event-to-projection ingestion.** Reader/audio surfaces emit encounter events into a bounded queue; a transaction upserts the lexical entry/occurrence and aggregate counters. A repeated view of the same token may be coalesced by document/anchor/session window while retaining total exposure counts.
5. **Compatibility projection.** `vocabularyHistoryStore` reads a recent lookup projection and can continue serving cached UI while migration/backfill is incomplete; new lookups write the durable model first.

## Risks / Trade-offs

- [Token-level writes may be expensive] → Batch/coalesce events, index `(profile_id, document_id, encountered_at)`, and keep aggregate counters separate from the rendered state.
- [Wrong lemma merges distinct words] → Store processor/provider/version/confidence and preserve surface/analysis; allow user split/override later.
- [Source deletion] → Keep the lexical aggregate and mark occurrences orphaned or purge according to retention, never block profile analytics.
- [Sync volume] → Sync lexical aggregates and user overrides by default; make raw occurrences compact, paged, and optionally excluded with a documented rebuild path.

## Migration Plan

1. Add schema and repository with no reader writes.
2. Migrate localStorage lookup entries into profile-scoped exact-form entries after the user selects/creates a profile; retain an unmapped legacy bucket until then.
3. Start writing new lookup/encounter events and expose a compatibility list.
4. Backfill occurrences only for content opened/processed after opt-in; do not fabricate historic token encounters from lookup counts.

## Open Questions

- Whether raw occurrences should be included in cloud sync for privacy and size reasons.
- Exact retention defaults for low-value repeated encounters.
- Whether dictionary meanings belong in immutable provider snapshots or a user-editable profile table.
