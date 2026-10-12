## Why

Sharing an X/Twitter post or multi-post thread from the Android X application into Plethora currently fails or drops content due to duplicate delivery across legacy and modern share bridges, unescaped JavaScript serialization crashing the WebView event dispatcher on quotes/newlines, inverted stream vs URL intent precedence, unqueued background imports silently discarding concurrent shares, and ProGuard/R8 stripping the native plugin commands in release APK builds. Fixing this makes reading and importing public X threads seamless, robust, and immediate on both cold and warm starts.

## What Changes

- **Android Share Intent Ingestion**: Support `ACTION_SEND` and `ACTION_VIEW` for X/Twitter posts, properly prioritizing URL extraction from `EXTRA_TEXT`, `intent.data`, and `ClipData` while reserving file stream staging exclusively for actual `content://` and `file://` streams.
- **URL Extraction & Normalization**: Extract and canonicalize valid `x.com` and `twitter.com` status URLs (including subdomains like `mobile.` and `www.`, `/i/status/`, tracking query parameters, and URLs embedded in shared text), stripping trailing punctuation.
- **Safe Native-to-Frontend Serialization**: Eliminate dangerous unescaped string concatenation (`JSON.parse('$jsonStr')`) in WebView `evaluateJavascript` by using safely quoted JSON serialization (`JSONObject.quote`) and eliminating duplicate delivery from redundant legacy events.
- **Durable Share Queue & Deduplication**: Replace the brittle single-slot `isProcessingRef` check with a sequential FIFO queue so multiple or concurrent shares are not discarded. Deduplicate repeated deliveries of the same status or thread root.
- **Accurate Import Status & Error Disclosures**: Stop reporting failed X thread retrievals as successful imports in `processSharedBatch()` and `openTwitterThread()`. When full-thread retrieval fails but a single post is available, show the post with an explicit limitation disclosure.
- **Automatic Navigation to X Thread Reader**: Automatically navigate to and focus the imported document in `XThreadViewer` upon successful import (and progressive skeleton during fetch), without requiring the user to tap toasts or search the library.
- **Mobile Reader UX**: Fix the mobile reader back button to use Plethora's tab/history navigation before falling back to browser history. Preserve extracts, flashcards, AI actions, and reading layout.
- **Release Build ProGuard/R8 Consumer Rules**: Add `consumer-rules.pro` for `plethora-folder-import` keeping Tauri plugin commands, callbacks, and argument types so share handling and file picking work in minified release APKs.

## Capabilities

### New Capabilities
- `android-x-share-and-thread-reader`: Covers native Android share sheet reception of X/Twitter URLs, safe IPC bridging, queue-based import orchestration, error reporting, thread deduplication, and automatic navigation to the native XThreadViewer.

### Modified Capabilities
<!-- None: No existing specs under openspec/specs/ are being modified -->

## Impact

- Native Kotlin: `src-tauri/plugins/plethora-folder-import/android/src/main/java/com/plethora/folderimport/FolderImportPlugin.kt`, `src-tauri/plugins/plethora-folder-import/android/consumer-rules.pro`, `src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Frontend share target & routing: `src/lib/shareTarget.ts`, `src/hooks/useShareTarget.ts`, `src/lib/importRouting.ts`, `src/hooks/useURLDetector.ts`, `src/lib/xthreadUrl.ts`
- Document store: `src/stores/documentStore.ts`
- Reader components: `src/components/viewer/XThreadViewer.tsx`
- Unit and integration tests for share normalization, intent parsing, queuing, and deduplication.
