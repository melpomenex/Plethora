# Spec: language-content-recommendations

## ADDED Requirements

### Requirement: Profile and interest scope

Recommendations SHALL target a selected Language Profile and may use explicit interests/preferences from the user's library/import settings. Application locale alone SHALL not select the target language.

#### Scenario: Spanish technology request
- **WHEN** a learner requests Spanish material about computer architecture
- **THEN** candidates are searched/ranked for Spanish and technology interest, with profile context visible

### Requirement: Candidate lifecycle and measured coverage

Candidates SHALL distinguish discovered metadata, text available, analyzed, ranked, accepted, and dismissed states. Lexical coverage/difficulty SHALL be shown only after sufficient text has been retrieved/analyzed; otherwise it SHALL be pending/unknown.

#### Scenario: Snippet-only result
- **WHEN** search returns only a title/snippet
- **THEN** the candidate does not claim a 95% coverage number and offers retrieve/analyze or remains pending

### Requirement: Ranking signals

Ranking MAY use learner interest, coverage-band distance, new-word/phrase density, length, source quality, recency, preferences, and library duplication. The result SHALL expose enough component explanation for the user to understand the recommendation.

#### Scenario: Explain recommendation
- **WHEN** a Spanish article is recommended
- **THEN** the UI can say it matches a technology interest and has measured Comfortable coverage, with freshness/source noted

### Requirement: User control and import

Users SHALL be able to inspect, accept/import, queue, dismiss, snooze, and report candidates. Accepted content SHALL use normal import/document/source provenance and MUST NOT be auto-imported without consent.

#### Scenario: Accept candidate
- **WHEN** the learner accepts a recommended podcast/article
- **THEN** it enters the existing import flow and retains source URL/metadata and profile association where selected

### Requirement: Queue integration

Recommendations MAY add an optional Queue composition/ranking signal such as a preferred coverage band, but SHALL not bypass due/review/explicit priority semantics, auto-rate, or create a separate backlog.

#### Scenario: Coverage band strategy
- **WHEN** the learner chooses 92–98% known material
- **THEN** eligible recommendation/import items may rank using that signal while generic Queue ordering rules remain intact

### Requirement: Duplication and stale analysis

The system SHALL detect existing library/source duplication and invalidate/recompute candidate coverage when source text, processor version, profile lexicon, or coverage policy changes.

#### Scenario: Known article duplicate
- **WHEN** a discovered URL matches an existing document by canonical URL/content fingerprint
- **THEN** it is labeled existing/duplicate and is not imported again by default

### Requirement: Provider/privacy/offline behavior

Configured content/search providers and cloud analysis SHALL use existing credentials/consent, disclose use, cache by source/config fingerprint, and send bounded content. Offline mode SHALL use existing library/cached candidates and label network discovery unavailable.

#### Scenario: Offline recommendations
- **WHEN** offline
- **THEN** cached/analyzed library candidates can be recommended and network sources show unavailable without breaking the Queue

### Requirement: Platform/accessibility

Recommendation explanations, filters, actions, loading/pending/error states, mobile touch, keyboard, screen reader, reduced motion, and e-ink presentation SHALL be usable.

#### Scenario: E-ink candidate
- **WHEN** recommendations open in e-ink mode
- **THEN** a text-first list shows language/coverage/freshness/explanation and actions without animation-heavy cards
