# Change: Browser Extension Extract Counter Increments for Context-Menu Extraction

Covers numbered requirement **#16 (browser-extension extract counter not incrementing for context-menu extraction)**.

## Why

The extension's "Extracts" counter does not increment when an extract is created via the right-click context-menu flow.

### Root cause (traced end-to-end)

- The counter is **derived**, not a separate variable: the popup (`popup.js:67–93` `loadStats()` → writes `#extracts-count` from `response.extractsCount`) reads the **content script's** `pageExtracts.length` (`content.js:1596–1603` `getPageStats()`), persisted per-host in page `localStorage` under `plethora_extracts_<hostname>` (`content.js:1748–1788`).
- The **incrementing flows** all run through the content script: `createExtract` pushes to `pageExtracts` at `content.js:1432` (then `savePageExtracts()`), `createSmartExtract` at `content.js:747`.
- The **context-menu flow** runs entirely in the background service worker: `chrome.contextMenus.onClicked` (`background.js:323–353`, case `'create-extract'`) → `createExtractFromSelection` (`background.js:1062–1085`) which POSTs to the server directly (`sendToIncrementum` → `POST http://127.0.0.1:8766/` → Rust `browser_sync_server.rs` `handle_extract_request`) and only shows a toast — it **never informs the tab's content script**, so `pageExtracts` and the counter never update.
- The same non-incrementing path is reached by the MV3 command `quick-extract` handler (`background.js:1279–1281` → `1311–1325` → `createExtractFromSelection`).
- The server does create the extract and returns `{ success, document_id, extract_id }` (`browser_sync_server.rs:1821–1826`); it also emits a `browser-sync://extract-saved` event (`1812–1819`) that no frontend listener consumes.

### Desired shared path

There should be one shared "extract successfully created" state/event path. The counter must be incremented exactly once on success through the context-menu flow, persisted using the same source of truth as other paths, and reflected in currently open extension UI. It must NOT increment on failure, on rejected requests, or twice due to optimistic + completion events.

## What Changes

1. Route the context-menu (and `quick-extract` command) flow through the same content-script "extract created" machinery as the popup flow — i.e., after a successful server create (or by delegating creation to the content script), register the extract into the tab's `pageExtracts`, persist it, and notify the popup to refresh `loadStats()`.
2. If instead the background notifies the content script after a successful `sendToIncrementum`, build the extract record with the same shape/content-script fields (id, url, title, text, range/selector/analysis where applicable) so the entry is a first-class `pageExtracts` member and counts/renders correctly.
3. Ensure exactly-once semantics (no double increment from optimistic push + completion event), failure handling (no increment if creation failed or was rejected), and correctness across service-worker restarts and multi-tab situations.
4. Where practical, keep the visible count derived from authoritative stored extraction state (the content script's `pageExtracts`/localStorage array) rather than adding a fragile separate counter.

## Impact

### Affected Specs
- `extension-extract-counter` (new, #16)

### Affected Code Areas
- `browser_extension/background.js` — `createExtractFromSelection` (1062–1085), `chrome.contextMenus.onClicked` (323–353), command `quick-extract` (1279–1325), and the message-routing to the content script
- `browser_extension/content.js` — the shared success path (`createExtract`/`createSmartExtract`, `pageExtracts` push at 1432/747, `getPageStats`), a new background-initiated "register extract" message handler
- `browser_extension/popup.js` — `loadStats()` refresh trigger on extract success (already called by the popup flow)
- `browser_extension/tests/*.test.cjs` — new coverage

### Non-goals
- No change to the server extract-creation path (`browser_sync_server.rs`).
- No change to the optimistic UI of the popup quick-extract flow beyond what's needed for parity.