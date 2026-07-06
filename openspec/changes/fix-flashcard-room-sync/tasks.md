## 1. Implement Flashcard Sync Entity Helpers

- [x] 1.1 Implement and export `publishCardDeleted` in `src/lib/sync/entities/flashcards.ts`
- [x] 1.2 Implement and export `publishCardById` in `src/lib/sync/entities/flashcards.ts`
- [x] 1.3 Implement and export `publishCards` in `src/lib/sync/entities/flashcards.ts`
- [x] 1.4 Implement and export `publishRecentlyModifiedCards` in `src/lib/sync/entities/flashcards.ts`

## 2. Hook API/Command Card Mutations

- [x] 2.1 Hook card creations in `createLearningItem` and `generateLearningItemsFromExtract` within `src/api/learning-items.ts`
- [x] 2.2 Hook card edits in `updateLearningItemContentWithVersion` and `revertLearningItemVersion` within `src/api/learning-items.ts`
- [x] 2.3 Hook `bulkSuspendItems` and `bulkUnsuspendItems` in `src/api/queue.ts` to fetch and publish the modified cards
- [x] 2.4 Hook card deletes and undos in `DeleteLearningItemCommand` and `BulkDeleteItemsCommand` within `src/commands/undoableCommands.ts`
- [x] 2.5 Hook card bulk deletes in `bulkDeleteItems` within `src/api/queue.ts`

## 3. Hook Bulk Rescheduling Operations

- [x] 3.1 Hook `postponeItem` and `advanceItem` in `src/api/queue.ts` to publish the modified card
- [x] 3.2 Hook bulk load-management operations (`load_balance_queue`, `advance_due_queue`, `apply_easy_days`) in `src/api/queue.ts` using HLC windowing and `publishRecentlyModifiedCards`

## 4. Hook Card Imports and Reseeding

- [x] 4.1 Implement and export `triggerReSeed` helper in `src/lib/sync/migrate.ts`
- [x] 4.2 Call `publishCards` on imported cards inside `importAnkiPackageFromPicker` in `src/utils/ankiImport.ts`
- [x] 4.3 Call `publishCards` or `triggerReSeed` in `src/components/settings/ImportExportSettings.tsx` after `.apkg`, legacy archive, and collection archive imports
