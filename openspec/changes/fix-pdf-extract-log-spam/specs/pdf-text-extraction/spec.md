# pdf-text-extraction Delta

## ADDED Requirements

### Requirement: PDF text extraction MUST NOT write per-glyph output to stdout
The PDF text extraction path SHALL NOT emit per-glyph, per-character, or
otherwise unbounded-by-document-count diagnostic lines to stdout, stderr, or
any configured log target, on any platform (document open, per-page indexing,
HTML conversion). Extraction diagnostics SHALL go through the `log` facade
with the `pdf_extract` module filtered at `error`, so at most a bounded
number of per-document records are visible.

#### Scenario: Ligature-heavy PDF produces no stdout flood
- **WHEN** the app opens a PDF whose fonts encode ligature glyph names (e.g.
  `f_f_i`, `f_f_l`, `f_i`) with differing ToUnicode mappings, and text
  extraction runs to completion
- **THEN** no `Unicode mismatch` (or similar per-glyph) lines are written to
  stdout, and the process performs no per-glyph console writes

#### Scenario: Extraction via terminal stays responsive
- **WHEN** the app is launched from a terminal with stdout attached and a
  multi-hundred-page PDF is opened
- **THEN** extraction completes within the existing bounded time (10s
  timeouts) without flooding or freezing the terminal, and the machine stays
  responsive (no console-write saturation as reported in issue #45)

### Requirement: pdf_extract log level MUST be capped at error
The application's logging configuration SHALL set the `pdf_extract` module
filter to `error` (or more restrictive), alongside the existing chatty-module
filters (hyper/rustls/sqlx), so that `warn!`-level per-glyph noise from the
extractor is never forwarded to the Stdout/LogDir/Logcat targets while
genuine extraction failures remain visible.

#### Scenario: Per-glyph warn records are filtered
- **WHEN** the extractor emits `warn` records (e.g. benign Unicode-mismatch
  notices) during extraction
- **THEN** the `tauri-plugin-log` targets do not receive them, because the
  module filter for `pdf_extract` is `error`

#### Scenario: Genuine extraction errors remain visible
- **WHEN** pdf-extract emits an `error`-level record (e.g. encrypted-document
  guidance)
- **THEN** the record still appears in the configured log targets

### Requirement: Extracted-text contract MUST remain stable for consumers
Upgrading the extractor SHALL preserve the consumer-facing contract of
`processor::pdf`: whole-document text extraction returns a `String` whose
normalized form still feeds word counts, reading-time estimates, HTML
conversion, and OCR fallbacks; per-page extraction returns a `Vec<String>`
with one entry per usable page using the existing fallback chain
(page-splitting extractor → whole-document split on form feeds → proportional
paragraph split).

#### Scenario: Word count and metadata still populate on open
- **WHEN** a text-layer PDF is opened after the upgrade
- **THEN** `extract_pdf_content` returns non-empty text and the document
  metadata still includes `word_count`, `text_length`, and
  `reading_time_minutes` computed from it

#### Scenario: Per-page fallback chain is preserved
- **WHEN** per-page extraction yields no usable pages (e.g. image-only or
  extractor-failing PDF)
- **THEN** the whole-document fallback split runs and returns entries as
  before the upgrade, and an empty result is returned only when both passes
  yield nothing

### Requirement: Dependency floor MUST be guarded against regression
The build SHALL keep `pdf-extract` at a version whose extraction hot path
uses the `log` facade rather than unconditional printing (>= 0.10.0), with an
automated script test that fails if `src-tauri/Cargo.lock` resolves an older
line.

#### Scenario: Lockfile guard rejects downgrade
- **WHEN** `Cargo.lock` resolves `pdf-extract` to a version below 0.10.0
  (the last unconditional-`println!` line was 0.8.x; 0.7.x is currently
  pinned)
- **THEN** the guard test fails with a message pointing at this change's
  rationale
