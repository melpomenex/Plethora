## Purpose

Provides cross-modal semantic indexing and retrieval for Plethora, mapping document figures on mobile and video/audio keyframes on desktop into EmbeddingGemma 2's unified 768-dimensional vector space.

## ADDED Requirements

### Requirement: Document Figure Extraction and Mobile Vision Embedding
The system SHALL extract embedded figures and diagrams from imported documents (PDF, EPUB, Web) and generate 768-dimensional normalized embeddings on mobile devices using the EmbeddingGemma 2 Text + Vision (440M) LiteRT runtime.

#### Scenario: Mobile visual figure indexed into semantic space
- **WHEN** a PDF containing embedded diagrams is indexed with the Visual Knowledge pack enabled on Android
- **THEN** the system extracts figure images, resizes them to the model input dimensions, computes 768-dimensional embeddings via LiteRT, and saves them to `semantic_chunks` with `source_type = "figure"`

#### Scenario: Mobile model pack availability
- **WHEN** the user inspects On-Device AI settings on Android
- **THEN** the system displays the optional "Visual Knowledge (Text + Vision 440M)" pack (~280 MB) with download and delete controls

### Requirement: Desktop Full Multimodal Video and Audio Ingestion
The desktop application SHALL support embedding video keyframes and audio chunks using the full EmbeddingGemma 2 multimodal (740M) model via local desktop providers.

#### Scenario: Desktop video keyframe indexing
- **WHEN** a local video or lecture is indexed on desktop with Multimodal Indexing enabled
- **THEN** the system samples keyframes across the timeline, computes 768-dimensional vision embeddings, and records chunk timestamps pointing directly to each video frame

#### Scenario: Desktop audio chunk indexing
- **WHEN** an audio file is processed on desktop
- **THEN** the system segments the audio into windows, computes audio embeddings via the multimodal encoder, and links chunks to playback timestamps

### Requirement: Cross-Modal Unified Search and Navigation
The search interface SHALL allow natural language text queries to retrieve and surface visual figures, video moments, and text passages within a single ranked list.

#### Scenario: Text query matches visual figure
- **WHEN** the user searches for a concept depicted in a document figure (e.g., "transformer architecture diagram")
- **THEN** the search results return the figure chunk with an image thumbnail and document page reference, ranking it alongside textual matches

#### Scenario: Selecting visual search result navigates to page
- **WHEN** the user activates a figure search hit in the command palette or search view
- **THEN** the reader opens the parent document and scrolls directly to the visual figure on the target page
