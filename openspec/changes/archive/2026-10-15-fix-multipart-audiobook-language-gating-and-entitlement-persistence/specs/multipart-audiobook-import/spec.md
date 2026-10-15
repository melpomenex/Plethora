# multipart-audiobook-import Specification

## Purpose
Defines semantic folder-import planning, the canonical persistence shape for audiobooks composed of multiple physical files, ordering/title derivation, duplicate-import identity, atomicity, and player consumption — so that physical file count never determines library document count.

## ADDED Requirements

### Requirement: Canonical Multi-File Audiobook Representation
The system SHALL represent an audiobook composed of multiple physical audio files as exactly ONE library Document of file type `audio`, ONE `AudioEdition` with provider `imported` and status `ready`, and N `AudioEditionSection` records — one per physical file, each with `generation_status` `ready`, its own staged `audio_file_path`, probed `duration_sec`, derived `title`, and play-order `section_index`.

#### Scenario: Directory of numbered tracks imported
- **WHEN** the user imports a directory containing `01 - An Unexpected Party.mp3`, `02 - Roast Mutton.mp3`, `03 - A Short Rest.mp3`
- **THEN** the system SHALL create exactly 1 document, 1 ready imported audio edition, and 3 ready sections titled after their tracks
- **AND** the library SHALL show a single item whose chapters are the three tracks in order

#### Scenario: No new schema
- **WHEN** a multipart audiobook is imported
- **THEN** the system SHALL persist it using the existing `documents`, `audio_editions`, and `audio_edition_sections` tables without schema migration

### Requirement: Semantic Import Planning Before Persistence
The system SHALL classify picked folder candidates and group them into semantic import units BEFORE persistence, producing a plan of multipart audiobook units and ordinary standalone files.

#### Scenario: Multiple books in one selected root
- **WHEN** the selected root contains `Book A/01.mp3`, `Book A/02.mp3`, `Book B/01.mp3`, `Book B/02.mp3`, and `notes.pdf`
- **THEN** the system SHALL produce 2 audiobook units and 1 standalone document import
- **AND** SHALL NOT merge the two books into one audiobook

#### Scenario: Mixed-content folder
- **WHEN** the selected folder contains a book directory with two audio files plus `paper.pdf` and `notes.md`
- **THEN** the system SHALL create 1 audiobook, 1 PDF document, and 1 Markdown document

#### Scenario: Picked root folder is the book
- **WHEN** the user picks a folder whose audio files sit directly in it (no subdirectories) — e.g. a book folder of chapter-named tracks sharing no filename base
- **THEN** the system SHALL create ONE audiobook titled by the picked folder's name

#### Scenario: Flat folder of unrelated audio
- **WHEN** the user picks a flat folder containing unrelated audio files (e.g. a downloads folder)
- **THEN** the system SHALL create one audiobook under the folder name
- **AND** the user SHALL be able to delete or re-title the result and import such files individually instead

#### Scenario: Loose multi-file picks require filename evidence
- **WHEN** audio files arrive from a multi-file picker (no folder semantics)
- **THEN** the system SHALL group them into one book only when every filename matches the same base-title pattern
- **AND** SHALL import each file standalone when the evidence does not match

#### Scenario: Standalone audio unaffected
- **WHEN** the user imports a single `.mp3`, `.m4b`, or other audio file
- **THEN** the system SHALL import it through the ordinary single-file audio path without multipart logic

### Requirement: Disc-Folder Merging and Directory Evidence
The system SHALL treat directory boundaries as strong grouping evidence and SHALL merge sibling subdirectories whose names match a volume keyword plus number (`disc`, `disk`, `cd`, `part`, `pt`, `vol`, `volume`, `book`, `chapter`, `side` — case-insensitive, optional separator, e.g. `Disc 1`, `cd2`, `Part 10`) into a single audiobook unit under their parent directory.

#### Scenario: Multi-disc layout
- **WHEN** a book directory contains `Disc 1/01.mp3`, `Disc 1/02.mp3`, `Disc 2/01.mp3`
- **THEN** the system SHALL create ONE audiobook whose section order is Disc 1 Track 1, Disc 1 Track 2, Disc 2 Track 1

#### Scenario: Volume-named subfolders
- **WHEN** a book directory contains `Part 1/*.mp3` and `Part 2/*.mp3` with duplicate basenames across the two subfolders
- **THEN** the system SHALL create ONE audiobook under the parent directory name with every part staged as its own distinct file

### Requirement: Deterministic Natural Ordering
The system SHALL order sections with natural numeric ordering such that `2` precedes `10`, and SHALL let embedded disc/track metadata outrank filename order when present for all parts. Extension matching SHALL be case-insensitive.

#### Scenario: Natural sort of numbered files
- **WHEN** files named `1.mp3`, `2.mp3`, `10.mp3` are imported as one book
- **THEN** section order SHALL be 1, 2, 10

#### Scenario: Embedded track order wins
- **WHEN** filename ordering disagrees with consistent embedded track numbers
- **THEN** the system SHALL order sections by the embedded track (and disc) numbers

#### Scenario: Metadata probe failure degrades gracefully
- **WHEN** a part's tags/duration cannot be probed (unsupported codec such as WMA, or a corrupt file)
- **THEN** the import SHALL succeed with a filename-derived title and zero duration for that section
- **AND** the duplicate fingerprint SHALL omit the duration term for that part so partially-probed imports still dedup

### Requirement: Chapter Title Derivation
The system SHALL derive each section title as the first available of: embedded track title; cleaned filename with numbering prefixes stripped; `Chapter N` (1-based). Book title and author SHALL come from explicit input, else consistent embedded album/album-artist metadata, else `Author - Title` parsing of the directory name.

