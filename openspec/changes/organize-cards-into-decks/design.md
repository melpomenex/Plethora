## Context

Decks are virtual: there is no `deck_id`/`collection_id` column on `learning_items` (`src-tauri/migrations/001_initial.sql:91-118`). A `StudyDeck` (`src/types/study-decks.ts`) is a client-side, Zustand-persisted record (`src/stores/studyDeckStore.ts`) holding a `tagFilters` array; membership is computed at query time by `matchesDeck()` in `src/utils/studyDecks.ts`, which matches an item's `tags` JSON column (and optionally `document_id`) against a deck's filters.

`.apkg` import already writes the source Anki deck name into each imported item's `tags` (`src-tauri/src/anki.rs` `build_learning_item`, ~line 650). Whether that translates into a visible Deck Manager deck depends entirely on whether the caller also invokes `useStudyDeckStore.getState().ensureDecksExist(deckNames)`. `ReviewHome.tsx::handleImportDeck` and `ReviewSession.tsx` do this; `DocumentsView.tsx::handleAnkiPackage` does not, so cards imported there get the right tag but no matching deck, and appear as if they belong nowhere.

Deck Manager (`src/components/review/DeckManager.tsx`) already renders a per-card list per deck and has a working single-card "move to deck" (`handleCardMoveToDeck`, lines 604-619), which reassigns `tags` to the target deck's `tagFilters`. This change extends that same mechanism to bulk selection and adds a synthetic "Unfiled" pseudo-deck.

## Goals / Non-Goals

**Goals:**
- Every `.apkg` import path creates/attaches decks by Anki deck name, regardless of which UI entry point (Review Home, Review Session, or Documents drag-drop) was used.
- Users can find cards not currently matched by any deck (an "Unfiled" view) without needing to know current tag state.
- Users can select multiple cards in Deck Manager and move them to a deck (existing or new) in one action, rather than one at a time.

**Non-Goals:**
- No database schema changes. Decks remain tag-based/virtual, consistent with the existing `flashcard-deck-manager` decision.
- No change to how deck *filters* work generally (difficulty/state/document filters, hierarchy separators) — only to assignment ergonomics and import wiring.
- No redesign of the .apkg import UI/dialog flow beyond auto-creating decks (still no manual deck-picker dialog on import; the existing TODO for that is superseded, not implemented).

## Decisions

**1. "Unfiled" is a computed pseudo-deck, not a stored one.**
Compute it client-side as `allCards.filter(card => !decks.some(deck => matchesDeck(card, deck)))`, reusing `matchesDeck` from `src/utils/studyDecks.ts`. Alternative considered: materialize an actual "Unfiled" `StudyDeck` with an empty/negated filter — rejected because `matchesDeck`'s filter model has no "NOT any of these" semantics and forcing it in would complicate every other deck's matching logic for one special case.

**2. Bulk move reuses the existing single-card reassignment mechanism.**
`handleCardMoveToDeck` already overwrites a card's relevant tag(s) with the target deck's `tagFilters`. Bulk move is the same operation looped over a selection set (batched into a single store/DB update rather than N sequential ones, to keep it fast and atomic-feeling for large selections). Alternative considered: a dedicated bulk-tag-update backend command — deferred; client-side batching over the existing per-card path is sufficient at current data volumes and avoids new Rust surface area.

**3. Fix import wiring at the call site, not in the shared import util.**
`ensureDecksExist(deckNames)` is added directly to `DocumentsView.tsx::handleAnkiPackage`, mirroring `ReviewHome.tsx::handleImportDeck`. Alternative considered: move `ensureDecksExist` into `ankiImport.ts` itself so every caller gets it "for free" — rejected for this change because it would silently change behavior for any other current/future caller that might intentionally want raw import without deck creation; explicit call sites keep the behavior visible and matches the existing pattern.

## Risks / Trade-offs

- [Large bulk moves (thousands of cards) could be slow if done as many individual store updates] → Batch the tag rewrite into a single store mutation / single SQL update where the backend supports it, rather than per-card round trips.
- [Unfiled view recomputes on every render for large libraries] → Memoize the unfiled set keyed on `(cards, decks)` reference identity, matching existing patterns already used for other computed deck lists in `DeckManager.tsx`.
- [Users may expect .apkg re-import to *not* duplicate decks] → `ensureDecksExist` already dedupes by deck name (`studyDeckStore.ts:110-131`), so re-imports attach to the same existing deck rather than creating duplicates — no new logic needed here, just confirming existing behavior via tests.

## Migration Plan

No data migration required (no schema change). Roll out as a normal UI/logic release. Rollback is a plain revert since no persisted state format changes.
