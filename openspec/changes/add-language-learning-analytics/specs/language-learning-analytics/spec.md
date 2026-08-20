# Spec: language-learning-analytics

## ADDED Requirements

### Requirement: Profile-scoped metric definitions

Language analytics SHALL be keyed by Language Profile and SHALL use a versioned metric catalog defining numerator, denominator, source events, time zone, and freshness. Application locale and unassociated content MUST NOT change the target profile's metrics.

#### Scenario: Spanish weekly view
- **WHEN** the user views the Spanish profile for the current week
- **THEN** metrics include only events attributed to that profile and show their data range/freshness

### Requirement: Vocabulary and exposure metrics

The system SHALL support known/familiar/learning/new lemmas, encounters, unique lemmas, document count, lookup count, tokens/words read, lookups per 1,000 words, and movement between states where evidence is available.

#### Scenario: State movement
- **WHEN** 12 Spanish lemmas move from Learning to Known through manual actions
- **THEN** the profile trend records the movement without double-counting cached renders

### Requirement: Activity metrics

The system SHALL support reading sessions/time/tokens, listening time/sentences, and nullable speaking/writing output metrics as those practice features are installed. Missing capability/data SHALL be labeled unavailable, not zero activity.

#### Scenario: No speaking feature
- **WHEN** the build has no speaking practice records
- **THEN** speaking analytics show unavailable/not yet measured rather than claiming zero speaking

### Requirement: Active/passive evidence

Analytics SHALL distinguish passive recognition evidence from active production evidence and SHALL expose the evidence sources/confidence used for estimates.

#### Scenario: Dictation evidence
- **WHEN** a learner correctly recognizes a word in reading but misses it in dictation
- **THEN** passive and active evidence are reported separately and the discrepancy is visible to future recommendations

### Requirement: Coverage/difficulty integration

When current lexical coverage data exists, analytics SHALL support coverage trends, per-document difficulty, and lookup/unknown density. Stale or pending coverage SHALL be represented explicitly.

#### Scenario: Pending backfill
- **WHEN** a document has not completed lexical analysis
- **THEN** its coverage contribution is marked pending and does not silently lower the profile average

### Requirement: Background aggregation and scale

Analytics queries SHALL use indexed aggregates or paged queries, process large occurrence/event sets incrementally, and avoid loading raw corpus data into reactive frontend state.

#### Scenario: Large history
- **WHEN** a profile has years of encounters
- **THEN** a monthly chart loads from bounded aggregates without scanning/rendering every occurrence in the UI

### Requirement: Offline/privacy/export

Core analytics SHALL work offline from local data. Analytics storage SHALL support deletion/export/retention controls and SHALL not transmit raw source passages to an analytics provider.

#### Scenario: Delete profile analytics
- **WHEN** a user deletes a language profile and confirms removal of derived analytics
- **THEN** profile-scoped aggregates are removed/exported according to the choice while generic reading data remains

### Requirement: Generic analytics regression safety

Adding language dimensions MUST NOT change unfiltered generic review/reading analytics or Queue/scheduler behavior.

#### Scenario: Generic dashboard
- **WHEN** no language profile filter is selected
- **THEN** existing dashboard totals retain their prior semantics
