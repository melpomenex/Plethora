## Context

Plethora provides an integration with Google NotebookLM that enables users to manage notebooks, attach sources (URLs, YouTube links, and library documents), generate artifacts (flashcards, quizzes, study guides, mind maps), and ask questions.

When attaching library documents (such as books or articles) to a NotebookLM notebook, users experienced a catastrophic failure:
1. The operation failed with `Tauri command "notebooklm_add_source" failed: All notebooklm CLI command attempts failed` and an inner validation error: `URL scheme '' is not allowed; only http and https URLs are accepted as sources`.
2. The entire extracted text of the book (tens of thousands of characters) was dumped into the error message and printed multiple times.
3. Extracted book text exhibited severe character corruption (mojibake like `â` in place of typographical apostrophes, quotation marks, and em dashes).

### Complete Call Graph & Failure Diagnosis

```
User clicks "Add Source" in UI (NotebookLMSidebar.tsx)
  │
  ▼
handleAddLibrarySource() retrieves Document from DB (doc.content, doc.filePath, doc.title)
  │
  ▼
notebooklmAddSource({ notebookId, kind: "file", content: doc.content, title: doc.title })
  │  (Sends full 65KB-5MB string over Tauri IPC)
  ▼
Rust command handler: notebooklm_add_source (src-tauri/src/notebooklm.rs)
  │
  ▼
CliProvider::add_source(ctx, notebook_id, req)
  │  (Constructs argv: ["source", "add", req.content, "--json", "--notebook", notebook_id, "--title", title])
  │  (Note: Discards req.kind! Omits --type entirely!)
  ▼
run_first_success(vec![base, alt]) -> run_notebooklm_command()
  │  (Spawns python3 -m notebooklm.notebooklm_cli source add <65KB+ book text> --json ...)
  ▼
Upstream notebooklm-py (v0.8.0rc1) CLI: build_source_add_plan()
  │
  ├─> Evaluates _is_url_shaped(content) -> checks `"://" in content`
  │   (TRUE because citations, bibliography, or footnotes in the book contain links like https://...)
  │
  ├─> Evaluates validate_url(content) -> urlsplit(content)
  │   (Sees scheme "" because the book starts with "Title Page\nDopamine Detox...", NOT http/https)
  │
  ▼
CLI raises SourceAddValidationError("URL scheme '' is not allowed; only http and https URLs are accepted as sources")
  │
  ▼
Rust run_first_success_with_bootstrap catches error from both attempts (base and alt)
  │  (Formats error: errors.push(format!("{} -> {}", args.join(" "), err)))
  │  (Concatenates entire book text into error string TWICE!)
  ▼
UI receives giant 130KB+ error string and displays failure toast.
```

### Encoding Corruption Root Cause

In `src-tauri/src/processor/epub.rs`, the function `extract_text_from_html(html: &str)` extracts visible text from EPUB XHTML spine items.
Lines 54-71 contained:
```rust
let bytes = html.as_bytes();
...
while i < n {
    let c = bytes[i];
    if c != b'<' {
        if c.is_ascii_whitespace() {
            ...
        } else {
            result.push(c as char); // <--- ROOT CAUSE BUG
        }
        i += 1;
    }
}
```
In Rust, `c` is a `u8` byte. Casting `c as char` converts the raw byte value directly to a Unicode code point (`U+0000..U+00FF`). In UTF-8:
- Typographical right apostrophe `’` is 3 bytes: `0xE2 0x80 0x99`.
  - Byte 0: `0xE2 as char` yields Unicode `U+00E2` = `â` (LATIN SMALL LETTER A WITH CIRCUMFLEX).
  - Bytes 1 & 2: `0x80 as char` and `0x99 as char` yield control codes `U+0080` and `U+0099`.
- Typographical double quotes `“` / `”` are `0xE2 0x80 0x9C` and `0xE2 0x80 0x9D` (leading `â`).
- Em dash `—` is `0xE2 0x80 0x94` (leading `â`).

This corrupted all typographic punctuation into mojibake at document import time when storing `doc.content` in SQLite.

---

## Goals / Non-Goals

**Goals:**
- Provide a typed `NotebookLmSourceInput` abstraction across frontend and backend.
- Upload original document files directly (`.pdf`, `.epub`, `.docx`, `.txt`, `.md`) when available on disk.
- Provide a scoped, ephemeral UTF-8 temporary file transport for synthetic text, web articles (where direct HTML file upload is rejected by NotebookLM), and documents lacking on-disk files.
- Guarantee that large document bodies are **never** passed in process `argv`.
- Pass explicit `--type [file|url|youtube|text]` arguments on every CLI invocation.
- Fix EPUB HTML text extraction to be 100% UTF-8 clean.
- Format concise, structured errors and redact document bodies from logs and UI errors.
- Ensure safety against path traversal, paths with spaces, and shell injection.

