## Purpose

Enable users to control one continuous audio session across application views while preserving existing source-specific listening and learning capabilities.

## ADDED Requirements

### Requirement: Exclusive navigation-independent audio ownership
The system SHALL maintain exactly one authoritative active audio session for supported audiobooks, podcasts, Audio Editions and playable recordings, independent of the current document, tab, pane, route, or expanded-player visibility. Closing or evicting a source view SHALL NOT stop, reconstruct, restore, or duplicate its active playback. Opening a source for inspection SHALL NOT replace existing playback until an explicit listening action.

#### Scenario: Closing the source tab
- **WHEN** an audiobook is playing and the user closes or evicts its source tab and opens RSS
- **THEN** playback continues from the same advancing media position with the same active session
- **AND** the persistent player remains synchronized without a second decoder or source reload

#### Scenario: Inspecting a competing source
- **WHEN** a podcast is playing and the user opens another audiobook without selecting Play
- **THEN** the podcast remains the active session and its position continues advancing

#### Scenario: Multiple views of the same source
- **WHEN** a user opens the active source in two panes and opens the expanded player
- **THEN** all transport controls operate the same session and opening either view does not apply a saved-position restore

### Requirement: Deterministic source takeover and command ordering
The system SHALL pause the previous audible source and preserve its progress before a newly requested source becomes audible. New explicit source requests SHALL supersede older unresolved requests. Late callbacks and commands from a retired session SHALL NOT mutate or resume the current session. Play and Pause SHALL be idempotent and distinct from Toggle.

#### Scenario: Podcast to audiobook and back
- **WHEN** a user explicitly plays an audiobook during podcast playback and later explicitly returns to the podcast
- **THEN** only the audiobook becomes audible after the podcast pauses
- **AND** both sources retain their own progress and the podcast resumes from its saved position

#### Scenario: Rapid unresolved source requests
- **WHEN** Play A, Play B, and Play C are requested before B finishes resolving
- **THEN** the latest accepted request C alone can become audible
- **AND** B's later completion and A's ended event cannot restart audio or seek C

#### Scenario: Competing commands from surfaces
- **WHEN** a mini-player Pause and system Play arrive in order for the current session
- **THEN** they are applied in accepted order with a monotonic result visible on all surfaces
- **AND** repeated Play never toggles an already playing source to paused

### Requirement: Source-aware positions and transport
The session SHALL preserve source identity, section/part identity, elapsed seconds, nullable duration, playback rate and truthful seek capabilities. Relative seeking SHALL cross known part boundaries using global media time. Chapter navigation and queue navigation SHALL be distinct actions. Unknown-duration or non-seekable sources SHALL NOT expose fabricated percentages or unsupported seek actions.

#### Scenario: Seek across audiobook parts
- **WHEN** the user seeks forward 30 seconds from 10 seconds before a known part boundary
- **THEN** the session selects the next part at 20 seconds and retains the original play/pause intent

#### Scenario: Unknown or very long duration
- **WHEN** a source has an unknown duration or a duration exceeding 24 hours
- **THEN** elapsed time remains finite and correctly formatted without time-of-day wrapping
- **AND** unavailable absolute seeking is disabled with an understandable explanation

### Requirement: Supported recordings and source resolution
The system SHALL play supported consolidated recording assets and imported audio through the same session. Transcript-only, missing-media and unfinished capture states SHALL remain distinguishable and SHALL NOT start a bogus player. Playback SHALL prefer an available authorized local copy, preserve existing supported media preparation, and avoid loading an entire long media file into application memory.

#### Scenario: Recording from Learning Studio
- **WHEN** a user plays a ready recording with transcript and markers and then navigates to notes
- **THEN** recording audio continues globally and returning to the studio restores synchronized transcript/marker controls for that session

#### Scenario: Transcript-only session
- **WHEN** a session has text but no playable recording asset
- **THEN** it reports transcript-only availability and leaves the current audio session unchanged

### Requirement: Exclusive coordination with speech and competing app audio
Starting reader TTS, other long-form speech, video, or microphone capture SHALL acquire exclusive app audio ownership before audible output or capture. Prior ordinary media SHALL remain paused when that competing activity finishes, fails, or unmounts. Returning to media SHALL stop or pause competing output before media resumes. Revoked asynchronous speech callbacks SHALL NOT become audible.

#### Scenario: Podcast followed by reader TTS
- **WHEN** a podcast listener starts text-to-speech in an article
- **THEN** the podcast pauses and saves its position before speech starts
- **AND** finishing or leaving the speech reader does not automatically resume the podcast
- **AND** explicit podcast Play revokes speech before resuming the podcast

#### Scenario: Source switch during speech generation
- **WHEN** TTS audio is generating and the user explicitly starts an audiobook
- **THEN** the audiobook starts only after speech ownership is revoked
- **AND** a late generated speech chunk cannot play over it

#### Scenario: Start microphone capture
- **WHEN** a user starts recording while supported media is playing
- **THEN** playback pauses before capture begins and remains paused after capture ends

### Requirement: Existing expanded playback and queue continuity
Expanded and source-specific player surfaces SHALL use the active session for transport, chapters, speed, supported sleep timers, bookmarks, transcript navigation, and existing learning actions. Explicit queue contexts SHALL preserve current order/identity across navigation and restart; auto-advance SHALL NOT be caused by view mounting or stale end events. Existing source-provenance capture and paired-reading anchors SHALL remain valid when only compact controls are visible.

#### Scenario: Expand during reading
- **WHEN** a user expands and collapses the player while reading an EPUB
- **THEN** the same audio session continues without a second player or re-seek
- **AND** reading position and annotations remain unchanged

#### Scenario: Ended item and sleep boundary
- **WHEN** a queued item reaches a selected sleep boundary
- **THEN** it checkpoints and pauses before any next-item auto-advance

#### Scenario: Ready and unprepared queued sections
- **WHEN** Android background playback reaches the next prepared part
- **THEN** playback advances once without JavaScript
- **AND** if the next required part instead needs foreground preparation, playback pauses at the boundary with progress retained and a request to open Plethora
