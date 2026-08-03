## Why

The pending NotebookLM study-sync work (`openspec/changes/add-notebooklm-integration/specs/notebooklm-study-sync/spec.md`) currently requires the user to manually pick a destination deck every time they sync flashcards generated from a NotebookLM notebook. That's extra friction for what is otherwise a one-click sync, and it throws away information Incrementum already has: the notebook a card came from. Cards synced from different notebooks (e.g. "Organic Chemistry Ch. 4" vs. "US History Midterm") should land in distinctly named decks automatically, the same way `.apkg` imports already land in a deck named after the source Anki deck (`ReviewHome.tsx::handleImportDeck` → `ensureDecksExist`).

## What Changes

- When cards are synced from a NotebookLM flashcard/quiz artifact, default the destination deck to one named after the source notebook (e.g. its NotebookLM title), auto-creating the deck via the existing `ensureDecksExist` tag-based deck pattern if it doesn't already exist.
- Still allow the user to override the suggested deck name or pick a different existing deck before confirming the sync (refines, doesn't remove, the existing "user-selected deck" requirement).
- Sanitize/dedupe notebook titles when deriving deck names (trim, collapse whitespace, fall back to a generic name like "NotebookLM Import" if the notebook has no title), and reuse an existing deck by case-insensitive name match rather than creating duplicates on repeat syncs from the same notebook — consistent with `ensureDecksExist`'s existing behavior.
- Tag synced cards with source attribution back to the originating notebook (extending the existing `source_url`-style provenance pattern used for podcasts/web extracts) so cards can be traced back to their notebook independent of the deck they end up in.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `notebooklm-study-sync` (currently only proposed/unimplemented in `add-notebooklm-integration`, not yet archived under `openspec/specs/`): the "User can sync NotebookLM flashcards into Incrementum study decks" requirement changes from requiring an explicit user-chosen deck to defaulting the destination deck to the source notebook's name, with the user able to override before confirming.

## Impact

- `src-tauri/src/notebooklm.rs` / notebooklm sync command(s) (to be added as part of `add-notebooklm-integration`) — pass the source notebook title through to the sync/import step.
- `src/stores/studyDeckStore.ts` (`ensureDecksExist`) — reused as-is for creating/reusing the notebook-named deck.
- `src/utils/studyDecks.ts` — reused for deck name normalization/matching; may need a small helper for sanitizing notebook titles into deck-safe names.
- Whatever sync-confirmation UI ships with `add-notebooklm-integration`'s study-sync feature — pre-fill the destination deck field with the derived notebook-name deck instead of leaving it blank/required.
- Card provenance: extend the `source_url`-style field (see `src-tauri/src/models/extract.rs`) or equivalent card metadata to record the originating notebook.
- This change is dependent on / should land alongside the still-unimplemented `notebooklm-study-sync` capability in `add-notebooklm-integration` — it refines that capability's deck-selection behavior rather than standing alone.
