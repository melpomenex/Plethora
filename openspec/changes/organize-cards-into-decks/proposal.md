## Why

Deck Manager already supports creating decks and moving a single card to a deck one at a time, but there is no bulk way to organize cards, and no way to see which cards aren't in any deck at all. Separately, `.apkg` imports only produce usable decks when they go through `ReviewHome`/`ReviewSession` (which call `ensureDecksExist`) — the Documents view's drag-drop `.apkg` import path (`DocumentsView.tsx::handleAnkiPackage`) tags cards with the Anki deck name but never creates or attaches the matching `StudyDeck`, so those cards are invisible in Deck Manager until a user manually recreates the deck with a matching name. This makes deck organization inconsistent depending on import entry point, and leaves users with no way to find and file the cards that fall outside any deck.

## What Changes

- Add an "Unfiled" / "No Deck" view in Deck Manager that surfaces every `learning_items` row whose tags don't match any existing `StudyDeck`'s `tagFilters` (using the existing `matchesDeck` logic from `src/utils/studyDecks.ts`), so cards outside a deck are easy to find.
- Add bulk selection and a "Move to deck" action in Deck Manager (multi-select cards, then assign/move them to a target deck in one action, with an option to create a new deck inline), extending the existing single-card `handleCardMoveToDeck` path.
- Fix `.apkg` import via the Documents view drag-drop path (`DocumentsView.tsx::handleAnkiPackage`) to call `ensureDecksExist` with the imported Anki deck names, matching the behavior already present in `ReviewHome.tsx::handleImportDeck` and `ReviewSession.tsx`, so every `.apkg` import path consistently creates/attaches decks named after the source Anki deck.
- Remove the stale `// TODO: Show a dialog to let user select which decks to import` comment in `DocumentsView.tsx` now that deck assignment happens automatically.

## Capabilities

### New Capabilities
- `deck-organization`: Bulk card-to-deck assignment and an "Unfiled" view in Deck Manager for finding and organizing cards that aren't in any deck.

### Modified Capabilities
- none (no existing spec currently covers Anki import deck assignment; import behavior fix is captured under the new `deck-organization` capability's requirements rather than an existing spec)

## Impact

- `src/components/review/DeckManager.tsx` — add multi-select state, bulk "Move to deck" action, and an "Unfiled" filter/tab.
- `src/components/review/DeckManagerCardRow.tsx` — add selection checkbox support.
- `src/utils/studyDecks.ts` — reuse/expose `matchesDeck` (and add an "unfiled" helper) for computing unassigned cards.
- `src/stores/studyDeckStore.ts` — reuse existing `ensureDecksExist`; possibly extend for bulk tag reassignment.
- `src/components/documents/DocumentsView.tsx` (`handleAnkiPackage`, ~line 573-584) — call `ensureDecksExist` after import, aligning with `ReviewHome.tsx`.
- No database schema changes — decks remain virtual/tag-based (`learning_items.tags`), consistent with the existing `flashcard-deck-manager` change.
