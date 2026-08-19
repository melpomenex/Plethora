## Context

Incrementum/Plethora features a multi-format reading engine supporting PDF (fixed, page-spread, reflowed, and OCR), EPUB, Markdown, HTML, and audio/video media transcripts. In recent versions, text selection UX on mobile was upgraded to Selection Interaction V2 (`overhaul-reader-selection-ux`), introducing a settled-selection state machine and anchored action bars.

However, a cluster of related state lifecycle and race bugs degrade the reader experience:
1. When selecting text on mobile and tapping **Extract** on the Selection Interaction V2 action bar, no extract is created if the native DOM selection collapsed upon touch release. The handler falls back to mutable React state instead of consuming the controller's authoritative snapshot.
2. Promoting an AI result (Explain, Summarize, Simplify, Key Terms, Ask) into an extract via **Create Extract** in `SelectionActionsSheet` executes as fire-and-forget without a pending or disabled state. Users frequently tap multiple times, producing duplicate extract records.
3. Once created, extracts do not reliably appear in the active document's **Extracts** view because `ExtractsList` maintains uncoordinated local `useState` rather than observing store updates or invalidation signals.
4. Navigating between reader views (Document -> Extracts or Document -> Cards) frequently displays an indefinite loading spinner until the user navigates away to another document/view and returns. This occurs because `DocumentViewer` places a single document-source `isLoading` check in front of all view modes, while uncoordinated document-hydration and source-loading effects lack monotonic generation tracking and set completion flags prematurely.

This design resolves these issues at the architectural level without introducing timeouts, artificial delays, or navigation reload hacks.

## Goals / Non-Goals

**Goals:**
- Guarantee that invoking Extract from Selection Interaction V2 always creates an extract from the authoritative captured selection, even if the native selection has collapsed.
- Provide an explicit asynchronous lifecycle (`idle` -> `saving` -> `saved` | `error`) for AI result extraction with single-submit button guarantees and disabled states.
- Eliminate duplicate extracts across rapid-click and fast-resolution scenarios via UI-level single-submission and hook-level deduplication.
- Ensure instantaneous coherency in `ExtractsList` upon extract creation, update, or deletion.
- Scope loading ownership in `DocumentViewer` so metadata views (`ExtractsList`, `LearningCardsList`) render independently of document source byte/stream loading.
- Implement monotonic load generation IDs and deferred readiness markers in `DocumentViewer` to eliminate race conditions and stuck loading states.
- Preserve Android WebView native selection safety without calling destructive selection clear APIs.

**Non-Goals:**
- Redesigning the SQLite database schema or Tauri backend commands for extracts (backend persistence is verified healthy).
- Altering the AI provider architecture or streaming protocols.
- Replacing the toast notification framework (`useToast` remains the system feedback mechanism).
- Rewriting EPUB.js or PDF.js rendering pipelines.

## Decisions

### Decision 1: Authoritative Selection Payload for Extraction
- **Decision**: In Selection Interaction V2, `handleSelectionBarAction("extract")` and all contextual menu extract invocations MUST call `selectionController.captureForAction()` (or consume `readySelection` snapshot) at the exact moment of user invocation, capturing an immutable `CapturedSelection` payload.
- **Payload Shape**:
  ```ts
  interface CapturedSelection {
    operationId: string;
    text: string;
    passage: string;
    selectionContext?: SelectionContext | unknown;
    geometry?: SelectionGeometry;
    documentId: string | null;
    surface: SelectionSurface;
    readerContext?: unknown;
    capturedAt: number;
  }
  ```
- **Rationale**: The core invariant of Selection Interaction V2 is that settled actions operate on application-owned immutable snapshots. Re-reading mutable React state (`mobileSelection.text`, `activeExtractSelection`) or DOM ranges (`window.getSelection()`) introduces race conditions where touch-end selection collapse causes silent no-ops.
- **Alternatives Considered**:
  - *Fallback chain (`snapshot.text || mobileSelection.text || activeExtractSelection`)*: Rejected because retaining the fallback masks incorrect controller state and permits inconsistent context capture.

### Decision 2: Observable Asynchronous Contract for Extract Creation
- **Decision**: All extract creation functions (`createInstantExtract`, `handleMobileExtract`, `handleCreateRssExtract`, `onCreateExtractFromResult`) MUST return `Promise<Extract | null>`.
- **Signature**:
  ```ts
  type InstantExtractHandler = (params: {
    text: string;
    documentId: string;
    selectionContext?: unknown;
    pageNumber?: number;
    color?: string;
    note?: string;
  }) => Promise<Extract | null>;
  ```
