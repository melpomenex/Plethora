# Spec: language-lexicon-and-occurrences

## ADDED Requirements

### Requirement: Lemma-aware lexical identity

The model SHALL distinguish surface form/token, normalized form, lemma, lexical entry, morphological analysis, phrase/lexical object, and occurrence. A lexical entry SHALL be scoped to a language profile and preserve processor/provider/version/confidence for derived identity.

#### Scenario: Inflected Spanish forms
- **WHEN** the processor identifies `hablando` and `habló` as forms of `hablar`
- **THEN** both occurrences preserve their exact surfaces and analyses while pointing to a lemma-aware lexical entry for `hablar` when confidence permits

#### Scenario: Low-confidence analysis
- **WHEN** the processor cannot confidently map a surface form to a lemma
- **THEN** the exact-form entry remains usable and no unverified lemma merge is treated as authoritative

### Requirement: Durable lexical fields and evidence

Lexical entries SHALL support lemma/canonical display, meanings/translations, POS, pronunciation, frequency/CEFR estimates when available, profile-scoped knowledge evidence, first/last encounter, encounter/document/lookup counts, review relationships, user notes, ignored/proper-noun flags, and active/passive evidence projections.

#### Scenario: Dictionary lookup enriches an entry
- **WHEN** a user looks up a new Spanish word
- **THEN** lookup count and provider metadata can be attached to the lexical entry without creating an SRS item

### Requirement: Compact occurrence provenance

An occurrence SHALL retain lexical entry ID, exact surface form, source document/media ID, sentence/context reference, source anchor where supported, encounter time, optional audio/video time, lookup/interaction flags, and processing confidence. It SHALL avoid unbounded duplicated passage blobs.

#### Scenario: EPUB occurrence recovery
- **WHEN** `hablando` is encountered in an EPUB
- **THEN** its occurrence can navigate back to its CFI/range and recover the exact sentence from source content

#### Scenario: Transcript occurrence
- **WHEN** a word occurs in a timestamped transcript
- **THEN** the occurrence may include segment/timestamp provenance for replay without copying the full transcript

### Requirement: Scalable durable storage

Lexical and occurrence data SHALL reside in SQLite or the repository's durable equivalent, with profile/language/document/lexical/time indexes and paged APIs. Reactive stores SHALL contain summaries or requested pages, not the full occurrence corpus.

#### Scenario: Large corpus query
- **WHEN** a profile has one million occurrences
- **THEN** recent occurrences, a word's examples, and aggregate counts can be queried in bounded pages without loading all rows into localStorage or React state

### Requirement: Cheap, safe encounter ingestion

Natural exposure tracking SHALL be asynchronous, batchable, and safe to repeat. Encounter ingestion MUST NOT rate, advance, dismiss, postpone, or create a learning item for a Queue item unless a separate explicit action requests it.

#### Scenario: Scroll exposure
- **WHEN** a reader displays a sentence containing an untracked token
- **THEN** an encounter event may be queued/coalesced in the background while the reader remains responsive and Queue state is unchanged

### Requirement: Lookup-history migration

Existing localStorage lookup history SHALL be migrated or projected into the durable model without losing lookup count, first/last seen timestamps, or last source document where available. The old store MUST NOT remain the sole source for new lookups.

#### Scenario: Existing lookup migration
- **WHEN** a user with legacy vocabulary history creates a Spanish profile
- **THEN** legacy entries are offered/migrated into that profile or a clearly labeled unmapped bucket, and the compatibility list still shows them

### Requirement: Profile and document deletion behavior

Deleting a document SHALL not invalidate the lexical aggregate; its occurrences SHALL be marked orphaned or removed by policy. Deleting a profile SHALL remove or export profile-scoped lexical state only after confirmation and SHALL preserve generic document/learning-item data.

#### Scenario: Document deletion
- **WHEN** a source document is deleted
- **THEN** its lexical occurrence rows do not make the profile query fail, and aggregate known/learning counts remain coherent

### Requirement: Privacy and provider neutrality

Core identity, encounter, lookup, and manual state operations SHALL work without AI/dictionary credentials. Provider-derived meanings/analyses SHALL record provenance and be replaceable without deleting user state.

#### Scenario: No dictionary provider
- **WHEN** a user encounters an unsupported word offline
- **THEN** exact-form occurrence and manual state changes still work, while enrichment is marked unavailable
