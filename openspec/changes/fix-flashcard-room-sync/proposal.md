## Why

Flashcard room sync is currently intermittent and fails to keep all devices in the same room in sync. This is because flashcard creation, editing, suspension, deletion, and importing do not publish updates to the shared Yjs room map; only card reviews trigger a sync event. 

This change ensures all card CRUD actions, including bulk operations and imports, publish their updates to the room's sync map, making flashcard sync reliable across all devices in the same room.

## What Changes

- Hook card creation (`createLearningItem`), card content editing (`updateLearningItemContentWithVersion`), version reversion (`revertLearningItemVersion`), and extract card generation (`generateLearningItemsFromExtract`) to publish changes to the shared `learningItems` Yjs map.
- Hook card suspension (`bulkSuspendItems`/`bulkUnsuspendItems`) and postpone/advance operations to fetch and publish updated card states.
- Hook card deletion (`delete_item` / `bulkDeleteItems`) to publish tombstone/deletes to Yjs.
- Ensure that importing an Anki `.apkg` package or restoring a collection/legacy archive triggers a synchronization re-seed, backfilling all imported cards to the sync room.
- Export utility functions (`publishCardDeleted`, `publishCardById`, `publishCards`, and `publishRecentlyModifiedCards`) from the flashcard sync entity module to support these hook flows.

## Capabilities

### New Capabilities
- `flashcard-room-sync`: The system must synchronize all card CRUD changes (creations, updates, deletes, suspension toggles, scheduling shifts, and bulk imports) across all devices in the same sync room using Yjs.

### Modified Capabilities

## Impact

- **API/Command Layer**: Hook mutations in `src/api/learning-items.ts`, `src/api/queue.ts`, and `src/commands/undoableCommands.ts`.
- **Sync/Replication Layer**: Add export helpers in `src/lib/sync/entities/flashcards.ts`. Hook into Anki/Archive imports in `src/utils/ankiImport.ts` and `src/components/settings/ImportExportSettings.tsx`.
