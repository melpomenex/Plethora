## Purpose

Unifies recorded, imported and transcript-only spoken content as durable library sessions with shared downstream learning capabilities and honest source availability.

## ADDED Requirements

### Requirement: Durable source privacy
Document privacy SHALL persist in native storage and survive restart, startup summaries, local backup and source round trips. New recording sessions SHALL default local-only. Ordinary document edits, absent cached flags and stale sync payloads SHALL NOT lower an existing restriction. Intentional policy changes SHALL use the current persisted policy version. Local-only SHALL block new remote sync/processing of source and derived material; AI exclusion SHALL block indexing and inference. Pending source uploads SHALL be revoked when remote eligibility is removed. Already dispatched remote data SHALL NOT be represented as erased by a local policy change.

#### Scenario: Restart retains policy
- **GIVEN** a local-only or AI-excluded source
- **WHEN** the app restarts and reads its document or startup summary
- **THEN** the same durable restrictions govern new processing and sync

#### Scenario: Stale update cannot weaken a restriction
- **GIVEN** a source restricted after a client cached its older document
- **WHEN** an ordinary edit or sync payload omits privacy flags or supplies false
- **THEN** the durable restrictions remain and a stale explicit policy change is rejected

#### Scenario: Restrict pending remote work
- **GIVEN** a source and accepted derived objects with pending sync payloads
- **WHEN** the user makes the source local-only
- **THEN** pending source and derived uploads are removed and new dispatch is blocked
- **AND** local reading and verified local processing remain available unless AI-excluded

#### Scenario: AI-excluded source during indexing
- **WHEN** an AI-excluded source is queued or an indexing batch resumes after exclusion
- **THEN** no new inference request is dispatched and the source is absent from the semantic index

### Requirement: Shared ingestion identity and downstream parity
The system SHALL offer Capture & Import with Record Audio, Import Recording, Import Transcript and Import Supported URL. Each successful source SHALL resolve to a stable ordinary library document and session. Recorded and imported versions SHALL expose the same transcription, extraction, draft review, search and source-navigation capabilities when equivalent evidence is available.

#### Scenario: Equivalent lecture origins
- **GIVEN** the same lecture captured internally and imported as MP3 in separate sessions
- **WHEN** both have equivalent finalized transcript evidence
- **THEN** both support transcript selection, extracts, reviewable card drafts, source navigation and existing review integration without an origin-specific learning restriction

#### Scenario: Unified file journey
- **WHEN** the user imports a supported recording
- **THEN** Plethora opens its session and tracks preparation, transcription and authorized suggestions there without requiring manual handoff between unrelated views

### Requirement: First-class transcript-only sources
The system SHALL import valid SRT, VTT and plain text as canonical transcript segments and support manual learning, summaries, concepts, Ask and card drafts subject to capability/privacy gates. It SHALL preserve available cue timing and SHALL NOT invent audio, speakers, word timing or precise locations.

#### Scenario: SRT without audio
- **WHEN** an SRT file is imported without media
- **THEN** its cue text/times are retained, source links open transcript cues and study materials can be proposed
- **AND** no audio playback link is offered

#### Scenario: Untimed text
- **WHEN** a plain-text transcript is imported
- **THEN** paragraphs are navigable without fabricated timestamps or speaker identities

#### Scenario: Invalid transcript
- **WHEN** parsing fails or timing is invalid
- **THEN** the source file is retained with a specific import error and no partially parsed revision replaces a valid transcript

### Requirement: Capability-aware formats and source permissions
The system SHALL distinguish recognized extension, decodable audio and playable media. Imports SHALL use authorized source access and durable private storage before depending on external grants. URLs SHALL use supported permission-aware source adapters; unsupported, private-network and protected acquisition SHALL be refused without bypass.

#### Scenario: Recognized but undecodable media
- **WHEN** an MP4 meeting is saved but its audio codec is unsupported on the current device
- **THEN** the source remains in the library and an actionable decode error is displayed without claiming successful transcription

#### Scenario: Source permission expires
- **WHEN** an Android shared URI loses its temporary grant after a completed private copy
- **THEN** the session still opens the copied recording after restart

#### Scenario: Unsupported URL
- **WHEN** a URL has no supported import adapter or violates source policy
- **THEN** Plethora explains the unsupported source and offers file/transcript import without acquiring the media

### Requirement: Independent batch imports and existing organization
Batch/file/directory ingestion SHALL create independently tracked sessions by default, reuse existing collections/tags for course or project assignment, detect exact source duplicates and retain successful imports if another fails. It SHALL NOT merge recordings into an audiobook implicitly.

#### Scenario: Several course recordings
- **WHEN** three recordings are imported into one course and one is an exact existing source
- **THEN** distinct sources become separate sessions in that collection and the duplicate offers reuse or explicit separate-session creation without redundant transcription by default

### Requirement: Retention and explicit deletion
Original media SHALL remain available after restart and after successful or failed transcription until explicit user deletion. Deletion SHALL describe retained transcript/accepted materials and handle shared ownership safely. Missing media SHALL NOT prevent access to retained transcripts or accepted learning objects.

#### Scenario: Transcription failure retains source
- **WHEN** transcription fails and the app restarts
- **THEN** the original recording is playable where codec support exists and Retry uses the same session/document identity

#### Scenario: Delete media only
- **WHEN** the user explicitly deletes media while retaining the transcript
- **THEN** transcript and accepted cards remain, playback becomes unavailable and source navigation degrades honestly