- **Rationale**: Callers (such as `SelectionActionsSheet`) require an awaitable promise to manage saving spinners, disable action controls, transition to success states, or handle errors gracefully.
- **Alternatives Considered**:
  - *Event callback with separate onSuccess/onError props*: Rejected as overly verbose compared to standard async/await promise resolution.

### Decision 3: AI-Result Extract Promotion Lifecycle and Single-Submit Protection
- **Decision**: `SelectionActionsSheet` owns the saving lifecycle state for the "Create Extract from Result" action:
  ```ts
  type ExtractSaveState = "idle" | "saving" | "saved" | "error";
  ```
  When the user taps "Create Extract from Result":
  1. Immediately set save state to `"saving"`.
  2. The CTA button is disabled and reflects busy state (e.g. `aria-busy="true"`, text changed to "Saving...", spinners adhering to e-ink / reduced-motion rules).
  3. Await `onCreateExtractFromResult(output)`.
  4. On success: set state to `"saved"`, fire success toast, notify controller via `onSettled(operationId, "success")`, and close the sheet.
  5. On failure: set state to `"error"`, display error toast, retain the AI result output, and restore button to active retryable state.
- **Rationale**: Provides immediate tactile feedback, prevents duplicate network/IPC requests, and guarantees clean dismissal.

### Decision 4: Extract State Freshness and Invalidation
- **Decision**: Establish a reactive document-extract invalidation subscription in `useExtractStore` and `ExtractsList`.
  Specifically:
  - `useExtractStore` maintains a revision token/event emitter per `documentId` or stores `extractsByDocumentId: Record<string, Extract[]>`.
  - When `createExtract`, `updateExtract`, or `deleteExtract` settles, it immediately updates the store cache and triggers invalidation.
  - `ExtractsList` observes the store or subscribes to invalidation for its `documentId`, refetching/updating synchronously without requiring remounts.
- **Rationale**: Decouples component mount timing from data freshness, ensuring that creating an extract on the document surface immediately updates the Extracts tab even if `ExtractsList` is already mounted or mounted immediately afterward.

### Decision 5: Scoped View Loading Ownership in DocumentViewer
- **Decision**: Restructure `DocumentViewer` rendering JSX to evaluate `viewMode` independently of document source loading:
  ```tsx
  {viewMode === "extracts" ? (
    <ExtractsList documentId={currentDocument.id} ... />
  ) : viewMode === "cards" ? (
    <LearningCardsList documentId={currentDocument.id} ... />
  ) : isPaletteMode && canUseEditPalette ? (
    <EditableContentPalette ... />
  ) : isSourceLoading && !canRenderAudioViewer ? (
    <div className="flex items-center justify-center h-full">
      <div className="text-muted-foreground">{t("viewer.loadingDocument")}</div>
    </div>
  ) : (
    <DocumentReader ... />
  )}
  ```
- **Rationale**: `ExtractsList` and `LearningCardsList` only require a valid `currentDocument.id` and SQLite database access. They do not require PDF.js range workers, EPUB streaming servers, or large file buffers to finish initializing.
- **Alternatives Considered**:
  - *Keeping source loading in front and setting isLoading=false on tab switch*: Rejected because toggling the source loading flag corrupts background document preparation and causes reader flickers.

### Decision 6: Monotonic Load Generation IDs and Terminal Readiness
- **Decision**:
  1. Add `loadGenerationRef = useRef<number>(0)` to `DocumentViewer`.
  2. Each invocation of `loadDocumentData` increments `const currentGen = ++loadGenerationRef.current`.
  3. Every asynchronous step within `loadDocumentDataInner` checks `if (currentGen !== loadGenerationRef.current) return;` before updating `fileData`, `pdfUrl`, `epubUrl`, `htmlContent`, `mediaSource`, `mediaError`, or `isLoading`.
  4. `lastLoadedDocumentIdRef.current` is set ONLY after `loadDocumentData` reaches a successful terminal ready state, NOT synchronously in `hydrateDocument.then()`.
  5. If `loadDocumentData` rejects or aborts, `lastLoadedDocumentIdRef.current` is reset/cleared, allowing subsequent re-entries to re-attempt loading cleanly.
- **Rationale**: Eliminates race conditions where opening Document A, quickly opening Document B, and receiving Document A's bytes late overwrites Document B's state.

