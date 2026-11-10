## Why

Incremental reading is designed for sustained comprehension and progressive knowledge extraction across documents, whereas flashcards test discrete memory recall. Plethora currently conflates these two workflows: reading a document triggers flashcard-style memory scheduling prompts, and items created on the current day are erroneously classified as "Overdue" within minutes of creation due to millisecond-level timestamp comparisons (`due < now`, screenshot 13). Correcting these scheduling semantics is essential to restore user trust and maintain accurate queue telemetry.

## What Changes

- Clarify document rotation as an incremental reading topic scheduler distinct from flashcard FSRS memory recall. Reading a document updates reading position and schedules next reading rotation; it does NOT record memory retrievability or recall grades (Again/Hard/Good/Easy).
- Fix the same-day overdue regression: normalize due-state comparisons to local calendar-day boundaries. An item scheduled for today is marked "Due Today", never "Overdue", on its creation calendar day.
- Unify overdue derivation across `reviewUx.ts`, `scheduleItemPresentation.ts`, and `terms.rs` to ensure bounded, monotone overdue scoring without 14-day hard ceilings.
- Add document rotation preferences in Settings and register search coverage (`setting-document-rotation-interval`).

## Capabilities

### New Capabilities

- `document-rotation-and-new-item-scheduling`: Independent document reading rotation lifecycles, calendar-day normalized due state calculations, and zero-minute same-day overdue immunity.

### Modified Capabilities

- `queue-flashcard-review-cards`: Disambiguate flashcard recall review from document reading sessions.
- `settings-search-coverage`: Register document rotation interval in settings search catalog.

## Impact

- **Backend**: `src-tauri/src/algorithms/daqe/terms.rs`, `src-tauri/src/commands/queue.rs`.
- **Frontend**: `src/utils/reviewUx.ts`, `src/lib/scheduleItemPresentation.ts`, `src/lib/scheduleViewModel.ts`, `src/components/review/ReviewQueueView.tsx`, `src/components/review/DeckManagerCardRow.tsx`.
- **Invariants**: Existing FSRS parameters for flashcards remain untouched. Stored due dates remain valid ISO-8601 strings. No historical review logs rewritten.
