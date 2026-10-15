## ADDED Requirements

### Requirement: Directory Import as Single Audiobook
The system SHALL support importing a directory containing multiple audio files (.mp3, .m4a, .m4b, .aac, .flac, .ogg, .wav) and combining them into a single unified audiobook document rather than creating separate library documents for each individual audio file.

#### Scenario: User selects a folder of chapter files
- **WHEN** user selects a folder containing multiple audio chapter files in the Audiobook Import dialog
- **THEN** system groups all constituent audio files into a single proposed audiobook document and displays the total duration and chapter count

#### Scenario: User selects a folder containing disc or volume subdirectories
- **WHEN** user selects a directory containing nested disc folders (such as "CD 1", "CD 2", or "Disc 1", "Disc 2")
- **THEN** system aggregates all audio files across the volume subdirectories into a single continuous audiobook tracklist ordered by disc and track numbers

### Requirement: Multi-File Combine and Import Mode Selection
The system SHALL provide an explicit option to choose between combining multiple audio files into a single audiobook or importing them as separate individual documents.

#### Scenario: Multiple loose audio files selected in audiobook shelf
- **WHEN** user selects two or more audio files via file picker in the audiobook import workflow
- **THEN** system defaults to combining the files into a single audiobook while offering a toggle to import as separate individual audiobooks

#### Scenario: User switches from separate batch mode to combined mode
- **WHEN** user chooses the "Combine into single audiobook" option for a multi-file selection
- **THEN** system transitions the import flow to a unified audiobook preview with aggregated metadata and chapter management

### Requirement: Automatic Chapter Discovery and Sequential Ordering
The system SHALL parse embedded audio metadata (disc number, track number, title, album, artist) and file naming conventions to determine the canonical playback sequence and derive chapter titles and timeline offsets.

#### Scenario: Embedded track and disc tags determine canonical order
- **WHEN** audio files contain embedded disc and track number tags
- **THEN** system orders the chapters strictly by disc number ascending followed by track number ascending

#### Scenario: Filename patterns derive clean chapter titles when metadata is absent
- **WHEN** audio files do not have embedded chapter title tags (e.g. named "01 - The Beginning.mp3", "Chapter 02.mp3")
- **THEN** system strips track numbers and prefixes to derive clean chapter titles ("The Beginning", "Chapter 02")

### Requirement: Interactive Chapter Review and Editing
The Audiobook Import Dialog SHALL provide an interactive chapter review interface before finalizing the import, displaying chapter titles, track indices, durations, and file sources.

#### Scenario: User reviews and customizes chapter titles
- **WHEN** user modifies a chapter title in the chapter review list
- **THEN** system updates the proposed chapter title and preserves the edited title upon final import

#### Scenario: User excludes unwanted track from audiobook
- **WHEN** user removes or unchecks a file (such as a promotional trailer or sample audio) from the chapter list
- **THEN** system recalculates the total duration and removes that file from the staged multi-part import plan

### Requirement: Atomic Multi-Part Persistence and Playback Integration
The system SHALL atomically stage all audio parts, persist the document and audio edition with ordered sections, and ensure full playback and chapter navigation parity in the audiobook player.

#### Scenario: Successful import produces a playable unified audiobook
- **WHEN** user confirms the import of a combined audiobook
- **THEN** system stages all parts, writes the document record and ready audio edition with chapter sections in a single transaction, and opens the book in the player with active chapter marks

#### Scenario: Playback transitions across chapter files seamlessly
- **WHEN** user listens through the boundary of chapter 1 into chapter 2
- **THEN** the player advances playback to the next audio section, updates the active chapter indicator, and records progress against the cumulative audiobook timeline