#### Scenario: Numbered filename without tags
- **WHEN** a part is named `004 - The Troll.mp3` and carries no embedded title tag
- **THEN** the section title SHALL be `The Troll` (numbering prefix stripped)
- **AND** SHALL NOT be the raw filename with padding digits

### Requirement: App-Owned Collision-Safe Staged Copies
The system SHALL copy every part of a multipart audiobook into durable app-owned storage before creating records, using collision-safe destinations so parts with identical basenames (e.g. `Disc 1/01.mp3` and `Disc 2/01.mp3` staged within the same second) never overwrite each other, and section `audio_file_path` values SHALL reference those staged copies — never user-picked originals — so playback survives removal of the source directory and application restart.

#### Scenario: Source directory removed after import
- **WHEN** the user deletes the originally imported folder after import completes
- **THEN** every chapter SHALL remain playable from its staged copy

#### Scenario: Duplicate basenames across volumes
- **WHEN** two parts of one book share the same filename in different subdirectories
- **THEN** each part SHALL be staged to a distinct destination file

### Requirement: Atomic Import with Cleanup
The system SHALL create the document, edition, and all sections for one audiobook in a single database transaction (including element-tree registration and sync journaling for the new document), staging files before the transaction off the async runtime, and SHALL remove staged copies and return an error on any failure — leaving no orphan documents, editions, sections, or files.

#### Scenario: Section persistence fails midway
- **WHEN** creation fails after some parts were staged
- **THEN** the database SHALL contain no partial audiobook for that unit
- **AND** the staged files created by the failed import SHALL be removed

### Requirement: Deterministic Duplicate Import Identity
The system SHALL compute a path-independent import fingerprint from the ordered set of per-part identities (normalized basename, file size, duration) and store it in document metadata and edition generation settings. Re-importing the same audiobook SHALL return the existing document instead of creating a duplicate.

#### Scenario: Same folder imported twice
- **WHEN** the user imports the same audiobook directory a second time
- **THEN** the system SHALL NOT create a second audiobook
- **AND** SHALL report the import as deduplicated against the existing item

#### Scenario: Fingerprint independent of absolute paths
- **WHEN** the same book is imported from a different absolute path or after mobile staging changes paths
- **THEN** the fingerprint SHALL still match the prior import

#### Scenario: Duplicate match against a synced document without local media
- **WHEN** a fingerprint match finds an existing document that has no local imported edition (e.g. the row arrived via sync, which does not carry editions or audio)
- **THEN** the import SHALL stage the files and create the edition and sections onto that existing document
- **AND** the resulting audiobook SHALL be playable

### Requirement: Offline Import Without Remote Dependencies
The system SHALL complete multipart audiobook import using only local metadata probing (tags, duration, filenames); remote metadata or cover enrichment MAY run best-effort afterward but SHALL NOT be required for import success.

#### Scenario: Offline import
- **WHEN** the device has no network connectivity during a folder import
- **THEN** the audiobook SHALL import completely with title/author/chapters derived from local evidence

### Requirement: Continuous Playback Across Section Files
The audiobook player SHALL treat a ready imported edition's sections as one continuous audiobook: chapter list with cumulative start times, next/previous chapter across physical files, automatic end-of-section advance, total duration, and playback position persisted at the logical audiobook level with resume across restart.

#### Scenario: Chapter navigation across files
- **WHEN** the listener presses next-chapter at the end of section 2 of a multi-section book
- **THEN** playback SHALL continue at the start of section 3's physical file without a document switch

#### Scenario: Resume after restart
- **WHEN** the app is restarted mid-book and the audiobook reopened
- **THEN** playback SHALL resume at the saved logical position mapped to the correct section and offset

### Requirement: Section Source Resolution
The player SHALL resolve section audio sources that are filesystem paths through the platform's media resolution path (desktop loopback media server; native mobile local-media resolution) rather than consuming raw paths, consistent with single-file audiobook playback.

#### Scenario: Desktop playback of staged sections
- **WHEN** a desktop user plays an imported multi-file audiobook
- **THEN** each section's staged file SHALL stream through the Range-capable local media server

### Requirement: Deletion Cleanup
Deleting the logical audiobook document SHALL cascade to its edition, sections, anchors, and listening sessions per existing ownership rules, and deleting an imported edition SHALL remove its staged section audio files from app storage.

#### Scenario: Book deleted
- **WHEN** the user deletes an imported multi-file audiobook from the library
- **THEN** no edition/section rows SHALL remain
- **AND** the staged part files SHALL be removed from app-owned storage

### Requirement: Legacy and Generated Editions Preserved
The system SHALL NOT alter existing standalone audiobooks, legacy localStorage-migrated records, TTS-generated editions, or transcript editions, and the legacy migration path SHALL continue to function unchanged.

#### Scenario: Existing TTS edition untouched
- **WHEN** a user imports a new folder while the library contains TTS-generated audio editions
- **THEN** those editions and their sections SHALL be unaffected

### Requirement: Sync Interaction
A multipart audiobook SHALL sync as one logical document row (with path-independent fingerprint metadata); audio binaries and edition/section rows SHALL remain unsynchronized, matching current behavior, and no host-specific absolute path SHALL be used as a cross-device identifier.

#### Scenario: Second device imports the same book
- **WHEN** another synced device imports the same audiobook files independently
- **THEN** the fingerprint in synced document metadata SHALL allow the import to recognize the duplicate
