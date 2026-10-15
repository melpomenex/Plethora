# audio-learning-actions Specification

## Purpose

Specifies source-linked "Save Recent Extract" with smart boundary expansion and typed capture outcomes, semantic markers, deferred "Ask Plethora" markers, transcript-segment extraction, source-provenance persistence and navigation, flashcard creation, and pronunciation dictionary overrides.

## ADDED Requirements

### Requirement: Smart Recent Extract Boundary Expansion

When a "Save Recent Extract" action is triggered at playback timestamp $T$, the system SHALL resolve the configured recent window (15 s / 30 s / 60 s / Smart — Smart snaps to semantic units via anchors, bounded to ≤ 90 s and ≤ 3 units), find all source/audio anchors (edition anchors or timed transcript segments) overlapping $[T-W, T]$, and expand to clean sentence/paragraph boundaries. Resolution SHALL be correct at document start, document end, window-boundary crossings, and with empty anchor sets.

#### Scenario: Clean extract boundary expansion

- **WHEN** Save Recent Extract triggers at 01:17:42 midway through a sentence with a 30 s window
- **THEN** the resulting extract SHALL begin at the start of the first overlapping sentence and end at the end of the currently playing sentence

#### Scenario: Smart window mode

- **WHEN** the capture window is set to Smart and Save Recent Extract triggers mid-paragraph
- **THEN** the capture SHALL snap to coherent semantic boundaries (enclosing sentence group/paragraph) rather than a raw time slice

### Requirement: Typed Capture Outcomes (No Synthetic Text)

Capture resolution SHALL produce exactly one of three typed outcomes, and SHALL NEVER persist placeholder text such as "Audio extract at 123s":

1. **Resolved** — exact source text recovered from anchors/transcript → permanent extract + session item linked by `extract_id`.
2. **Needs confirmation** — paired external audiobook with medium alignment confidence → session item storing playback timestamp, candidate source range, and candidate text flagged for user confirmation; no permanent extract.
3. **Pending audio bookmark** — low confidence or no source mapping → session item storing timestamp and any nearby candidate context with empty snippet text rendered as "Pending audio bookmark"; no fake textual content.

The Listening Session Inbox SHALL make unresolved captures visually obvious and support later confirmation.

#### Scenario: Anchor miss produces a pending bookmark, not garbage

- **WHEN** Save Recent Extract triggers on audio whose source mapping cannot be resolved
- **THEN** the system SHALL save a pending audio bookmark for later review and SHALL NOT create any textual extract with placeholder content

### Requirement: Alignment-Confidence-Tierred Capture for Paired External Audiobooks

For paired external audiobooks: **high** confidence SHALL auto-save the exact matched source text; **medium** SHALL save timestamp + candidate range + candidate text with status requiring user confirmation; **low** SHALL save a timestamp/bookmark with nearby candidate context only and SHALL NOT automatically create a permanent textual extract. The tier SHALL be recorded on the capture and surfaced in the Inbox.

#### Scenario: Medium-confidence capture awaits confirmation

- **WHEN** a capture occurs during playback of a paired audiobook whose alignment confidence is medium
- **THEN** the Inbox SHALL show the candidate text with a confirmation control, and confirming SHALL convert it into a permanent extract

### Requirement: Transcript-Segment Anchoring for Imported Audiobooks and Podcasts

For audiobooks/podcasts that are not generated Audio Editions but possess timed transcript data (Whisper/Groq segments or imported transcripts), the system SHALL use transcript segment timings as source anchors: Smart Recent Extract SHALL collect transcript text overlapping the recent window, and provenance SHALL reference the audiobook document and timestamp. Audio Edition generation SHALL NOT be required merely to enable hands-free extraction when a quality timed transcript already exists.

#### Scenario: Podcast capture uses transcript timing

- **WHEN** Save Recent Extract triggers during an imported podcast with segment-level transcript
- **THEN** the capture SHALL contain the overlapping transcript text with segment/timestamp provenance

