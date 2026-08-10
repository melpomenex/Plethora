## ADDED Requirements

### Requirement: Import eligibility is determined per artifact type
The system SHALL determine whether a completed Studio job can be imported from the job's artifact type, using a single per-type capability lookup rather than a hardcoded list of two types. Artifact types with no defined import behavior SHALL be viewable without offering an import action.

#### Scenario: Importable type offers an import action
- **WHEN** a job completes with an artifact type that has a defined import behavior
- **THEN** the Studio panel offers an import action for that job

#### Scenario: Unsupported type does not offer import
- **WHEN** a job completes with an artifact type that has no defined import behavior
- **THEN** the Studio panel offers viewing but no import action, and does not present a failing import path

#### Scenario: Incomplete job is not importable
- **WHEN** a job is queued, running, failed, or expired-auth
- **THEN** no import action is offered regardless of artifact type

### Requirement: Study Guide and Report import as library documents
The system SHALL import completed study-guide and report artifacts into the Incrementum documents library as documents, so they are available to the queue and to extraction like any other reading material.

#### Scenario: Report import creates a document
- **WHEN** the user imports a completed report or study-guide job
- **THEN** a document is created in the library containing the artifact content, titled from the job, and attributed to its source notebook

#### Scenario: Imported report is queue-eligible
- **WHEN** a report has been imported
- **THEN** it is available to the queue on the same terms as any other imported document

### Requirement: Mind Map and Data Table import as structured documents
The system SHALL import completed mind-map and data-table artifacts into the library while preserving their structured JSON content, so they remain viewable in the existing structured viewers after import.

#### Scenario: Structured artifact import preserves JSON
- **WHEN** the user imports a completed mind-map or data-table job
- **THEN** a library item is created that retains the artifact's structured content

#### Scenario: Structured artifact remains viewable after import
- **WHEN** the user opens an imported mind-map or data-table
- **THEN** it renders through the existing structured viewer rather than as raw text

#### Scenario: Structured content is missing
- **WHEN** the user imports a job whose structured content is absent or unparseable
- **THEN** the system declines the import and tells the user the artifact must be regenerated, without creating a partial library item

### Requirement: Audio Overview imports through the existing podcast pipeline
The system SHALL import a completed audio artifact as a podcast-type library item, reusing the application's existing podcast handling rather than a NotebookLM-specific player.

#### Scenario: Audio import creates a podcast item
- **WHEN** the user imports a completed audio job
- **THEN** the media is retrieved and registered as a podcast-type library item playable through the existing podcast surface

### Requirement: Imported audio carries playback duration
The system SHALL populate the duration of an imported audio artifact by probing the downloaded media file, since the upstream service does not report duration.

#### Scenario: Duration is populated after import
- **WHEN** an audio artifact has been imported and its media file is present
- **THEN** the item's duration is derived from the file and shown wherever durations are displayed

#### Scenario: Duration cannot be probed
- **WHEN** the media file's duration cannot be determined
- **THEN** the item remains playable and the missing duration is handled the same way as any other item lacking one

#### Scenario: Playback progress
- **WHEN** the user plays an imported audio item that has a known duration
- **THEN** progress is reported against that duration like any other podcast item

### Requirement: Video Overview imports as a library item
The system SHALL import a completed video artifact into the library as a video item, retrieving the media referenced by the job rather than leaving the artifact view-only.

#### Scenario: Video import creates a library item
- **WHEN** the user imports a completed video job
- **THEN** the media is retrieved and registered as a library item playable through the application's existing video surface

#### Scenario: Media reference is missing
- **WHEN** the user imports an audio or video job that carries no media reference
- **THEN** the system declines the import with an explanatory message and creates no library item

### Requirement: Slide Deck imports as a PDF document
The system SHALL import a completed slide-deck artifact into the library as a PDF document, so it is rendered and covered by the library's existing PDF handling.

#### Scenario: Slide deck import creates a PDF document
- **WHEN** the user imports a completed slide-deck job
- **THEN** the deck is retrieved as a PDF and registered as a PDF document in the library

#### Scenario: Imported deck uses existing PDF rendering
- **WHEN** the user opens an imported slide deck
- **THEN** it renders through the library's existing PDF surface rather than a NotebookLM-specific viewer

### Requirement: Infographic imports as an image document
The system SHALL import a completed infographic artifact into the library as an image document, using the image file type rather than the generic other type.

#### Scenario: Infographic import creates an image document
- **WHEN** the user imports a completed infographic job
- **THEN** the infographic image is retrieved and registered as an image-type library document

#### Scenario: Imported infographic is viewable
- **WHEN** the user opens an imported infographic
- **THEN** the image is displayed in the image viewer

### Requirement: Imported infographics are OCR'd for text extraction
The system SHALL run OCR on an imported infographic using the user's configured OCR provider, so the resulting document carries extractable text rather than being viewable only. The system SHALL NOT hardcode a provider.

