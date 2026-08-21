# Specification: Import Subsystem Decommissioning

## MODIFIED Requirements

### Requirement: SuperMemo import pipeline is completely removed
The system SHALL remove all dedicated SuperMemo XML/ZIP import capabilities from both frontend and backend codebases, including file pickers, Tauri commands, parsers, and document converters.

#### Scenario: File picker does not offer SuperMemo export option
- **WHEN** the user opens the document or flashcard import dialog (`EnhancedFilePicker.tsx`)
- **THEN** the import sources list includes `"local"`, `"folder"`, `"url"`, `"arxiv"`, `"screenshot"`, `"anki"`, and `"json"`, and does NOT include `"supermemo"`

#### Scenario: Backend does not expose legacy import commands
- **WHEN** the Tauri application registers command handlers in `src-tauri/src/lib.rs`
- **THEN** commands `import_supermemo_package` and `validate_supermemo_package` are NOT registered in `generate_handler![]`

#### Scenario: Unrelated import formats remain fully operational
- **WHEN** the user imports an Anki collection (`.apkg`), Kindle clippings file, Markdown directory, or JSON deck
- **THEN** the import executes successfully with all cards and metadata preserved
