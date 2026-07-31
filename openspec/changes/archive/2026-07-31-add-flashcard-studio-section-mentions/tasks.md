## 1. Data model & state plumbing

- [x] 1.1 Extend `ContextMode` in `FlashcardStudioModal.tsx` with `"sections"`, and add a `selectedSectionIds: string[]` field (default `[]`) to `ContextSelection` and `DEFAULT_CONTEXT_SELECTION`.
- [x] 1.2 Update `normalizeContextSelection` to accept and validate `selectedSectionIds` (filter to strings; default `[]`).
- [x] 1.3 Add an optional `sourceContext?: SectionSourceReference` field to the `ChatMessage` type (and carry the same reference onto generated `DraftCard`s).

## 2. Section tree wiring

- [x] 2.1 In `FlashcardStudioModal`, call `useDocumentSections({ documentId: selectedDocument?.id, content: selectedDocumentText ?? "", contentHash })` to build the section tree (it auto-reads PDF/EPUB outlines from `useDocumentOutlineStore`). Memoize so it only rebuilds when the document or its text changes.
- [x] 2.2 Derive `selectedSectionNodes` from `selectedSectionIds` via the hook's `getById`/`flat` list.

## 3. `#` mention interaction in the chat input

- [x] 3.1 Add `#`-trigger state to the chat input handler (mirroring `AssistantPanel.handleInputChange`): detect a bare `#` via `/#([^#\s]*)$/`, open a popup, and close/clear selection when a `#{...}` token is deleted.
- [x] 3.2 Render the existing `SectionMentionPopup` above the chat `<textarea>` (only when a document is selected and the trigger is active), passing the section tree and the current query.
- [x] 3.3 Implement selection: on pick, replace the typed `#query` with a `#{title}` token at the caret, append the section id to `selectedSectionIds`, and set `contextSelection.mode = "sections"`.
- [x] 3.4 Wire keyboard navigation (Arrow/Enter/Esc/Tab) for the popup, consistent with the Assistant.

## 4. Context Control panel: sections mode

- [x] 4.1 Add a `sections` mode button to the `ContextControlPanel` mode row, with an icon and i18n label.
- [x] 4.2 When `mode === "sections"`, render the focused section list (labels/breadcrumbs) with remove controls, plus a hint to use `#` in the prompt. Clearing all sections falls `mode` back to `full`.
- [x] 4.3 Update the panel's `estimatedTokens` memo and the collapsed summary text to show section label(s) + token estimate for `sections` mode (using the hook's token estimate, not full resolution).

## 5. Context resolution at send time

- [x] 5.1 In the `contextContent` memo, return `undefined` for `mode === "sections"` (resolution is deferred to send time to operate on fresh text).
- [x] 5.2 In `handleSend`, add a `sections` branch before the LLM call: reload document text via `loadDocumentQaText`, call `resolveSectionFocusedContext(selectedSectionNodes, allSections, freshText, { documentId: selectedDocument.id, maxTokens })` with a single transparent retry on transient first-load miss (mirror AssistantPanel lines 1166–1204).
- [x] 5.3 On success, build the prompt via `createDocumentQaRequestContent` and pass the resolved content as `contextContent` to `chatWithContext`; stamp the returned `sourceContext` onto the assistant message and generated cards.
- [x] 5.4 Extend the context-descriptor system message to emit `Use the document titled "X", focusing on: <section labels>` for `sections` mode.

## 6. Validation & errors

- [x] 6.1 In `contextValidationError`, add a `sections` case: empty focus → "Select a section before generating cards."; unresolvable selection → report the resolution diagnostic; never fall back to whole-document.
- [x] 6.2 Surface `truncated` from `resolveSectionFocusedContext` in the post-generation message/summary so users know the section was clipped to the token budget.

## 7. Cost estimator & i18n

- [x] 7.1 Ensure the `CostEstimator` input for `sections` mode uses the focused-section token estimate (cheap), not full resolution.
- [x] 7.2 Add i18n keys for the new `sections` mode label, summary, hints, and validation messages under `flashcardStudio.*` (and any new section-mention labels) across all locale files.

## 8. Verification

- [ ] 8.1 Manual: with a document selected, type `#`, pick a section, confirm the token/summary updates and only the section is sent (inspect the assembled context or network/IPC payload).
- [ ] 8.2 Manual: multi-section selection, deletion of a `#{title}` token, and empty-focus validation all behave per spec.
- [ ] 8.3 Manual: confirm a stale/edited document yields a resolution error (no silent whole-document fallback), and that `full`/`chapters`/`pages`/`excerpt`/`search` modes still work unchanged.
- [x] 8.4 Run `npm run typecheck` (and lint) and fix any new errors in `FlashcardStudioModal.tsx`.
