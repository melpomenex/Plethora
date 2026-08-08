## Context

Three existing mechanisms meet in this change:

1. **Documents view search** (`src/utils/documentsView.ts`, `src/components/documents/DocumentsView.tsx`) is entirely client-side. `parseDocumentSearch` turns the query string into `{ text, tags, sources, queue, extracts }`, and `matchesDocumentSearch` filters the already-loaded `documents` array. There is no learning-item awareness anywhere in the view — only per-document `learningItemCount` badges.

2. **Decks are client-side tag filters.** `StudyDeck` (`src/types/study-decks.ts`) is `{ id, name, tagFilters, documentId?, filterType, ... }`, persisted in localStorage by `studyDeckStore` (zustand `persist`, key `incrementum-study-decks`, version 2). Deck membership is computed at render time by `matchesDeck` / `filterByDeck` in `src/utils/studyDecks.ts`. There is no deck table, no `deck_id` column on learning items, and no backend involvement at all.

3. **The extension already tags its cards.** `handle_image_occlusion_request` sets `tags = ["browser-extension", "image-occlusion"]` (`src-tauri/src/browser_sync_server.rs:1957`) and the AI save path sets `["browser-extension", "ai-generated"]` (`:2399`). The extension has exactly two card-creating routes — `/ai/image-occlusion` and `/ai/process` with `save_flashcards` — both of which comply today.

So the data needed for both features already exists. What's missing is surfacing: `DeckManager` renders `decks.filter(...)` and a card with `browser-extension` matches no deck unless the user hand-builds one, and the search never looks at cards.

One real defect blocks the "move them around to other decks" half of the request: `handleCardMoveToDeck` (`src/components/review/DeckManager.tsx:605`) does `tags: [...deck.tagFilters]` — a wholesale replacement. Moving an occlusion card into "Anatomy" silently deletes `browser-extension`, `image-occlusion`, and any unrelated user tags, so the provenance tag this change relies on would not survive first contact with the feature.

## Goals / Non-Goals

**Goals:**
- Documents view search returns matching flashcards in their own result group.
- Extension imports show up in the Deck Manager without user setup, and can be filed into real decks.
- Provenance tags survive deck moves so `tag:browser-extension` stays a durable query.
- No new backend surface: no migrations, no Tauri commands, no dependencies.

**Non-Goals:**
- FTS5 indexing of learning items. `document_search` / `extract_search` exist (`migrations.rs:963`, `:994`) but adding a third virtual table plus triggers is a migration and a reindex path for a search that is already client-side elsewhere in this view.
- A first-class deck entity in SQLite. Real deck rows would fix several long-standing rough edges, but that is a much larger change and is not what this request needs.
- Changing the browser extension itself. All work is app-side; the extension already sends what is needed.

## Decisions

### 1. Reuse `parseDocumentSearch` tokens; add a sibling `matchesCardSearch`

`src/utils/documentsView.ts` gains `matchesCardSearch(item, tokens)` next to `matchesDocumentSearch`. It matches `tokens.text` against question + answer + cloze text + tags, and requires every `tokens.tags` entry to be present.

Document-only tokens (`source:`, `queue:`, `extracts`) return `false` for all cards, so `source:pdf` does not drag an unrelated card list into view. This is a deliberate choice over "ignore unknown tokens": ignoring them would make `source:pdf` return every card whose text matched, which reads as a bug.

*Alternative considered:* a separate card-query grammar (`card:`, `deck:` tokens). Rejected — the user asked to search cards from the Documents view, not to learn a second query language. A `deck:` token can be added later on top of the same token struct if wanted.

### 2. Lazy single fetch of learning items on first search

`DocumentsView` calls the existing `getAllLearningItems()` (`src/api/learning-items.ts:108`) once, triggered by the first non-empty `debouncedSearch`, cached in state for the life of the view. Filtering is a `useMemo` over that array, mirroring how documents are already filtered.

This is what `DeckManager` already does (`DeckManager.tsx:103`), so the cost profile is known rather than guessed. Fetch failures set the card list to empty and log — document results must not be blocked by a card fetch.

*Alternative considered:* a new `search_learning_items` Tauri command with SQL `LIKE`. Rejected for now — it adds a command, a repository method, and an async race per keystroke to replace a `useMemo`. If the card count grows past what a client-side filter handles comfortably, that command is the upgrade path, and the `matchesCardSearch` boundary is where it plugs in.

