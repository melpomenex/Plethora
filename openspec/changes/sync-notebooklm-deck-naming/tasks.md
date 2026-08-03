## 1. Deck name derivation

- [ ] 1.1 Add a helper (e.g. `deriveDeckNameFromNotebookTitle` in `src/utils/studyDecks.ts`) that sanitizes a NotebookLM notebook title into a deck-safe name: trim, collapse whitespace, strip tag-unsafe characters, fall back to "NotebookLM Import" if empty
- [ ] 1.2 Add unit tests for the helper covering: normal title, whitespace-heavy title, empty/whitespace-only title, title with tag-unsafe characters (e.g. commas)

## 2. Deck assignment during sync

- [ ] 2.1 Wire the NotebookLM flashcard/quiz sync step (from `add-notebooklm-integration`) to call `ensureDecksExist([derivedDeckName])` before/while creating synced cards, reusing the existing case-insensitive deck reuse behavior
- [ ] 2.2 Confirm repeat syncs from the same notebook reuse the existing deck rather than creating a duplicate (integration test against `ensureDecksExist`)
- [ ] 2.3 Expose the derived deck name to the sync-confirmation UI as an editable default so the user can override it before confirming

## 3. Source provenance

- [ ] 3.1 Extend card creation during NotebookLM sync to set a `source_url`-style provenance value (e.g. `notebooklm://<notebook_id>`), following the pattern used for podcast episodes (`src-tauri/src/commands/podcast.rs`)
- [ ] 3.2 Verify provenance survives deck reassignment/rename (i.e. it's stored independent of the deck tag)

## 4. Tests

- [ ] 4.1 Add/extend integration tests analogous to `flashcardStudioSessions.integration.test.ts` covering: first sync creates a notebook-named deck, repeat sync reuses it, user override lands cards in the chosen deck instead
- [ ] 4.2 Add a test for the empty/unsanitizable-title fallback path end-to-end (sync creates cards in "NotebookLM Import")
