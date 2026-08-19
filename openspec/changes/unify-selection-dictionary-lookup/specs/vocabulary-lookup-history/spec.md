# Spec Delta: vocabulary-lookup-history

## ADDED Requirements

### Requirement: Local vocabulary lookup recording
The system SHALL record dictionary lookups in a local persisted store capturing, per word: lookup count, first and last lookup timestamps, and the source document identifier when available. The store SHALL be size-bounded with least-recently-used eviction and SHALL NOT record surrounding passage text or full document content.

#### Scenario: Repeated lookups increment the count
- **WHEN** the user looks up `perspicacious` three times across sessions
- **THEN** the store holds one entry for the word with lookup count 3 and an updated last-seen timestamp

#### Scenario: Store survives restart
- **WHEN** the app is restarted after lookups were recorded
- **THEN** the recorded vocabulary history is still available locally without any network or account dependency

### Requirement: Lookups never create learning items automatically
Recording a vocabulary lookup MUST NOT create flashcards, extracts, queue items, or any other learning item, and MUST NOT insert words into spaced repetition or the review queue. Conversion of looked-up words into learning items SHALL require explicit user action.

#### Scenario: Lookup does not pollute the queue
- **WHEN** a user looks up several words while reading
- **THEN** no learning items are created and the review queue and schedule are unchanged

### Requirement: Extension point for future vocabulary mode
The vocabulary history store SHALL expose a readable API sufficient for a future Vocabulary review surface (list words with counts and recency), and this change SHALL NOT build any vocabulary management UI.

#### Scenario: Future surface can read history
- **WHEN** a future feature lists looked-up words ordered by recency or count
- **THEN** it can do so from the store API without schema changes