### Requirement: Repeat-Invoke Extension (Not Gesture Multiplicity)

A second Save Recent Extract within the extension window (default 2.5 s) SHALL extend the SAME capture backward by one semantic unit — updating the existing extract and session item in place, capped at 3 extensions, with an extended confirmation earcon — rather than creating a duplicate record or interpreting the repeat as a different action.

#### Scenario: Rapid re-invoke extends the window

- **WHEN** Save Recent Extract fires twice within 2.5 seconds
- **THEN** one extract SHALL exist, containing the original plus the preceding paragraph, and an extended earcon SHALL play

### Requirement: Semantic Hands-Free Markers

The system SHALL support `bookmark`, `mark_interesting`, and `mark_confusing` actions, each persisting a listening-session item (with audio timestamp, source anchor, snippet or pending state, marker type) and — for interesting/confusing — tagging the capture for prioritized spaced review (`#interesting` / `#needs-explanation`). Markers SHALL work regardless of session age (a session SHALL exist by the time any capture fires). Marker values SHALL agree across TS enums, dispatcher, and the backend `marker_type` CHECK constraint.

#### Scenario: Confusing marker created

- **WHEN** the command mapped to "Mark Confusing" fires
- **THEN** a session item SHALL record the recent passage, document, chapter, and audio timestamp tagged `#needs-explanation`, with its distinct earcon

#### Scenario: Interesting marker created

- **WHEN** the command mapped to "Mark Interesting" fires
- **THEN** a session item SHALL record the recent passage tagged `#interesting`, and the Inbox SHALL offer spaced-review promotion

### Requirement: Deferred "Ask Plethora About What I Just Heard"

The `ask_plethora` remote action SHALL NOT depend on any visible UI at capture time. It SHALL capture the recent source passage and enqueue a scoped Ask-Plethora marker into the Listening Session Inbox; when the user later opens it, Document Q&A SHALL launch pre-scoped to the passage, document title, and chapter. Background AI answer generation is out of scope for v1.

#### Scenario: Marker enqueued screen-off

- **WHEN** the command mapped to "Ask Plethora" fires with the screen locked
- **THEN** a session marker SHALL be persisted with the captured passage (no UI required), and reviewing it later SHALL open Document Q&A scoped to that passage

### Requirement: Durable Source Provenance and "Open in Source"

Every resolved capture SHALL retain provenance — source document ID, Audio Edition ID (if applicable), section/chapter ID, source start/end anchors, playback timestamp, capture window, listening session ID, alignment confidence, and provider — persisted with the extract, and SHALL support "Open in source" navigation landing at the correct EPUB CFI, PDF page/reflow anchor, article DOM/text anchor, or transcript timestamp.

#### Scenario: Navigate from capture to source

- **WHEN** the user taps "Open in source" on an audio-captured extract
- **THEN** the document viewer SHALL open at the exact anchored location corresponding to the captured audio position

### Requirement: Source-Provenance Flashcard Generation

The system SHALL enable creating flashcards from the audio player, saved extracts, or session review, retaining complete provenance (document, chapter, page/CFI, text, audio timestamp).

#### Scenario: Flashcard created from audio extract

- **WHEN** the user selects "Create Flashcard" on an audio-captured extract (player or Inbox)
- **THEN** card creation SHALL launch pre-populated with the extracted text, tags, and provenance metadata

### Requirement: Pronunciation Dictionary Overrides

User-configured phonetic pronunciation overrides SHALL apply globally (Settings) with optional per-document/per-edition overrides merged on top, replacing terms prior to TTS synthesis. The global dictionary SHALL affect newly generated editions without requiring per-edition re-entry.

#### Scenario: Technical term pronunciation corrected

- **WHEN** the global dictionary contains "Riemannian → REE-mahn-ee-an" and a new edition is generated
- **THEN** synthesis SHALL use the phonetic replacement; edition-level overrides SHALL take precedence over the global entry
