## Context

Flashcards in Incrementum are synced via Yjs maps (`learningItems` for SRS records and `reviews` for the append-only review log). However, the synchronization is currently intermittent because card CRUD operations (create, edit, delete, suspend, and bulk imports) do not call the Yjs publish hooks. Only card reviews trigger card state publishing. 

This design implements comprehensive publishing hooks for all card mutations to ensure immediate, reliable sync across all Tauri devices in a room.

## Goals / Non-Goals

**Goals:**
- Hook all card creation, editing, reversion, generation, suspension, and deletion paths to publish updates to Yjs.
- Implement robust sync support for bulk operations (bulk suspend, postpone, advance, load balancing, easy days) and imports (.apkg, legacy zip archives, collection archives).
- Keep implementation localized to the frontend API/command layers to avoid breaking backend changes.

**Non-Goals:**
- Enabling full database/map sync on web/PWA browser environments (which is gated by `isTauri()` in `replicatedMap.ts` and lacks corresponding browser-backend mocked database tables).

## Decisions

### 1. Helper exports in flashcard sync entity module
Expose new publishing functions in `src/lib/sync/entities/flashcards.ts`:
- `publishCardDeleted(id)`: tombstone deletes a card from Yjs.
- `publishCardById(id)`: queries the card from local DB, stamps it with `nowHLC()`, and publishes to Yjs.
- `publishCards(cards)`: processes card arrays, stamps them, and publishes in chunks of 50.
- `publishRecentlyModifiedCards(sinceHlc)`: fetches all cards, filters for `updated_at > sinceHlc`, and publishes them.

### 2. Hooking card CRUD operations in API and command layers
- **Create/Update/Revert/Generate**: Hook `createLearningItem`, `updateLearningItemContentWithVersion`, `revertLearningItemVersion`, and `generateLearningItemsFromExtract` to call `publishCard` or `publishCards` with the returned item(s).
- **Delete**: Hook `DeleteLearningItemCommand.execute()`, `BulkDeleteItemsCommand.execute()`, and `bulkDeleteItems` to call `publishCardDeleted(id)`.
- **Undo Re-creation**: Hook `undo()` in `DeleteLearningItemCommand` and `BulkDeleteItemsCommand` to call `publishCard` on the restored card(s).

### 3. Syncing bulk load-management operations using HLC windowing
For scheduling operations (`load_balance_queue`, `advance_due_queue`, `apply_easy_days`) which update multiple cards directly in SQLite and return counts rather than IDs:
- Capture `beforeHLC = nowHLC()` before invoking the Tauri command.
- Invoke the command.
- Call `publishRecentlyModifiedCards(beforeHLC)` to find and publish all cards updated in SQLite during the operation.

### 4. Syncing imports by resetting migration / re-seeding
For Anki imports (`.apkg`) and collection/legacy archives, after a successful import:
- Reset the sync migration flag in `localStorage` (`incrementum_yjs_migration_v3_done:<room>`).
- Re-run `startSyncSubsystems()` and `runSyncMigrationIfNeeded()` to backfill all imported cards to Yjs in background batches.

## Risks / Trade-offs

- **Risk**: Saturation of the Yjs sync log if thousands of cards are imported and published at once.
- **Mitigation**: Batch all card seedings and imports in chunks of 50, yielding to the event loop between batches using `setTimeout(r, 0)` so the websocket provider has room to process messages without dropping the connection.
