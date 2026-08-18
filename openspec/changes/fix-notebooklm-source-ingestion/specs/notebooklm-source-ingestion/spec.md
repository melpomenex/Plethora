## ADDED Requirements

### Requirement: Typed Source Classification
The NotebookLM source ingestion layer SHALL accept explicit typed source variants (`LocalFile`, `Text`, `Url`, `YouTube`, or `LibraryDocument`) rather than ambiguous untyped strings. Raw document text MUST NOT be interpreted as a URL or a file path.

#### Scenario: User attaches a web URL
- **WHEN** a user provides a web URL starting with `http://` or `https://`
- **THEN** the system classifies the source as `Url` and passes `--type url` with the URL to the NotebookLM CLI.

#### Scenario: User attaches a YouTube video link
- **WHEN** a user provides a valid YouTube watch or share URL
- **THEN** the system classifies the source as `YouTube` and passes `--type youtube` with the URL to the NotebookLM CLI.

#### Scenario: User provides arbitrary raw text
- **WHEN** a user inputs raw text (including text containing URL schemes, colons, or code snippets)
- **THEN** the system classifies the source as `Text` and stages it via an explicit text transport rather than URL auto-detection.

### Requirement: Original File Ingestion for Supported Formats
When a user adds a document from the Plethora library whose original file exists on disk and has an extension supported by NotebookLM file uploads (`.pdf`, `.epub`, `.docx`, `.txt`, `.md`), the system SHALL upload the original file directly rather than flattening the document to extracted text.

#### Scenario: Adding a PDF document from library
- **WHEN** the user attaches a library PDF document whose file exists at `/path/to/paper.pdf`
- **THEN** the backend invokes `notebooklm source add /path/to/paper.pdf --type file --title <doc.title> --notebook <notebook_id> --json`.

#### Scenario: Adding an EPUB document from library
- **WHEN** the user attaches a library EPUB document whose file exists at `/path/to/book.epub`
- **THEN** the backend invokes `notebooklm source add /path/to/book.epub --type file --title <doc.title> --notebook <notebook_id> --json` without reading the entire book into memory or IPC payloads.

### Requirement: Scoped UTF-8 Temporary File Transport for Text
For synthetic text, web articles (where direct HTML file upload is rejected by NotebookLM), or documents where the on-disk file is unavailable, the system SHALL write the content as UTF-8 encoded text to a temporary `.md` or `.txt` file in the application's scoped cache directory, upload the temporary file with `--type file`, and automatically delete the temporary file upon completion or failure.

#### Scenario: Attaching a web article document
- **WHEN** a user attaches an imported web article whose original source is HTML
- **THEN** the system extracts clean markdown/text, writes it to a temporary file `<app_cache>/notebooklm_sources/<uuid>.md` encoded in UTF-8, invokes `notebooklm source add <temp_path> --type file --title <article.title> ...`, and removes the temporary file after the CLI command completes.

#### Scenario: Temporary file cleanup on failure
- **WHEN** the NotebookLM CLI fails, times out, or returns an error during upload of a temporary text file
- **THEN** the temporary file is unlinked immediately by the RAII guard and no orphaned files remain in storage.

### Requirement: Process Argv Protection
The system SHALL NEVER pass raw document bodies, book chapters, or multi-kilobyte text payloads as positional arguments or environment variables to child processes.

#### Scenario: Ingesting a 100KB+ document
- **WHEN** a document containing over 100,000 characters of text is added to NotebookLM
- **THEN** the process `argv` for the spawned CLI process contains only metadata arguments (`subcommand`, `--type`, `--notebook`, `--title`, `--json`, `--storage`, and a file path or URL), and the book body is never present in `argv`.

### Requirement: Redacted and Structured Error Reporting
The system SHALL NOT include raw document contents in application logs, Tauri error responses, or user-facing UI toast notifications. Diagnostic error messages MUST be formatted with structured metadata.

#### Scenario: CLI returns a validation or API error
- **WHEN** the NotebookLM CLI returns an error (such as `VALIDATION_ERROR` or `AUTHENTICATION_ERROR`)
- **THEN** the returned `AppError` and UI error message display a concise message containing the document title and error code without printing the document body.

#### Scenario: Logging source add attempts
- **WHEN** a source add operation is executed
- **THEN** diagnostic logs emit structured fields (`operation`, `source_type`, `transport`, `byte_size`, `title`, `exit_code`, `duration_ms`) and omit document text.

### Requirement: Title Integrity and Process Invocation Safety
Document titles and paths containing spaces, quotes, punctuation, or shell metacharacters SHALL be preserved intact and passed as discrete process arguments without shell interpolation.

#### Scenario: Document with adversarial title
- **WHEN** a document is titled `My Book; rm -rf / --notebook fake "test"`
- **THEN** the title is passed as a discrete argument to `--title` without triggering shell evaluation or option injection.

#### Scenario: Path with spaces
- **WHEN** a document file resides at `/Users/mini/Library/Application Support/com.plethora.app/Incrementum/book.epub`
- **THEN** the path is passed directly to the child process without quote truncation or split errors.

### Requirement: Duplicate Source Guard
The system SHALL check whether a source with identical title or canonical identifier is already attached to the target notebook before initiating an upload, preventing duplicate sources.

#### Scenario: User attempts to re-add an attached document
- **WHEN** the user selects a library document whose title already matches an active source in the selected notebook
- **THEN** the system warns the user and does not spawn an unnecessary duplicate upload command.
