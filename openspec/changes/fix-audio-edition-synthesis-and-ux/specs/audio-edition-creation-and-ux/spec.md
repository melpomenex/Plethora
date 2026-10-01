## Purpose

Provides reliable source document hydration, validated semantic section extraction, queue safety, and cross-application visual progress feedback for audio edition synthesis.

## ADDED Requirements

### Requirement: Document Content Hydration Prior to Audio Edition Configuration
The system SHALL fully load and hydrate the source document's body content, metadata, and table of contents before initializing semantic section extraction and audio pre-flight estimation.

#### Scenario: Document opened from library list summary
- **WHEN** user initiates "Create Audio Edition" on a document from the library whose content is not yet in memory
- **THEN** the system SHALL fetch the full document content and metadata, display a loading state while fetching, and accurately compute section counts, character counts, and duration estimates.

#### Scenario: Document has empty readable text
- **WHEN** the hydrated document contains 0 readable text characters
- **THEN** the system SHALL display an actionable warning indicating that no readable text was found and disable the creation button.

### Requirement: Fallback Semantic Section Content Extraction
The system SHALL ensure that every generated audio edition section contains valid body text. If structural extraction (e.g. EPUB TOC or PDF outline) fails to map text to sections or yields empty sections, the system SHALL fall back to semantic content chunking based on headings or paragraph boundaries.

#### Scenario: EPUB or PDF outline yields empty sections
- **WHEN** section extraction based on TOC or outline produces sections with 0 characters but full document text is present
- **THEN** the system SHALL extract sections by dividing the full document text by heading or paragraph boundaries, ensuring no section has empty content.

#### Scenario: Article without headings
- **WHEN** an article without markdown or HTML headings is processed for an audio edition
- **THEN** the system SHALL partition the text into paragraph-bounded semantic chunks of approximately 1,500 characters.

### Requirement: Synthesis Queue Safety and Empty Section Guardrails
The system SHALL prevent synthesis workers from generating sections with empty text or silently falling back to synthesizing only section titles.

#### Scenario: Section has empty text in queue
- **WHEN** a synthesis job encounters a section where the text to synthesize is empty
- **THEN** the system SHALL mark that section as failed with a descriptive reason rather than synthesizing the title and marking the section as complete.

### Requirement: Real-Time Audio Edition Generation Feedback across App
The system SHALL provide immediate and ambient visual feedback when an audio edition is being synthesized, across the library view, application toolbar, and Audiobooks shelf.

#### Scenario: Audio edition generation initiated
- **WHEN** user submits the Create Audio Edition dialog
- **THEN** the system SHALL enqueue the synthesis job, close the dialog, and display a toast notification with a shortcut to view progress in the Audiobooks tab.

#### Scenario: Generation in progress in library view
- **WHEN** an audio edition is actively synthesizing for a document displayed in the library view
- **THEN** the system SHALL display an active synthesis badge with progress percentage on the document's list item or card.

#### Scenario: Active background jobs indicator in toolbar
- **WHEN** one or more audio edition synthesis jobs are actively running
- **THEN** the system SHALL display an animated progress or pulse indicator on the Audiobooks button in the application toolbar.

### Requirement: Audiobooks Shelf Generation Monitoring and Job Controls
The Audiobooks Shelf SHALL dynamically track active synthesis jobs, correctly prioritize in-progress generation states over partial readiness, display per-section progress, and provide controls to pause, resume, cancel, or retry generation.

#### Scenario: In-progress edition displayed on shelf
- **WHEN** an audio edition is generating with at least one section already completed
- **THEN** the system SHALL display the generating status badge with progress percentage and section counter (e.g. "Section 2 of 5 · 40%") instead of claiming the entire edition is ready.

#### Scenario: Shelf updates reactively during synthesis
- **WHEN** synthesis progress updates or a section completes
- **THEN** the Audiobooks Shelf SHALL reflect the updated completed sections and duration without requiring a manual page reload or tab switch.

#### Scenario: User pauses or cancels job
- **WHEN** user clicks Pause or Cancel on an active edition card
- **THEN** the system SHALL pause or cancel the synthesis worker and update the job state accordingly.
