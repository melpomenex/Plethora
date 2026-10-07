# Proposal

## Why

Reading on mobile is Plethora's core loop, but asking a question about what you're reading is high-friction: select text, then hunt through a horizontally scrolling pill menu for the Ask action, then land in a generic chat box with no grounding in the passage. Users either don't ask or lose their reading flow entirely. Meanwhile the app already ships a semantic library index, embedding-based retrieval, and on-device RAG — the intelligence exists, but there is no mobile UX that exposes it where reading actually happens.

## What Changes

- Text selection on mobile surfaces a single primary **Ask** action; remaining selection actions move to an overflow. No more scrolling the pill to find Ask.
- Tapping Ask opens a **bottom-sheet composer**: the selected passage as an editable/removable context chip, a scope picker (**Passage / Document / Library**), voice input, and tap-to-ask suggested questions.
- Answers render as **docked cards over the document** (the document stays visible above the card), with tappable source citations, follow-up suggestion chips, and one-tap **Make flashcard** / **Read aloud** / **Copy**.
- **Library scope** answers questions across the user's whole library using the existing embedding retrievers, with cited sources that deep-link back to the passage. Documents not yet indexed are disclosed, never silently skipped.
- A **no-selection entry point** ("Ask about this page") uses the currently visible section as context, for questions that don't attach to a specific sentence.
- A **"Where else is this discussed?"** suggestion runs the selected concept across the library and returns a jump-list of related passages in other documents.

## Capabilities

### New Capabilities

- `mobile-ask-sheet`: Bottom-sheet question composer and docked answer cards on mobile — selection-triggered Ask entry, context chip, scope picker, voice input, suggested questions, answer cards with flashcard/TTS/copy actions and follow-up chips, and the no-selection "ask about this page" entry point.
- `library-qa`: Scoped semantic Q&A over the user's library — passage/document/library scope resolution through the existing RAG compositions, embedding retrieval with cited deep-linkable sources, suggested questions derived from passage context, cross-document concept tracing, and honest index-freshness signaling.

### Modified Capabilities

- None. No existing spec covers the mobile selection pill menu or the `ask-selection` assistant behavior, so there are no requirement deltas — only new behavior.

## Impact

- UI: `src/components/assistant/AssistantPanel.tsx` (mobile ask-selection flow), `src/components/common/MobileContextMenuSheet.tsx` (established sheet pattern to reuse), reader viewers (`DocumentViewer`, `PDFViewer`, `MarkdownViewer`, `AudiobookViewer`).
- AI: `src/lib/ai/tasks/definitions/libraryTask.ts` (`askLibrary` retrieval + grounded answers), `src/lib/ai/ragComposition.ts` and `src/lib/ai/resolveLibraryRag.ts` (scope-aware composition), `src/features/documentQa/` (section context).
- Learning loop: flashcard creation path (answer → card with source citations), TTS (`src/api/tts.ts`) for read-aloud answers.
- No breaking changes. Desktop assistant behavior is unchanged; all new UI is mobile-gated.
