## Why

Five reported bugs remain open after the queue-ordering, extract-mode, feature-popup, flashcard-percentage and item-types fixes landed. An audit of each against the code (and, for two of them, against the live database) found that they are not one class of problem: two are missing features reported as breakage, two are surfaces that exist but degrade to nothing in common cases, and one cannot currently be reproduced. They are grouped here because they are all user-visible promises the app does not keep.

The startup/runtime slowness report is deliberately excluded — it appears resolved by the Yjs sync disable, the y-indexeddb cold-start fix, the bounded startup loading, the library virtualization, and the queue virtualization repair.

## What Changes

- **Extracts become readable in their own right.** The queue's primary action on an extract opens the parent document and scroll-focuses the extract card. There is no way to read an extract as an item. Add a dedicated extract reading surface and route the queue to it, keeping "open source document" available as a secondary action.
- **Manual image occlusion authoring.** AI-generated occlusion exists; hand-authoring does not exist at all — there is no region-drawing editor anywhere in the codebase. Add one: draw, move, resize, delete and label regions over an image, then save as an occlusion card. Also tighten the AI path so unusable AI regions can be corrected in the same editor rather than discarded.
- **`#` mentions stop coming up empty.** Assistant mentions resolve against `buildDocumentSections`, which needs Markdown headings or a PDF/EPUB outline. A plain imported article has neither, so the popup is empty and the feature reads as broken. Add a fallback section index for outline-less documents, and let the user mention the **current selection** — which is what "asking about a certain portion of text" actually means.
- **In-app web browser works or says why it cannot.** The browser tab renders through a cross-origin iframe on web (silently blocked by `X-Frame-Options`/CSP for most sites) and a manually bounds-synced native webview under Tauri. Diagnose which path fails, fix it, and surface an explicit blocked/failed state instead of a blank pane.
- **Imported articles must not yield a whole-article extract.** Not reproducible from current data — every extract in the live database is under 2 KB and no import path was found that auto-extracts. Reproduce it against the URL/browser import paths first; fix and add a regression test if confirmed, otherwise close it with the test as evidence.

## Capabilities

### New Capabilities
- `extract-reading`: opening, reading and rating an extract as a first-class item, independent of its source document.
- `manual-image-occlusion`: hand-authoring and editing occlusion regions on an image, including correcting AI-proposed regions.
- `assistant-text-mentions`: referencing part of a document in the assistant — outline sections, heuristic sections for outline-less documents, and the live text selection.
- `in-app-web-browser`: browsing inside the app and creating extracts from the page, with an explicit failure state when a site cannot be embedded.
- `imported-article-extracts`: what an import may and may not create as extracts.

### Modified Capabilities

None. No existing spec in `openspec/specs/` covers these surfaces. `flashcard-studio-section-mentions` covers the Flashcard Studio mention UI only; `assistant-text-mentions` is the assistant-side counterpart and must stay consistent with it.

## Impact

- **Extract reading**: `src/components/review/queueActions.ts`, `src/components/tabs/QueueTab.tsx`, `src/pages/QueuePage.tsx`, a new extract reader surface, `src/components/tabs/TabRegistry.tsx`.
- **Manual occlusion**: new editor component, `src/components/viewer/ImageSaveOverlay.tsx`, `src/components/review/FlashcardStudioModal.tsx`, `src/components/review/ReviewCard.tsx`, `src/types/learningItemInteractions.ts`.
- **Mentions**: `src/utils/sectionIndex.ts`, `src/hooks/useDocumentSections.ts`, `src/components/assistant/AssistantPanel.tsx`, `src/components/tabs/DocumentQATab.tsx`, `src/components/common/SectionMentionPopup.tsx`.
- **Browser**: `src/components/tabs/WebBrowserTab.tsx`, `src/lib/webview-extract-bridge.ts`, Tauri webview bounds/z-order handling.
- **Import fidelity**: `src/utils/documentImport.ts`, `src/api/documents.ts`, `src/components/tabs/WebBrowserTab.tsx` (page-save path).
- **i18n**: new user-facing strings must land in all six locales (`en`, `de`, `es`, `fr`, `ja`, `zh`) — the repo has a placeholder-parity test.
- No database migrations expected except any new occlusion region persistence, which should reuse the existing `image-occlusion` learning-item shape.
