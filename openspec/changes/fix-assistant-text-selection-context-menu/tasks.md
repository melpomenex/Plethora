## 1. Isolate DocumentViewer selection and dismissal boundaries

- [x] 1.1 Add `data-assistant-panel="true"` to the root container of `AssistantPanel` in `src/components/assistant/AssistantPanel.tsx` and verify the attribute is present in rendered DOM.
- [x] 1.2 Scope `DocumentViewer`'s desktop `handleSelection` (`mouseup` / `keyup` in `src/components/viewer/DocumentViewer.tsx`) to only capture selections whose `anchorNode` and `focusNode` are inside the `DocumentViewer` content root (excluding `[data-assistant-panel="true"]`, `.textLayer`, `.context-menu`, and `[role="dialog"]`), and verify selecting text in `AssistantPanel` alongside an audio/video document does not call `updateSelection` or render `[data-extract-button="true"]`.
- [x] 1.3 Scope `DocumentViewer`'s mobile `readDocumentSelection`, `isDocumentContentScrollTarget`, and `handleTouchStart` (`src/components/viewer/DocumentViewer.tsx`) so `.prose` matches only within the `DocumentViewer` container and never inside `[data-assistant-panel="true"]`, and verify mobile selection in `AssistantPanel` does not open the document selection sheet.
- [x] 1.4 Update `DocumentViewer`'s `handleClickOutside` (`mousedown` listener in `src/components/viewer/DocumentViewer.tsx`) so clicks/right-clicks inside `[data-assistant-panel="true"]` do not call `clearTextSelection()` (which wipes `window.getSelection()`), and verify right-clicking selected text in `AssistantPanel` preserves the browser selection.

## 2. Preserve Assistant scroll position and context menu behavior

- [x] 2.1 Verify `useAssistantConversationScroll` (`src/components/assistant/useAssistantConversationScroll.ts`) preserves `scrollTop` during text selection, container resize, and context-menu open, and add a guard if needed so active selection or context menu interactions never trigger a jump to `scrollTop = 0` or an earlier message anchor.
- [x] 2.2 Verify `AssistantPanel`'s `handleContextMenu` (`src/components/assistant/AssistantPanel.tsx`) opens the context menu on both selected message text and non-text areas with selection actions (`Copy Selection`, `Extract Selection`, `Ask about Selection`, `Summarize Selection`) operating on the preserved selection.

## 3. Verification and regression tests

- [x] 3.1 Add unit/component tests in `src/components/assistant/__tests__/AssistantPanelContextMenu.test.tsx` (and/or `useAssistantConversationScroll.test.tsx`) covering text selection + right-click on message text and non-text areas, verifying selection preservation, scroll stability, and menu actions.
- [x] 3.2 Add a regression test for `DocumentViewer` + `AssistantPanel` (side-by-side non-PDF/audio mode) verifying that selecting text in `AssistantPanel` does not trigger `Create Extract` or `selection-context-chip`, and run the relevant Vitest suites (`npx vitest run src/components/assistant/__tests__/AssistantPanelContextMenu.test.tsx src/components/assistant/__tests__/useAssistantConversationScroll.test.tsx`).
