## 1. Carry open-origin on document-viewer tabs

- [x] 1.1 In `src/components/tabs/DocumentsTab.tsx`, set `data: { documentId, openedFrom: "documents" }` on the `addTab` call (~line 11–24).
- [x] 1.2 In `src/pages/DocumentsPage.tsx`, do the same — add `openedFrom: "documents"` to the `addTab({ type: "document-viewer", data: { documentId } })` call (~line 10–19).
- [x] 1.3 In `src/components/tabs/QueueTab.tsx`, add `openedFrom: "queue"` to the queue-opened document-viewer tab `data` (~line 33–63).
- [x] 1.4 In `src/pages/QueuePage.tsx`, add `openedFrom: "queue"` to the queue-opened document-viewer tab `data` (~line 30–54).
- [x] 1.5 In `src/hooks/useQueueNavigation.ts`, add `openedFrom: "queue"` to the prev/next navigation `addTab` data (~line 85–95).

## 2. Forward the signal through the wrapper

- [x] 2.1 In `src/components/viewer/DocumentViewerWrapper.tsx`, add `openedFrom?: string` and `hideRatingOrbs?: boolean` to the `DocumentViewerWithAssistantProps` interface.
- [x] 2.2 In `DocumentViewerWrapper.tsx`, forward `openedFrom` and `hideRatingOrbs` to `<BaseDocumentViewer ... />` in the JSX where props are spread/passed (~line 343–357).

## 3. Gate the inline rating orbs by origin

- [x] 3.1 In `src/components/viewer/DocumentViewer.tsx`, accept an `openedFrom?: string` prop (add to the component's props type alongside the existing `hideRatingOrbs` declaration, ~line 296).
- [x] 3.2 Add a memoized derived flag, e.g. `const shouldHideRatingOrbs = hideRatingOrbs || openedFrom === "documents";`, near the existing `hideRatingOrbs` default (~line 364).
- [x] 3.3 Update the inline rating-orbs render condition (~line 7096) to use `shouldHideRatingOrbs` instead of `!hideRatingOrbs`, preserving the other existing gates (`viewMode === "document"`, doc-type checks, `isDocumentInQueue`).
- [x] 3.4 If the single "mark as read" fallback button uses the same `hideRatingOrbs` gate, apply the same `shouldHideRatingOrbs` substitution there for consistency.

## 4. Verify

- [x] 4.1 Build/typecheck the app (`npm run build` or the project's typecheck) to confirm the prop wiring compiles.
- [ ] 4.2 Manually open a document that is in the queue from the **Documents** view → confirm the inline rating orbs do NOT appear.
- [ ] 4.3 Open the same document from the **Queue** view → confirm the inline rating orbs DO appear and rating still advances to the next queue item.
- [ ] 4.4 Open via queue prev/next navigation → confirm orbs still appear.
- [ ] 4.5 Enter Scroll Mode from the queue → confirm the `ScrollOverlayControls` orbs are unaffected (separate code path) and the embedded viewer's inline orbs remain hidden as before.
