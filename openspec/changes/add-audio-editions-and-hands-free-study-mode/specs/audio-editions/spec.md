# audio-editions Specification

## Purpose
Defines the canonical data model, lifecycle, storage schema, source revision tracking, and library integration for document-linked Audio Editions in Plethora.

## ADDED Requirements

### Requirement: Canonical Audio Edition Data Model
The system SHALL represent any document-linked audio generation or paired audio as a first-class `AudioEdition` manifest linked to a source document ID and revision hash.

#### Scenario: Audio Edition manifest creation
- **WHEN** an Audio Edition is created for a document
- **THEN** the system SHALL create an `AudioEdition` record containing unique ID, `sourceDocumentId`, `sourceRevisionHash`, TTS provider/model/voice metadata, generation parameters, array of `AudioEditionSection` items, total duration, and generation timestamp

### Requirement: Semantic Section Model and Audio Asset Storage
The system SHALL divide an Audio Edition into ordered `AudioEditionSection` units, each retaining its source section ID, title, anchor boundaries, generation status, duration, local audio asset path, and source-to-audio anchor intervals.

#### Scenario: Section audio asset assignment
- **WHEN** audio synthesis for a section finishes
- **THEN** the system SHALL persist the generated audio file to local app storage, record `durationSec`, `audioFilePath`, and `audioMimeType`, and update the section's `generationStatus` to `ready`

### Requirement: Document Revision and Stale Section Tracking
The system SHALL calculate and store a cryptographic content hash for the source document and each semantic section. When the source document is modified, the system SHALL identify modified sections, mark their audio stale, and retain unchanged sections and valid bookmarks.

#### Scenario: Source document content updated
- **WHEN** a document with an existing Audio Edition is edited
- **THEN** the system SHALL compare new section content hashes against the stored Audio Edition manifest, mark only altered sections as `stale`, and preserve valid completed sections without regenerating them

### Requirement: SQLite Persistence Schema
The system SHALL persist Audio Editions, sections, and anchors in dedicated SQLite tables (`audio_editions`, `audio_edition_sections`, `audio_edition_anchors`) with foreign key constraints, indices on `(source_document_id, status)` and `(section_id, start_time)`, and transactional integrity.

#### Scenario: Manifest queried across application restarts
- **WHEN** the application restarts and opens a document with an existing Audio Edition
- **THEN** the system SHALL load the complete Audio Edition manifest and section states from SQLite without data loss or re-generation

### Requirement: Backward Compatibility and Legacy Migration
The system SHALL provide an idempotent migration path that converts legacy single-file audiobooks, `audiobook-*` localStorage records, and paired EPUB entries into canonical `AudioEdition` records.

#### Scenario: Legacy audiobook record opened
- **WHEN** a user opens an audiobook created in a previous version of Plethora
- **THEN** the system SHALL construct a corresponding `AudioEdition` manifest preserving playback progress, bookmarks, and transcript segments without requiring user reconfiguration

### Requirement: Library and Audiobooks Shelf Integration
The system SHALL display document-linked Audio Editions within the Audiobooks Shelf tab and document context menus, indicating generation state (e.g. Ready, Generating, Stale, Partial) and direct playback triggers.

#### Scenario: Library item context menu opened
- **WHEN** user opens the context menu on any readable EPUB, PDF, or saved article in the library
- **THEN** the system SHALL display "Create Audio Edition" if none exists, or "Listen to Audio Edition" / "Regenerate Audio Edition" if an Audio Edition is already present
