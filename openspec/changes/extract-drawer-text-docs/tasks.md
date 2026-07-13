## 1. Document Viewer Selection Drawer

- [x] 1.1 Update `activeExtractSelection` in `src/components/viewer/DocumentViewer.tsx` to support persistent selection drawer for all text formats: epub, markdown, html, other (plain text), and PDF OCR-HTML.
- [x] 1.2 Add `mousedown` listener to HTML iframe document inside `DocumentViewer.tsx`'s selection tracking `useEffect` to forward event to parent window for click-outside dismissal.

## 2. Queue RSS Selection Drawer

- [x] 2.1 Import `lookupDictionary` and define dictionary states inside `src/pages/QueueScrollPage.tsx`.
- [x] 2.2 Update selection toolbar UI for RSS items in `src/pages/QueueScrollPage.tsx` to use the premium glassmorphic selection drawer matching the DocumentViewer experience.
- [x] 2.3 Implement dictionary lookup action and dictionary definition display block for RSS items in `src/pages/QueueScrollPage.tsx`.
- [x] 2.4 Unify click-away dismissals for RSS text selection in the queue view.
