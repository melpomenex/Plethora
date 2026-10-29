## MODIFIED Requirements

### Requirement: Semantic Chapterization Hierarchy
The system SHALL derive audio generation sections from the intrinsic semantic hierarchy of the source document:
- For EPUB: navigation TOC, spine hierarchy, and chapter headings (`<h1>`-`<h3>`)
- For PDF: embedded PDF outline/bookmarks, canonical reflow headings, or structural font-size heuristics
- For HTML/Web Articles: semantic headings (`<h1>`-`<h3>`) and article container structure
- For unstructured text: fallback structural boundary detection (e.g. Introduction, Key Points, Conclusion).
Chapter/section names and order SHALL be preserved. Oversized chapters SHALL use stable synthesis segments or named subparts retaining parent identity. EPUB TOC fragments/nesting and untitled spine content SHALL map to nonoverlapping canonical text ranges without duplicate or omitted body text. Textless PDFs SHALL use existing OCR/reflow or report extraction required.

#### Scenario: EPUB chapterization derived from TOC
- **WHEN** user initiates Audio Edition generation on an EPUB with a table of contents
- **THEN** the system SHALL create semantic `AudioEditionSection` units corresponding to TOC ranges, preserving chapter titles and source text boundaries, with stable parent-linked subparts for oversized ranges

#### Scenario: PDF outline segmentation
- **WHEN** user initiates Audio Edition generation on a PDF containing outline bookmarks
- **THEN** the system SHALL create `AudioEditionSection` entries matching the PDF outline nodes and canonical text boundaries

#### Scenario: Several TOC entries share one EPUB file
- **WHEN** nested TOC entries target fragments in the same spine file or repeat chapter labels
- **THEN** source ranges SHALL cover each readable body span once in spine order and SHALL NOT duplicate the entire file per entry or search only for matching titles

### Requirement: Progressive Section Generation and Early Playback
The system SHALL generate audio sequentially or concurrently by section and allow immediate playback as soon as the first playable section is durably generated, while subsequent sections continue generating in the background. Generation SHALL NOT automatically take audio focus or replace existing listening. Playback SHALL wait at missing/failed required sections rather than silently skipping source text, and SHALL accept later ready sections without resetting current position.

#### Scenario: Playback begins on first ready section
- **WHEN** Chapter 1 finishes generating while Chapters 2 through 10 are queued
- **THEN** the system SHALL enable the "Play now" control and allow the user to listen to Chapter 1 immediately while remaining chapters generate asynchronously

#### Scenario: Another book already plays
- **WHEN** the first section of a new edition becomes ready during existing audiobook playback
- **THEN** the app SHALL expose availability without autoplaying it or altering the active listening session

#### Scenario: Playback catches generation
- **WHEN** playback reaches the end of available contiguous ready audio
- **THEN** it SHALL show waiting/failed-section state and continue only when valid next audio is available or the user explicitly navigates

### Requirement: Generic Multi-Provider TTS Dispatch
The system SHALL route audio generation through the existing generic speech provider registry, retaining configured OpenRouter, Pocket TTS (local), Fal.ai, Android sherpa-onnx, ElevenLabs, OpenAI, System and other adapters while adding LFM3 (On-device). Permanent generation SHALL require an adapter that returns exportable audio assets; playback-only adapters SHALL NOT be accepted as durable generation. Requests SHALL respect provider input/output limits, cancellation and immutable edition configuration, and reuse compatible durable speech cache.

#### Scenario: OpenRouter speech model used for generation
- **WHEN** user selects an OpenRouter speech model for an Audio Edition
- **THEN** the system SHALL send synthesize requests using the resolved OpenRouter credentials with per-section text chunking matching the model's maximum input character limit

#### Scenario: LFM3 used for generation
- **WHEN** the user selects installed and compatible LFM3 for an article or book
- **THEN** the normal registry SHALL dispatch bounded segments with the edition's stored voice/locale/model configuration and reuse valid identical cached speech

