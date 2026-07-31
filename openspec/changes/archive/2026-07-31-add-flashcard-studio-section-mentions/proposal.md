## Why

In regular documents, the Assistant lets a user type `#` to open a menu of the document's sections (headings / chapters / PDF & EPUB outline entries), pick one, and feed just that section's text into the LLM context window. The AI Flashcard Studio — the primary place users go to *generate* cards from a document — has no equivalent: its context options are whole-document, rough "chapters", approximate page ranges, pasted excerpts, or search, but the user cannot precisely point at "the section titled X" the way they already can in the Assistant. This forces users to either dump the whole document (wasting tokens, diluting focus) or hand-paste excerpts, when the precise section-resolution machinery already exists and is proven in the Assistant. The Studio should reuse that same section-mention interaction so flashcard generation can be scoped to an exact, authoritatively-bounded section.

## What Changes

- Add a **section-mention** interaction to the AI Flashcard Studio chat input: typing `#` while a document is selected opens the existing `SectionMentionPopup`, filtered to the selected document's section tree.
- On selecting a section, insert a `#{title}` token in the input and track the chosen `SectionNode`(s) as the active section focus.
- Introduce a new **`sections` context mode** in the `ContextControlPanel` (alongside `full` / `chapters` / `pages` / `excerpt` / `search`). When active, the LLM context is built by resolving the mentioned section(s) via the existing `resolveSectionFocusedContext` (re-resolving ranges against fresh document text, within the token budget, with neighbor context).
- Surface the focused section(s) in the context summary banner (token estimate + section labels), consistent with the Assistant's "Focused: …" affordance.
- Stamp generated cards / the assistant message with a `sourceContext` (section ids + content hash) so the provenance of cards generated from a section is preserved, mirroring the Assistant.
- Reuse the existing shared infrastructure (`useDocumentSections`, `SectionMentionPopup`, `resolveSectionFocusedContext`, `createDocumentQaRequestContent`) rather than duplicating section-parsing or resolution logic. **No backend/Rust changes.**

## Capabilities

### New Capabilities

- `flashcard-studio-section-mentions`: Ability to scope AI flashcard generation in the Flashcard Studio to a specific document section via a `#` mention in the chat input, reusing the Assistant's section-resolution machinery to feed an authoritatively-bounded section into the LLM context.

### Modified Capabilities

<!-- No existing spec-level requirements change. The Flashcard Studio has no current spec, and section mentions in the Assistant are un-specced. This change establishes the new capability via a new spec. -->

## Impact

- **Frontend (Flashcard Studio)**: `src/components/review/FlashcardStudioModal.tsx` — add `#`-trigger handling + `SectionMentionPopup` to the chat `<textarea>`; add `sections` mode to `ContextControlPanel`; extend the `contextContent` memo and `handleSend` to resolve mentioned sections; thread `sourceContext` onto generated messages/cards.
- **Shared (reuse, no change expected)**: `src/components/common/SectionMentionPopup.tsx`, `src/hooks/useDocumentSections.ts`, `src/utils/sectionIndex.ts` (`resolveSectionFocusedContext`, `buildDocumentSections`), `src/features/documentQa/sectionContextRequest.ts` (`createDocumentQaRequestContent`, `loadDocumentQaText`).
- **State**: extends `ContextSelection` / `ContextMode` with a `sections` mode and a `selectedSectionIds` (or node) field; persisted behavior of the modal (e.g. `localStorage` history) is unaffected.
- **No backend/Rust changes**; no breaking changes — the new mode is additive and only available when a document is selected.
