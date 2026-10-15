## 1. Gesture Detection & Paragraph Selection in Adapters

- [x] 1.1 Add touch double-tap tracking and gesture detection to `attachTopDocumentAdapter` in `src/components/viewer/selectionInteraction/adapters.ts`
- [x] 1.2 Implement paragraph element resolver helper to find the target paragraph container (`p`, `blockquote`, `[data-pdf-reflow-block]`, `li`) with exclusions for interactive elements (`a`, `button`, `input`, etc.)
- [x] 1.3 Implement programmatic DOM Range selection on the resolved paragraph element and dispatch selection event with `gestureOrigin: "double-tap"`
- [x] 1.4 Extend `attachContentDocumentBridge` to detect double-taps within iframe-hosted documents (EPUB, HTML) and select paragraph ranges in the iframe document

## 2. Selection Controller & Intent Integration

- [x] 2.1 Update `GestureOrigin` type and intent classification in `src/components/viewer/selectionInteraction/intent.ts` to support `"double-tap"`
- [x] 2.2 Verify `useSelectionInteraction` processes programmatic paragraph selections, computes placement geometry, and enters `ready` phase
- [x] 2.3 Ensure touch-action and event handling prevent mobile double-tap zoom interference on content surfaces

## 3. Queue Scroll & Document Viewer Surface Integration

- [x] 3.1 Verify and hook paragraph double-tap handling in `QueueScrollPage` for RSS content and rendered document items
- [x] 3.2 Verify and test paragraph double-tap handling across `DocumentViewer` (Markdown, EPUB, PDF Reflow, HTML)
- [x] 3.3 Ensure action surfaces (`SelectionActionBar`, `SelectionActionsSheet`, `ContextMenu`, extract dialogs) open reliably with paragraph text

## 4. Testing & Verification

- [x] 4.1 Add unit tests for double-tap detection and paragraph range selection in `adapters.test.ts`
- [x] 4.2 Add hook/machine integration tests in `useSelectionInteraction.test.tsx` verifying double-tap flow transitions to `ready` with paragraph text
- [x] 4.3 Run existing benchmark and test suite (`npm run test:scripts`, vitest) to verify zero regressions