### 3. The Browser Extension deck is an ordinary tag-filter deck, ensured once per Deck Manager mount

On `DeckManager` mount, after cards load, if any card carries `browser-extension` and no deck already filters on that tag, create one:

```
addDeck("Browser Extension", ["browser-extension"], undefined, "tags")
```

Two details matter:

- **`filterType` must be `"tags"`.** `addDeck`'s default is `"all"`, and `matchesDeck` with `filterType === "all"` and no `documentId` returns `true` for *every* card — the deck would swallow the entire collection. This is the single easiest way to get this change wrong.
- **`addDeck` already dedupes by case-insensitive name and merges tag filters**, which gives idempotency for free. No new store method is needed.

Running the check once per mount (guarded by a ref) satisfies "deleting the deck does not instantly resurrect it" without persisting a `dismissed` flag. It will reappear on the next visit to the Deck Manager; that is an accepted trade-off — the alternative is new persisted state in a store that already carries a migration.

Detection is by tag filter, not by name, so a user who renames the deck to "Web Clips" keeps one deck instead of getting a second one created beside it.

*Alternative considered:* extending `seedFromDocuments` to seed from learning items. Rejected — it early-returns when any deck exists (`studyDeckStore.ts:135`), so it only ever runs for a brand-new user and would silently do nothing for everyone else.

*Alternative considered:* creating the deck in the Rust import handler. Rejected — decks live in localStorage in the WebView; Rust cannot write them.

### 4. Deck moves swap deck tags instead of replacing all tags

New helper in `src/utils/studyDecks.ts`:

```
swapDeckTags(cardTags, decks, targetDeck) -> string[]
```

It drops every tag that is a tag filter of some deck the card currently matches, adds the target deck's tag filters, and leaves everything else untouched. Tag comparison reuses the existing `normalize` / `tagMatchesFilter` semantics (including the `deck:` prefix and `::`/`/` hierarchy handling) so behavior stays consistent with `matchesDeckTags`.

`handleCardMoveToDeck` then calls the helper instead of `[...deck.tagFilters]`, keeping its existing optimistic-update-then-reload-on-failure structure.

This is the root-cause fix rather than a special case for `browser-extension`: any tag the user cares about currently gets destroyed by a move, and the same helper serves both.

### 5. Rust side: one shared provenance helper

`browser_sync_server.rs` gains a small `fn browser_import_tags(kind: &str) -> Vec<String>` returning `vec!["browser-extension", kind]`, used by both existing call sites (`:1957`, `:2399`). Both already produce the correct tags, so this is not a behavior change — it exists so a future third route cannot quietly ship untagged cards. Two call sites is the whole justification; nothing more is built here.

## Risks / Trade-offs

- **Large collections make the client-side card filter slow** → `getAllLearningItems` already runs at this scale in the Deck Manager, and the fetch is lazy and cached. Escape hatch is documented in decision 2 (a `search_learning_items` command behind the same `matchesCardSearch` boundary).
- **`filterType: "all"` misconfiguration makes the deck match every card** → called out in decision 3 and covered by a unit test asserting the created deck's `filterType` and `tagFilters`.
- **Deleting the Browser Extension deck only sticks until the next Deck Manager visit** → accepted; documented behavior, and the deck is a normal renamable deck so a user who wants it gone-but-different can rename it instead.
- **`swapDeckTags` could strip a tag that is both a deck filter and a meaningful user tag** → only tags belonging to decks the card *currently matches* are dropped, which is exactly the set that defines its present deck membership. Non-matching decks' filters are left alone.
- **Provenance tags become load-bearing for search** → they are plain tags a user can still delete by hand from the card editor. That is intentional; nothing hides them or protects them beyond the move path.

## Migration Plan

No data migration. No schema change. The `studyDeckStore` persisted version stays at 2 — the Browser Extension deck is an ordinary deck record created through the existing `addDeck` path, indistinguishable from a user-created one in storage.

Rollback is reverting the commit; the only persisted residue is a normal deck row in localStorage the user can delete.

## Open Questions

- Should the Cards result group be collapsible or capped (e.g. first 50 with a "show all")? Deferred to implementation — cap only if a real collection makes the list unwieldy.
- Should `deck:<name>` become a search token in the Documents view? Out of scope; the token struct is the place to add it later.