**Non-Goals:**
- Rewriting NotebookLM authentication, chat, or notebook management.
- Modifying non-EPUB document format engines unless encoding bugs exist.
- Replacing the bundled `notebooklm-py` CLI dependency.

---

## Decisions

### Decision 1: Typed Source Abstraction

Replace ambiguous untyped string payloads in `AddSourceRequest` with an explicit domain model.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NotebookLmSourcePayload {
    /// Direct file on disk
    File {
        path: String,
        title: Option<String>,
        mime_type: Option<String>,
    },
    /// Web URL
    Url {
        url: String,
        title: Option<String>,
    },
    /// YouTube Video URL
    Youtube {
        url: String,
        title: Option<String>,
    },
    /// In-memory text (transported via ephemeral temp file)
    Text {
        text: String,
        title: Option<String>,
    },
    /// Existing Plethora Library Document ID
    Document {
        document_id: String,
        title: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSourceRequest {
    pub notebook_id: Option<String>,
    #[serde(flatten)]
    pub payload: NotebookLmSourcePayload,
}
```

*Rationale*:
- Eliminates ambiguous string interpretation where text could be mistaken for URLs or file paths.
- Allows frontend to send `{ kind: "document", documentId: "..." }` without loading and transmitting multi-megabyte text payloads over IPC.
- Backwards-compatible deserializer fallback can be provided if legacy callers pass `{ kind: "...", content: "...", title: "..." }`.

*Alternatives Considered*:
- Keep `content: String` and use regex to detect URLs vs paths. *Rejected*: Heuristics are inherently fragile (the root cause of the current bug).

---

### Decision 2: Document Source Routing Preference Matrix

When adding a library document, Plethora chooses the ingestion mechanism based on the following preference table:

| Document Type / State | Physical File Status | NotebookLM Upload Capability | Chosen Ingestion Strategy | CLI Invocation |
| :--- | :--- | :--- | :--- | :--- |
| **PDF** (`.pdf`) | Exists on disk | Fully supported (`application/pdf`) | **Original File** | `source add <path> --type file --title <title>` |
| **EPUB** (`.epub`) | Exists on disk | Fully supported (`application/epub+zip`) | **Original File** | `source add <path> --type file --title <title>` |
| **Markdown** (`.md`) | Exists on disk | Fully supported (`text/markdown`) | **Original File** | `source add <path> --type file --title <title>` |
| **Plain Text** (`.txt`) | Exists on disk | Fully supported (`text/plain`) | **Original File** | `source add <path> --type file --title <title>` |
| **DOCX** (`.docx`) | Exists on disk | Fully supported | **Original File** | `source add <path> --type file --title <title>` |
| **HTML / Web Article** | HTML file or DB HTML | **Rejected by NotebookLM upload** | **Scoped UTF-8 Temp Markdown** | `source add <temp.md> --type file --title <title>` |
| **Synthetic / Note** | No disk file | Raw text | **Scoped UTF-8 Temp Markdown** | `source add <temp.md> --type file --title <title>` |
| **Missing Disk File** | File moved/missing | Extracted text in DB | **Scoped UTF-8 Temp Text** | `source add <temp.txt> --type file --title <title>` |
| **Web URL Source** | N/A | Supported via URL scraper | **Explicit URL** | `source add <url> --type url --title <title>` |
| **YouTube Video** | N/A | Supported via YouTube scraper | **Explicit YouTube** | `source add <url> --type youtube --title <title>` |

*Rationale*:
- Original files preserve semantic structure, page layouts, tables, and embedded images that plain text reflow discards.
- NotebookLM's server endpoint explicitly rejects raw HTML file uploads (`.html`, `.htm`). Converting web articles to clean markdown and uploading as a `.md` file is robust and supported.

---

### Decision 3: Ephemeral UTF-8 File Transport & RAII Lifecycle

When raw text or synthetic document content must be ingested:
1. Write the content to a temporary file in the app's cache directory: `<app_cache>/notebooklm_staged/<uuid>.md` (or `.txt`).
2. Write with UTF-8 encoding without BOM.
3. Wrap the file in an RAII struct `ScopedTempSourceFile` whose `Drop` implementation calls `std::fs::remove_file`.
4. Spawn `notebooklm source add <temp_file_path> --type file --title <title> ...`.
5. Upon completion or process failure, `ScopedTempSourceFile` is dropped and cleans up the temporary file.
6. A startup cleanup sweep removes any orphaned `.tmp` or `.md` files in `<app_cache>/notebooklm_staged/` older than 1 hour.

*Rationale*:
- Completely prevents document text from entering process `argv` or environment variables.
- Works identically on macOS, Linux, and Windows.
- Eliminates `ARG_MAX` buffer limits.
- Guarantees zero orphaned files on disk even when uploads fail or throw errors.

---

### Decision 4: Bundled CLI Contract & Compatibility Strategy

Inspection of the bundled CLI sidecar (`notebooklm-py==0.8.0rc1`) reveals:
- Subcommand syntax: `notebooklm source add <CONTENT> [OPTIONS]`
- Supported options:
  - `--type [url|text|file|youtube]` (Mandatory to prevent heuristic mistakes)
  - `-n, --notebook TEXT`
  - `--title TEXT`
  - `--mime-type TEXT`
  - `--json`
- In `notebooklm.rs`, `run_first_success` was trying both `--notebook` and `-n` sequentially. Since `notebooklm-py` 0.8.0rc1 supports both, we standardize on `--notebook` (with fallback only if necessary) and do NOT retry on server-side validation or auth errors.

---

### Decision 5: Fixing EPUB UTF-8 Extraction

Rewrite `extract_text_from_html` in `src-tauri/src/processor/epub.rs`:
- Instead of iterating over `html.as_bytes()` and pushing `c as char`, use `html.chars()` or slice string ranges on character boundaries.
- For HTML stripping, integrate safe string processing or reuse `html2text` / `scraper` / character-aware state machine that preserves full Unicode scalar values.
- Add comprehensive test fixtures testing smart quotes (`’`, `“`, `”`), em dashes (`—`), ellipses (`…`), accented Latin (`é`, `ü`, `ñ`), and CJK (`日本語`).

---

### Decision 6: Redaction and Structured Error Reporting

Overhaul error handling in `src-tauri/src/notebooklm.rs`:
1. `run_notebooklm_command` and `run_first_success`:
   - Summarize arguments in error logs: Replace any file paths or content arguments with `[file: <filename>, size: <bytes>]`.
   - Never use `args.join(" ")` when logging or constructing error messages.
2. Structured Error Parsing:
   - When the CLI exits with non-zero status and outputs JSON: `{"error": true, "code": "VALIDATION_ERROR", "message": "..."}`, parse `code` and `message` directly into `AppError::IntegrationError(format!("{}: {}", code, clean_message))`.
3. Logging:
   - Log metadata: `tracing::info!(operation = "source_add", source_type = "file", title = %title, bytes = byte_count)`.

---

## Risks / Trade-offs

- **[Risk] Original document file has moved or is inaccessible**
  → *Mitigation*: Check `Path::new(&doc.file_path).is_file()`. If missing, log a warning and fall back to the ephemeral UTF-8 text transport using `doc.content`.
- **[Risk] Path traversal in custom titles or filenames**
  → *Mitigation*: Temporary files use randomly generated UUIDs (`Uuid::new_v4()`). Titles are passed strictly via `--title` as discrete arguments to `Command::arg()`, never used as filesystem path segments.
- **[Risk] Spaces or special characters in document paths**
  → *Mitigation*: Use `tokio::process::Command::arg()` directly. Never construct shell strings or invoke via `/bin/sh -c`.
- **[Risk] Legacy documents in database already contain mojibake**
  → *Mitigation*: When attaching a library document whose original file exists on disk, original-file-first ingestion bypasses the database text entirely, giving NotebookLM the pristine source.

---

## Migration Plan

1. **Phase 1: UTF-8 Parser Fix**: Update `src-tauri/src/processor/epub.rs` and verify with unit tests.
2. **Phase 2: Backend Source Ingestion Overhaul**: Implement `NotebookLmSourcePayload`, `ScopedTempSourceFile`, original-file routing, CLI flag emission (`--type`), and error redaction in `src-tauri/src/notebooklm.rs`.
3. **Phase 3: Frontend Integration**: Update `src/api/integrations.ts` and `src/components/notebooklm/NotebookLMSidebar.tsx` to pass typed document requests.
4. **Phase 4: Verification & Acceptance Testing**: Run automated tests for Unicode round-trips, file routing, argv emptiness, and mock CLI error handling.

*Rollback Strategy*: All changes are backwards-compatible at the IPC boundary; reverting restores the previous behavior without database schema mutations.

---

## Open Questions

- *None*: The bundled CLI binary (`0.8.0rc1`), its argument contract (`--type`, `--title`, `--notebook`, `--json`), and the UTF-8 parser bug have all been inspected and confirmed statically and dynamically.
