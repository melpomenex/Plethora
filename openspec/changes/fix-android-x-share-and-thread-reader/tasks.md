## 1. Native Android Intent Handling & Safe Serialization

- [x] 1.1 Fix `streamUri` vs `intent.data` precedence in `FolderImportPlugin.kt` so HTTP/HTTPS URLs are treated as web URLs rather than local file streams, and extract text from `EXTRA_TEXT`, `ClipData`, and CharSequence extras. Verify via unit/intent tests.
- [x] 1.2 Replace unsafe string concatenation in `FolderImportPlugin.kt` evaluateJavascript with safe JSON quoting (`JSONObject.quote`) and remove duplicate event emission. Verify with serialization tests covering quotes, newlines, and backslashes.
- [x] 1.3 Create `consumer-rules.pro` for `plethora-folder-import` keeping `@TauriPlugin`, `@Command`, `@ActivityCallback`, and `@InvokeArg` annotations for ProGuard/R8 release builds. Verify rule definitions match AGP requirements.

## 2. URL Extraction, Normalization & Frontend Bridges

- [x] 2.1 Update URL detection and status-ID extraction in `src/hooks/useURLDetector.ts` and `src/lib/xthreadUrl.ts` to support all canonical and mobile X/Twitter variants and strip trailing punctuation from embedded links. Verify with Vitest unit tests.
- [x] 2.2 Update `src/lib/shareTarget.ts` to deduplicate delivery across legacy and modern custom events. Verify with tests in `src/lib/__tests__/shareTarget.test.ts`.

## 3. Durable Queue, Deduplication & Routing

- [x] 3.1 Replace single-slot `isProcessingRef` drop check in `src/hooks/useShareTarget.ts` with a sequential FIFO queue and deduplication of rapid identical shares. Verify with tests in `src/hooks/__tests__/useShareTarget.test.ts` and `src/hooks/__tests__/useShareTargetDedupe.test.ts`.
- [x] 3.2 Update `src/lib/importRouting.ts` to detect `doc.metadata?.xThreadError`, prevent reporting false successful imports on retrieval errors, and automatically navigate to the imported document tab using `openDocumentAtLocation`. Verify with unit tests.

## 4. Mobile Reader UX & Back Navigation

- [x] 4.1 Update `src/components/viewer/XThreadViewer.tsx` mobile back button to call `useTabsStore.getState().goToPreviousTab()` before falling back to `window.history.back()`. Verify with unit tests.
- [x] 4.2 Ensure loading skeleton, error retry states, and single-post limitation notes render correctly and preserve text selection, extracts, and flashcard creation. Verify with `XThreadViewer.test.tsx`.

## 5. Verification & Regressions

- [x] 5.1 Run all affected Vitest test suites (`shareTarget`, `useShareTarget`, `documentStoreXThread`, `XThreadViewer`, `urlDetector`) and verify 100% pass rate.
- [x] 5.2 Execute performance benchmark check (`npm run bench:check`) and ensure zero regressions against baseline.
