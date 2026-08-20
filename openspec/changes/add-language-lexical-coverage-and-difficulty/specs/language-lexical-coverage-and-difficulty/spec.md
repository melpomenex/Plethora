# Spec: language-lexical-coverage-and-difficulty

## ADDED Requirements

### Requirement: Profile-specific coverage

For a profile-associated document, the system SHALL calculate lexical coverage from that profile's current knowledge state and analysis, not only document CEFR/frequency metadata. The result SHALL include total counted tokens/words, known, learning, familiar, new/unknown, and unresolved counts where applicable.

#### Scenario: Spanish summary
- **WHEN** a document has 2,184 counted tokens for a Spanish profile
- **THEN** the UI can show coverage percentage and state counts whose denominator and freshness are explicit

### Requirement: Linguistic accounting policy

Coverage SHALL define deterministic treatment for inflections/lemmas, phrases, repeated forms, proper nouns, numbers, punctuation, ignored terms, and low-confidence tokens. It MUST NOT count punctuation as unknown vocabulary.

#### Scenario: Inflected known lemma
- **WHEN** `hablando` maps confidently to a Known `hablar` entry
- **THEN** it contributes according to the profile policy as known while preserving surface/analysis diagnostics

### Requirement: Difficulty bands

The system SHALL map coverage and supporting signals such as unresolved density, phrase difficulty, and document length into configurable/data-driven bands equivalent to Very easy, Comfortable, Productive challenge, Difficult, and Very difficult. It SHALL show method/freshness and avoid pretending a band is universal truth.

#### Scenario: Threshold change
- **WHEN** the user changes profile coverage thresholds
- **THEN** cached labels invalidate/recompute without rewriting source documents or lexical states

### Requirement: Lazy/background processing

Coverage calculation SHALL be lazy/background/chunked, cancellable, cacheable, and non-blocking for document open. Pending, stale, unavailable, and failed states SHALL be distinguishable.

#### Scenario: Open before analysis
- **WHEN** a large EPUB is opened with no coverage result
- **THEN** it opens normally, shows pending coverage, and calculates in background

### Requirement: Incremental invalidation

Changing one lexical state SHALL invalidate only affected coverage projections/documents/chunks where possible; content, processor, lexicon version, policy, and threshold changes SHALL invalidate the appropriate cached result.

#### Scenario: One word state change
- **WHEN** one lemma changes from Learning to Known
- **THEN** affected summaries update without rescanning unrelated documents

### Requirement: Queue and metadata integration

Coverage SHALL be available in document metadata, dashboards, sorting/filtering, and an optional Queue strategy such as a preferred band. It MUST remain one input to existing Queue priority/scheduling and MUST NOT auto-dismiss or reschedule items.

#### Scenario: Preferred band
- **WHEN** a learner selects 92–98% known material
- **THEN** Queue may rank eligible documents using that signal while due/review/explicit priority semantics remain intact

### Requirement: Unsupported/ambiguous language behavior

If lemma/morphology/phrase capabilities are unavailable, exact-form accounting MAY continue and unresolved counts SHALL be visible. The calculator SHALL not invent analyses or block reading.

#### Scenario: Exact-form fallback
- **WHEN** an unsupported language has tokenization but no lemmatizer
- **THEN** coverage uses exact forms with an explicit method label and no fabricated lemma mapping

### Requirement: Privacy and deletion

Coverage projections SHALL be profile/document-version scoped, exportable/deletable as derived data, and SHALL preserve generic document and reading data when a profile is removed.

#### Scenario: Profile removed
- **WHEN** a profile is deleted
- **THEN** its coverage rows are removed or exported by policy and the document remains readable/queueable normally
