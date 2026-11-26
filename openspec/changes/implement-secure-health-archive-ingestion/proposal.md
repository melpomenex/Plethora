## Why

Wearable manufacturers (Apple Health, Garmin, Oura, WHOOP, Google Takeout, Samsung Health, Withings, Polar, RingConn) deliver personal data exports as `.zip` archives that can exceed hundreds of megabytes. Requiring users to manually extract archives or loading entire multi-hundred-megabyte files into memory causes failures, poor UX, and security risks (ZIP Slip, ZIP bombs, symlink traversal, XML XXE).

## What Changes

- Implement `src-tauri/src/health/importers/archive.rs` using `zip` with streaming entry inspection, selective entry reading, and strict resource budgets.
- Enforce archive security controls: path-traversal rejection (`..`, drive letters, absolute paths), symlink entry rejection, duplicate path normalization checks, nested archive rejection (depth limit), compression-ratio and expanded-byte ceilings, entry-count limits, and cancellation checks.
- Replace whole-file IPC string transfers with native file-path / streaming `BufReader<File>` processing in Rust so large exports never pass through React state or exceed V8/IPC limits.

## Capabilities

### New Capabilities

- `secure-health-archive-ingestion`: Streaming, bounded, cancellation-aware ZIP archive inspection and extraction-free entry reading with defense-in-depth against archive attacks.

### Modified Capabilities

None.

## Impact

- **Dependencies:** Depends on `establish-universal-wearable-import-foundation`.
- **Native:** `src-tauri/src/health/importers/archive.rs`, `src-tauri/src/health/importers/limits.rs`.
- **Security:** Protects against ZIP Slip, symlinks, compression bombs, excessive entry counts, nested archives, and uncontrolled temp file creation.
