## ADDED Requirements

### Requirement: Generic document import SHALL detect Kindle clippings files before treating them as plain text

The generic document import path (drag & drop, file picker, folder import, and clipboard-paste file paths) SHALL detect when an incoming file is a Kindle `My Clippings.txt` and delegate to the dedicated Kindle clippings parser instead of storing it as a generic `.txt` / markdown document. Detection SHALL be based on BOTH filename (`My Clippings.txt`, case-insensitive, locale-insensitive whitespace) AND a content sniff of the Kindle clippings format (entries separated by `==========` lines, each with a metadata line matching `- Your (Highlight|Note|Bookmark)`). Files that match the filename but fail the content sniff SHALL fall back to the existing plain-text / markdown import behavior.

#### Scenario: User drags My Clippings.txt onto the Library
- **WHEN** user drags a file named `My Clippings.txt` onto the Documents Tab or Library
- **THEN** the importer SHALL detect it as a Kindle clippings file via filename and content sniff
- **THEN** the importer SHALL delegate to the Kindle clippings parser
- **THEN** one Document SHALL be created per unique book (not a single `.txt` document)
- **THEN** one Extract SHALL be created per highlight/note using the existing content-hash dedup
- **THEN** the resulting documents SHALL be openable in the viewer without hitting the "preview not available / coming soon" fallback

#### Scenario: User uses the main Import Document button on My Clippings.txt
- **WHEN** user picks `My Clippings.txt` through the main "Import Document" file picker
- **THEN** the importer SHALL detect it as a Kindle clippings file
- **THEN** the importer SHALL delegate to the Kindle clippings parser and produce per-book documents

#### Scenario: User imports a folder containing My Clippings.txt
- **WHEN** user imports a folder that contains a `My Clippings.txt` file
- **THEN** that file SHALL be detected as a Kindle clippings file and delegated to the Kindle parser
- **THEN** other supported files in the folder SHALL be imported through their normal flow

#### Scenario: User pastes a My Clippings.txt file path
- **WHEN** user pastes a file path whose basename is `My Clippings.txt`
- **THEN** the importer SHALL detect it as a Kindle clippings file and delegate to the Kindle parser

#### Scenario: A plain .txt file that is not Kindle clippings
- **WHEN** user imports a `.txt` file whose content does not match the Kindle clippings format
- **THEN** the importer SHALL NOT treat it as Kindle clippings
- **THEN** the file SHALL be imported using the existing plain-text / markdown behavior unchanged

#### Scenario: A file named My Clippings.txt but with non-Kindle content
- **WHEN** user imports a file whose basename is `My Clippings.txt` but whose content fails the Kindle format sniff
- **THEN** the importer SHALL fall back to the plain-text / markdown import behavior
- **THEN** no Kindle documents or extracts SHALL be created

### Requirement: Kindle clippings detection SHALL be a shared, reusable function

The detection logic SHALL be implemented once and reused by every generic import entry point (backend `import_from_path`, frontend drag-drop, file picker, folder import, and paste handler). It SHALL return a boolean verdict given either a filesystem path or raw bytes, so backend and frontend callers can share the same definition of "is this a Kindle clippings file."

#### Scenario: Backend import_from_path detects Kindle clippings
- **WHEN** `import_from_path` is called with a path whose basename is `My Clippings.txt` and whose content matches the Kindle format
- **THEN** the shared detector SHALL return true
- **THEN** `import_from_path` SHALL delegate to the Kindle clippings importer and return the resulting documents

#### Scenario: Frontend drag-drop detects Kindle clippings before invoking the generic importer
- **WHEN** a dropped file's basename is `My Clippings.txt`
- **THEN** the frontend SHALL route it to the Kindle import flow rather than the generic `importDocument` call

### Requirement: Importing a Kindle clippings file SHALL return one or more documents, not a single document

Because a single `My Clippings.txt` contains highlights from many books, the generic import command SHALL be able to return multiple documents from a single source file when the source is detected as Kindle clippings. Frontend callers SHALL handle the multi-document return shape for Kindle-detected files and update the library with all resulting documents.

#### Scenario: Single My Clippings.txt containing multiple books
- **WHEN** a `My Clippings.txt` containing highlights from 5 books is imported through any generic entry point
- **THEN** the import SHALL produce 5 documents (one per book)
- **THEN** the frontend library state SHALL be refreshed with all 5 documents

#### Scenario: Re-import of the same My Clippings.txt after edits
- **WHEN** the user re-imports the same `My Clippings.txt` after new highlights were added
- **THEN** existing documents and extracts SHALL NOT be duplicated (content-hash dedup)
- **THEN** only genuinely new clippings SHALL produce new extracts

### Requirement: The generic import preview UX for Kindle clippings SHALL match the dedicated flow

When a Kindle clippings file is detected through a generic entry point, the system SHALL present the same preview/dedup UX as the dedicated Settings → Import/Export Kindle flow (the `KindleImportDialog` showing per-book new-vs-existing counts) before writing any data. This preserves the user's ability to review and cancel, and keeps the experience consistent regardless of how the file entered the app.

#### Scenario: Drag-drop of My Clippings.txt opens the preview dialog
- **WHEN** user drops `My Clippings.txt` onto the Library
- **THEN** the `KindleImportDialog` SHALL open with that file's path preloaded
- **THEN** no documents or extracts SHALL be written until the user confirms in the dialog

#### Scenario: Canceling the preview dialog
- **WHEN** user cancels the `KindleImportDialog` after a generic import detected a Kindle clippings file
- **THEN** no documents or extracts SHALL be created
- **THEN** the raw `.txt` file SHALL NOT be left in the library as an unreadable document

### Requirement: Dead or conflicting .txt classifiers SHALL be removed

The codebase SHALL have a single source of truth for `.txt` classification in the live import pipeline. The unregistered, dead `commands/file_drop.rs` module (whose `.txt → Other` classifier contradicts the live `document.rs` classifier) SHALL be either deleted or wired up so that it shares the same detection logic. After this change there SHALL be no second copy of import-classification logic that bypasses Kindle detection.

#### Scenario: No dead import classifier remains that bypasses Kindle detection
- **WHEN** a developer searches the codebase for `.txt` classification logic in the import path
- **THEN** only the shared classifier (with Kindle detection) SHALL be reachable from a live import entry point
- **THEN** no unregistered module SHALL exist that classifies `.txt` without Kindle detection
