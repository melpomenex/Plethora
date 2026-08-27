## Why

Desktop Plethora spawns duplicate processes on relaunch, has no registered file associations (Open With / double-click), and routes external entry points through disconnected handlers (deep links only in occlusion composer, shares only on mobile). A single-instance guard plus a unified external-open router prevents unsafe concurrent SQLite assumptions and duplicate imports.

## What Changes

- Add `tauri-plugin-single-instance` (desktop) as the first registered plugin; second launches focus/restore the main window and forward argv to the running instance.
- Add `bundle.fileAssociations` for formats Plethora actually imports (PDF, EPUB, Markdown, HTML, text, APKG, Plethora backup archives, common audio).
- Introduce Rust `external_open` module normalizing argv, macOS `RunEvent::Opened`, and single-instance argv into `ExternalOpenPayload` events.
- Introduce frontend `externalOpen` router converting payloads into existing `SharedBatch` / import pipeline (reusing `useShareTarget` import logic).
- macOS `RunEvent::Opened` and Windows/Linux startup argv feed the same router.

## Capabilities

### New Capabilities

- `single-instance`: One logical desktop process; relaunch focuses existing window.
- `external-open-router`: Unified normalization and dispatch for files, deep links, and forwarded argv.
- `desktop-file-associations`: OS-level Open With / double-click for supported import formats.

### Modified Capabilities

- `tray-integration`: Single-instance behavior replaces the documented multi-instance limitation.

## Impact

- `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, new `src-tauri/src/external_open.rs`
- `src-tauri/tauri.conf.json` — `fileAssociations`
- `src/lib/externalOpen.ts`, `src/hooks/useExternalOpen.ts`, `src/lib/importRouting.ts`
- `src/components/layout/MainLayout.tsx`
- Tests in `src-tauri/src/external_open.rs` and `src/lib/__tests__/externalOpen.test.ts`
