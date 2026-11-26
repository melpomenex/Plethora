## Context

`zip = "0.6"` and `tempfile = "3"` are already in `src-tauri/Cargo.toml`. Existing `pick_health_file` in `commands/health.rs` reads the entire file into a `Vec<u8>` capped at `50 * 1024 * 1024` bytes.

## Goals / Non-Goals

- **Goals:**
  - Inspect ZIP central directory metadata in O(entries) without decompressing unrelated files (photos, audio, workout GPX/TCX).
  - Stream selected entries via `BufReader` with a `BoundedReader` wrapper enforcing per-entry and cumulative expanded byte limits, compression ratio limits (e.g. 100:1 above a 1 MB floor), entry count limits (e.g. 50,000 entries), and `CancellationToken`.
  - Reject symlinks (`unix_mode` S_IFLNK), path traversal (`..`), absolute paths, backslashes/drive prefixes, and duplicate normalized entry paths.
- **Non-Goals:**
  - Do not extract archives to user-visible directories or execute nested archives.

## Decisions

- **Direct Entry Streaming:** Read relevant entries directly from `ZipArchive<BufReader<File>>` into streaming XML/CSV/JSON parsers without writing unencrypted temp files whenever possible; if a parser requires seekable temp storage, use `tempfile::NamedTempFile` in private app cache with `0600` permissions and RAII cleanup on drop/error/cancel.
- **Resource Limits Rationale:**
  - `MAX_ARCHIVE_ENTRIES = 50_000` (covers multi-year Takeout/Garmin archives while blocking entry-flood DoS).
  - `MAX_ARCHIVE_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024` (2 GiB cumulative read budget for large Apple Health `export.xml`).
  - `MAX_ENTRY_BYTES = 1536 * 1024 * 1024` (1.5 GiB single entry for `export.xml`).
  - `MAX_COMPRESSION_RATIO = 120` (for entries > 1 MB compressed, defending against ZIP bombs while permitting repetitive XML).
