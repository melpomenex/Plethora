## ADDED Requirements

### Requirement: Error-tolerant word alignment

The system SHALL align ebook chapter text to a `TranscriptionTimeline` using error-tolerant token matching that handles insertions, deletions, substitutions, punctuation differences, and narrator additions without requiring exact string equality.

#### Scenario: Perfect match

- **WHEN** transcript text matches ebook text for a chapter
- **THEN** every ebook word receives a timestamp with confidence ≥ 0.9

#### Scenario: Narrator introduction

- **WHEN** the transcript contains an introduction not present in the ebook
- **THEN** introduction tokens are classified as INSERT and ebook alignment resumes at the first matching passage

#### Scenario: Skipped footnote

- **WHEN** the narrator skips ebook footnote text
- **THEN** footnote words are classified as DELETE with interpolated or absent timestamps and reduced confidence

### Requirement: Persisted alignment map

The system SHALL persist a `PlethoraAlignmentMap` sidecar separate from the source EPUB and audiobook files, keyed by content hashes of both inputs and the transcript fingerprint.

#### Scenario: Reuse after restart

- **WHEN** the user reopens a paired ebook and audiobook with unchanged content
- **THEN** the system loads the existing alignment map without recomputing

#### Scenario: Stale invalidation

- **WHEN** the ebook or audiobook file changes
- **THEN** the system marks the alignment stale and prompts regeneration

### Requirement: STT provider independence

The alignment engine SHALL consume a normalized `TranscriptionTimeline` and SHALL NOT depend on a specific STT vendor.

#### Scenario: Segment-only transcript

- **WHEN** only segment-level timestamps are available
- **THEN** the adapter synthesizes per-word timings within each segment before alignment

### Requirement: Chapter-scoped processing

The system SHALL align one chapter at a time to bound memory and allow partial progress.

#### Scenario: Partial book alignment

- **WHEN** alignment is interrupted after chapter 5 of 20
- **THEN** chapters 1–5 remain usable and alignment can resume from chapter 6
