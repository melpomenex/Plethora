## Why

Readers in Plethora suffer from an interrelated cluster of selection, extract persistence, and view-loading state defects across mobile and desktop surfaces:
1. **Direct Extract from selection action bar fails on mobile**: The Selection Interaction V2 direct Extract action attempts to read text from legacy/mutable React state (`mobileSelection.text` / `activeExtractSelection`) instead of the authoritative selection snapshot captured by the controller. On touch surfaces where native selection collapses on touch release, this causes the Extract tap to silently no-op and dismiss without creating an extract.
2. **AI Result -> Create Extract permits accidental duplicate extracts**: The `SelectionActionsSheet` lacks an asynchronous save lifecycle. The Create Extract button is fire-and-forget, has no pending/disabled state, and remains visible and interactive after creation, leading users to tap multiple times and create duplicate extracts.
3. **Competing extract state sources cause stale views**: Extract creation refreshes `useExtractStore`, but the active `ExtractsList` renders from independent React local state (`useState`) without observing store updates or invalidation signals, causing newly created extracts to not appear immediately in the Extracts view.
4. **Unscoped `isLoading` state blocks independent views**: In `DocumentViewer`, a single global `isLoading` flag covering document-source loading (PDF byte/range parsing, EPUB loopback streaming, video source resolution) blocks rendering of independent subviews (`viewMode === "extracts"` and `viewMode === "cards"`).
5. **Missing request-generation guards and premature loaded markers cause stuck loading states**: `loadDocumentData` lacks monotonic generation tracking, allowing stale async loads to overwrite newer document state, while `lastLoadedDocumentIdRef` is set prematurely before asynchronous loading completes, wedging view transitions until the user navigates away and back.

## What Changes

- **Authoritative Selection Snapshot for Extraction**:
  - Update `DocumentViewer` and selection action handlers (`handleSelectionBarAction`, context menus, overflow menus) so that invoking "Extract" immediately captures an immutable `CapturedSelection` payload (selected text, surrounding passage, `selectionContext`, document ID, surface type, page number) from `selectionController.captureForAction()` before dismissing the selection interaction.
  - Eliminate reliance on mutable fallback state (`mobileSelection.text`, `activeExtractSelection`, or raw DOM selections) in the V2 extract path.
  - Preserve Android WebView selection safety by keeping native touch selection undisturbed and utilizing controller-driven suppression without calling `window.getSelection()?.removeAllRanges()`.

- **Observable Asynchronous Extract Persistence Lifecycle**:
  - Standardize `createInstantExtract`, `handleMobileExtract`, and `onCreateExtractFromResult` to return an explicit awaitable contract (`Promise<Extract | null>`).
  - Introduce explicit operation state (`idle` | `saving` | `saved` | `error`) in `SelectionActionsSheet` for the "Create Extract from Result" CTA.
  - While saving is in-flight, disable the CTA and display visual progress indicators without animation reliance (ensuring full compatibility with e-ink displays and reduced-motion settings).
  - On save success, display the existing success toast, close the sheet, notify the selection machine of settlement, and prevent CTA re-activation.
  - On save failure, preserve the AI output, restore the CTA to an active retryable state, and surface error feedback.

- **Multi-Layer Duplicate Prevention**:
  - Prevent rapid double-tap extract creation through UI-level button disabling and state transitions.
  - Maintain the in-flight deduplication key registry in `useToastExtract` as defense-in-depth.

- **Extract Collection Coherency and Immediate Freshness**:
  - Establish a single canonical reactive source of truth or direct invalidation mechanism between extract mutations (`createExtract`, `deleteExtract`, `updateExtract`, `useToastExtract`) and `ExtractsList`.
  - Ensure any mounted `ExtractsList` for the active `documentId` immediately reflects newly persisted extracts without requiring component unmount, tab switching, or page reloads.

- **Scoped View Loading Ownership**:
  - Decouple `viewMode === "extracts"` (`<ExtractsList />`) and `viewMode === "cards"` (`<LearningCardsList />`) from the reader's document source loading state (`isSourceLoading`).
  - Allow Extracts and Cards views to render and manage their own loading/empty/error states immediately when switched, regardless of whether underlying PDF, EPUB, or media source bytes are still loading.

- **Generation-Safe Document and Subview Load Lifecycles**:
  - Introduce monotonic load generation counters (`loadGenerationRef`) in `DocumentViewer` for `loadDocumentData` and source preparation paths.
  - Verify request authority before mutating shared component states (`fileData`, `pdfUrl`, `epubUrl`, `htmlContent`, `mediaSource`, `mediaError`, `isLoading`).
  - Set `lastLoadedDocumentIdRef` (or terminal readiness marker) only upon terminal success/readiness of source loading, ensuring failed or interrupted loads can be cleanly retried.
  - Add generation / cancellation guards to `ExtractsList` and `LearningCardsList` async data fetch effects to eliminate out-of-order race conditions when switching documents rapidly.

## Capabilities

### New Capabilities
- `reader-view-state-lifecycle`: Scoped view loading ownership (isolating document source loading from independent metadata subviews like Extracts and Learning Cards), monotonic load-generation tracking for `DocumentViewer`, accurate terminal readiness tracking, and deterministic first-navigation rendering without navigation workarounds.
- `reader-selection-extract-flow`: Immutable snapshot-based extract creation for Selection Interaction V2, observable `Promise<Extract | null>` persistence lifecycle, single-submit AI result extract promotion in `SelectionActionsSheet`, Android-safe selection suppression, and desktop context menu parity.

### Modified Capabilities
- `toast-extract-feedback`: Update instant extract creation requirements to mandate observable asynchronous contracts (`Promise<Extract | null>`), UI-level single-submit saving states for AI result promotion, multi-layer duplicate submission prevention, and immediate post-persistence local collection coherence.
- `extract-reader-stability`: Extend stability requirements to enforce deterministic independent subview loading (Extracts and Cards lists unaffected by source document loading) and generation-safe asynchronous fetch lifecycle (ignoring stale responses across document switches).

## Impact

- **Affected Frontend Components**:
  - `src/components/viewer/DocumentViewer.tsx`
  - `src/components/viewer/SelectionActionsSheet.tsx`
  - `src/components/viewer/selectionInteraction/useSelectionInteraction.ts`
  - `src/components/extracts/ExtractsList.tsx`
  - `src/components/learning/LearningCardsList.tsx`
  - `src/hooks/useToastExtract.ts`
  - `src/stores/extractStore.ts`
  - `src/pages/QueueScrollPage.tsx`
- **APIs & State Contracts**:
  - Return signatures for instant extract callbacks updated to `Promise<Extract | null>`.
  - Extract state synchronization updated between `useExtractStore`, `createExtract`, and `ExtractsList`.
- **Dependencies**: No new external runtime or build dependencies.
