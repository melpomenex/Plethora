## Purpose

Provides a right-click context menu on transcript blocks, frictionless creation of text and timed media extracts from transcripts, and one-click multi-format transcript export across all transcript viewers.

## ADDED Requirements

### Requirement: Transcript blocks provide a right-click context menu
The system SHALL open a context menu when the user right-clicks (or triggers the context menu keyboard shortcut on) any transcript segment block across video, audio, podcast, and session transcript viewers.

#### Scenario: Right-clicking a transcript block without active text selection
- **WHEN** the user right-clicks a transcript segment block while no text selection is active
- **THEN** the system opens a context menu anchored to the cursor offering actions for that block: "Create Extract", "Capture Video/Audio Slice" (when timed media extraction is supported), "Play from Here" (when seekable), "Copy Segment Text", "Copy with Timestamp", "Copy Full Transcript", and "Export Transcript"

#### Scenario: Right-clicking a transcript block with active text selection
- **WHEN** the user selects text within a transcript block or across multiple blocks and right-clicks
- **THEN** the context menu targets the selected text and time span for "Create Extract", "Capture Video/Audio Slice", and "Copy Selection"

### Requirement: Users can easily extract text and timed slices from transcripts
The system SHALL allow users to create a text extract or a timed video/audio slice from any transcript segment or transcript text selection in one action.

#### Scenario: Creating a text extract from a transcript block or selection
- **WHEN** the user chooses "Create Extract" from the transcript block right-click menu, hover quick-action, or selection floating bar
- **THEN** the system persists a document extract containing the segment or selected text and its timestamp metadata, and displays a confirmation toast

#### Scenario: Capturing a timed media slice from a transcript block or selection
- **WHEN** the user chooses "Capture Video Slice" from the transcript block right-click menu or selection floating bar on a timed media document
- **THEN** the system creates a timed video/audio extract bounded by the segment's or selection's start and end timestamps and notifies the user

### Requirement: Transcripts can be exported easily in multiple formats
The system SHALL provide an always-available export control in the transcript header and right-click context menu that exports the transcript in Plain Text (`.txt`), Markdown (`.md`), SubRip (`.srt`), WebVTT (`.vtt`), or JSON (`.json`).

#### Scenario: Exporting a transcript from the transcript header or context menu
- **WHEN** the user selects an export format (Plain Text, Markdown, SRT, WebVTT, or JSON) from the transcript export menu
- **THEN** the system serializes the transcript segments (including timestamps and speaker labels when available) into the chosen format and triggers a file download with a clean filename
