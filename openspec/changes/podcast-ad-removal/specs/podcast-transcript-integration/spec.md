## Purpose

Specifies the permanent association of podcast transcripts with episodes, supporting interactive playback follow-along, dual full/clean reading modes, study extract creation, and whole-library learning integrations.

## ADDED Requirements

### Requirement: Permanent Transcript Association and Storage
Whenever a podcast episode is transcribed for ad detection or study, the complete transcript SHALL be saved permanently to `podcast_episodes` and `podcast_transcript_segments`, remaining available offline and surviving application restarts.

#### Scenario: Transcript preservation after ad classification completion
- **WHEN** ad detection finishes processing an episode transcript
- **THEN** the full transcript text and all timed segments SHALL remain stored in the local SQLite database
- **AND** the transcript SHALL be immediately accessible to the user without re-running speech recognition

#### Scenario: Transcript preservation after downstream classification failure
- **WHEN** speech-to-text succeeds in generating a transcript but the subsequent semantic ad classifier encounters an error
- **THEN** the transcript SHALL be retained in the database with status `done`
- **AND** the user SHALL be able to read, search, and navigate the transcript despite the ad classification failure

### Requirement: Interactive Playback and Karaoke Highlighting
The transcript viewer SHALL synchronize with audio playback, highlighting current spoken words or segments and allowing instantaneous seeking by tapping any transcript text.

#### Scenario: Word-level follow-along highlighting
- **WHEN** audio playback is active and the transcript contains word-level timing data
- **THEN** the viewer SHALL highlight spoken words in real time with smooth interpolated animation
- **AND** the active spoken line SHALL be auto-scrolled to maintain comfortable eye positioning

#### Scenario: Tapping transcript segment to seek audio
- **WHEN** a user taps or clicks any segment or word in the transcript viewer
- **THEN** the audio player SHALL seek directly to the corresponding timestamp in the audio track
- **AND** playback SHALL continue from that exact spoken point

### Requirement: Dual Full and Clean Reading Views
The transcript viewer SHALL provide a user-controlled toggle between a complete verbatim view and a clean reading view that collapses or hides classified advertising content without mutating original timestamps.

#### Scenario: Viewing transcript in clean reading mode
- **WHEN** the user selects the "Clean Reading View" filter
- **THEN** transcript segments classified as external advertisements SHALL be hidden from view or collapsed into compact indicators
- **AND** surrounding content timestamps, word alignments, and paragraph formatting SHALL remain intact

#### Scenario: Switching to verbatim transcript view
- **WHEN** the user toggles back to the complete verbatim transcript view
- **THEN** all original spoken segments, including sponsor reads and bumpers, SHALL be displayed with distinct advertising badge styling
- **AND** all segments SHALL remain clickable for seeking and study extraction

### Requirement: Incremental Reading and Knowledge Integration
Podcast transcripts SHALL fully support Plethora's incremental study toolset, enabling text selection, extract capture, flashcard synthesis, and AI assistant interaction.

#### Scenario: Creating a study extract from podcast transcript
- **WHEN** a user selects a passage of text within the podcast transcript and chooses "Create Extract"
- **THEN** the system SHALL create an `Extract` record linked to the episode's promoted `Document`
- **AND** the extract SHALL preserve the timestamp anchor and appear in the user's Incremental Reading queue

#### Scenario: Querying AI Assistant about episode transcript
- **WHEN** the user opens the Assistant panel while viewing a podcast transcript
- **THEN** the transcript text SHALL be included as grounded context for the AI assistant
- **AND** the assistant SHALL answer questions, summarize topics, or generate study cards from the transcript content

### Requirement: Transcript Export and Offline Access
Users SHALL be able to export saved podcast transcripts in common text formats and read transcripts completely offline.

#### Scenario: Exporting timestamped transcript
- **WHEN** a user triggers the "Export Transcript" action and selects timestamped text format
- **THEN** the system SHALL generate a clean text file formatted with `[HH:MM:SS] Speaker: Content` lines
- **AND** prompt the user to save the file to local storage

#### Scenario: Offline transcript reading
- **WHEN** the device has no internet connection and the user opens an episode with a saved transcript
- **THEN** the transcript viewer SHALL render the full transcript immediately from local SQLite cache