### Decision 7: Subview Loader Cancellation and Race Protection
- **Decision**: In `ExtractsList` and `LearningCardsList`, wrap the `documentId` fetch effects with standard cancellation flags / request generation IDs:
  ```tsx
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getExtracts(documentId)
      .then((data) => {
        if (!cancelled) setExtracts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);
  ```
- **Rationale**: Prevents stale database responses from an earlier document from overwriting a newer document when the user switches tabs rapidly.

### Decision 8: Android Touch Selection Safety
- **Decision**: Never invoke `window.getSelection()?.removeAllRanges()` on Android / touch platforms during action dismissal.
- **Mechanism**: Use `selectionController.dismiss({ suppressCurrentText: true })` and `dismissedSelectionKeyRef`, which hides the Plethora action UI and ignores the existing native selection until a new touch gesture occurs, keeping Android WebView's native action mode and focus stable.

### Decision 9: Desktop Parity
- **Decision**: Desktop right-click context menu and `SelectionPopup` actions route through the same snapshot capture and `createInstantExtract` contract, ensuring consistent highlight creation, toast feedback, and extract freshness.

## Answers to Specific Design Inquiries

1. **What object is the authoritative selection payload for V2 Extract?**
   `CapturedSelection` produced by `selectionController.captureForAction()`, containing `text`, `passage`, `selectionContext`, `geometry`, `documentId`, `surface`, `readerContext`, and `operationId`.
2. **At what moment is it captured?**
   At the exact moment the user triggers the Extract action, before executing dismissal or state transitions.
3. **What is the return contract of extract creation?**
   `Promise<Extract | null>` across all extract creation entry points.
4. **Who owns AI-result Create Extract saving state?**
   `SelectionActionsSheet` manages local `isSavingExtract` state (`idle` | `saving` | `saved` | `error`).
5. **How are duplicate submissions prevented?**
   Synchronous button disabling on first tap in `SelectionActionsSheet` combined with the in-flight deduplication set in `useToastExtract`.
6. **What is the canonical freshness mechanism for Extracts?**
   Extract store invalidation / document-scoped reactive subscription linking `createExtract` directly to `ExtractsList`.
7. **Does `ExtractsList` migrate to `useExtractStore`, or use explicit invalidation?**
   `ExtractsList` observes `useExtractStore` state / invalidation signals for the active `documentId`.
8. **What does document-level `isLoading` actually mean after this change?**
   It strictly represents document source binary/media loading (`isSourceLoading`) and only gates the `viewMode === "document"` content container.
9. **Which views are allowed to render while source loading continues?**
   `viewMode === "extracts"` and `viewMode === "cards"` render immediately.
10. **How are concurrent `loadDocumentData` generations sequenced?**
    Via monotonic integer `loadGenerationRef.current += 1`.
11. **When is `lastLoadedDocumentIdRef` updated?**
    Only upon successful completion of `loadDocumentData`.
12. **How are stale load completions ignored?**
    Async branches check `if (gen !== loadGenerationRef.current) return;` before calling state setters.
13. **Do ExtractsList/Card list loaders need cancellation guards?**
    Yes, standard `cancelled` flags in `useEffect` cleanup.
14. **What is the failure/retry model for each foreground load?**
    Inline error banners with actionable "Retry" buttons for source loading, extracts loading, and card loading; preserved input with re-enabled CTA for extract creation.
15. **How is Android native selection safety preserved?**
    By avoiding `removeAllRanges()` on touch devices and relying on controller suppression.
16. **How is desktop behavior kept consistent?**
    By sharing `createInstantExtract` and immutable snapshot capture across context menus and popup bars.
17. **Which existing OpenSpec capabilities are modified instead of duplicated?**
    `toast-extract-feedback` and `extract-reader-stability` are updated via delta specs; new capabilities `reader-view-state-lifecycle` and `reader-selection-extract-flow` are created.

## Risks / Trade-offs

- **[Risk] Multiple rapid document switches while large PDF is parsing**:
  - *Mitigation*: Monotonic `loadGenerationRef` strictly ignores callbacks from superseded loads.
- **[Risk] ExtractsList rendering before document metadata is hydrated**:
  - *Mitigation*: `DocumentViewer` only renders view modes once `currentDocument` is validly hydrated (`currentDocument.id` present).
- **[Risk] E-ink screen ghosting or animation dependencies**:
  - *Mitigation*: Saving indicators in `SelectionActionsSheet` use text/icon indicators rather than continuous high-fps animations.
