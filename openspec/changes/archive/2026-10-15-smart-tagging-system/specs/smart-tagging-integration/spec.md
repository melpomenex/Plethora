# smart-tagging-integration Specification

## ADDED Requirements

### Requirement: Smart Tagging is enabled by default
Smart Tagging SHALL be enabled by default for all users (both new installations and existing upgraded databases). The system SHALL NOT require any initial configuration or setup wizards before Smart Tagging operates.

#### Scenario: Default setting on fresh install
- **GIVEN** a new user launches Plethora for the first time
- **WHEN** the user inspects Settings -> Documents -> Smart Tagging
- **THEN** the setting `Smart Tagging` is `Enabled` (`true`)
- **AND** mode is set to `Automatic`

#### Scenario: User disables Smart Tagging
- **GIVEN** a user who prefers strictly manual organization
- **WHEN** the user toggles `Smart Tagging` to `Off` in Settings
- **THEN** subsequent document imports do not run automated tag classification
- **AND** existing tags remain untouched

### Requirement: Asynchronous, non-blocking ingestion post-processing
Document import SHALL NEVER block or fail due to Smart Tagging processing. Imported items SHALL appear in the library and reader immediately, with Smart Tagging executing asynchronously as a post-processing step.

#### Scenario: Immediate library availability during background tagging
- **WHEN** a user imports a 30MB PDF document or web article
- **THEN** the document is persisted and immediately visible in the Library and Reading Queue
- **AND** Smart Tagging executes asynchronously in the background
- **AND** inferred tags appear on the document card and metadata inspector once classification completes

#### Scenario: Ingestion coverage across all document types
- **WHEN** items enter Plethora via any supported ingestion path (PDF, EPUB, Web Article, YouTube, Twitter/X thread, Podcast transcript, Markdown folder, or Clipboard paste)
- **THEN** each imported item is enqueued for asynchronous Smart Tagging post-processing

### Requirement: Clear separation between deterministic metadata and semantic tags
Deterministic document metadata (e.g. `PDF`, `Web Article`, `YouTube`, `x-thread`, `author`, `hostname`, `language`, `import date`) SHALL NOT be inferred through expensive semantic classification. Known structural metadata SHALL be populated directly by extractors.

#### Scenario: Source metadata preserved without LLM inference
- **GIVEN** an article imported from `developer.mozilla.org`
- **WHEN** ingestion populates document metadata
- **THEN** domain `developer.mozilla.org` and format `html` are recorded deterministically
- **AND** Smart Tagging focuses strictly on semantic subject matter (e.g. `JavaScript`, `CSS Grid`, `Web APIs`)

### Requirement: Concurrency control and mobile battery safety
The system SHALL throttle concurrent background tagging tasks to prevent CPU exhaustion, local model contention, mobile battery drain, or cloud rate limits.

#### Scenario: Batch import rate limiting
- **WHEN** a user imports 50 documents simultaneously via drag-and-drop or folder import
- **THEN** all 50 documents are registered in the library immediately
- **AND** Smart Tagging processes the batch sequentially or with a bounded concurrency pool (maximum 2 concurrent tagging jobs)
- **AND** on mobile devices, background tagging pauses when low power mode or extreme battery drain is detected

### Requirement: Safe database migration
Upgrading to Smart Tagging SHALL NOT alter, delete, or overwrite any existing user-created tags or historical document data.

#### Scenario: Migration preserves existing library state
- **GIVEN** an existing Plethora database containing hundreds of user documents
- **WHEN** the application updates and runs migrations
- **THEN** all existing tag assignments are preserved
- **AND** Smart Tagging is activated for subsequent imports
- **AND** an optional maintenance tool is surfaced to review or retag previously imported items
