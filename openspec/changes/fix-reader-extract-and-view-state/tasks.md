## 1. Selection Payload Correctness & Snapshot Ownership

- [x] 1.1 Update `handleSelectionBarAction` in `DocumentViewer.tsx` to capture an immutable `CapturedSelection` snapshot via `controller.captureForAction()` when the "extract" action is invoked, prior to controller dismissal.
- [x] 1.2 Refactor extraction creation helpers in `DocumentViewer.tsx` to accept captured selection snapshots (`text`, `selectionContext`, `documentId`, `pageNumber`, `surface`) and eliminate dependency on mutable/legacy fallback states (`mobileSelection.text`, `activeExtractSelection`).
- [x] 1.3 Update contextual overflow and right-click menus in `DocumentViewer.tsx` and `SelectionPopup.tsx` to consistently pass authoritative snapshot text and context into extract creation.
- [x] 1.4 Verify and preserve touch selection dismissal discipline on Android/touch devices, using controller-level suppression (`suppressCurrentText: true`) without calling `window.getSelection()?.removeAllRanges()`.

## 2. Async Extract Lifecycle & Duplicate Prevention

- [x] 2.1 Update return signature of `createInstantExtract` in `useToastExtract.ts` and downstream props (`onCreateExtract`, `onCreateExtractFromResult`) to explicitly return `Promise<Extract | null>`.
- [x] 2.2 Add explicit saving state (`idle` | `saving` | `saved` | `error`) to `SelectionActionsSheet.tsx` for the "Create Extract from Result" button, immediately disabling the button upon activation.
- [x] 2.3 Implement success and failure transitions in `SelectionActionsSheet.tsx`: dismiss sheet and notify controller on success; preserve AI output, surface error toast, and re-enable button for retry on failure.
- [x] 2.4 Harden `useToastExtract.ts` in-flight deduplication set to guarantee that rapid repeated submissions produce exactly one persisted extract record.

## 3. Extract Collection Coherency

- [x] 3.1 Enhance `useExtractStore.ts` with document-scoped cache or reactive invalidation notifications for extract mutations.
- [x] 3.2 Update `ExtractsList.tsx` to observe extract store state or invalidation events for `documentId`, ensuring instant synchronization upon extract creation or deletion.
- [x] 3.3 Verify immediate visibility of newly created extracts in `ExtractsList` without requiring component remount, page reload, or document switching.

## 4. Scoped View Loading Ownership

- [x] 4.1 Refactor content-area rendering in `DocumentViewer.tsx` so that `viewMode === "extracts"` (`<ExtractsList />`) and `viewMode === "cards"` (`<LearningCardsList />`) evaluate independently of document source loading.
- [x] 4.2 Restrict the `isLoading` "Loading document..." indicator strictly to `viewMode === "document"` content preparation.
- [x] 4.3 Ensure background document source loading continues without rendering blocking overlays on active metadata subviews.

## 5. Generation-Safe Document & Subview Load Lifecycles

- [x] 5.1 Introduce monotonic `loadGenerationRef` in `DocumentViewer.tsx` to track `loadDocumentData` invocations.
- [x] 5.2 Add generation-identity checks across all asynchronous resolution branches in `loadDocumentDataInner` (`readDocumentFile`, `getEpubStreamUrl`, `resolveLocalMediaSource`) to discard superseded responses.
- [x] 5.3 Defer assignment of `lastLoadedDocumentIdRef` until `loadDocumentData` successfully resolves, and reset the ref on load failure or cancellation.
- [x] 5.4 Add cancellation guards (`cancelled = true` cleanup) to `useEffect` data loaders in `ExtractsList.tsx` and `LearningCardsList.tsx` to reject stale out-of-order responses when switching documents.

## 6. Testing & Validation

- [x] 6.1 Add unit test in `src/components/viewer/__tests__/` verifying that Selection Interaction V2 "Extract" action succeeds when DOM selection has collapsed.
- [x] 6.2 Add unit test for `SelectionActionsSheet.tsx` verifying single-submit saving state, button disabling, success dismissal, and error retry.
- [x] 6.3 Add deterministic race condition test for `DocumentViewer.tsx` verifying that superseded source load A cannot overwrite newer load B.
- [x] 6.4 Add test verifying that switching to `viewMode === "extracts"` renders `ExtractsList` while document source loading is pending.
- [x] 6.5 Add test verifying that rapid document switching in `ExtractsList` and `LearningCardsList` does not display stale items from previous documents.
- [x] 6.6 Run full typecheck and test suite verification (`npm run build:check`, `npm test`).