#### Scenario: OCR uses the configured provider
- **WHEN** an infographic is imported and the user has an OCR provider configured
- **THEN** OCR runs through that provider and the recognized text is stored with the document

#### Scenario: Default provider
- **WHEN** an infographic is imported and the user has not chosen a provider
- **THEN** OCR runs through the application's default local provider

#### Scenario: Extraction from an imported infographic
- **WHEN** the user creates an extract from an imported infographic that has been OCR'd
- **THEN** the recognized text is available to extract from

#### Scenario: OCR fails or is unavailable
- **WHEN** OCR fails, or no OCR provider is available
- **THEN** the infographic is still imported and viewable, and the failure does not abort the import

### Requirement: Imported artifacts land at the collection library root
The system SHALL place every imported artifact at the root of the user's collection library, so it is picked up by the Queue for review on the same terms as any other library item.

#### Scenario: Import destination
- **WHEN** any artifact is imported
- **THEN** the resulting document is created at the root of the user's collection library rather than in a NotebookLM-specific or nested location

#### Scenario: Imported artifact reaches the queue
- **WHEN** an imported artifact meets the queue's normal criteria
- **THEN** it appears in the Queue for review without further user action

#### Scenario: Import while no collection is active
- **WHEN** an import occurs and no collection context can be resolved
- **THEN** the system imports to the default library root rather than failing the import

### Requirement: Media retrieval uses the authenticated session
The system SHALL retrieve artifact media through the underlying CLI's download facility for the artifact's type, rather than fetching a stored media URL directly.

#### Scenario: Retrieval for each media type
- **WHEN** the user imports an audio, video, slide-deck, or infographic job
- **THEN** the media is retrieved through the download path for that artifact type using the authenticated session

#### Scenario: Session no longer valid
- **WHEN** media retrieval fails because the session is no longer authenticated
- **THEN** the system reports the authentication failure distinctly from a transfer failure, so the user knows to reconnect rather than regenerate

### Requirement: Media download failures leave the library unchanged
The system SHALL treat retrieval of artifact media as a fallible operation and SHALL NOT create or partially populate a library item when retrieval fails.

#### Scenario: Download fails mid-transfer
- **WHEN** media retrieval fails or is interrupted after partial transfer
- **THEN** no library item is created, any partial file is discarded, and the user is told the import failed

#### Scenario: Retry after failure
- **WHEN** the user retries an import that previously failed
- **THEN** the import proceeds from a clean state and does not produce a duplicate library item

### Requirement: User can export a payload-backed artifact to a file
The system SHALL let the user export an artifact whose content is carried in the job payload — flashcards, quiz, report, study guide, mind map, and data table — to a file of their choosing, in JSON, Markdown, or HTML.

#### Scenario: Exporting an artifact
- **WHEN** the user chooses to export a completed payload-backed artifact and picks a destination
- **THEN** the artifact is written to that path in the chosen format

#### Scenario: Export is cancelled
- **WHEN** the user dismisses the destination picker without choosing a path
- **THEN** no file is written and no error is reported

#### Scenario: Export fails
- **WHEN** writing the file fails
- **THEN** the user is told the export failed

#### Scenario: Suggested filename
- **WHEN** the destination picker opens
- **THEN** it suggests a filename identifying the artifact type, with an extension matching the chosen format

### Requirement: Exported content reflects the artifact's actual payload
The system SHALL include the artifact's own content in every supported export format. Markdown export SHALL carry text content and structured content, not only flashcards and quiz items.

#### Scenario: Exporting a report as Markdown
- **WHEN** the user exports a report or study guide as Markdown
- **THEN** the file contains that artifact's text content and is not empty

#### Scenario: Exporting a structured artifact as Markdown
- **WHEN** the user exports a mind map or data table as Markdown
- **THEN** the file contains that artifact's structured content and is not empty

#### Scenario: Exporting flashcards or a quiz as Markdown
- **WHEN** the user exports flashcards or a quiz as Markdown
- **THEN** the file contains the cards or questions as it did before

#### Scenario: Artifact carries no content
- **WHEN** the user exports an artifact whose payload is empty
- **THEN** the system reports that there is nothing to export rather than writing an empty file

### Requirement: Export is not offered for media artifacts
The system SHALL NOT offer file export for audio, video, slide-deck, or infographic artifacts, whose content is a binary file rather than payload content; importing those artifacts is how they reach the user's disk.

#### Scenario: Media artifact offers no export
- **WHEN** the user views a completed audio, video, slide-deck, or infographic artifact
- **THEN** no export action is offered, and the import action is available instead

### Requirement: Imported artifacts are traceable to their origin
The system SHALL record, for each imported artifact, the notebook and job it came from.

#### Scenario: Origin recorded on import
- **WHEN** any artifact is imported into the library
- **THEN** the resulting item records its source notebook and source job identifiers

#### Scenario: Re-import is not silently duplicated
- **WHEN** the user imports a job that has already been imported
- **THEN** the system informs the user it was already imported rather than creating a second library item without acknowledgement
