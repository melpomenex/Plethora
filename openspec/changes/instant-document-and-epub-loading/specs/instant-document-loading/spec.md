## Purpose

Eliminate blocking startup work when opening documents—especially `.epub` books—so the first page renders near-instantly using already-available metadata, parallelized initialization, and cached/idle-deferred indexing.

## ADDED Requirements

### Requirement: Directory-mode EPUB loading
When opening an `.epub` from an entry-level loopback URL, the EPUB reader SHALL open the book in directory mode rather than archive mode so it never downloads or unzips the entire `.epub` file in JavaScript.

#### Scenario: Opening an EPUB via entry-level URL
- **WHEN** the EPUB viewer receives an entry-level base URL
- **THEN** it SHALL initialize the reader in directory mode and fetch only the metadata and active chapter entries needed for initial display

#### Scenario: Legacy or fallback EPUB URL
- **WHEN** the EPUB viewer receives a direct `.epub` archive URL or in-memory byte buffer
- **THEN** it SHALL continue to open the archive using the archive mode fallback

### Requirement: Non-blocking initial EPUB display
The EPUB reader SHALL display the initial chapter as soon as the book metadata and rendition container are ready, without blocking initial render on table-of-contents parsing, redundant backend document fetches, or full-book location generation.

#### Scenario: Saved reading position already available
- **WHEN** the viewer already has the document's saved reading position from store state or local storage
- **THEN** it SHALL start rendering at that position immediately without waiting for an additional backend document query

#### Scenario: Table of contents loads concurrently
- **WHEN** an EPUB is opened
- **THEN** the initial chapter display SHALL proceed without awaiting navigation/TOC parsing completion, and the TOC SHALL populate as soon as it resolves

### Requirement: Cached and idle-deferred EPUB location indexing
The EPUB reader SHALL persist generated location maps in local storage keyed by document identity and archive signature, restoring them on subsequent opens without re-scanning the book, and SHALL defer uncached location generation until after initial paint and idle time.

#### Scenario: Reopening a previously indexed EPUB
- **WHEN** a user reopens an `.epub` whose location map was previously cached for the same file signature
- **THEN** the reader SHALL restore the cached locations immediately without fetching or parsing all spine chapters

#### Scenario: First-time open of an uncached EPUB
- **WHEN** a user opens an `.epub` with no cached location map
- **THEN** the first chapter SHALL render immediately and location generation SHALL be deferred until after initial display settles

### Requirement: Store-first document source resolution
When opening any document whose metadata and file path are already present in the client store, the document viewer SHALL begin resolving the document source immediately in parallel with background metadata hydration rather than waiting for hydration to complete first.

#### Scenario: Opening a document from the library or queue
- **WHEN** a user opens a document that is already present in the client store with a valid file path
- **THEN** source resolution (EPUB stream URL, PDF range source, or media URL) SHALL start immediately without waiting for a serial document-hydration round-trip

### Requirement: Streaming EPUB source in audiobook sync view
The audiobook-EPUB synchronization view SHALL resolve `.epub` sources through the streaming URL endpoint instead of reading the entire `.epub` file into memory over IPC.

#### Scenario: Opening audiobook-EPUB sync view
- **WHEN** a user opens the synchronized audiobook and EPUB view
- **THEN** the EPUB side SHALL load via the streaming URL endpoint rather than reading the entire file bytes over IPC