#### Scenario: Playback-only adapter selected
- **WHEN** an adapter can speak but supplies only a native-playback marker or no exportable audio
- **THEN** the dialog SHALL disable permanent generation with an explanation rather than persist the marker as a ready audio path

### Requirement: Document-Text Voice Audition Preview
The system SHALL provide a short narrator preview using text from the active document's opening readable content, targeting approximately 5-to-10 seconds and labeling duration as approximate before synthesis. The preview SHALL use the same provider/voice/locale configuration and normalization as the proposed edition, follow common focus rules and remain cancellable without creating a chapter.

#### Scenario: User auditions narrator voice
- **WHEN** user clicks the preview button next to a candidate voice in the creation dialog
- **THEN** the system SHALL synthesize a short sample of the current document's opening paragraph and play the resulting audio without persisting a full chapter

#### Scenario: Close preview during model load
- **WHEN** the dialog closes or preview is cancelled while loading/synthesizing
- **THEN** obsolete output SHALL NOT play later or create an edition section

### Requirement: Durable Generation Job Queue
The system SHALL persist active/queued generation control, immutable narration/segmentation plan and committed segment checkpoints in local durable storage, enabling safe automatic resumption after crashes/restarts for jobs whose saved intent is running. User-paused/cancelled jobs SHALL remain inactive. Recovery SHALL revalidate source/model/configuration and retain valid completed work without requiring an in-memory text map. Existing edition/section states SHALL be retained with additive control/phase metadata for queued, loading, paused, partial and cancelled presentation.

#### Scenario: Application closed during multi-chapter generation
- **WHEN** the application is terminated while generating Chapter 4 of an Audio Edition
- **THEN** upon restart, the system SHALL restore the job, keep Chapters 1-3 and valid Chapter 4 segment checkpoints ready, and resume only unfinished valid work without duplicating successful synthesis

#### Scenario: Paused or cancelled job on restart
- **WHEN** an application restart restores a job the user paused or cancelled
- **THEN** it SHALL remain inactive with completed audio retained until an explicit resume/retry action

#### Scenario: Missing source or original model
- **WHEN** recovery cannot resolve the original source text revision or required model/configuration
- **THEN** the job SHALL wait with an actionable explanation and SHALL NOT silently synthesize changed text or use the newest defaults

#### Scenario: Late result after cancellation
- **WHEN** a segment returns after persisted pause/cancel/deletion changed the job epoch
- **THEN** it SHALL NOT update the section to ready or restart the job

## ADDED Requirements

### Requirement: Local edition estimates disclose time and storage uncertainty
LFM3 edition creation SHALL show source size, estimated narration duration, permanent audio storage and model installation requirements separately, with no recurring remote inference charge. Time estimates SHALL use measured device/backend throughput where available and SHALL be labeled approximate or unknown. Disk preflight and commit-time checks SHALL pause safely on insufficient space, retaining successful work.

#### Scenario: Unbenchmarked local device
- **WHEN** the user creates a first LFM3 edition on a device without throughput evidence
- **THEN** the UI SHALL label time estimates as unknown/provisional rather than presenting an invented completion time

#### Scenario: Disk fills during chapter generation
- **WHEN** available storage becomes insufficient after generation starts
- **THEN** the job SHALL pause/fail with space-recovery guidance, retain valid completed audio and SHALL NOT mark incomplete audio ready

### Requirement: Local segment retries are idempotent and preserve success
Each local generation segment SHALL have a stable identity and committed asset metadata. Retrying failures or recovering a crash SHALL reuse verified completed segments, never delete successful chapters, and apply a bounded recorded automatic retry policy. Final section assembly SHALL validate audio/anchors and commit atomically before readiness.

#### Scenario: Retry one failed chapter
- **WHEN** a chapter containing committed segments and one failed segment is retried
- **THEN** only missing/invalid segments and required final assembly SHALL run and earlier successful chapters SHALL remain available

#### Scenario: Crash after asset rename before manifest update
- **WHEN** a crash leaves an audio file published without a successful manifest transaction
- **THEN** recovery SHALL reconcile or reclaim that unreferenced file without exposing a false ready section or duplicating committed work
