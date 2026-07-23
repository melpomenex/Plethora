# Optimize Performance Hotspots

## Why

A codebase-wide performance audit (2026-07-23) found five concrete bottleneck clusters that hurt latency, memory, and app size — several of them worst on the weakest target (Android WebView). Prior optimization passes (deferred sync boot, lazy tabs/fonts/locales, desktop queue virtualization, WAL + quick_check) already removed the easy wins; what remains are structural issues that need coordinated changes across the Rust/IPC boundary, the queue data flow, and the build pipeline.

### Critical findings, sorted by priority

| # | Finding | Evidence | Platforms | Impact |
|---|---------|----------|-----------|--------|
| 1 | PDF byte ranges cross IPC as `Vec<u8>` → JSON number arrays: each 512 KB chunk becomes ~1.8 MB of JSON text, serialized in Rust and re-parsed to a JS number array per page fetch | `src-tauri/src/commands/pdf_mobile.rs:48` (`bytes: Vec<u8>`), `MAX_PDF_RANGE_BYTES = 512*1024`; consumed in `src/api/documents.ts` (`PdfDocumentRange.bytes: number[]`) | Mobile (primary PDF path), desktop fallback | High |
| 2 | Whole document files cross IPC as base64 strings (`read_document_file`) — a 100 MB PDF becomes a ~133 MB JS string + `atob` copy; Android caps at 16 MB but desktop is unbounded | `src-tauri/src/commands/document.rs:1163`; `src/api/documents.ts:300` | Cross-platform | High |
| 3 | Mobile queue renders every filtered item unvirtualized (desktop path virtualizes >20 items; mobile maps the full array) | `src/components/mobile/MobileQueueView.tsx:669` vs `src/components/review/ReviewQueueView.tsx:1338` | Mobile | High |
| 4 | `get_queue` returns the full unpaginated queue with per-item card content (`question`, `answer`, `cloze_text`, `tags`), and the store reloads the entire queue after every mutation (8 `loadQueue()` call sites) | `src-tauri/src/commands/queue.rs:418`, `src-tauri/src/models/queue.rs:6`, `src/stores/queueStore.ts:279–680` | Cross-platform | Medium-High |
| 5 | Main JS chunk is 1.44 MB: the full 144 KB theme registry is pulled in eagerly because `ThemeContext` both statically and dynamically imports `themes/builtin.ts` (the static import defeats the intended lazy load), plus the eager 284 KB `en` locale | `src/contexts/ThemeContext.tsx:12` vs `:270`; `src/lib/i18n/index.ts:7`; `dist/assets/index-*.js` = 1.44 MB | Cross-platform startup | Medium-High |
| 6 | Settings is a single 961 KB chunk: `SettingsPage` statically imports ~18 section panels (AI, Sync, RSS, Cloud, TTS, Embeddings, …) so opening any section loads all | `src/components/settings/SettingsPage.tsx` imports; `dist/assets/SettingsPage-*.js` = 961 KB | Cross-platform | Medium |
| 7 | Two PDF.js worker builds ship (~2.1 MB total): `pdf.worker.min.mjs` (1.08 MB) via `?url` and the custom bootstrap `src/workers/pdfjs.worker.ts` bundle (1.02 MB) | `src/components/viewer/PDFViewer.tsx:3,288`; both present in `dist/assets` | Cross-platform (app size, Android APK) | Medium |
| 8 | Blocking file I/O and CPU-bound PDF text extraction run directly on tokio runtime threads in async commands (95 `std::fs`/`fs::read|write` sites under `src-tauri/src/commands/`; `pdf_extract::extract_text_from_mem` called synchronously in 3 of 4 paths) | `src-tauri/src/commands/document.rs:1163` (`fs::read` in async fn), `src-tauri/src/processor/pdf.rs:141,271,284` | Cross-platform; worst on 4-core Android | Medium |
| 9 | 76 components subscribe to entire zustand stores (`useXStore()` with destructuring, no selector) → broad re-renders on any store field change | grep across `src/components/**` (76 hits, incl. `QueueTab`, `SettingsPage`, `DashboardTab`) | Cross-platform | Medium |
| 10 | Phosphor icons vendor chunk is 602 KB — 290 files import from the root entry; each icon component embeds all 6 weight variants | `dist/assets/ui-vendor-*.js`; import audit | Cross-platform (parse cost on Android) | Low-Medium |

