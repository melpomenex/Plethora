# audio-edition-generation Specification

## Purpose
Specifies structural chapterization, progressive section-level TTS generation, generic provider dispatch, voice audition previews, cost and duration estimation guardrails, failure recovery, and background job lifecycle management.

## ADDED Requirements

### Requirement: Semantic Chapterization Hierarchy
The system SHALL derive audio generation sections from the intrinsic semantic hierarchy of the source document:
- For EPUB: navigation TOC, spine hierarchy, and chapter headings (`<h1>`-`<h3>`)
- For PDF: embedded PDF outline/bookmarks, canonical reflow headings, or structural font-size heuristics
- For HTML/Web Articles: semantic headings (`<h1>`-`<h3>`) and article container structure
- For unstructured text: fallback structural boundary detection (e.g. Introduction, Key Points, Conclusion).

#### Scenario: EPUB chapterization derived from TOC
- **WHEN** user initiates Audio Edition generation on an EPUB with a table of contents
- **THEN** the system SHALL create one `AudioEditionSection` per TOC entry, preserving chapter titles and source text boundaries

#### Scenario: PDF outline segmentation
- **WHEN** user initiates Audio Edition generation on a PDF containing outline bookmarks
- **THEN** the system SHALL create `AudioEditionSection` entries matching the PDF outline nodes

### Requirement: Progressive Section Generation and Early Playback
The system SHALL generate audio sequentially or concurrently by section and allow immediate playback as soon as the first playable section is generated, while subsequent sections continue generating in the background.

#### Scenario: Playback begins on first ready section
- **WHEN** Chapter 1 finishes generating while Chapters 2 through 10 are queued
- **THEN** the system SHALL enable the "Play now" control and allow the user to listen to Chapter 1 immediately while remaining chapters generate asynchronously

### Requirement: Section-Level Failure Isolation and Retry
The system SHALL isolate TTS errors (such as network timeouts, rate limits, or validation errors) to the specific failing section without invalidating completed sections or aborting the entire Audio Edition.

#### Scenario: Single chapter failure during generation
- **WHEN** Chapter 3 encounters a rate limit or API error during generation
- **THEN** the system SHALL mark Chapter 3 as `failed` with the error reason, keep Chapters 1 and 2 in `ready` state, continue processing Chapter 4, and expose a "Retry Chapter 3" action to the user

### Requirement: Generic Multi-Provider TTS Dispatch
The system SHALL route audio generation requests through Plethora's generic `TTSProviderAdapter` registry, supporting OpenRouter, Pocket TTS (local), Fal.ai, Android sherpa-onnx, ElevenLabs, OpenAI, and System TTS.

#### Scenario: OpenRouter speech model used for generation
- **WHEN** user selects an OpenRouter speech model for an Audio Edition
- **THEN** the system SHALL send synthesize requests using the resolved OpenRouter credentials with per-section text chunking matching the model's maximum input character limit

### Requirement: Quality Abstraction and Advanced Selector
The system SHALL present standard users with simplified quality presets (Fast, Natural, Best) that map to configured recommended providers/models, while offering an Advanced mode exposing provider, model ID, voice ID, speed, response format, and custom instructions.

#### Scenario: Natural quality preset chosen
- **WHEN** user selects "Natural" quality in the Audio Edition creation dialog
- **THEN** the system SHALL automatically configure the default neural voice model (such as OpenRouter neural narrator or Pocket TTS local) without prompting for raw provider endpoints

### Requirement: Document-Text Voice Audition Preview
The system SHALL provide an instant voice preview feature that synthesizes a short 5-to-10 second sample using text extracted directly from the beginning of the active document.

#### Scenario: User auditions narrator voice
- **WHEN** user clicks the preview button next to a candidate voice in the creation dialog
- **THEN** the system SHALL synthesize a 5-second sample of the current document's opening paragraph and play the resulting audio without persisting a full chapter

### Requirement: Pre-Flight Cost and Duration Estimation
For cloud TTS providers with known pricing models, the system SHALL calculate and display estimated character count, audio duration, and monetary cost before starting Audio Edition generation.

#### Scenario: Large document cost estimate presented
- **WHEN** user opens the Audio Edition creation dialog for a 400-page document using a paid provider
- **THEN** the system SHALL calculate the total character count, display the estimated total duration (e.g. "~8h 30m"), and show estimated cost (e.g. "~$2.45") with a clear confirmation prompt

### Requirement: Durable Generation Job Queue
The system SHALL persist the state of all active and queued generation jobs in local storage, enabling automatic job resumption after app crashes, restarts, or background pauses.

#### Scenario: Application closed during multi-chapter generation
- **WHEN** the application is terminated while generating Chapter 4 of an Audio Edition
- **THEN** upon restart, the system SHALL restore the job queue, keep Chapters 1-3 marked as ready, and resume generation from Chapter 4 without duplicating API requests for completed chapters
