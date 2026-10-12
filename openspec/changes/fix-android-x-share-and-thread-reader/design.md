## Context

The Plethora desktop application already contains a robust Rust pipeline for X thread retrieval (`twitter.rs`, `threadreader.rs`) and a dedicated viewer (`XThreadViewer.tsx`). However, sharing from the Android X application fails due to multiple root causes across the native Kotlin bridge, intent parsing, JavaScript serialization, frontend import routing, and release build minification.

## Goals / Non-Goals

**Goals:**
- Seamlessly import single posts and multi-post threads shared from the Android X application.
- Deliver shared payloads safely without JavaScript escaping or syntax errors.
- Ensure incoming shares are queued durably without being dropped when imports overlap.
- Automatically navigate to and open the imported thread in `XThreadViewer`.
- Accurately disclose retrieval errors and partial single-post thread limitations.
- Ensure native plugin commands remain intact in release APK builds.

**Non-Goals:**
- Building a new or separate Twitter retrieval backend (reuse existing Rust `get_twitter_thread` and `import_twitter_thread`).
- Scraping authenticated private tweets (public posts and syndication/TRA support only).
- Modifying desktop X import workflows.

## Decisions

### 1. Intent Parsing & Data Precedence (`FolderImportPlugin.kt`)
- **Decision**: Treat `intent.data` as a URL when its scheme is `http` or `https`. Only treat `EXTRA_STREAM` or `intent.data` as a file stream if its scheme is `content` or `file` (or non-hierarchical local path).
- **Rationale**: Previously, `val streamUri = ... ?: intent.data` unconditionally assigned HTTP/HTTPS URLs to `streamUri`, causing `stageFileByUri` to fail and bypassing URL extraction entirely.
- **Text & ClipData**: Extract text from `intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()`, `intent.getStringExtra(Intent.EXTRA_TEXT)`, and fallback to `intent.clipData?.getItemAt(0)?.text?.toString()`.
- **URL Sanitization**: Extract URLs with regex and strip trailing punctuation (e.g. `)`, `.`, `,`, `!`, `?`) from the matched URL so status IDs like `12345)` are not corrupted.

### 2. Safe Native-to-Frontend Serialization & Bridge De-duplication
- **Decision**: Use `org.json.JSONObject.quote(batch.toString())` to wrap JSON in a properly escaped JavaScript string literal when calling `evaluateJavascript("window.dispatchEvent(new CustomEvent('plethora-native-share', { detail: JSON.parse(" + quoted + ") }));", null)`.
- **Rationale**: `batch.toString().replace("'", "\\'")` breaks whenever tweet titles, text, or authors contain double quotes, backslashes, newlines (`\n`), or control characters, causing unhandled `SyntaxError` in the WebView.
- **De-duplicate Bridges**: In `FolderImportPlugin.kt`, remove the redundant call to `handleSharedUrl(url)` inside `handleIncomingIntent` when adding URL items to `items`. In frontend `src/lib/shareTarget.ts`, ensure only modern `plethora-native-share` is dispatched, while maintaining legacy listener fallback without double dispatch.

### 3. Asynchronous FIFO Queue & In-Flight Deduplication (`useShareTarget.ts`)
- **Decision**: Replace `if (isProcessingRef.current) return;` with an ordered FIFO queue that executes incoming batches sequentially.
- **Rationale**: Dropping concurrent shares silently causes data loss whenever multiple shares arrive or when background tasks overlap.
- **Deduplication**: Maintain a cache of recently processed and in-flight URLs (e.g., status IDs or canonical URLs) to coalesce duplicate events from rapid re-shares or bridge retries.

### 4. Accurate Error Reporting in `processSharedBatch()` & `documentStore`
- **Decision**: Inspect the returned document from `openTwitterThread(url)`. If `doc.metadata?.xThreadError` is set, increment `failed` count and avoid displaying the "Imported successfully" toast.
- **Rationale**: Previously, `openTwitterThread` caught the fetch error, attached `xThreadError` to the placeholder document, and returned it. `processSharedBatch` blindly pushed it to `importedDocs`, reporting a 100% success rate even when the fetch failed.

### 5. Automatic Navigation to Reader
- **Decision**: In `processSharedBatch()`, call `openDocumentAtLocation(doc.id, {}, addTab)` upon successful import of an X thread document.
- **Rationale**: Users sharing from the X app expect to land directly in the reader without an unnecessary intermediate step of tapping a temporary toast.

### 6. Mobile Reader Navigation & UX
- **Decision**: In `XThreadViewer.tsx`, update the mobile back button to call `useTabsStore.getState().goToPreviousTab()`, falling back to `window.history.back()` only if tab navigation is exhausted.
- **Rationale**: In Tauri single-page webviews, `window.history.back()` can exit the app or navigate to a blank state if the history stack is empty.

### 7. ProGuard / R8 Consumer Rules (`consumer-rules.pro`)
- **Decision**: Create `src-tauri/plugins/plethora-folder-import/android/consumer-rules.pro` with keep rules for `com.plethora.folderimport.**`, `@app.tauri.annotation.TauriPlugin`, `@app.tauri.annotation.Command`, `@app.tauri.annotation.InvokeArg`, and `@app.tauri.annotation.ActivityCallback`.
- **Rationale**: In release builds with `isMinifyEnabled = true`, R8 strips or renames plugin methods and command parameter classes, causing IPC commands to fail.

## Risks / Trade-offs

- [Risk] Concurrent network requests if multiple shares are queued.
  → Mitigation: Sequential FIFO processing ensures only one thread is imported at a time.
- [Risk] Very large threads slowing down UI.
  → Mitigation: Progressive placeholder open displays loading skeleton immediately while background enrichment fills details non-blocking.
- [Risk] Deleted or private tweets.
  → Mitigation: Typed error state renders in the viewer with clear message, "Retry", and "Open on X" actions.
