## 1. Fix .apkg import deck wiring

- [ ] 1.1 In `src/components/documents/DocumentsView.tsx::handleAnkiPackage`, extract distinct Anki deck names from the imported items (reuse or mirror `inferAnkiDeckNames` from `ReviewHome.tsx`).
- [ ] 1.2 Call `useStudyDeckStore.getState().ensureDecksExist(deckNames)` after import completes, matching the pattern in `ReviewHome.tsx::handleImportDeck`.
- [ ] 1.3 Remove the stale `// TODO: Show a dialog to let user select which decks to import` comment now superseded by automatic deck creation.
- [ ] 1.4 Verify re-importing the same `.apkg` (or importing via a different entry point) attaches to the existing deck rather than creating a duplicate (confirm `ensureDecksExist` dedupe behavior in `studyDeckStore.ts:110-131` covers this).

## 2. Unfiled view

- [ ] 2.1 Add a helper (e.g. `getUnfiledCards(cards, decks)`) near `matchesDeck` in `src/utils/studyDecks.ts` that returns cards not matched by any deck.
- [ ] 2.2 Add an "Unfiled" entry to Deck Manager's deck list/sidebar in `src/components/review/DeckManager.tsx`, backed by the new helper.
- [ ] 2.3 Memoize the unfiled computation keyed on cards/decks to avoid recomputation on every render.
- [ ] 2.4 Add an empty state for when there are no unfiled cards.

## 3. Bulk card selection and move

- [ ] 3.1 Add multi-select state to `DeckManager.tsx` (selected card IDs) and selection checkboxes to `DeckManagerCardRow.tsx`.
- [ ] 3.2 Add a "Move to deck" bulk action (toolbar/context menu) that appears when one or more cards are selected, available from both a deck view and the Unfiled view.
- [ ] 3.3 Implement bulk move logic that reassigns tags for all selected cards to the target deck's `tagFilters`, batching the update rather than looping per-card DB writes.
- [ ] 3.4 Support "New deck" as a target option in the bulk move action, creating the deck then assigning selected cards to it.
- [ ] 3.5 After a bulk move, clear selection and refresh the current view (selected cards should disappear from Unfiled / prior deck view as appropriate).

## 4. Verification

- [ ] 4.1 Manually test: import a `.apkg` via Documents view drag-drop, confirm a matching deck appears in Deck Manager with the cards assigned.
- [ ] 4.2 Manually test: create cards with tags not matching any deck, confirm they appear under Unfiled.
- [ ] 4.3 Manually test: select multiple cards in Unfiled and in an existing deck, move to another deck (existing and new), confirm cards move correctly and disappear from prior view.
- [ ] 4.4 Re-import the same `.apkg` twice and via two different entry points; confirm no duplicate decks are created.
