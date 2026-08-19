# audio-learning-actions Specification

## Purpose
Specifies source-linked "Save Recent Extract" with smart sentence/paragraph boundary expansion, semantic markers, scoped "Ask Plethora about what I just heard", source-provenance flashcards, and pronunciation dictionary overrides.

## ADDED Requirements

### Requirement: Smart Recent Extract Boundary Expansion
When a "Save Recent Extract" action is triggered at playback timestamp $T$, the system SHALL identify the recently heard audio interval (default 30 seconds, configurable to 15s/30s/60s/Smart) and expand the extracted text to clean sentence or paragraph boundaries using stored source/audio anchors.

#### Scenario: Clean extract boundary expansion
- **WHEN** user triggers Save Recent Extract at timestamp 01:17:42 midway through a sentence
- **THEN** the system SHALL resolve the anchors for the preceding 30 seconds of audio and output a complete textual extract beginning at the start of the first sentence and ending at the end of the current sentence

### Requirement: Multi-Press Window Extension
When a user triggers "Save Recent Extract" multiple times within a short duration window (e.g. 2.5 seconds), the system SHALL extend the boundary of the existing extract further backward to include preceding paragraphs rather than creating duplicate extract records.

#### Scenario: Double-press extends extract window
- **WHEN** user presses the Save Extract button twice in rapid succession
- **THEN** the system SHALL extend the captured text window backward to include the preceding paragraph and play an extended confirmation tone

### Requirement: Semantic Hands-Free Markers
The system SHALL support creating semantic markers during playback:
- Bookmark: Stores audio timestamp + source text anchor + optional note
- Mark Interesting: Tags the recent passage with an `#interesting` label for prioritized spaced review
- Mark Confusing / Needs Explanation: Tags the recent passage with a `#needs-explanation` label for one-tap AI clarification during session review.

#### Scenario: Confusing marker created
- **WHEN** user executes the remote action mapped to "Mark Confusing"
- **THEN** the system SHALL record a session marker linking the recent source passage, document ID, chapter, and audio timestamp tagged as `#needs-explanation`

### Requirement: Scoped "Ask Plethora About What I Just Heard"
The system SHALL provide an AI Q&A action from the audio player and session review that automatically injects the current document title, active chapter, and recent 60-second narrated text passage as focused context into Document Q&A.

#### Scenario: Question asked during playback
- **WHEN** user opens the player menu and taps "Ask Plethora about this"
- **THEN** the system SHALL open Document Q&A with the prompt scoped to the recently heard passage and allow immediate questioning (e.g. "What did that mean?" or "Give me a concrete example")

### Requirement: Source-Provenance Flashcard Generation
The system SHALL enable creating flashcards directly from the audio player, saved extracts, or session review, retaining complete source provenance (source document, chapter title, page/CFI, exact text passage, and audio timestamp).

#### Scenario: Flashcard created from audio extract
- **WHEN** user selects "Create Flashcard" on an audio-captured extract
- **THEN** the system SHALL launch the Flashcard Studio pre-populated with the extracted source text, tags, and document reference metadata

### Requirement: Pronunciation Dictionary Overrides
The system SHALL support user-configured phonetic pronunciation overrides scoped per document or globally across all documents, replacing terms with their phonetic spelling prior to TTS synthesis.

#### Scenario: Technical term pronunciation corrected
- **WHEN** user adds a dictionary entry "Riemannian -> REE-mahn-ee-an" for a document
- **THEN** subsequent TTS generation for that document SHALL replace "Riemannian" with "REE-mahn-ee-an" and mark only sections containing that term for regeneration
