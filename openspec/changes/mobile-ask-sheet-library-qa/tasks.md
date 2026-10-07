# Tasks

## 1. Scope resolution and answer-model plumbing

- [x] 1.1 Extend the library answer model to carry per-citation location metadata (`documentId`, `documentTitle`, `headingPath`, `location`) from `RetrievalResult` through `askLibrary`, and verify the existing `ragContracts`/`libraryTask` unit tests pass with citations resolving to the correct documents.
- [x] 1.2 Implement scope resolution (Passage / Document / Library) mapping to RAG composition: Passage calls `askLibrary` with `sources: []` and the chip text as `contextPassage`; Document retrieves with `documentId` set; Library uses `resolveLibraryRagComposition()`; verify each scope produces the expected retriever request in unit tests.
- [x] 1.3 Expose the library indexer's unindexed-document count and the resolved `generatorKind` (on-device / cloud / retrieval-only) to the UI layer, and verify the values match the indexer and composition state in unit tests.

## 2. AskSheet composer

- [x] 2.1 Build the `AskSheet` bottom-sheet composer (mobile-only, following the `MobileContextMenuSheet` pattern) with context chip (tap-to-edit, remove → falls back to Document scope), scope picker, text input, and voice input control; verify the sheet opens/closes with gestures and the keyboard only appears on field focus in component tests.
- [x] 2.2 Generate 3 tap-to-ask suggested questions from the passage when the sheet opens (cached per passage hash), and verify suggestions render and submit without typing in component tests.
- [x] 2.3 Implement "Where else is this discussed?" as a retrieval-only jump-list of related passages in other documents with deep-links, and verify entries navigate to the cited locations in integration tests.

## 3. Docked answer cards

- [x] 3.1 Build the docked answer card (collapsed summary → swipe-up expanded → swipe-down dismiss) keeping the document visible and scrollable above it, and verify expand/dismiss gestures and document interactivity in component tests.
- [x] 3.2 Render source citations as tappable chips using the plumbed location metadata, and verify tapping a chip opens the reader at the cited document location in integration tests.
- [x] 3.3 Wire card actions: Make flashcard (creates a card carrying question, answer, and source citations), Read aloud (via TTS), and Copy; verify flashcard creation persists sources and TTS speaks the answer in integration tests.
- [x] 3.4 Add follow-up suggestion chips that submit the next question without opening the keyboard, and verify a two-turn conversation stays in the same sheet session in integration tests.

## 4. Reader entry points and rollout flag

- [x] 4.1 Promote Ask to the single primary action on the mobile selection menu with remaining actions in overflow (desktop unchanged), and verify Ask is visible without horizontal scrolling on a mobile viewport in component tests.
- [x] 4.2 Add the no-selection "Ask about this page" entry point opening the composer with the visible section as context, and verify the context matches the viewport section in integration tests.
- [x] 4.3 Gate the new mobile Ask entry and sheet behind a `settings.features` flag (default off), and verify the old pill-menu path remains when the flag is off.

## 5. Honest state and edge cases

- [x] 5.1 Show the Library-scope freshness disclosure when unindexed documents exist and the answering-mode indicator (on-device / cloud / retrieval-only) in the composer, and verify both reflect live state in component tests.
- [x] 5.2 Implement retrieval-only mode: return matching passages with no generation and no network egress, and verify no cloud calls occur in unit tests with network stubbed.
- [x] 5.3 Handle the zero-valid-citation case (validation drops all fabricated refs) by showing retrieved passages without a synthesized answer, and verify the empty state renders in component tests.

## 6. Integration verification

- [x] 6.1 Run the full related unit/integration suites (`vitest` for touched areas) plus `npm run bench:check` to confirm no performance regression, and verify all green.
- [x] 6.2 Walk the end-to-end mobile flow on a real viewport (select → Ask → voice/type → answer card → flashcard → deep-link back), and verify each spec scenario passes.