Explicitly examined and found healthy (no action proposed): DB layer (sqlx pool, WAL, per-connection pragmas, quick_check, FTS5 with 105 indexes), tab-level code splitting (`TabRegistry` lazy), per-locale dynamic imports, `@fontsource` lazy font loading, `ThemeBackdrop` animation guards (30 fps cap, battery/visibility/reduced-motion aware), release profile (`opt-level="z"`, `lto="thin"`, `strip`, `panic="abort"` — `lto="fat"`/`codegen-units=1` intentionally avoided per documented SIGSEGV history), `invokeCommand` wrapper (memoized one-shot readiness handshake), `listen()` cleanup discipline (spot-checked), DEV-gated performance monitor.

## What Changes

- **Binary IPC transfer**: `read_pdf_document_range` and `read_document_file` return raw bytes via `tauri::ipc::Response` (ArrayBuffer on the JS side) instead of JSON number arrays / base64 strings; frontend callers consume `ArrayBuffer` directly. Existing JSON-shaped metadata (offset/identity/eof) moves to response headers or a small side-channel struct.
- **Queue IPC efficiency**: `get_queue` gains a slim mode that omits card content fields from queue listings (content fetched on demand when an item is opened), and queue mutations update the affected item locally instead of reloading the full queue.
- **Startup bundle budget**: fix the `themes/builtin.ts` static/dynamic import conflict so the theme registry actually code-splits; split `SettingsPage` sections into lazy chunks; consolidate to a single PDF.js worker build; migrate Phosphor icon imports to per-icon deep imports (or a curated re-export module).
- **Mobile queue virtualization**: `MobileQueueView` virtualizes its item list above the same threshold as the desktop queue, using the already-bundled `@tanstack/react-virtual`.
- **Backend thread hygiene**: async Tauri commands move blocking file I/O to `tokio::fs` or `spawn_blocking`, and the remaining synchronous `pdf_extract` call sites move onto `spawn_blocking`, matching the pattern already used in `processor/pdf.rs:37`.
- **Store subscription hygiene** (piggybacks on queue work, no new capability): convert whole-store `useXStore()` destructuring to selector-based subscriptions in the hot paths touched by this change (queue, review, settings shells).

Non-goals: Yjs/sync performance (covered by existing `yjs-sync-performance` spec), Cargo release-profile changes (documented SIGSEGV risk outweighs the marginal size win), tiktoken WASM removal (5.6 MB but already lazy; revisit separately if APK budget demands it), and any scheduling-algorithm changes (SM-20 paths stay untouched).

## Capabilities

### New Capabilities

- `ipc-binary-transfer`: Binary file content (PDF byte ranges, whole-document reads) crosses the Tauri IPC boundary as raw bytes, never as JSON-encoded number arrays or base64 strings, with size guards preserved.
- `queue-ipc-efficiency`: Queue listings transfer only listing-relevant fields; queue mutations do not re-transfer the full queue.
- `startup-bundle-budget`: The startup-critical JS chunk stays within a defined budget; deferred-loadable assets (theme registry, settings sections, duplicate workers, icon set) load outside it.
- `mobile-queue-virtualization`: The mobile queue list virtualizes rendering above a small item threshold.
- `backend-thread-hygiene`: Tauri async commands never execute blocking file I/O or CPU-bound extraction on async runtime threads.

### Modified Capabilities

<!-- none — no existing spec's requirements change; postpone-engine, flashcard-review-session, etc. keep their behavior, only transport/rendering mechanics change -->

## Impact

- **Rust**: `src-tauri/src/commands/pdf_mobile.rs`, `commands/document.rs`, `commands/queue.rs`, `processor/pdf.rs`; new IPC response types. No DB schema changes.
- **Frontend**: `src/api/documents.ts`, `src/api/queue.ts`, `src/stores/queueStore.ts`, `src/components/mobile/MobileQueueView.tsx`, `src/contexts/ThemeContext.tsx`, `src/components/settings/SettingsPage.tsx`, `src/components/viewer/PDFViewer.tsx` + `src/workers/pdfjs.worker.ts`, icon imports across ~290 files (mechanical codemod).
- **Build**: `vite.config.ts` chunking assumptions unchanged; bundle-size assertions added to CI-runnable script.
- **Compatibility**: IPC changes are internal (no plugin/permission changes); PWA/browser mode keeps its existing `browserInvoke` paths, which do not use Tauri IPC. Breaking risk concentrated in the PDF range reader — mitigated by keeping the identity-check contract identical.
