## 1. Document Replication Layer

- [x] 1.1 Add `deleteDocumentSync` function in `src/lib/documentReplication.ts` to write tombstone markers to the Yjs `documents` map.
- [x] 1.2 Update the Yjs observer `handleRemoteDocument` in `src/lib/documentReplication.ts` to process tombstone values by deleting the document from SQLite, unregistering the local file loader, clearing the cached file, and triggering a store refresh.

## 2. Store and Command Integration

- [x] 2.1 Integrate `deleteDocumentSync` in `src/stores/documentStore.ts` for single, optimistic, and bulk deletions.
- [x] 2.2 Integrate `deleteDocumentSync` and `publishDocument` in `src/commands/undoableCommands.ts` inside `DeleteDocumentCommand` for deletion sync and undo/restore sync respectively.

## 3. Verification

- [x] 3.1 Verify that deleting a document locally writes a tombstone to the Yjs documents map.
- [x] 3.2 Verify that receiving a tombstone marker deletes the corresponding document locally, clean up local file sync registrations/caches, and does not cause the document to reappear on app restart.
