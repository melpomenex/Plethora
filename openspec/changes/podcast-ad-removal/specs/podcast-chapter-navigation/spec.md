## Purpose

Enables first-class podcast chapter navigation in Plethora, supporting ingestion from publisher metadata standards, persistent database storage, interactive player selection, and visual chapter division markers.

## ADDED Requirements

### Requirement: Publisher Chapter Metadata Ingestion
The podcast feed parser and episode metadata extractor SHALL parse chapters from Podcasting 2.0 JSON feeds (`<podcast:chapters>`), Podlove Simple Chapters (`<psc:chapters>`), embedded ID3 `CHAP`/`CTOC` tags, and episode description timestamps.

#### Scenario: Ingesting Podcasting 2.0 external JSON chapters
- **WHEN** a podcast episode RSS item contains a `<podcast:chapters>` element with a valid URL pointing to JSON chapter data
- **THEN** the parser SHALL fetch and validate the JSON chapter payload
- **AND** the system SHALL parse each chapter's `startTime`, `title`, optional `img`, and optional `url` into structured chapter records

#### Scenario: Ingesting Podlove Simple Chapters
- **WHEN** a podcast episode contains `<psc:chapters>` XML elements within the feed item
- **THEN** the parser SHALL extract each `<psc:chapter>` start time and title
- **AND** normalize start times formatted in seconds, MM:SS, or HH:MM:SS into milliseconds

#### Scenario: Ingesting ID3 CHAP frames from downloaded audio
- **WHEN** an episode audio file is downloaded and inspected locally
- **AND** the MP3/M4A media contains ID3 `CHAP` frames or QuickTime chapter tracks
- **THEN** the metadata extractor SHALL parse the native chapter markers, titles, and millisecond boundaries

#### Scenario: Extracting chapters from description timestamps
- **WHEN** an episode lacks external or embedded chapter metadata but contains timestamped lines in its text description
- **THEN** the system SHALL extract monotonic timestamp lines into structured chapter records
- **AND** the system SHALL label the chapters as generated rather than publisher-authored

### Requirement: Chapter Normalization and Validation
The chapter ingestion engine SHALL sanitize, sort, and validate chapter intervals, handling missing end times, out-of-order markers, and overlapping entries.

#### Scenario: Sanitizing chapters with missing end times
- **WHEN** a chapter list provides only start timestamps without explicit end timestamps
- **THEN** the ingestion engine SHALL compute each chapter's end time from the start time of the subsequent chapter
- **AND** the final chapter's end time SHALL equal the total episode audio duration

#### Scenario: Filtering malformed or overlapping chapters
- **WHEN** chapter metadata contains backward timestamps, zero-length entries, or duplicate titles
- **THEN** the validator SHALL enforce strictly monotonic start times
- **AND** discard invalid entries while logging diagnostic warnings

### Requirement: Touch-First Chapter Navigation UI
The podcast audio player SHALL expose an intuitive, accessible chapter selector supporting quick chapter jumps, chapter search, and clear active-chapter highlighting across desktop and mobile form factors.

#### Scenario: Opening adaptive chapter sheet on mobile
- **WHEN** a user taps the chapter title chip above the progress bar or the chapters button on a mobile device
- **THEN** the interface SHALL present an accessible bottom sheet displaying all episode chapters
- **AND** the currently playing chapter SHALL be automatically scrolled into view and visibly highlighted

#### Scenario: Jumping to a chapter
- **WHEN** a user taps a chapter entry in the chapter list
- **THEN** the audio player SHALL seek directly to the chapter's start timestamp
- **AND** update the displayed chapter title and scrubber progress immediately

#### Scenario: Visual chapter markers on progress bar
- **WHEN** an episode possesses two or more chapters
- **THEN** the player progress bar SHALL render subtle chapter tick marks or division gaps corresponding to chapter boundaries
- **AND** hovering or scrubbing near a boundary SHALL display the target chapter name in the timestamp tooltip

### Requirement: Chapter-Level Skipping and Playback Selection
The user SHALL be able to mark individual chapters to be skipped automatically or select a subset of chapters to play as an isolated queue.

#### Scenario: User marking a chapter to be skipped
- **WHEN** a listener toggles the "Skip Chapter" control on an intro, sponsorship, or off-topic chapter
- **THEN** the system SHALL register that chapter's interval as an active skip interval in the player policy
- **AND** playback SHALL automatically bypass that chapter when reached

#### Scenario: Chapter queue playback
- **WHEN** a listener selects a specific chapter and chooses "Play This Chapter Only"
- **THEN** the player SHALL commence playback at the chapter start
- **AND** automatically pause or trigger sleep timer actions upon reaching the chapter's end timestamp
