## Why

Cards created from the browser extension are invisible after import. They are saved with tags (`browser-extension`, `image-occlusion`) but nothing surfaces them: the Deck Manager only shows cards that match a user-created deck's tag filters, and the Documents view search only matches documents — never learning items. A user who occludes five images on Wikipedia has no view in the app that lists those five cards, and no way to file them into a real deck.

## What Changes

- **Documents view search matches learning items.** When a search query is active, the Documents view shows a "Cards" result group alongside the document results, matching card question/answer/cloze text and tags. Existing `tag:` and `source:` filter tokens keep working, and a card result opens the card in the Deck Manager / card editor.
- **A "Browser Extension" deck exists and is kept in sync.** The app ensures a deck named `Browser Extension` with tag filter `browser-extension` exists whenever extension-created cards are present, so imported cards appear in the Deck Manager without the user having to build a deck by hand.
- **Extension provenance tagging is completed and made consistent.** All learning items created through the local extension server carry `browser-extension` plus a kind tag (`image-occlusion`, `ai-generated`). The manual-save path currently omits it.
- **Moving a card between decks no longer destroys its tags.** `handleCardMoveToDeck` today replaces a card's entire tag list with the target deck's tag filters, wiping `browser-extension`, `image-occlusion`, and any unrelated user tags. Moving becomes a swap of deck-filter tags only; provenance tags are preserved, so a card filed into "Anatomy" is still findable by `tag:browser-extension`.

Non-goals: no FTS5 indexing of learning items (client-side filtering matches the existing Documents view search), no new database tables, no changes to the extension itself.

## Capabilities

### New Capabilities
- `documents-card-search`: Documents view search returns matching learning items / flashcards in a separate result group, using the same query-token grammar as document search.
- `browser-extension-deck`: Extension-created learning items carry provenance tags, are surfaced in the Deck Manager through an auto-maintained "Browser Extension" deck, and can be moved to other decks without losing those tags.

### Modified Capabilities
<!-- None: no existing spec in openspec/specs/ covers Documents view search, the Deck Manager, or the browser-extension import path. -->

## Impact

- `src/utils/documentsView.ts` — reuse `parseDocumentSearch` tokens for a new card matcher.
- `src/components/documents/DocumentsView.tsx` — lazy-load learning items on first search, render the Cards result group.
- `src/stores/studyDeckStore.ts` — reserved-deck helper for the auto-maintained Browser Extension deck.
- `src/utils/studyDecks.ts` — tag-swap helper that preserves non-deck tags.
- `src/components/review/DeckManager.tsx` — move-to-deck uses the tag-swap helper.
- `src-tauri/src/browser_sync_server.rs` — provenance tags on the manual card-save path.
- No new dependencies, no migrations, no Tauri command surface changes.
