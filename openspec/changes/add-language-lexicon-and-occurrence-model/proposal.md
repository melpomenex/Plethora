## Why

`vocabularyHistoryStore` records at most 2,000 lowercased lookup strings in localStorage and intentionally has no notion of lemma, occurrence, profile, or source anchor. It cannot support natural exposure, multi-million-token libraries, coverage, active/passive evidence, or reliable language-aware Dictionary Peek without replacing it with a durable lexical model.

## What Changes

- Add profile-scoped lexical entries for lemmas, exact forms, meanings, pronunciation, frequency, morphology, knowledge evidence, and user metadata.
- Add compact occurrence records for document/media sentence encounters with source anchors, timestamps, confidence, lookup/interaction flags, and optional media time.
- Add phrase-capable lexical identity hooks without making phrase discovery part of every token encounter.
- Migrate/reuse vocabulary lookup history and preserve lookup counts without creating cards automatically.
- Add indexed, paged SQLite APIs, background ingestion, retention/cleanup, and sync/backup rules.

## Dependencies

- Hard: `add-language-learning-profiles`, `add-language-processing-adapter-layer`.
- Soft: existing `unify-selection-dictionary-lookup`/`vocabulary-lookup-history`, `add-collections`, transcript/audio alignment.
- This proposal supersedes the localStorage persistence strategy but preserves its observable lookup-history behavior.

## Capabilities

### New Capabilities

- `language-lexicon-and-occurrences`: Durable lexical identity, occurrence storage, lookup migration, indexing, retention, and source recovery.

### Modified Capabilities

- `vocabulary-lookup-history`: Existing lookup events become a projection/compatibility view over the durable lexicon, with no automatic learning-item side effect.

## Impact

- SQLite migrations, Rust models/repositories/commands, TypeScript APIs and stores.
- Reader/transcript selection and background processing hooks.
- Backup/import/export, sync/account scoping, analytics consumers, and database performance.
- No source document mutation and no replacement SRS scheduler.
