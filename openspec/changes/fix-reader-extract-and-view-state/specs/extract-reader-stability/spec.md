## ADDED Requirements

### Requirement: Independent subviews load without document source blocking
The document viewer SHALL allow independent metadata subviews (Extracts and Learning Cards) to render immediately and manage their own loading and data lifecycle without being blocked or obscured by document binary, PDF range, EPUB stream, or media source loading states.

#### Scenario: Switching to Extracts while document source is loading
- **WHEN** the user switches view mode to "extracts" while a PDF, EPUB, or video file source is still loading
- **THEN** the Extracts list view mounts and renders immediately, driven by extract data availability rather than document source preparation

#### Scenario: Switching to Cards while document source is loading
- **WHEN** the user switches view mode to "cards" while a document source is still loading
- **THEN** the Learning Cards list view mounts and renders immediately, displaying cards without waiting for the source reader to initialize

### Requirement: Subview data loaders ignore stale asynchronous responses
Asynchronous data loading hooks and effects within subviews (`ExtractsList`, `LearningCardsList`) SHALL implement cancellation or request generation guards so that responses from superseded document fetches cannot overwrite the state of a newly selected document.

#### Scenario: Fast document switching in Extracts view
- **WHEN** a fetch for document A's extracts is pending and the user switches to document B
- **THEN** document A's eventual response is discarded, and the Extracts view displays document B's extract items exclusively
