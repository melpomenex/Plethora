## Why

When users attach documents (such as books or articles) from Plethora to NotebookLM, the operation fails with a validation error (`URL scheme '' is not allowed`) and floods the UI with tens of thousands of characters of raw book text. This occurs because Plethora forwards extracted book text as an untyped positional command-line argument to `notebooklm source add` without specifying `--type`. The bundled `notebooklm-py` CLI's auto-detection treats any text containing `"://"` (common in citations, links, or bibliographies) as a URL and rejects it when it fails URL scheme validation.

Furthermore, book text in Plethora suffers from severe character encoding corruption (mojibake like `â` for curly apostrophes and quotes) caused by a byte-level `c as char` cast in the EPUB HTML parser. Additionally, passing complete book texts through process arguments risks hitting operating-system `ARG_MAX` limits, leaks sensitive content into process tables/command logs, and causes unreadable error dumps. A deterministic, typed source-ingestion architecture is needed to preserve original files, safely transport synthetic text, ensure UTF-8 fidelity, and surface concise diagnostic errors.

## What Changes

- **Typed NotebookLM Source Abstraction**: Replace ambiguous untyped string payloads in `notebooklm_add_source` with an explicit, typed domain model (`LocalFile`, `Text`, `Url`, `YouTube`, `LibraryDocument`).
- **Original-File-First Ingestion**: When adding a library document whose backing file exists on disk in a format supported by NotebookLM (`.pdf`, `.epub`, `.docx`, `.txt`, `.md`), upload the original file directly (`--type file <path> --title <title>`), preserving layout, formatting, and figures.
- **Safe Text Fallback with RAII Temp Files**: For synthetic text, web articles (HTML is rejected by NotebookLM's upload endpoint), or documents without an on-disk original, stage clean UTF-8 text to a scoped temporary `.md` or `.txt` file, upload it as `--type file`, and clean up via RAII/drop guards. Large document bodies are **never** passed in process `argv`.
- **Explicit CLI Flag Contract**: Always emit explicit `--type [file|url|youtube|text]` flags to the bundled `notebooklm-py` CLI (version 0.8.0rc1), eliminating ambiguous auto-detection heuristics.
- **UTF-8 Extraction Fix**: Fix `src-tauri/src/processor/epub.rs` to parse HTML characters properly as UTF-8 rather than iterating over raw `u8` bytes and casting `c as char` (which turned multi-byte UTF-8 sequences starting with `0xE2` into `â` mojibake).
- **Concise Error Handling and Redaction**: Redact document payloads from process logs and failure messages. Format user-facing and log errors with concise metadata (`operation`, `source_type`, `title`, `byte_size`, `exit_code`, structured `code`, and trimmed `message`).
- **Process Safety and Portability**: Spawning child processes with discrete arguments across macOS, Linux, and Windows; ensuring paths with spaces and adversarial document titles are never shell-interpolated.
- **Automated Regression Test Suite**: Add unit tests for typed routing, Unicode round-trip preservation fixtures (`’`, `“`, `”`, `—`, `…`, accented characters, CJK), mock CLI execution tests verifying argv emptiness for bodies, and temp-file lifecycle tests.

## Capabilities

### New Capabilities
- `notebooklm-source-ingestion`: Typed, deterministic source ingestion pipeline that chooses between direct original-file upload, scoped UTF-8 temporary-file transport, and explicit URL/YouTube routing with redaction and structured error reporting.
- `unicode-text-extraction`: UTF-8 clean text extraction across EPUB and document processors, preventing byte-to-char conversion bugs and preserving typographical punctuation, accented Latin, and multi-byte Unicode scripts.

### Modified Capabilities
<!-- None: No existing specs in openspec/specs/ define NotebookLM source ingestion contracts -->

## Impact

- **Backend (Rust)**:
  - `src-tauri/src/notebooklm.rs`: Implement typed source models, original-file-first routing, RAII temporary file management, CLI argument construction with explicit `--type`, structured error redaction, and logging.
  - `src-tauri/src/processor/epub.rs`: Replace byte-casting HTML text extraction with UTF-8 char/string parsing.
- **Frontend (TypeScript/React)**:
  - `src/api/integrations.ts`: Update `notebooklmAddSource` request interfaces and type definitions.
  - `src/components/notebooklm/NotebookLMSidebar.tsx`: Update source-add handlers to pass typed requests (e.g. `documentId` or typed source) rather than extracting and dumping full text strings.
- **CLI / Bundled Binaries**:
  - Validated compatibility with bundled `notebooklm-py==0.8.0rc1` CLI sidecar contract (`--type`, `--title`, `--notebook`, `--json`).
- **Dependencies & Storage**:
  - Uses standard `tempfile` / app-cache directory for ephemeral text files with automatic cleanup.
