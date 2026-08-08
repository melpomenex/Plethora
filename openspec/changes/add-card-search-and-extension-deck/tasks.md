## 1. Fix deck moves so tags survive (root-cause first)

- [x] 1.1 Add `swapDeckTags(cardTags: string[], decks: StudyDeck[], targetDeck: StudyDeck): string[]` to `src/utils/studyDecks.ts` — drop tags that are filters of decks the card currently matches, add the target deck's `tagFilters`, preserve everything else, reusing the existing `normalize` / `tagMatchesFilter` comparison
- [x] 1.2 Extend `src/utils/__tests__/studyDecks.test.ts`: provenance tags survive a move, unrelated user tags survive, the previous deck's tag is removed, a card matching no deck keeps all tags
- [x] 1.3 Replace `tags: [...deck.tagFilters]` in `handleCardMoveToDeck` (`src/components/review/DeckManager.tsx:605`) with `swapDeckTags(...)`, in both the optimistic state update and the `updateLearningItem` persist call, keeping the existing reload-on-failure path

## 2. Browser Extension deck in the Deck Manager

- [x] 2.1 Add `browser_import_tags(kind: &str) -> Vec<String>` to `src-tauri/src/browser_sync_server.rs` and use it at the two card-creating call sites (`:1957` image occlusion, `:2399` AI save) in place of the inline tag literals
- [x] 2.2 In `DeckManager`, after cards load, ensure the deck once per mount (ref-guarded): if any card carries `browser-extension` and no existing deck has `browser-extension` among its `tagFilters`, call `addDeck("Browser Extension", ["browser-extension"], undefined, "tags")` — detect by tag filter, not by name, so a renamed deck is not duplicated
- [x] 2.3 Add the `Browser Extension` deck name to the i18n locale files alongside the other deck-manager strings
- [x] 2.4 Test the ensure logic: deck created with `filterType: "tags"` and `tagFilters: ["browser-extension"]`, not created when no card carries the tag, not duplicated across repeated runs, not recreated when a renamed deck already filters on the tag

## 3. Card search in the Documents view

- [x] 3.1 Add `matchesCardSearch(item, tokens: DocumentSearchTokens): boolean` to `src/utils/documentsView.ts` — match `tokens.text` against question, answer, cloze text and tags; require all `tokens.tags`; return `false` when `tokens.sources`, `tokens.queue`, or `tokens.extracts` is present
- [x] 3.2 Extend `src/utils/__tests__/documentsView.test.ts` for `matchesCardSearch`: free-text hit on question/answer/cloze/tag, `tag:` filter, `tag:` + text combined, and document-only tokens excluding all cards
- [x] 3.3 In `DocumentsView`, lazily fetch `getAllLearningItems()` on the first non-empty `debouncedSearch`, cache it in state for the view's lifetime, and swallow fetch failures to an empty list so document results still render
- [x] 3.4 Render a "Cards" result group (with count) below the document results when the query matches at least one card, showing question or cloze text, a card-type indicator, image-occlusion label where applicable, and tags
- [x] 3.5 Wire card activation to open the Deck Manager with that card selected in the card editor, reusing the existing `incrementum:pending-flashcard-id` handoff (`DeckManager.tsx:124`)
- [x] 3.6 Add the Cards group heading, count, and empty-state strings to the i18n locale files

## 4. Verify

- [x] 4.1 Run `npm test` (vitest) and `cargo test --manifest-path src-tauri/Cargo.toml` and fix fallout
- [ ] 4.2 Run the app: create an image occlusion card from the extension, confirm it appears in the `Browser Extension` deck, move it to another deck, then confirm `tag:browser-extension` in the Documents view search still finds it
