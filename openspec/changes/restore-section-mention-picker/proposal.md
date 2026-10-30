## Why

Typing `#` in the Assistant no longer shows the document's sections, so the whole section-scoping workflow — ask about this chapter, make cards from it, send only those tokens — is unreachable. The picker element is still rendered in the DOM (the existing `#` unit tests pass), but it is absolutely positioned above a composer that became a scroll container (`overflow-y-auto`), so the browser clips it completely. The Document Q&A composer has the same scroll container and the same defect. Even where the picker is visible (Flashcard Studio), a bare `#` lists every nested heading as one flat list whose expand chevrons do not hide anything, which makes a book-sized outline hard to scan.

## What Changes

- **Restore picker visibility (the regression).** Render the `#` section picker in a shared anchored floating layer that is not a descendant of any scroll/clip container (portal + measured fixed position, clamped to the viewport and to the assistant panel). It opens above the text input, flips below only when there is no room, follows composer resize/scroll, and survives the mobile sheet. Applied uniformly to the Assistant, Document Q&A, and Flashcard Studio.
- **Make bare `#` an outline, not a flat dump.** With no query, show the document's top-level sections with real expand/collapse for nested headings, a breadcrumb preview, and a per-section token badge. Typing after `#` switches to ranked flat search results with matched breadcrumbs. The header names the document and reports top-level vs total sections.
- **Make the consequence of a selection explicit.** The picker footer states that the chosen section alone becomes the model context, and the selected-section card (already in the composer) shows the section's token cost. Selecting multiple sections shows their combined scope in the same affordance.
- **Keep keyboard navigation honest.** Arrow keys move the visible outline rows and scroll the active row into view; Right/Left (or the expand affordance) expand/collapse a branch; Enter selects; Escape closes and returns focus to the input. The popup exposes combobox/listbox semantics and `aria-activedescendant` while focus remains in the textarea.
- **Cover every entry path and state.** Typing or pasting `#` itself arms the section index (not only focus), and the picker distinguishes loading, no-extractable-text, no-document-targeted, and extract/non-document contexts instead of showing an empty panel or nothing.
- **Cross-surface parity.** Assistant (desktop and mobile presentation), Document Q&A, and Flashcard Studio use the same picker component, outline model, width/containment rules, and state copy.
- Add browser-level regression coverage that fails when the popup is clipped or covered, plus unit/integration coverage for outline browsing, filtering, keyboard behavior, and section-only prompt context.

## Capabilities

### New Capabilities

- `section-mention-picker`: The shared `#` section picker across the Assistant, Document Q&A, and Flashcard Studio: where and how it renders, outline-first browsing and filtering, token/context feedback, keyboard and accessibility behavior, and loading/empty/unavailable states.

### Modified Capabilities

- `document-qa-section-focus`: The Document Q&A autocomplete requirements gain a visible, unclipped floating layer anchored to the question input and an outline-first (expandable) presentation for a bare `#`; filtering and section-only scoping remain unchanged.

## Impact

- **Frontend (shared picker)**: `src/components/common/SectionMentionPopup.tsx` (portal/anchored layer, outline model, disclosure rows, active-row scrolling, accessibility), plus a small shared anchoring hook (for example `src/components/common/useAnchoredFloatingLayer.ts`) and any new i18n keys in all six locales under `src/lib/i18n/locales/*.ts`.
- **Frontend (hosts)**: `src/components/assistant/AssistantPanel.tsx` (anchor ref and render layer; type/paste arms the index), `src/components/tabs/DocumentQATab.tsx` + `src/components/tabs/documentQaWorkspace.css` (anchor ref; keep the composer scroll behavior without clipping the picker), and `src/components/review/FlashcardStudioModal.tsx` (same anchored layer and outline).
- **Tests**: `src/components/common/__tests__/SectionMentionPopup.test.tsx`, `src/components/assistant/__tests__/AssistantPanelSectionLazy.test.tsx`, `src/components/tabs/__tests__/DocumentQATab.test.tsx`, and a Playwright geometry/visual case built on `src/visual/assistantControlsHarness.tsx` / `src/visual/documentQaHarness.tsx` that asserts the popup is hit-testable and inside the host bounds. jsdom cannot detect ancestor clipping, so the browser test is the required regression guard.
- **No backend, API, database, or prompt-assembly changes.** Section resolution, token budgeting, and the submitted `#{…}` token format are untouched; this change restores and improves how a section is picked, not what is sent once picked.
