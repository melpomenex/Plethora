## 1. Archive Security & Resource Budgets

- [x] 1.1 Define configurable `ArchiveSecurityLimits` in `src-tauri/src/health/importers/limits.rs` with documented limits for entry count, per-entry expanded size, cumulative expanded size, compression ratio, and nested archive depth.
- [x] 1.2 Implement `SafeZipInspector` and `BoundedEntryReader` in `src-tauri/src/health/importers/archive.rs` rejecting path traversal, absolute paths, symlinks, duplicate paths, and compression bombs.
- [x] 1.3 Wire streaming file-path opening from native file picker / drag-drop into `orchestrator.rs` without loading whole archives into React or IPC strings.
- [x] 1.4 Add comprehensive security unit tests for ZIP Slip, symlinks, ZIP bombs, entry floods, duplicate paths, and malformed headers.
