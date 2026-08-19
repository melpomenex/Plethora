# audio-source-sync Specification

## Purpose

Specifies bidirectional synchronization between visual reading position and Audio Edition playback position, text-to-audio anchoring across document types (including timed transcripts of imported audiobooks), read-along highlighting, "Listen from here" navigation, efficient anchor resolution, and external audiobook pairing alignment with confidence tiers — integrated into the actual viewers.

## ADDED Requirements

### Requirement: Bidirectional Read and Listen Position Alignment

The system SHALL maintain a unified document position mapping between text reading progress (CFI for EPUB, page/scroll for PDF, scroll offset for articles) and Audio Edition playback time, and the audio player and document viewers SHALL actually consume it (the sync hook SHALL NOT remain unintegrated infrastructure).

#### Scenario: Switching from reading to listening

- **WHEN** user reads to Chapter 5 paragraph 12 and invokes "Listen from here" in a document viewer
- **THEN** the Audio Edition player SHALL resolve the source anchor for that paragraph and start playback at the corresponding audio timestamp

#### Scenario: Switching from listening back to reading

- **WHEN** user pauses Audio Edition playback and opens the visual document reader
- **THEN** the reader SHALL navigate and scroll to the visual text location corresponding to the active audio playback timestamp

### Requirement: Provider-Agnostic Source-to-Audio Anchoring

The system SHALL record source-to-audio anchor intervals during synthesis by associating audio time intervals `[audioStartSec, audioEndSec]` with source text anchors `[sourceStartAnchor, sourceEndAnchor]` for every provider. Hands-free features SHALL depend only on this canonical anchor model (plus transcript segments), never on a specific TTS provider.

#### Scenario: Chunk synthesis generates bounding anchors

- **WHEN** a TTS section chunk containing 3 paragraphs is synthesized by any provider
- **THEN** anchor entries SHALL map each paragraph's character/CFI range to its start/end timestamps in the section audio

### Requirement: Efficient Anchor Resolution at Scale

Anchor resolution at capture time SHALL use section-local anchor arrays with indexed or binary search by audio start time (and the SQL index for persisted lookups), keeping per-action cost logarithmic for editions with thousands of anchors; source-anchor lookups SHALL compare numeric anchors numerically.

#### Scenario: Capture on a large edition

- **WHEN** Save Recent Extract triggers on an edition with tens of thousands of anchors
- **THEN** resolution SHALL complete without linearly scanning the full edition anchor set, and the action SHALL feel immediate

### Requirement: Synchronized Read-Along Highlighting

When an Audio Edition is playing while the document reader is open, the system SHALL visually highlight the active source paragraph or sentence corresponding to the current audio playback position and scroll it into view.

#### Scenario: Active paragraph highlighted during playback

- **WHEN** audio playback enters the time interval of paragraph 42
- **THEN** the document viewer SHALL apply an active read-along highlight to paragraph 42 and smoothly scroll it into view

### Requirement: External Audiobook Pairing Alignment with Confidence Levels

The system SHALL align externally supplied audiobooks with readable documents, categorizing alignment confidence into High (exact text match), Medium (fuzzy paragraph window), and Low (audio timestamp fallback), and capture behavior SHALL follow the typed-outcome rules of the `audio-learning-actions` capability (high → auto extract; medium → needs-confirmation candidate; low → pending bookmark).

#### Scenario: Extract triggered on paired audiobook

- **WHEN** user triggers an extract during playback of an externally paired audiobook
- **THEN** the system SHALL check alignment confidence and produce the corresponding typed capture outcome, never auto-creating a permanent extract at medium/low confidence
