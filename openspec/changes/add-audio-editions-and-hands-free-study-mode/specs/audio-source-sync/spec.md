# audio-source-sync Specification

## Purpose
Specifies bidirectional synchronization between visual reading position and Audio Edition playback position, paragraph/sentence text-to-audio anchoring, read-along highlighting, and external audiobook pairing alignment.

## ADDED Requirements

### Requirement: Bidirectional Read and Listen Position Alignment
The system SHALL maintain a unified document position mapping between text reading progress (CFI for EPUB, page/scroll for PDF, scroll offset for HTML/articles) and Audio Edition playback time.

#### Scenario: Switching from reading to listening
- **WHEN** user reads to Chapter 5 paragraph 12 and invokes "Listen from here"
- **THEN** the Audio Edition player SHALL resolve the source anchor for that paragraph and start playback at the corresponding audio timestamp

#### Scenario: Switching from listening back to reading
- **WHEN** user pauses Audio Edition playback and opens the visual document reader
- **THEN** the reader SHALL automatically navigate and scroll to the visual text location corresponding to the active audio playback timestamp

### Requirement: Provider-Agnostic Source-to-Audio Anchoring
The system SHALL record source-to-audio anchor intervals during synthesis by associating generated audio time intervals `[audioStartSec, audioEndSec]` with corresponding source text anchors `[sourceStartAnchor, sourceEndAnchor]`.

#### Scenario: Chunk synthesis generates bounding anchors
- **WHEN** a TTS section chunk containing 3 paragraphs is synthesized
- **THEN** the system SHALL compute and store anchor entries mapping each paragraph's character/CFI range to its start and end timestamps in the generated section audio

### Requirement: Synchronized Read-Along Highlighting
When an Audio Edition is playing while the document reader is open, the system SHALL visually highlight the active source paragraph or sentence corresponding to the current audio playback position.

#### Scenario: Active paragraph highlighted during playback
- **WHEN** audio playback enters the time interval of paragraph 42
- **THEN** the document viewer SHALL apply an active read-along highlight to paragraph 42 and smoothly scroll the paragraph into view

### Requirement: External Audiobook Pairing Alignment with Confidence Levels
The system SHALL support aligning externally supplied audiobooks with readable documents, categorizing alignment confidence into High (exact text match), Medium (fuzzy paragraph window), and Low (audio timestamp fallback).

#### Scenario: Extract triggered on paired audiobook
- **WHEN** user triggers an extract during playback of an externally paired audiobook
- **THEN** the system SHALL check alignment confidence: if High, save the exact matched text; if Medium/Low, save the audio bookmark with candidate source boundaries for later user confirmation
