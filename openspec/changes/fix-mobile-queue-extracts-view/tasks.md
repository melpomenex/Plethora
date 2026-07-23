## 1. Add a bounded Queue Extracts scroll surface

- [x] 1.1 Update the `scrollViewMode === "extracts"` branch in `src/pages/QueueScrollPage.tsx` so the `ExtractsList` is rendered inside a full-height, `min-h-0`, `min-w-0` vertical scroll container within the existing document pane.
- [x] 1.2 Apply touch-friendly vertical scrolling and contained overscroll to the Queue Extracts wrapper, while leaving the parent pane and the Document/Learning Cards branches unchanged.
- [x] 1.3 Add responsive horizontal padding plus top and bottom clearance to the Queue Extracts wrapper, including mobile safe-area handling and enough space for transient overlay controls; confirm the wrapper does not create horizontal overflow at narrow widths.

## 2. Preserve existing Extracts behavior and view switching

- [x] 2.1 Keep `ExtractsList`'s shared root and data/action logic reusable for its existing `DocumentViewer` entry point; do not move Queue-specific overflow behavior into the shared component unless required by verification.
- [x] 2.2 Verify the overlay view-mode buttons still switch between Document, Extracts, and Learning Cards, and that returning to Document restores the existing EPUB/document viewer scroll and paging behavior.
- [x] 2.3 Verify extract selection, focused-extract scrolling, editing, deletion, card generation, and dialog interactions continue to operate after the list is scrolled.

## 3. Add regression coverage

- [x] 3.1 Add or update a focused test that asserts the Queue Extracts branch exposes the intended scroll-container and inset contract at the component/layout boundary supported by the existing Vitest setup.
- [x] 3.2 Run the focused Queue/Extracts tests and `npm run build:check`, fixing any type, lint, or JSX issues introduced by the layout change.

## 4. Verify responsive behavior manually

- [ ] 4.1 On a narrow mobile viewport approximating the Boox Palma 2, open an EPUB from Queue, tap the overlay Extracts button, and confirm the `Extracts` heading has visible side insets and does not bleed or clip at either edge.
- [ ] 4.2 On the same narrow viewport with enough extracts to exceed one screen, swipe from the top to the bottom and confirm every extract, including the final card's actions, is reachable above the safe area and overlay controls.
- [ ] 4.3 On a desktop/tablet viewport, confirm wheel or trackpad scrolling works, overlay controls remain usable, and switching back to Document leaves EPUB/document scrolling unaffected.
