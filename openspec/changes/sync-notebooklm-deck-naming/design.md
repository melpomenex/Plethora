## Context

Decks in Incrementum are virtual and tag-based, not a separate DB table: a `StudyDeck` (`src/types/study-decks.ts`) has a `tagFilters: string[]`, and membership is computed at query time by matching a card's `learning_items.tags` against those filters (`matchesDeck` in `src/utils/studyDecks.ts`). The existing import path that creates decks from source metadata is `ensureDecksExist` (`src/stores/studyDeckStore.ts`, called from `ReviewHome.tsx::handleImportDeck` for `.apkg`/JSON imports): given a list of deck names, it creates a `StudyDeck` per name (name-as-tag-filter) or reuses an existing one by case-insensitive name match, then tags the imported cards with that deck name.

The NotebookLM sync feature itself (mapping NotebookLM flashcard/quiz artifacts into Incrementum cards) is not yet implemented — it exists only as an unimplemented spec (`notebooklm-study-sync` in `openspec/changes/add-notebooklm-integration`) which currently says the system "SHALL ... place them in a user-selected deck." This change defines how that not-yet-built sync step should derive a default deck name from the source notebook, reusing `ensureDecksExist` rather than inventing a new deck-creation path.

## Goals / Non-Goals

**Goals:**
- Define how a NotebookLM notebook's title becomes a deck name/tag, reusing the existing tag-based deck model (no schema change).
- Ensure repeat syncs from the same notebook land in the same deck (case-insensitive reuse, matching `ensureDecksExist`'s existing semantics).
- Preserve user control: the derived name is a default/pre-fill, not forced.
- Preserve provenance: a card should be traceable to its source notebook even if the user renames/merges the deck later.

**Non-Goals:**
- Building the NotebookLM flashcard/quiz sync pipeline itself (artifact selection, card field mapping, dedupe rules) — that's `add-notebooklm-integration`'s `notebooklm-study-sync` scope; this change only specifies the deck-naming/default-selection behavior within it.
- Deck hierarchy/nesting beyond what `tagFilters` already supports (e.g. `::`/`/` separators) — out of scope unless a notebook naturally maps to a nested structure, which it doesn't by default.
- Retroactively renaming/reorganizing decks for cards synced before this change ships.

## Decisions

- **Derive deck name from notebook title, not notebook ID.** Titles are human-meaningful ("aptly named" per the request); IDs are opaque. Rationale: matches the Anki import precedent, which uses the Anki deck's human name.
  - Alternative considered: prefix with a fixed namespace, e.g. "NotebookLM: <title>", to visually distinguish these decks from manually created ones. Left as an open question below rather than decided, since it affects the UX the sync-confirmation dialog will need to build.
- **Reuse `ensureDecksExist` verbatim** rather than adding a NotebookLM-specific deck-creation function. Rationale: keeps deck creation/reuse semantics (case-insensitive name matching, tag-filter-as-name) consistent across every import path, avoiding the exact kind of inconsistency the sibling `organize-cards-into-decks` change is fixing for `.apkg` imports.
- **Sanitize notebook titles before use as deck names/tags**: trim, collapse internal whitespace, strip characters that would break tag matching (e.g. commas, since tags are often comma-delimited elsewhere in the app), and fall back to a generic name ("NotebookLM Import") if the title is empty after sanitization. Rationale: notebook titles are free-text user input in NotebookLM and aren't guaranteed to be tag-safe.
- **Record source notebook provenance separately from the deck tag**, using a `source_url`-style field (e.g. `notebooklm://<notebook_id>`) rather than only the deck tag. Rationale: if a user later renames the deck, merges cards into a different deck, or the notebook title changes, the card should still be traceable to its origin — matching how podcast-sourced cards keep `source_url = "podcast://{episode.id}"` independent of any deck tag.

## Risks / Trade-offs

- [Two different NotebookLM notebooks happen to have the same (or same-after-sanitization) title] → `ensureDecksExist`'s case-insensitive reuse will merge them into one deck. Acceptable: matches existing Anki-import behavior for same-named decks, and the user can still rename/split after the fact via Deck Manager.
- [Notebook is renamed in NotebookLM after a prior sync already created a deck under the old name] → next sync will create a *new* deck under the new name rather than reconciling with the old one, since matching is by current name only. Mitigation: out of scope to auto-migrate; the `source_url`-style provenance field lets a future feature reconcile/merge if needed.
- [Sanitization collapses two distinctly-titled notebooks to the same fallback name] → both would share the "NotebookLM Import" deck. Acceptable given how rare empty/unsanitizable titles should be; not worth generating disambiguating suffixes.

## Open Questions

- Should notebook-derived decks be visually namespaced (e.g. "NotebookLM: <title>") in Deck Manager, or should they look identical to any other deck? Leaving this to whoever designs the sync-confirmation UI in `add-notebooklm-integration`, since it's a UI decision more than a data-model one.
- Exact shape of the sync-confirmation UI (pre-filled editable deck name field vs. deck picker defaulting to the notebook) is owned by `add-notebooklm-integration`'s implementation, not this change.
